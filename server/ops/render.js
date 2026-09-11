/**
 * Theater-Bild-Gelöte — Renderjobs
 * ===========================================================================
 *
 * Setzt die Filtergraphen aus filtergraph.js in echte ffmpeg-Laeufe um.
 *
 * Jede Funktion bekommt als erstes Argument den Jobkontext aus server/jobs.js:
 *   ctx = { setProgress(0..1), log(zeile), signal, setResult(obj) }
 *
 * Grundsaetze:
 *   - Jeder ffmpeg-Aufruf steht als lesbare Kommandozeile im Ergebnis
 *     (result.command) und wird zusaetzlich ins Joblog geschrieben. Es gibt
 *     keinen Schritt, den der Nutzer nicht sehen kann.
 *   - Kein Fehler ist still: alles Gefangene wird geloggt UND als deutscher
 *     Klartext weitergeworfen.
 *   - Vor jedem Render wird geprueft, ob das Zielverzeichnis existiert und
 *     beschreibbar ist. Ein Abbruch nach zwanzig Minuten Rechnen, weil der
 *     Ordner schreibgeschuetzt ist, waere unverzeihlich.
 *   - Nach jedem Render wird die Ausgabedatei geprobt und gegen die Erwartung
 *     verglichen (result.verify).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { targetFrameCount, deliveryName, getWallSpec } from '../../shared/model.js';
import { buildWallGraph, graphToCommand, formatCommandLine, explainGraph, num } from './filtergraph.js';

// Namensraum-Import: so scheitert das Laden nicht schon daran, dass ein
// einzelner Export in deliver.js (noch) anders heisst. Was fehlt, faellt
// unten auf die Presetdaten aus dem Venue-JSON zurueck.
import * as deliver from './deliver.js';

/* ==========================================================================
 * Anbindung an die uebrigen Servermodule
 *
 * paths.js, ffmpeg.js und probe.js werden von anderen Modulen bereitgestellt.
 * Sie werden hier dynamisch geladen, damit ein noch fehlendes Modul nicht das
 * ganze Laden von render.js verhindert — und damit klar im Klartext gemeldet
 * wird, was fehlt, statt eines nackten ERR_MODULE_NOT_FOUND beim Serverstart.
 * ========================================================================== */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

async function optionalImport(spec) {
  try {
    return await import(spec);
  } catch (err) {
    if (err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND')) return null;
    throw err; // echter Fehler im Modul — nicht verschlucken
  }
}

let _paths;
async function studioPaths() {
  if (_paths) return _paths;
  const mod = await optionalImport('../paths.js');
  const cand = mod ? (mod.paths ?? mod.PATHS ?? mod.default ?? mod) : null;
  if (cand && typeof cand === 'object' && cand.root) {
    _paths = cand;
  } else if (mod && typeof mod.getPaths === 'function') {
    _paths = await mod.getPaths();
  } else {
    // Notfall-Ableitung aus der Lage dieser Datei: server/ops -> Projektwurzel.
    _paths = {
      root: ROOT,
      bin: path.join(ROOT, 'bin'),
      cache: path.join(ROOT, '.cache'),
      proxies: path.join(ROOT, 'proxies'),
      thumbs: path.join(ROOT, 'thumbs'),
      out: path.join(ROOT, 'out'),
    };
  }
  return _paths;
}

let _bins;

/**
 * Gemerkte ffmpeg-Pfade verwerfen.
 *
 * Noetig nach einer ffmpeg-Installation (vorher war der Rueckfall "ffmpeg aus
 * dem PATH" gemerkt, jetzt liegt ein eigenes Binary im Arbeitsverzeichnis) und
 * nach einem Wechsel des Arbeitsverzeichnisses (das bin/ liegt dann woanders).
 * Ohne das benutzt der naechste Render stur die alten Pfade.
 */
export function resetBins() {
  _bins = undefined;
}
/** Pfade zu ffmpeg und ffprobe ermitteln. */
async function resolveBins() {
  if (_bins) return _bins;
  const p = await studioPaths();
  let ffmpeg = null;
  let ffprobe = null;

  const mod = await optionalImport('../ffmpeg.js');
  if (mod) {
    // Der Vertrag von ffmpeg.js legt keinen Exportnamen fest, deshalb werden
    // die gebraeuchlichen Formen akzeptiert.
    for (const key of ['ffmpegPath', 'FFMPEG_PATH', 'ffmpegBin']) {
      if (typeof mod[key] === 'string') ffmpeg = mod[key];
    }
    for (const key of ['ffprobePath', 'FFPROBE_PATH', 'ffprobeBin']) {
      if (typeof mod[key] === 'string') ffprobe = mod[key];
    }
    for (const fn of ['resolveFfmpeg', 'findFfmpeg', 'getFfmpeg', 'detectFfmpeg', 'ffmpegInfo']) {
      if (ffmpeg && ffprobe) break;
      if (typeof mod[fn] !== 'function') continue;
      try {
        const info = await mod[fn]();
        if (!info) continue;
        ffmpeg = ffmpeg || info.ffmpeg?.path || info.ffmpegPath || (typeof info.path === 'string' ? info.path : null);
        ffprobe = ffprobe || info.ffprobe?.path || info.ffprobePath || null;
      } catch {
        /* naechste Variante probieren */
      }
    }
  }

  const exe = process.platform === 'win32' ? '.exe' : '';
  if (!ffmpeg) {
    const bundled = path.join(p.bin || path.join(ROOT, 'bin'), `ffmpeg${exe}`);
    ffmpeg = (await exists(bundled)) ? bundled : `ffmpeg${exe}`;
  }
  if (!ffprobe) {
    const bundled = path.join(p.bin || path.join(ROOT, 'bin'), `ffprobe${exe}`);
    ffprobe = (await exists(bundled)) ? bundled : `ffprobe${exe}`;
  }

  _bins = { ffmpeg, ffprobe, fromModule: Boolean(mod) };
  return _bins;
}

async function exists(f) {
  try {
    await fs.access(f);
    return true;
  } catch {
    return false;
  }
}

/* ==========================================================================
 * ffmpeg ausfuehren
 * ========================================================================== */

/** Jobkontext gegen fehlende Felder absichern (z.B. Aufruf aus der CLI). */
function safeCtx(ctx) {
  const c = ctx || {};
  return {
    setProgress: typeof c.setProgress === 'function' ? c.setProgress.bind(c) : () => {},
    log: typeof c.log === 'function' ? c.log.bind(c) : () => {},
    setResult: typeof c.setResult === 'function' ? c.setResult.bind(c) : () => {},
    setCommand: typeof c.setCommand === 'function' ? c.setCommand.bind(c) : null,
    signal: c.signal || null,
  };
}

function abortIfCancelled(ctx) {
  if (ctx.signal && ctx.signal.aborted) {
    const e = new Error('Job wurde abgebrochen.');
    e.cancelled = true;
    throw e;
  }
}

/**
 * ffmpeg starten und den Fortschritt aus "-progress pipe:1" lesen.
 *
 * ffmpeg schreibt dorthin Zeilen der Form "frame=123" und "out_time_us=...".
 * Daraus wird der Fortschritt bevorzugt ueber die Framezahl gerechnet, weil
 * wir die Zielframezahl exakt kennen; out_time_us ist der Rueckfall.
 *
 * Wird IMMER lokal per child_process.spawn ausgefuehrt (nie per Bibliothek).
 *
 * Frueher wurde hier an einen Runner aus ffmpeg.js delegiert. Das ist bewusst
 * entfernt: ffmpeg.js#runFfmpeg hat die Signatur (ctx, args, opts), hier wurde
 * aber (args, opts) uebergeben — das Argument-Array landete als ctx und der
 * Lauf starb mit "args.includes is not a function". spawnFfmpegLocal kann
 * ohnehin alles, was gebraucht wird, inklusive Abbruch ueber ctx.signal.
 * Weniger Kopplung, ein Fehlerpfad weniger.
 */
async function runFfmpeg(ctx, exe, args, { totalFrames, fps, onLine } = {}) {
  // Der vollstaendige Aufruf gehoert ins Joblog, bevor irgendetwas passiert —
  // wenn ffmpeg abstuerzt, will man genau diese Zeile kopieren koennen.
  const cmd = quoteCommandLine(exe, args);
  ctx.log(`ffmpeg-Aufruf: ${cmd}`);
  ctx.setCommand?.(cmd);
  return spawnFfmpegLocal(ctx, exe, args, { totalFrames, fps, onLine });
}

/**
 * Erkennt, ob ffmpeg am Arbeitsspeicher gescheitert ist.
 *
 * x264 meldet "malloc of size N failed", ffmpeg selbst "Cannot allocate memory"
 * bzw. "Out of memory". Der Exitcode ist dabei nicht verlaesslich (unter
 * Windows kommen grosse, wechselnde Werte zurueck), deshalb wird der Text
 * ausgewertet.
 */
function istSpeicherFehler(err) {
  const t = String(err?.message || '');
  return /malloc of size \d+ failed|Cannot allocate memory|Out of memory|OutOfMemory|bad_alloc/i.test(t);
}

/**
 * Grobe Abschaetzung, ob der freie Arbeitsspeicher fuer N gleichzeitige
 * Encoder reicht.
 *
 * Die Zahlen sind bewusst konservativ und nur eine Hausnummer — es geht nicht
 * um Genauigkeit, sondern darum, den offensichtlich aussichtslosen Fall vorher
 * abzufangen statt nach zehn Minuten Render.
 */
function speicherBedarf(graph, extraCount, outArgs) {
  const px = (graph.meta?.width || 0) * (graph.meta?.height || 0);
  const istX264 = outArgs.includes('libx264');
  // libx264 haelt Lookahead- und Referenzpuffer: grosszuegig ~12 Bytes/Pixel.
  // Intra-only (HAP, ProRes) kommt mit ~4 Bytes/Pixel aus.
  const proEncoder = px * (istX264 ? 12 : 4);
  // Der Filtergraph selbst haelt Basis und Zwischenbilder in rgba.
  const graphBedarf = px * 4 * 4;
  const brauchtBytes = graphBedarf + proEncoder * (extraCount + 1);
  const brauchtMB = Math.round(brauchtBytes / 1e6);

  let freiMB = Infinity;
  try {
    freiMB = Math.round(os.freemem() / 1e6);
  } catch {
    /* ohne Angabe wird nicht ausgewichen */
  }
  // Sicherheitsabstand: die Haelfte des freien Speichers bleibt unangetastet.
  return { brauchtMB, freiMB, knapp: Number.isFinite(freiMB) && brauchtMB > freiMB * 0.5 };
}

/** Anzeigbare Kommandozeile. Nur fuer Log und UI, nie zum Ausfuehren. */
function quoteCommandLine(exe, args) {
  const q = (s) => (/[\s"]/.test(String(s)) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s));
  return [exe, ...args].map(q).join(' ');
}

function spawnFfmpegLocal(ctx, exe, args, { totalFrames, fps, onLine } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Error(`ffmpeg konnte nicht gestartet werden (${exe}): ${err.message}`));
      return;
    }

    const tail = []; // letzte Zeilen fuer die Fehlermeldung
    let stdoutRest = '';
    let stderrRest = '';
    let lastFrame = 0;
    let lastTimeSec = 0;
    let cancelled = false;
    const totalSec = totalFrames > 0 && fps > 0 ? totalFrames / fps : 0;

    const onAbort = () => {
      cancelled = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* Prozess schon weg */
      }
    };
    if (ctx.signal) {
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutRest += chunk;
      const lines = stdoutRest.split(/\r?\n/);
      stdoutRest = lines.pop() ?? '';
      for (const line of lines) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (key === 'frame') {
          const f = Number(val);
          if (Number.isFinite(f)) lastFrame = f;
        } else if (key === 'out_time_us') {
          const us = Number(val);
          if (Number.isFinite(us)) lastTimeSec = us / 1e6;
        }
        // Bevorzugt ueber die Framezahl rechnen — die Zielframezahl steht
        // exakt fest. out_time_us ist der Rueckfall, wenn "frame=" (noch)
        // nicht geliefert wird.
        let p = -1;
        if (totalFrames > 0 && lastFrame > 0) p = lastFrame / totalFrames;
        else if (totalSec > 0 && lastTimeSec > 0) p = lastTimeSec / totalSec;
        if (p >= 0) ctx.setProgress(Math.max(0, Math.min(0.999, p)));
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrRest += chunk;
      const lines = stderrRest.split(/\r?\n/);
      stderrRest = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 60) tail.shift();
        onLine?.(line);
      }
    });

    child.on('error', (err) => {
      reject(
        new Error(
          `ffmpeg konnte nicht gestartet werden (${exe}): ${err.message}. ` +
            'Ist ffmpeg installiert? Reiter Systemzustand -> "ffmpeg installieren".'
        )
      );
    });

    child.on('close', (code) => {
      if (ctx.signal) ctx.signal.removeEventListener?.('abort', onAbort);
      if (stderrRest.trim()) {
        tail.push(stderrRest.trim());
        onLine?.(stderrRest.trim());
      }
      if (cancelled) {
        const e = new Error('Job wurde abgebrochen.');
        e.cancelled = true;
        reject(e);
        return;
      }
      if (code === 0) {
        ctx.setProgress(1);
        resolve({ code, tail });
        return;
      }
      reject(
        new Error(
          `ffmpeg ist mit Code ${code} abgebrochen.\n` +
            tail.slice(-20).join('\n')
        )
      );
    });
  });
}

/* ==========================================================================
 * ffprobe
 * ========================================================================== */

/** Ausgabedatei analysieren. Nutzt probe.js, wenn es das gibt. */
async function probeOutput(file) {
  const mod = await optionalImport('../probe.js');
  for (const fn of ['probeFile', 'probeMedia', 'probe']) {
    if (mod && typeof mod[fn] === 'function') {
      try {
        // probe.js liefert ein MEDIA-Objekt (makeMedia), die Messwerte liegen
        // eine Ebene tiefer unter .probe. Ohne das Auspacken sind width/height/
        // fps/frames hier undefined und die Kontrolle nach dem Render laeuft
        // ins Leere — genau die Kontrolle, die einen doppelten Schlussframe
        // nach einem Stundenrender fangen soll.
        const r = await mod[fn](file);
        if (r) return r.probe ?? r;
      } catch (err) {
        throw new Error(`Die Ausgabedatei konnte nicht analysiert werden: ${err.message}`);
      }
    }
  }
  return probeLocal(file);
}

function runCapture(exe, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Error(`${exe} konnte nicht gestartet werden: ${err.message}`));
      return;
    }
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', (e) => reject(new Error(`${exe} konnte nicht gestartet werden: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(exe)} endete mit Code ${code}: ${err.trim().split(/\r?\n/).slice(-3).join(' ')}`));
    });
  });
}

async function probeLocal(file) {
  const { ffprobe } = await resolveBins();
  const json = await runCapture(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,pix_fmt,duration:format=duration,size',
    '-of',
    'json',
    file,
  ]);

  let data;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`ffprobe lieferte kein lesbares JSON fuer ${path.basename(file)}: ${err.message}`);
  }
  const s = (data.streams && data.streams[0]) || {};
  const fmt = data.format || {};

  const parseRate = (r) => {
    if (!r || typeof r !== 'string') return 0;
    const [a, b] = r.split('/').map(Number);
    if (!b) return Number.isFinite(a) ? a : 0;
    return b === 0 ? 0 : a / b;
  };

  const fps = parseRate(s.r_frame_rate) || parseRate(s.avg_frame_rate);
  const durationSec = Number(s.duration ?? fmt.duration) || 0;
  let frames = Number(s.nb_frames);

  if (!Number.isFinite(frames) || frames <= 0) {
    // nb_frames fehlt in manchen Containern. Pakete zaehlen ist deutlich
    // billiger als Frames dekodieren und fuer unsere Intraframe-Codecs exakt.
    try {
      const pj = await runCapture(ffprobe, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-count_packets',
        '-show_entries',
        'stream=nb_read_packets',
        '-of',
        'json',
        file,
      ]);
      frames = Number(JSON.parse(pj).streams?.[0]?.nb_read_packets) || 0;
    } catch {
      frames = fps > 0 ? Math.round(durationSec * fps) : 0;
    }
  }

  let sizeBytes = Number(fmt.size) || 0;
  if (!sizeBytes) {
    try {
      sizeBytes = (await fs.stat(file)).size;
    } catch {
      sizeBytes = 0;
    }
  }

  return {
    width: Number(s.width) || 0,
    height: Number(s.height) || 0,
    fps,
    fpsExact: s.r_frame_rate || '',
    durationSec,
    frames,
    codec: s.codec_name || '',
    pixFmt: s.pix_fmt || '',
    sizeBytes,
  };
}

/* ==========================================================================
 * Verzeichnis, Presets, Namen
 * ========================================================================== */

/** Zielverzeichnis anlegen und Schreibrecht wirklich pruefen (nicht raten). */
async function ensureWritableDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    throw new Error(`Zielverzeichnis "${dir}" konnte nicht angelegt werden: ${err.message}`);
  }
  const probeFile = path.join(dir, `.Theater-Bild-Gelöte-schreibtest-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(probeFile, 'theater-bild-geloete');
  } catch (err) {
    throw new Error(
      `In das Zielverzeichnis "${dir}" kann nicht geschrieben werden: ${err.message}. ` +
        'Anderen Ordner waehlen oder Schreibrechte pruefen.'
    );
  } finally {
    try {
      await fs.rm(probeFile, { force: true });
    } catch {
      /* Testdatei bleibt liegen — nicht schlimm, aber melden waere Laerm */
    }
  }
}

function presetOf(venue, presetId) {
  const list = venue?.delivery?.presets || [];
  const id = presetId || venue?.delivery?.defaultPreset;
  const p = list.find((x) => x.id === id);
  if (!p) {
    throw new Error(
      `Delivery-Preset "${presetId}" gibt es im Venue ${venue?.id} nicht. Bekannt sind: ${list.map((x) => x.id).join(', ')}`
    );
  }
  return p;
}

/**
 * Encoder-Argumente: bevorzugt aus deliver.js, sonst aus dem Venue-Preset.
 *
 * width/height sind PFLICHT, sobald ein HAP-Preset im Spiel ist: deliver.js
 * prueft damit, ob die Kantenlaengen Vielfache von 4 sind, und wirft sonst.
 * Ohne die Masse wirft es bei JEDEM HAP-Preset — und hap_q ist der Standard
 * fuers Schiff.
 */
function outArgsFor(venue, presetId, width, height) {
  if (typeof deliver.deliveryArgs === 'function') {
    const a = deliver.deliveryArgs(venue, presetId, { width, height });
    if (Array.isArray(a) && a.length) return a;
  }
  const p = presetOf(venue, presetId);
  if (!Array.isArray(p.args) || !p.args.length) {
    throw new Error(`Delivery-Preset "${presetId}" enthaelt keine Encoder-Argumente.`);
  }
  return p.args.slice();
}

/** Dateiname: bevorzugt aus deliver.js, sonst deliveryName() aus dem Modell. */
function outNameFor(venue, id, width, height, presetId) {
  if (typeof deliver.deliveryOutName === 'function') {
    const n = deliver.deliveryOutName(venue, id, width, height, presetId);
    if (typeof n === 'string' && n) return n;
  }
  return deliveryName(venue, id, width, height, presetId);
}

/**
 * Aus den Encoder-Argumenten den erwarteten Codecnamen ableiten, wie ffprobe
 * ihn spaeter meldet. ffmpeg-Encoder und ffprobe-Decoder heissen nicht gleich.
 */
const ENCODER_TO_CODEC = {
  hap: 'hap',
  prores_ks: 'prores',
  prores: 'prores',
  mpeg2video: 'mpeg2video',
  libx264: 'h264',
  libx265: 'hevc',
  png: 'png',
};

function expectedCodec(outArgs) {
  const i = outArgs.indexOf('-c:v');
  const enc = i >= 0 ? outArgs[i + 1] : null;
  if (!enc) return null;
  return ENCODER_TO_CODEC[enc] || enc;
}

/**
 * Ergebnis gegen die Erwartung halten. Liefert immer ein Objekt, auch wenn
 * das Probeen scheitert — dann steht der Grund drin.
 */
async function verifyOutput(file, expected) {
  let probe;
  try {
    probe = await probeOutput(file);
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      expected,
      problems: [`Die fertige Datei konnte nicht geprueft werden: ${err.message}`],
    };
  }

  const problems = [];
  if (expected.width && probe.width !== expected.width) {
    problems.push(`Breite ${probe.width} px statt ${expected.width} px`);
  }
  if (expected.height && probe.height !== expected.height) {
    problems.push(`Hoehe ${probe.height} px statt ${expected.height} px`);
  }
  if (expected.fps && Math.abs(probe.fps - expected.fps) > 0.01) {
    problems.push(`${num(probe.fps, 3)} fps statt ${num(expected.fps, 3)} fps`);
  }
  if (expected.frames && probe.frames && probe.frames !== expected.frames) {
    problems.push(
      `${probe.frames} Frames statt ${expected.frames} — bei einem Frame Unterschied ist meist der doppelte Schlussframe die Ursache (Projekteinstellung "letzten Frame weglassen")`
    );
  }
  if (expected.codec && probe.codec && probe.codec !== expected.codec) {
    problems.push(`Codec "${probe.codec}" statt "${expected.codec}"`);
  }

  return {
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    frames: probe.frames,
    codec: probe.codec,
    pixFmt: probe.pixFmt,
    durationSec: probe.durationSec,
    sizeBytes: probe.sizeBytes,
    expected,
    ok: problems.length === 0,
    problems,
  };
}

/** Warnungen des Graphen ins Joblog schreiben — nie stumm verschlucken. */
function logWarnings(ctx, graph) {
  for (const w of graph.warnings) ctx.log(`Warnung: ${w}`);
}

/* ==========================================================================
 * renderWall — eine Wand in einem Durchlauf
 * ========================================================================== */

export async function renderWall(ctx0, opts = {}) {
  const ctx = safeCtx(ctx0);
  const {
    project,
    venue,
    wallId,
    presetId,
    outDir,
    outName,
    rangeSec = null,
    dryRun = false,
    alsoPanels = false,
  } = opts;

  if (!project) throw new Error('Es ist kein Projekt geladen.');
  if (!venue) throw new Error('Es ist kein Venue geladen.');

  const wallSpec = getWallSpec(venue, wallId);
  const preset = presetOf(venue, presetId);
  const bins = await resolveBins();
  const paths = await studioPaths();
  const dir = outDir || paths.out;

  ctx.log(`Wand ${wallId} (${wallSpec.width}x${wallSpec.height}) -> ${preset.label || preset.id}`);

  const graph = buildWallGraph(project, venue, wallId, {
    alpha: Boolean(preset.alpha),
    forPanels: Boolean(alsoPanels),
    rangeSec,
  });
  logWarnings(ctx, graph);

  const outArgs = outArgsFor(venue, preset.id, wallSpec.width, wallSpec.height);
  const name = outName || outNameFor(venue, wallId, graph.meta.width, graph.meta.height, preset.id);
  const outPath = path.join(dir, name);

  // Panels im selben Durchlauf mitschneiden: dieselbe Dekodier- und
  // Filterarbeit, nur ein zusaetzlicher crop pro Panel. Zweimal rendern waere
  // reine Zeitverschwendung.
  const extraOutputs = [];
  const panelPaths = [];
  if (alsoPanels) {
    for (const pm of graph.panelMaps) {
      const pName = outNameFor(venue, pm.id, pm.width, pm.height, preset.id);
      const pPath = path.join(dir, pName);
      // Eigene Encoder-Argumente je Panel — die Panelbreiten weichen von der
      // Wandbreite ab und HAP prueft die Kantenlaengen.
      extraOutputs.push({
        map: pm.label,
        args: outArgsFor(venue, preset.id, pm.width, pm.height),
        path: pPath,
      });
      panelPaths.push({ id: pm.id, path: pPath, width: pm.width, height: pm.height });
    }
  }

  const args = graphToCommand(graph, {
    ffmpegPath: bins.ffmpeg,
    outArgs,
    outPath,
    fps: graph.meta.fps,
    progress: true,
    extraOutputs,
  });
  const command = formatCommandLine(bins.ffmpeg, args);
  const explain = explainGraph(graph);

  ctx.setCommand?.(command);
  ctx.log(command);

  if (dryRun) {
    const result = {
      dryRun: true,
      command,
      filterComplex: graph.filterComplex,
      explain,
      outPath,
      panels: panelPaths,
      frames: graph.frames,
      warnings: graph.warnings,
    };
    ctx.setProgress(1);
    ctx.setResult(result);
    return result;
  }

  abortIfCancelled(ctx);
  await ensureWritableDir(dir);

  const startedAt = Date.now();

  // Mehrere Ausgaben in einem Durchlauf sind der effizienteste Weg — einmal
  // dekodieren und filtern, dann N-mal kodieren. Es ist aber auch der Weg mit
  // dem hoechsten Speicherbedarf: jeder Encoder haelt eigene Puffer, und
  // libx264 legt zusaetzlich Lookahead-Puffer in Bildgroesse an. Auf einer
  // knapp bestueckten Maschine stirbt das mit "x264 [error]: malloc failed",
  // und zwar erst mitten im Render.
  //
  // Deshalb: Speicher vorher abschaetzen, notfalls sofort den zweistufigen Weg
  // gehen (erst die Wand, dann aus der fertigen Wand die Panels schneiden).
  // Bei intra-only-Codecs wie HAP und ProRes ist das Schneiden qualitativ
  // gleichwertig, bei h264 kostet es eine Encodergeneration — was fuer ein
  // Ansichtsexemplar unerheblich ist.
  // Fuer den zweistufigen Weg muss der Graph OHNE die Panel-Zweige neu gebaut
  // werden. Es reicht nicht, die zusaetzlichen Ausgaben wegzulassen: der Graph
  // enthaelt dann immer noch split + crop und damit die Labels [p1]..[p4], die
  // niemand abnimmt — und einen unverbundenen Filterausgang lehnt ffmpeg mit
  // "Error binding filtergraph inputs/outputs" rundheraus ab.
  const nurWandArgs = () => {
    const g = buildWallGraph(project, venue, wallId, {
      alpha: Boolean(preset.alpha),
      forPanels: false,
      rangeSec,
    });
    return graphToCommand(g, {
      ffmpegPath: bins.ffmpeg, outArgs, outPath, fps: g.meta.fps, progress: true, extraOutputs: [],
    });
  };

  let effArgs = args;
  let panelsSeparat = false;
  const speicher = speicherBedarf(graph, extraOutputs.length, outArgs);
  if (extraOutputs.length > 0 && speicher.knapp) {
    ctx.log(
      `Zu wenig freier Arbeitsspeicher fuer ${extraOutputs.length + 1} gleichzeitige Encoder ` +
        `(geschaetzt ${speicher.brauchtMB} MB noetig, ${speicher.freiMB} MB frei). ` +
        'Die Panels werden deshalb nach der Wand aus der fertigen Datei geschnitten.'
    );
    panelsSeparat = true;
    effArgs = nurWandArgs();
  }

  try {
    await runFfmpeg(ctx, bins.ffmpeg, effArgs, {
      totalFrames: graph.frames,
      fps: graph.meta.fps,
      onLine: (line) => ctx.log(line),
    });
  } catch (err) {
    if (!istSpeicherFehler(err) || panelsSeparat || extraOutputs.length === 0) throw err;
    // Der Speicher hat trotz Abschaetzung nicht gereicht: einmal zweistufig
    // nachziehen, statt den Nutzer mit einer x264-Meldung alleinzulassen.
    ctx.log(
      'ffmpeg ist am Arbeitsspeicher gescheitert. Neuer Versuch: erst die Wand allein, ' +
        'dann die Panels aus der fertigen Datei schneiden.'
    );
    panelsSeparat = true;
    await runFfmpeg(ctx, bins.ffmpeg, nurWandArgs(), {
      totalFrames: graph.frames, fps: graph.meta.fps, onLine: (line) => ctx.log(line),
    });
  }

  if (panelsSeparat && panelPaths.length) {
    ctx.log(`Panels aus ${path.basename(outPath)} schneiden …`);
    const n = wallSpec.panels.length;
    const chains = [`[0:v]split=${n}${wallSpec.panels.map((_, i) => `[q${i + 1}]`).join('')}`];
    wallSpec.panels.forEach((p, i) => {
      chains.push(`[q${i + 1}]crop=${p.width}:${wallSpec.height}:${p.x}:0[p${i + 1}]`);
    });
    const cutArgs = ['-y', '-hide_banner', '-nostdin', '-progress', 'pipe:1', '-nostats',
                     '-i', outPath, '-filter_complex', chains.join(';')];
    wallSpec.panels.forEach((p, i) => {
      const pa = outArgsFor(venue, preset.id, p.width, wallSpec.height);
      cutArgs.push('-map', `[p${i + 1}]`, ...pa, '-frames:v', String(graph.frames),
                   '-r', num(graph.meta.fps, 5), '-fps_mode', 'cfr');
      if (!pa.includes('-an')) cutArgs.push('-an');
      cutArgs.push(panelPaths[i].path);
    });
    await runFfmpeg(ctx, bins.ffmpeg, cutArgs, {
      totalFrames: graph.frames, fps: graph.meta.fps, onLine: (line) => ctx.log(line),
    });
  }

  const tookSec = (Date.now() - startedAt) / 1000;

  const expected = {
    width: graph.meta.width,
    height: graph.meta.height,
    fps: graph.meta.fps,
    frames: graph.frames,
    codec: expectedCodec(outArgs),
  };
  const verify = await verifyOutput(outPath, expected);
  if (verify.ok) {
    ctx.log(`Fertig in ${num(tookSec, 1)} s: ${outPath} (${verify.frames} Frames, ${verify.codec})`);
  } else {
    ctx.log(`ACHTUNG — die fertige Datei weicht von der Erwartung ab: ${(verify.problems || []).join('; ')}`);
  }

  const panelVerify = [];
  for (const p of panelPaths) {
    panelVerify.push({
      ...p,
      verify: await verifyOutput(p.path, { ...expected, width: p.width, height: p.height }),
    });
  }

  const result = {
    command,
    filterComplex: graph.filterComplex,
    explain,
    outPath,
    frames: graph.frames,
    tookSec,
    warnings: graph.warnings,
    verify,
    panels: panelVerify,
  };
  ctx.setProgress(1);
  ctx.setResult(result);
  return result;
}

/* ==========================================================================
 * renderPanels — die vier Einzeldateien
 * ========================================================================== */

/**
 * Zwei Wege:
 *   fromMaster gesetzt -> eine fertige Masterdatei wird nur noch zerschnitten
 *                         (schnell, ein Input, nur split+crop)
 *   sonst              -> aus dem Projekt rendern, Master wird nicht geschrieben
 */
export async function renderPanels(ctx0, opts = {}) {
  const ctx = safeCtx(ctx0);
  const { project, venue, wallId, presetId, outDir, fromMaster = null, rangeSec = null, dryRun = false } = opts;

  if (!venue) throw new Error('Es ist kein Venue geladen.');
  const wallSpec = getWallSpec(venue, wallId);
  const preset = presetOf(venue, presetId);
  // Jedes Panel hat seine eigenen Masse (auf D: 648/720/720/648), und HAP
  // prueft die Kantenlaengen. Deshalb die Encoder-Argumente pro Panel bauen,
  // nicht einmal fuer alle.
  const argsFor = (w, h) => outArgsFor(venue, preset.id, w, h);
  const bins = await resolveBins();
  const paths = await studioPaths();
  const dir = outDir || paths.out;

  const fps = Number(project?.fps) || Number(venue.fps) || 30;

  let args;
  let command;
  let explain;
  let filterComplex;
  let frames;
  let panels = [];

  if (fromMaster) {
    if (!(await exists(fromMaster))) {
      throw new Error(`Die Masterdatei "${fromMaster}" gibt es nicht.`);
    }
    ctx.log(`Panels von Wand ${wallId} aus der fertigen Datei schneiden: ${fromMaster}`);

    const master = await probeOutput(fromMaster).catch((err) => {
      throw new Error(`Die Masterdatei konnte nicht analysiert werden: ${err.message}`);
    });
    if (master.width !== wallSpec.width || master.height !== wallSpec.height) {
      throw new Error(
        `Die Masterdatei ist ${master.width}x${master.height}, Wand ${wallId} braucht aber ${wallSpec.width}x${wallSpec.height}. Falsche Datei erwischt?`
      );
    }

    frames = master.frames || (project ? targetFrameCount(project) : 0);

    const n = wallSpec.panels.length;
    const chains = [`[0:v]split=${n}${wallSpec.panels.map((_, i) => `[q${i + 1}]`).join('')}`];
    wallSpec.panels.forEach((p, i) => {
      chains.push(`[q${i + 1}]crop=${p.width}:${wallSpec.height}:${p.x}:0[p${i + 1}]`);
      panels.push({
        id: p.id,
        label: `[p${i + 1}]`,
        width: p.width,
        height: wallSpec.height,
        path: path.join(dir, outNameFor(venue, p.id, p.width, wallSpec.height, preset.id)),
      });
    });
    filterComplex = chains.join(';');

    args = ['-y', '-hide_banner', '-nostdin', '-progress', 'pipe:1', '-nostats', '-i', fromMaster, '-filter_complex', filterComplex];
    panels.forEach((p) => {
      const pArgs = argsFor(p.width, p.height);
      args.push('-map', p.label, ...pArgs);
      if (frames > 0) args.push('-frames:v', String(frames));
      args.push('-r', num(fps, 5), '-fps_mode', 'cfr');
      if (!pArgs.includes('-an')) args.push('-an');
      args.push(p.path);
    });

    explain =
      `Wand ${wallId}: die fertige Masterdatei wird per split in ${n} Zweige kopiert und jeder Zweig auf sein Panel zugeschnitten.\n` +
      panels.map((p) => `  ${p.id}: ${p.width}x${p.height} ab x=${wallSpec.panels.find((q) => q.id === p.id).x}`).join('\n') +
      '\nEs wird nur geschnitten und neu kodiert, nichts umgerechnet.';
  } else {
    if (!project) throw new Error('Es ist kein Projekt geladen.');
    ctx.log(`Panels von Wand ${wallId} direkt aus dem Projekt rendern`);

    const graph = buildWallGraph(project, venue, wallId, {
      alpha: Boolean(preset.alpha),
      forPanels: true,
      rangeSec,
    });
    logWarnings(ctx, graph);
    filterComplex = graph.filterComplex;
    frames = graph.frames;

    panels = graph.panelMaps.map((pm) => ({
      id: pm.id,
      label: pm.label,
      width: pm.width,
      height: pm.height,
      path: path.join(dir, outNameFor(venue, pm.id, pm.width, pm.height, preset.id)),
    }));

    // Hier soll KEINE Masterdatei entstehen, nur die Panels. Das Label [out]
    // bleibt dabei uebrig — ein unverbundener Filterausgang ist fuer ffmpeg
    // aber ein harter Fehler. Deshalb wird [out] in eine nullsink geleitet
    // und das erste Panel wird zur Hauptausgabe.
    const panelGraph = {
      ...graph,
      filterComplex: `${graph.filterComplex};[out]nullsink`,
      map: panels[0].label,
    };
    filterComplex = panelGraph.filterComplex;

    args = graphToCommand(panelGraph, {
      ffmpegPath: bins.ffmpeg,
      outArgs: argsFor(panels[0].width, panels[0].height),
      outPath: panels[0].path,
      fps: graph.meta.fps,
      progress: true,
      extraOutputs: panels
        .slice(1)
        .map((p) => ({ map: p.label, args: argsFor(p.width, p.height), path: p.path })),
    });

    explain = explainGraph(graph);
  }

  command = formatCommandLine(bins.ffmpeg, args);
  ctx.setCommand?.(command);
  ctx.log(command);

  if (dryRun) {
    const result = { dryRun: true, command, filterComplex, explain, panels, frames };
    ctx.setProgress(1);
    ctx.setResult(result);
    return result;
  }

  abortIfCancelled(ctx);
  await ensureWritableDir(dir);

  const startedAt = Date.now();
  await runFfmpeg(ctx, bins.ffmpeg, args, { totalFrames: frames, fps, onLine: (line) => ctx.log(line) });
  const tookSec = (Date.now() - startedAt) / 1000;

  const codec = expectedCodec(outArgs);
  const checked = [];
  for (const p of panels) {
    checked.push({
      ...p,
      verify: await verifyOutput(p.path, { width: p.width, height: p.height, fps, frames, codec }),
    });
  }
  const bad = checked.filter((p) => !p.verify.ok);
  if (bad.length) {
    ctx.log(`ACHTUNG — ${bad.length} von ${checked.length} Panels weichen von der Erwartung ab.`);
  } else {
    ctx.log(`Fertig in ${num(tookSec, 1)} s: ${checked.length} Panels in ${dir}`);
  }

  const result = { command, filterComplex, explain, panels: checked, frames, tookSec };
  ctx.setProgress(1);
  ctx.setResult(result);
  return result;
}

/* ==========================================================================
 * renderAll — mehrere Waende x mehrere Presets
 * ========================================================================== */

export async function renderAll(ctx0, opts = {}) {
  const ctx = safeCtx(ctx0);
  const {
    project,
    venue,
    walls = null,
    presetIds = null,
    outDir,
    alsoPanels = false,
    rangeSec = null,
    dryRun = false,
    continueOnError = true,
  } = opts;

  if (!project) throw new Error('Es ist kein Projekt geladen.');
  if (!venue) throw new Error('Es ist kein Venue geladen.');

  const wallIds = (walls && walls.length ? walls : venue.walls.map((w) => w.id)).slice();
  const presets = (presetIds && presetIds.length ? presetIds : [venue.delivery?.defaultPreset]).filter(Boolean);
  if (!presets.length) throw new Error('Es wurde kein Delivery-Preset angegeben.');

  const jobs = [];
  for (const w of wallIds) for (const p of presets) jobs.push({ wallId: w, presetId: p });

  ctx.log(`${jobs.length} Durchlaeufe: ${wallIds.join(', ')} x ${presets.join(', ')}`);

  const results = [];
  const errors = [];

  for (let i = 0; i < jobs.length; i += 1) {
    abortIfCancelled(ctx);
    const job = jobs[i];
    const base = i / jobs.length;
    const span = 1 / jobs.length;

    // Fortschritt des Einzelrenders in den Gesamtfortschritt umrechnen.
    const subCtx = {
      setProgress: (p) => ctx.setProgress(base + Math.max(0, Math.min(1, p)) * span),
      log: (line) => ctx.log(line),
      setResult: () => {},
      setCommand: null,
      signal: ctx.signal,
    };

    ctx.log(`--- ${i + 1}/${jobs.length}: Wand ${job.wallId}, Preset ${job.presetId} ---`);
    try {
      const r = await renderWall(subCtx, {
        project,
        venue,
        wallId: job.wallId,
        presetId: job.presetId,
        outDir,
        rangeSec,
        dryRun,
        alsoPanels,
      });
      results.push({ ...job, ok: true, ...r });
    } catch (err) {
      if (err.cancelled) throw err;
      const msg = `Wand ${job.wallId} / ${job.presetId} ist fehlgeschlagen: ${err.message}`;
      ctx.log(msg);
      errors.push(msg);
      results.push({ ...job, ok: false, error: err.message });
      if (!continueOnError) throw new Error(msg);
    }
  }

  const result = { runs: results, errors, ok: errors.length === 0 };
  ctx.setProgress(1);
  ctx.setResult(result);
  if (errors.length) {
    ctx.log(`${errors.length} von ${jobs.length} Durchlaeufen sind fehlgeschlagen.`);
  }
  return result;
}

/* ==========================================================================
 * renderStill — ein einzelnes PNG
 * ========================================================================== */

export async function renderStill(ctx0, opts = {}) {
  const ctx = safeCtx(ctx0);
  const { project, venue, wallId, atSec = 0, outPath, scale = 1, dryRun = false } = opts;

  if (!project) throw new Error('Es ist kein Projekt geladen.');
  if (!venue) throw new Error('Es ist kein Venue geladen.');

  const bins = await resolveBins();
  const paths = await studioPaths();
  const fps = Number(project.fps) || Number(venue.fps) || 30;

  // Genau ein Frame: der Ausschnitt ist eine Frame-Dauer lang.
  const graph = buildWallGraph(project, venue, wallId, {
    alpha: false,
    forPanels: false,
    rangeSec: [atSec, atSec + 1 / fps],
    scale,
    pixFmt: 'rgb24', // PNG will RGB, nicht rgba - sonst gibt es einen Alphakanal ohne Inhalt
  });
  logWarnings(ctx, graph);

  const target =
    outPath ||
    path.join(
      paths.out,
      `Still_${wallId}_${graph.meta.width}x${graph.meta.height}_${num(atSec, 3).replace('.', '-')}s.png`
    );

  // -update 1 verhindert, dass ffmpeg den Dateinamen als Bildsequenzmuster
  // versteht und eine Warnung ueber fehlende %d-Platzhalter ausgibt.
  const outArgs = ['-f', 'image2', '-update', '1', '-c:v', 'png', '-frames:v', '1'];

  const args = graphToCommand(graph, {
    ffmpegPath: bins.ffmpeg,
    outArgs,
    outPath: target,
    fps,
    progress: true,
  });
  const command = formatCommandLine(bins.ffmpeg, args);
  const explain = explainGraph(graph);

  ctx.setCommand?.(command);
  ctx.log(command);

  if (dryRun) {
    const result = { dryRun: true, command, filterComplex: graph.filterComplex, explain, outPath: target };
    ctx.setProgress(1);
    ctx.setResult(result);
    return result;
  }

  abortIfCancelled(ctx);
  await ensureWritableDir(path.dirname(target));

  await runFfmpeg(ctx, bins.ffmpeg, args, { totalFrames: 1, fps, onLine: (line) => ctx.log(line) });

  const verify = await verifyOutput(target, {
    width: graph.meta.width,
    height: graph.meta.height,
    fps: 0, // Standbilder haben keine sinnvolle Framerate
    frames: 1,
    codec: 'png',
  });
  ctx.log(`Standbild geschrieben: ${target}`);

  const result = {
    command,
    filterComplex: graph.filterComplex,
    explain,
    outPath: target,
    atSec,
    verify,
    warnings: graph.warnings,
  };
  ctx.setProgress(1);
  ctx.setResult(result);
  return result;
}
