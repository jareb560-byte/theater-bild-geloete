/**
 * Theater-Bild-Gelöte - Qualitaetskontrolle (QC)
 * ---------------------------------------------------------------------------
 * Jeder Check bildet genau eine der Sorgen ab, die in
 * Claude/05_deliver/ENCODE.md unter "Vor dem Vollrender: Testfile an Jan"
 * stehen:
 *
 *   1. Banding im Nachthimmel        -> banding()
 *   2. Schwarzwert (Absen hebt an)   -> blackLevel()
 *   3. Moire bei Kranstreben/Gittern -> moire()
 *   4. Neon-Helligkeit / Clipping    -> blackLevel() (YMAX-Teil)
 *   5. Flackerfrequenz vs. Shutter   -> flicker()
 *
 * Dazu die Delivery-Pflichten aus Schritt 5 derselben Datei:
 *
 *   - Framezahl == Looplaenge x fps  -> frameCount()
 *   - Frame 0 != letzter Frame       -> loopSeam()
 *   - Aufloesung/fps/Codec/pix_fmt   -> specCompliance()
 *
 * Und die Designregel Nr. 1 aus 00_specs/LED-SPECS.md (die Wandteile fahren
 * auseinander, kein bildtragendes Motiv ueber der Mittelnaht):
 *
 *   - Detailenergie auf den Panelnaehten -> seamContent()
 *   - Belegung der aeusseren 15 %        -> safeArea()
 *
 * Plus der Kontaktbogen, der an den Kunden geht -> contactSheet().
 *
 * ---------------------------------------------------------------------------
 * ROBUSTHEIT
 * ---------------------------------------------------------------------------
 * Scheitert ein ffmpeg-Aufruf, wird NUR dieser eine Check 'skip' mit einer
 * verstaendlichen Begruendung. Der Job bleibt gruen. Nichts wird still
 * verschluckt: jeder gefangene Fehler geht ausserdem ins Log.
 *
 * Abgebrochen wird nur, wenn der Nutzer abbricht - dann fliegt der Fehler
 * bewusst bis nach oben durch.
 * ---------------------------------------------------------------------------
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { getWallSpec, targetFrameCount } from '../../shared/model.js';

/* ==========================================================================
 * Konstanten und Schwellen
 * ==========================================================================
 * Alle Schwellen stehen hier oben, damit man sie nach dem ersten echten
 * Testfile vom Schiff nachziehen kann, ohne Code zu lesen.
 */

/** Loop-Naht: darueber gelten Anfang und Ende als identisch -> Loop stockt. */
const LOOPSEAM_IDENTICAL = 0.995;
/** Loop-Naht: darunter ist der Sprung hart. */
const LOOPSEAM_HARDCUT = 0.60;

/** Halbe Breite des Nahtstreifens in Pixeln (Naht +/- 24 px). */
const SEAM_HALF_PX = 24;
/** Breite des Kontextstreifens, der als Bild-Artefakt mitgeliefert wird. */
const SEAM_CONTEXT_PX = 80;
/** Gewoehnliche Panelnaht: ab diesem Verhaeltnis zur Gesamtflaeche -> warn. */
const SEAM_RATIO_WARN = 1.35;
/** Mittelnaht: dort trennt sich die Wand im Regelfall, deshalb strenger. */
const SEAM_RATIO_WARN_CENTER = 1.15;
/** Unter dieser absoluten Detailenergie ist nichts da, was reissen koennte. */
const SEAM_ENERGY_FLOOR = 1.5;

/** Schwarzwert: Referenz und Toleranz fuer tv-range (16..235). */
const BLACK_TV_FLOOR = 16;
const BLACK_TV_WARN = 20;
const WHITE_TV_CLIP = 233;
/** Schwarzwert: Referenz und Toleranz fuer pc-range (0..255). */
const BLACK_PC_WARN = 6;
const WHITE_PC_CLIP = 253;

/** Banding: SSIM zwischen Original und gradfun-Fassung, nur dunkle Bereiche. */
const BANDING_SSIM_WARN = 0.985;
const BANDING_SSIM_STRONG = 0.960;
/** Alles ueber diesem Luma-Wert wird fuer den Banding-Vergleich plattgelegt. */
const BANDING_DARK_CLAMP = 96;

/** Moire: mittlere Hochfrequenzenergie (0..255) der Differenz zur Weichzeichnung. */
const MOIRE_WARN = 8;
const MOIRE_STRONG = 14;
const MOIRE_BLUR_SIGMA = 0.9;

/** Flicker: kritisches Band gegen Kamerashutter der Hausregie. */
const FLICKER_HZ_LOW = 4;
const FLICKER_HZ_HIGH = 15;
/** Amplitude in Luma-Stufen, ab der ein Peak auffaellt. */
const FLICKER_AMP_WARN = 1.2;
/** ... und wie weit er ueber dem Rauschteppich (Median) liegen muss. */
const FLICKER_AMP_OVER_MEDIAN = 4;
/** Obergrenze fuer die von Hand gerechnete DFT. */
const FLICKER_MAX_SAMPLES = 4096;

/** Wieviele Frames blackLevel hoechstens per signalstats auswertet. */
const BLACKLEVEL_MAX_SAMPLES = 600;

/** Stichproben-Zeitpunkte fuer die inhaltlichen Checks. */
const SAMPLES_SEAM = 5;
const SAMPLES_SAFEAREA = 3;
const SAMPLES_MOIRE = 3;

/** Zielbreite des Kontaktbogens. */
const CONTACTSHEET_WIDTH = 1920;

const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
/** studio/server/ops/qc.js -> studio/ */
const ROOT_FALLBACK = nodePath.resolve(HERE, '..', '..');

/**
 * Encoder-Name (so steht er in den Delivery-Presets) -> Codec-Name,
 * so wie ffprobe ihn spaeter in der fertigen Datei meldet.
 */
const ENCODER_TO_CODEC = {
  hap: 'hap',
  prores_ks: 'prores',
  prores: 'prores',
  prores_aw: 'prores',
  mpeg2video: 'mpeg2video',
  libx264: 'h264',
  h264_nvenc: 'h264',
  libx265: 'hevc',
  hevc_nvenc: 'hevc',
};

/** pix_fmt, die ffprobe bei HAP-Dateien je nach Build meldet. */
const HAP_PIX_FMTS = ['rgba', 'rgb0', 'bgra', 'bgr0', 'rgb24', 'yuv420p'];

/** Reihenfolge und deutsche Bezeichnung aller Checks. */
export const CHECKS = [
  { id: 'frameCount', label: 'Framezahl' },
  { id: 'specCompliance', label: 'Spec-Konformität' },
  { id: 'loopSeam', label: 'Loop-Naht' },
  { id: 'seamContent', label: 'Motiv auf den Panelnähten' },
  { id: 'safeArea', label: 'Außenzonen (15 %)' },
  { id: 'blackLevel', label: 'Schwarzwert und Spitzen' },
  { id: 'banding', label: 'Banding in dunklen Flächen' },
  { id: 'moire', label: 'Moiré-Risiko' },
  { id: 'flicker', label: 'Flackerfrequenzen' },
  { id: 'contactSheet', label: 'Kontaktbogen' },
];

export const ALL_CHECK_IDS = CHECKS.map((c) => c.id);

const STATUS_RANK = { pass: 0, skip: 1, warn: 2, fail: 3 };

/* ==========================================================================
 * Einstiegspunkt
 * ========================================================================== */

/**
 * Fuehrt die gewuenschten Checks aus.
 *
 * @param {object} ctx   Job-Kontext. Optional, alles daran ist defensiv
 *                       abgefragt: { log, progress, signal, job, paths,
 *                       ffmpegPath, ffprobePath, probe }
 * @param {object} req   { path, project, venue, wallId, checks, options }
 * @returns {Promise<{checks: Array}>} gemaess shared/API.md
 */
export async function runChecks(ctx, req = {}) {
  const { path: filePath, project, venue, wallId, checks, options } = req;

  if (!filePath || typeof filePath !== 'string') {
    throw new Error('QC braucht eine Datei: das Feld "path" fehlt oder ist leer.');
  }
  const file = nodePath.resolve(filePath);
  if (!fs.existsSync(file)) {
    throw new Error(`Die zu prüfende Datei gibt es nicht: ${file}`);
  }

  const wanted = normalizeCheckList(checks);
  if (wanted.length === 0) {
    throw new Error('Es wurde kein einziger Check angefordert.');
  }

  // Arbeitsordner fuer Frames, Differenzbilder, Histogramm, Kontaktbogen.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const work = nodePath.join(
    studioPaths(ctx).cache,
    'qc',
    `${stamp}_${sanitizeName(wallId || nodePath.parse(file).name)}`
  );
  try {
    fs.mkdirSync(work, { recursive: true });
  } catch (err) {
    throw new Error(`Der QC-Arbeitsordner ließ sich nicht anlegen (${work}): ${err.message}`);
  }
  setOn(ctx, 'qcWorkDir', work);

  logLine(ctx, `QC startet: ${file}`);
  logLine(ctx, `Arbeitsordner: ${work}`);
  logLine(ctx, `Checks: ${wanted.join(', ')}`);

  // Einmal proben. Faellt das aus, laufen die rein rechnerischen Checks
  // nicht - sie werden dann sauber als 'skip' gemeldet, nicht als Fehler.
  let info = null;
  try {
    info = await probeFile(ctx, file);
    logLine(
      ctx,
      `Probe: ${info.width}x${info.height}, ${info.fps} fps (${info.fpsExact}), ` +
        `${info.frames} Frames, ${info.durationSec.toFixed(3)} s, ${info.codec}/${info.pixFmt}`
    );
  } catch (err) {
    logLine(ctx, `ffprobe ist gescheitert, rein rechnerische Checks entfallen: ${err.message}`);
  }

  const env = { file, info, project, venue, wallId, options: options || {} };
  const results = [];

  for (let i = 0; i < wanted.length; i++) {
    throwIfCancelled(ctx);
    setProgress(ctx, i / wanted.length);
    const id = wanted[i];
    const def = CHECKS.find((c) => c.id === id) || { id, label: id };
    logLine(ctx, `-- Check ${i + 1}/${wanted.length}: ${def.label}`);
    results.push(await guarded(ctx, def, () => dispatch(ctx, id, env)));
  }

  setProgress(ctx, 1);
  const summary = summarize(results);
  logLine(
    ctx,
    `QC fertig: ${summary.pass} ok, ${summary.warn} Warnung(en), ` +
      `${summary.fail} Fehler, ${summary.skip} übersprungen.`
  );

  // API.md verlangt { checks: [...] }. summary/file/wallId sind additiv und
  // duerfen von jedem Client ignoriert werden.
  return { checks: results, summary, file, wallId: wallId ?? null };
}

async function dispatch(ctx, id, env) {
  const { file, info, project, venue, wallId, options } = env;
  switch (id) {
    case 'frameCount':
      return frameCount(info, project);
    case 'specCompliance':
      return specCompliance(info, venue, wallId);
    case 'loopSeam':
      return await loopSeam(ctx, file, info);
    case 'seamContent':
      return await seamContent(ctx, file, venue, wallId);
    case 'safeArea':
      return await safeArea(ctx, file, venue, wallId);
    case 'blackLevel':
      return await blackLevel(ctx, file);
    case 'banding':
      return await banding(ctx, file);
    case 'moire':
      return await moire(ctx, file, venue);
    case 'flicker':
      return await flicker(ctx, file);
    case 'contactSheet':
      return await contactSheet(ctx, file, options.contactSheet || {});
    default:
      return skipResult({ id, label: id }, `Unbekannter Check "${id}" - übersprungen.`);
  }
}

/* ==========================================================================
 * Check 1 - Framezahl
 * ========================================================================== */

/**
 * Framezahl gegen Looplaenge x fps.
 * Bei dropDuplicateEndFrame darf KEIN Frame mehr da sein, sonst stockt der Loop.
 *
 * Rein rechnerisch, kein ffmpeg - deshalb ohne ctx und leicht testbar.
 */
export function frameCount(info, project) {
  const def = { id: 'frameCount', label: 'Framezahl' };

  if (!info) return skipResult(def, 'Die Datei konnte nicht analysiert werden (ffprobe lieferte nichts).');
  if (!project) return skipResult(def, 'Ohne Projekt ist die Soll-Framezahl unbekannt.');
  if (!(project.loopSeconds > 0) || !(project.fps > 0)) {
    return skipResult(def, 'Das Projekt hat keine brauchbare Looplänge oder Framerate.');
  }

  const expected = targetFrameCount(project);
  let actual = Number(info.frames) || 0;
  let estimated = false;
  if (!actual && info.durationSec > 0 && info.fps > 0) {
    actual = Math.round(info.durationSec * info.fps);
    estimated = true;
  }
  if (!actual) {
    return skipResult(def, 'Die Datei nennt keine Framezahl und die Dauer ist unbekannt.');
  }

  const diff = actual - expected;
  const detail = {
    expected,
    actual,
    diff,
    estimated,
    loopSeconds: project.loopSeconds,
    fps: project.fps,
    dropDuplicateEndFrame: !!project.dropDuplicateEndFrame,
  };
  const est = estimated ? ' (aus Dauer x fps geschätzt, die Datei nennt keine nb_frames)' : '';

  if (diff === 0) {
    return {
      ...def,
      status: 'pass',
      message:
        `${actual} Frames — genau ${project.loopSeconds} s × ${project.fps} fps` +
        `${project.dropDuplicateEndFrame ? ', ohne doppelten Schlussframe' : ''}.${est}`,
      detail,
      artifacts: [],
    };
  }

  const richtung = diff > 0 ? 'zu viel' : 'zu wenig';
  let hinweis;
  if (diff === 1 && project.dropDuplicateEndFrame) {
    hinweis =
      'Das sieht nach dem doppelten Schlussframe aus: Frame 0 wurde am Ende noch einmal ' +
      'mitgerendert. Auf der Wand ist das ein sichtbares Stocken im Loop.';
  } else if (diff > 0) {
    hinweis = 'Die Datei ist länger als der Loop — beim Umlauf entsteht ein Versatz.';
  } else {
    hinweis = 'Es fehlen Frames — die PNG-Sequenz war lückenhaft oder der Render brach ab.';
  }

  return {
    ...def,
    status: 'fail',
    message:
      `${actual} Frames statt ${expected} — ${Math.abs(diff)} Frame(s) ${richtung} ` +
      `(${(Math.abs(diff) / project.fps).toFixed(3)} s). Soll: ${project.loopSeconds} s × ` +
      `${project.fps} fps = ${expected}. ${hinweis}${est}`,
    detail,
    artifacts: [],
  };
}

/* ==========================================================================
 * Check 2 - Spec-Konformitaet
 * ========================================================================== */

/**
 * Aufloesung, fps, Codec, pix_fmt und HAP-Teilbarkeit gegen die Venue-Spec.
 * Rein rechnerisch, kein ffmpeg.
 */
export function specCompliance(info, venue, wallId) {
  const def = { id: 'specCompliance', label: 'Spec-Konformität' };

  if (!info) return skipResult(def, 'Die Datei konnte nicht analysiert werden (ffprobe lieferte nichts).');
  if (!venue) return skipResult(def, 'Ohne Venue gibt es keine Sollwerte.');
  if (!wallId) return skipResult(def, 'Ohne Wand-ID ist die Soll-Auflösung unbekannt.');

  let wall;
  try {
    wall = getWallSpec(venue, wallId);
  } catch (err) {
    return skipResult(def, err.message);
  }

  const problems = [];
  const notes = [];

  if (info.width !== wall.width || info.height !== wall.height) {
    problems.push(
      `Auflösung ${info.width}×${info.height}, Soll für Wand ${wall.id} ist ${wall.width}×${wall.height}`
    );
  }

  if (venue.fps > 0 && Math.abs((info.fps || 0) - venue.fps) > 0.01) {
    problems.push(
      `${info.fps} fps (${info.fpsExact || '?'}), das Haus verlangt ${venue.fps} fps — Soll ist exakt ${venue.fps}/1`
    );
  }

  // Erlaubte Codecs aus den Delivery-Presets des Venues ableiten.
  const allowedCodecs = allowedCodecsOf(venue);
  if (allowedCodecs.length && info.codec && !allowedCodecs.includes(info.codec)) {
    problems.push(
      `Codec "${info.codec}" ist für dieses Haus nicht vorgesehen. Erlaubt: ${allowedCodecs.join(', ')}`
    );
  }

  // pix_fmt: bei HAP meldet ffprobe je nach Build unterschiedlich, deshalb
  // dort nur ein Hinweis statt eines Fehlers.
  const allowedFmts = allowedPixFmtsOf(venue);
  if (info.pixFmt) {
    if (info.codec === 'hap') {
      if (!HAP_PIX_FMTS.includes(info.pixFmt)) {
        notes.push(
          `pix_fmt "${info.pixFmt}" ist für HAP ungewöhnlich (erwartet ${HAP_PIX_FMTS.slice(0, 3).join('/')})`
        );
      }
    } else if (allowedFmts.length && !allowedFmts.includes(info.pixFmt)) {
      notes.push(`pix_fmt "${info.pixFmt}" steht in keinem Delivery-Preset (dort: ${allowedFmts.join(', ')})`);
    }
  }

  // HAP arbeitet in 4x4-Bloecken - Kantenlaengen muessen durch 4 teilbar sein.
  if (info.width % 4 !== 0 || info.height % 4 !== 0) {
    problems.push(
      `Kantenlängen ${info.width}×${info.height} sind nicht durch 4 teilbar — HAP braucht Vielfache von 4 ` +
        `(nächster gültiger Wert: ${Math.ceil(info.width / 4) * 4}×${Math.ceil(info.height / 4) * 4})`
    );
  }

  if (info.audioStreams > 0) {
    notes.push(`${info.audioStreams} Audiospur(en) in der Datei — Delivery ist bildlos, "-an" fehlte`);
  }

  const detail = {
    wallId: wall.id,
    expected: { width: wall.width, height: wall.height, fps: venue.fps, codecs: allowedCodecs, pixFmts: allowedFmts },
    actual: {
      width: info.width,
      height: info.height,
      fps: info.fps,
      fpsExact: info.fpsExact,
      codec: info.codec,
      pixFmt: info.pixFmt,
      colorRange: info.colorRange,
      container: info.container,
      audioStreams: info.audioStreams,
    },
    problems,
    notes,
  };

  if (problems.length) {
    return { ...def, status: 'fail', message: problems.join('. ') + '.', detail, artifacts: [] };
  }
  if (notes.length) {
    return { ...def, status: 'warn', message: notes.join('. ') + '.', detail, artifacts: [] };
  }
  return {
    ...def,
    status: 'pass',
    message:
      `${info.width}×${info.height}, ${info.fps} fps, ${info.codec}/${info.pixFmt} — ` +
      `passt zur Spec von Wand ${wall.id}.`,
    detail,
    artifacts: [],
  };
}

function allowedCodecsOf(venue) {
  const out = new Set();
  for (const p of venue?.delivery?.presets || []) {
    const args = p.args || [];
    const i = args.indexOf('-c:v');
    if (i >= 0 && args[i + 1]) out.add(ENCODER_TO_CODEC[args[i + 1]] || args[i + 1]);
  }
  return [...out];
}

function allowedPixFmtsOf(venue) {
  const out = new Set();
  for (const p of venue?.delivery?.presets || []) {
    const args = p.args || [];
    const i = args.indexOf('-pix_fmt');
    if (i >= 0 && args[i + 1]) out.add(args[i + 1]);
  }
  return [...out];
}

/* ==========================================================================
 * Check 3 - Loop-Naht
 * ========================================================================== */

/**
 * Ersten und letzten Frame extrahieren und per ffmpeg-Filter ssim vergleichen.
 *
 * Richtig ist: der letzte Frame ist der letzte NEUE Frame, der Sprung
 * letzter -> 0 ist genau ein Frameschritt. Sind beide praktisch identisch,
 * wurde Frame 0 doppelt gerendert und der Loop stockt sichtbar.
 */
export async function loopSeam(ctx, path, info) {
  const def = { id: 'loopSeam', label: 'Loop-Naht' };
  const work = workDir(ctx);
  const firstPng = nodePath.join(work, 'loop_first.png');
  const lastPng = nodePath.join(work, 'loop_last.png');
  const diffPng = nodePath.join(work, 'loop_diff.png');

  const probe = info || (await probeFile(ctx, path));
  const total = Number(probe?.frames) || 0;

  // Erster Frame - exakt n == 0, kein Seek, damit wirklich Frame 0 kommt.
  await runFfmpeg(ctx, [
    '-i', path,
    '-vf', "select='eq(n,0)'",
    '-fps_mode', 'passthrough',
    '-frames:v', '1', '-update', '1', '-an',
    firstPng,
  ]);

  // Letzter Frame - wenn die Framezahl bekannt ist exakt, sonst per -sseof.
  if (total > 1) {
    await runFfmpeg(ctx, [
      '-i', path,
      '-vf', `select='eq(n,${total - 1})'`,
      '-fps_mode', 'passthrough',
      '-frames:v', '1', '-update', '1', '-an',
      lastPng,
    ]);
  } else {
    // Ohne nb_frames: die letzte Sekunde durchlaufen und jeden Frame ueber
    // dieselbe Datei schreiben - was uebrig bleibt, ist der letzte Frame.
    await runFfmpeg(ctx, ['-sseof', '-1', '-i', path, '-update', '1', '-an', lastPng]);
  }

  if (!fs.existsSync(firstPng) || !fs.existsSync(lastPng)) {
    throw new Error('Erster oder letzter Frame ließ sich nicht extrahieren.');
  }

  const ssim = await ssimOf(ctx, firstPng, lastPng);
  if (ssim == null) {
    throw new Error('Der ssim-Filter hat keinen Wert geliefert (ffmpeg-Build ohne ssim?).');
  }

  const artifacts = [
    { type: 'image', path: firstPng, label: 'Erster Frame' },
    { type: 'image', path: lastPng, label: 'Letzter Frame' },
  ];

  // Differenzbild - leicht angehoben, sonst sieht man auf Schwarz nichts.
  try {
    await runFfmpeg(ctx, [
      '-i', firstPng, '-i', lastPng,
      '-filter_complex', '[0:v][1:v]blend=all_mode=difference,eq=contrast=3.0,format=rgb24',
      '-frames:v', '1', '-update', '1', '-an',
      diffPng,
    ]);
    artifacts.push({ type: 'image', path: diffPng, label: 'Differenz erster/letzter Frame' });
  } catch (err) {
    logLine(ctx, `Differenzbild der Loop-Naht ließ sich nicht erzeugen: ${err.message}`);
  }

  const detail = { ssim, lastFrameIndex: total > 0 ? total - 1 : null, frames: total || null };

  if (ssim > LOOPSEAM_IDENTICAL) {
    return {
      ...def,
      status: 'fail',
      message:
        `Erster und letzter Frame sind praktisch identisch (SSIM ${ssim.toFixed(4)}), der Loop stockt. ` +
        'Der letzte Frame darf nicht noch einmal Frame 0 sein — im Projekt "dropDuplicateEndFrame" setzen ' +
        'und neu rendern.',
      detail,
      artifacts,
    };
  }
  if (ssim < LOOPSEAM_HARDCUT) {
    return {
      ...def,
      status: 'warn',
      message:
        `harter Sprung an der Loopnaht (SSIM ${ssim.toFixed(4)}). Beim Umlauf springt das Bild sichtbar. ` +
        'Wenn das nicht gewollt ist: Anfang und Ende angleichen oder eine Blende über die Naht legen.',
      detail,
      artifacts,
    };
  }
  return {
    ...def,
    status: 'pass',
    message: `Erster und letzter Frame unterscheiden sich (SSIM ${ssim.toFixed(4)}) — sauber.`,
    detail,
    artifacts,
  };
}

/* ==========================================================================
 * Check 4 - Motiv auf den Panelnaehten
 * ==========================================================================
 * Der wichtigste inhaltliche Check. Die vier Teile jeder Wand fahren
 * auseinander. Was ueber einer Naht liegt, reisst dabei entzwei.
 */

/**
 * Detailenergie in schmalen Streifen um jede Panelnaht, verglichen mit der
 * Detailenergie der Gesamtflaeche. Gemessen ueber mehrere Zeitpunkte per
 * Sobel-Kantenbild (edgedetect) und dessen mittlerer Helligkeit.
 */
export async function seamContent(ctx, path, venue, wallId) {
  const def = { id: 'seamContent', label: 'Motiv auf den Panelnähten' };

  if (!venue) return skipResult(def, 'Ohne Venue sind die Panelgrenzen unbekannt.');
  if (!wallId) return skipResult(def, 'Ohne Wand-ID sind die Panelgrenzen unbekannt.');

  let wall;
  try {
    wall = getWallSpec(venue, wallId);
  } catch (err) {
    return skipResult(def, err.message);
  }

  const panels = wall.panels || [];
  if (panels.length < 2) {
    return skipResult(def, `Wand ${wall.id} hat keine Panelnähte.`);
  }

  const centerX = wall.centerSeamX ?? Math.round(wall.width / 2);
  const seams = panels.slice(1).map((p, i) => ({
    x: p.x,
    left: panels[i].id,
    right: p.id,
    isCenter: p.x === centerX,
  }));

  const probe = await probeFile(ctx, path);
  const times = sampleTimes(probe.durationSec, SAMPLES_SEAM);
  const width = probe.width || wall.width;

  // Pro Stichprobe: Kantenbild bauen, Gesamtenergie messen, dann jeden Streifen.
  const perSeam = seams.map(() => []);
  const fullValues = [];
  const frames = [];

  for (const t of times) {
    throwIfCancelled(ctx);
    const frame = await frameAt(ctx, path, t);
    frames.push({ t, frame });
    const edges = await edgeMap(ctx, frame);

    const full = await statsOf(ctx, edges);
    fullValues.push(num(full.YAVG));

    for (let s = 0; s < seams.length; s++) {
      const x0 = clamp(seams[s].x - SEAM_HALF_PX, 0, Math.max(0, width - 1));
      const w = clamp(SEAM_HALF_PX * 2, 1, width - x0);
      const st = await statsOf(ctx, edges, `crop=${w}:ih:${x0}:0,`);
      perSeam[s].push(num(st.YAVG));
    }
  }

  const fullEnergy = mean(fullValues);
  const rows = seams.map((seam, s) => {
    const energy = mean(perSeam[s]);
    const ratio = energy / Math.max(fullEnergy, 0.5);
    const limit = seam.isCenter ? SEAM_RATIO_WARN_CENTER : SEAM_RATIO_WARN;
    const hot = energy >= SEAM_ENERGY_FLOOR && ratio > limit;
    return { ...seam, energy: round3(energy), ratio: round3(ratio), limit, hot };
  });

  // Artefakte: Kontextstreifen um die Mittelnaht und um jede auffaellige Naht.
  const artifacts = [];
  const midFrame = frames[Math.floor(frames.length / 2)]?.frame;
  if (midFrame) {
    for (const row of rows) {
      if (!row.hot && !row.isCenter) continue;
      const x0 = clamp(row.x - SEAM_CONTEXT_PX, 0, Math.max(0, width - 1));
      const w = clamp(SEAM_CONTEXT_PX * 2, 1, width - x0);
      const out = nodePath.join(workDir(ctx), `seam_x${row.x}.png`);
      try {
        await runFfmpeg(ctx, [
          '-i', midFrame,
          '-vf', `crop=${w}:ih:${x0}:0`,
          '-frames:v', '1', '-update', '1', '-an',
          out,
        ]);
        artifacts.push({
          type: 'image',
          path: out,
          label: `Naht x=${row.x} (${row.left}/${row.right})${row.isCenter ? ', Mittelnaht' : ''}`,
        });
      } catch (err) {
        logLine(ctx, `Nahtstreifen bei x=${row.x} ließ sich nicht schneiden: ${err.message}`);
      }
    }
  }

  const detail = {
    wallId: wall.id,
    centerSeamX: centerX,
    stripHalfWidthPx: SEAM_HALF_PX,
    sampleTimesSec: times,
    fullFrameEnergy: round3(fullEnergy),
    seams: rows,
  };

  const hot = rows.filter((r) => r.hot);
  if (hot.length === 0) {
    return {
      ...def,
      status: 'pass',
      message:
        `Alle ${rows.length} Nähte sind ruhig. Detailenergie auf den Nähten liegt bei ` +
        `${rows.map((r) => `${(r.ratio * 100).toFixed(0)} %`).join(' / ')} des Flächendurchschnitts ` +
        `(${round3(fullEnergy)}). Wenn die Teile auffahren, reißt nichts Wesentliches.`,
      detail,
      artifacts,
    };
  }

  const texte = hot.map((r) => {
    const base = `Auf der Naht bei x=${r.x} liegt viel Bilddetail. Wenn die Teile auffahren, reißt das Motiv.`;
    const zahlen =
      ` (${(r.ratio * 100).toFixed(0)} % des Flächendurchschnitts, Grenze ` +
      `${(r.limit * 100).toFixed(0)} %, zwischen ${r.left} und ${r.right})`;
    return r.isCenter
      ? `MITTELNAHT: ${base}${zahlen} Dort trennt sich die Wand im Regelfall.`
      : base + zahlen;
  });

  return { ...def, status: 'warn', message: texte.join(' '), detail, artifacts };
}

/* ==========================================================================
 * Check 5 - Aussenzonen
 * ========================================================================== */

/**
 * Belegung der aeusseren 15 %: liegt dort hell/detailreicher Inhalt, der beim
 * Strecken oder bei einem Logo stoert? Reine Information, nie ein Fehler.
 */
export async function safeArea(ctx, path, venue, wallId) {
  const def = { id: 'safeArea', label: 'Außenzonen (15 %)' };

  if (!venue) return skipResult(def, 'Ohne Venue ist die Größe der Außenzone unbekannt.');
  if (!wallId) return skipResult(def, 'Ohne Wand-ID ist die Größe der Außenzone unbekannt.');

  let wall;
  try {
    wall = getWallSpec(venue, wallId);
  } catch (err) {
    return skipResult(def, err.message);
  }

  const pct = wall.safeAreaPct ?? 0.15;
  const p = pct.toFixed(4);
  const regions = [
    { id: 'links', crop: `crop=iw*${p}:ih:0:0,` },
    { id: 'rechts', crop: `crop=iw*${p}:ih:iw*(1-${p}):0,` },
    { id: 'oben', crop: `crop=iw:ih*${p}:0:0,` },
    { id: 'unten', crop: `crop=iw:ih*${p}:0:ih*(1-${p}),` },
    { id: 'mitte', crop: `crop=iw*(1-2*${p}):ih*(1-2*${p}):iw*${p}:ih*${p},` },
  ];

  const probe = await probeFile(ctx, path);
  const times = sampleTimes(probe.durationSec, SAMPLES_SAFEAREA);

  const acc = {};
  for (const r of regions) acc[r.id] = { luma: [], edges: [] };

  let firstFrame = null;
  for (const t of times) {
    throwIfCancelled(ctx);
    const frame = await frameAt(ctx, path, t);
    if (!firstFrame) firstFrame = frame;
    const edges = await edgeMap(ctx, frame);
    for (const r of regions) {
      const l = await statsOf(ctx, frame, r.crop);
      const e = await statsOf(ctx, edges, r.crop);
      acc[r.id].luma.push(num(l.YAVG));
      acc[r.id].edges.push(num(e.YAVG));
    }
  }

  const values = {};
  for (const r of regions) {
    values[r.id] = { luma: round3(mean(acc[r.id].luma)), edges: round3(mean(acc[r.id].edges)) };
  }
  const refLuma = Math.max(values.mitte.luma, 0.5);
  const refEdges = Math.max(values.mitte.edges, 0.5);

  const bands = ['links', 'rechts', 'oben', 'unten'];
  const rel = {};
  for (const b of bands) {
    rel[b] = {
      lumaPct: Math.round((values[b].luma / refLuma) * 100),
      edgePct: Math.round((values[b].edges / refEdges) * 100),
    };
  }

  // Auffaellig ist eine Zone, die deutlich heller ODER detailreicher ist als die Mitte.
  const busy = bands.filter((b) => rel[b].lumaPct >= 130 || rel[b].edgePct >= 140);

  const artifacts = [];
  if (firstFrame) {
    const out = nodePath.join(workDir(ctx), 'safearea.png');
    const box = (x, y, w, h) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=red@0.75:t=4`;
    try {
      await runFfmpeg(ctx, [
        '-i', firstFrame,
        '-vf',
        [
          box(0, 0, `iw*${p}`, 'ih'),
          box(`iw*(1-${p})`, 0, `iw*${p}`, 'ih'),
          box(0, 0, 'iw', `ih*${p}`),
          box(0, `ih*(1-${p})`, 'iw', `ih*${p}`),
        ].join(','),
        '-frames:v', '1', '-update', '1', '-an',
        out,
      ]);
      artifacts.push({
        type: 'image',
        path: out,
        label: `Außenzonen ${(pct * 100).toFixed(0)} % markiert`,
      });
    } catch (err) {
      logLine(ctx, `Übersichtsbild der Außenzonen ließ sich nicht erzeugen: ${err.message}`);
    }
  }

  const detail = {
    wallId: wall.id,
    safeAreaPct: pct,
    sampleTimesSec: times,
    absolute: values,
    relativeToCenterPct: rel,
    busyZones: busy,
  };

  const zahlen = bands
    .map((b) => `${b} ${rel[b].lumaPct} % Helligkeit / ${rel[b].edgePct} % Detail`)
    .join(', ');

  let message = `Außenzone ${(pct * 100).toFixed(0)} % gegenüber der Bildmitte: ${zahlen}. `;
  if (busy.length) {
    message +=
      `Belegt: ${busy.join(', ')}. Wenn dort gestreckt wird oder ein Logo hinein soll, geht dieser ` +
      'Inhalt verloren. Vor der Produktion klären, ob die 15 %-Zone reine Sicherheitszone, ' +
      'Logo-Platz oder Streckfläche ist.';
  } else {
    message += 'Die Außenzonen sind ruhig — Strecken oder ein Logo dort wäre unkritisch.';
  }

  // API.md kennt nur pass/warn/fail/skip. "info-Level" wird deshalb als
  // 'pass' gemeldet, die Aussage steckt in message und detail.
  return { ...def, status: 'pass', message, detail, artifacts };
}

/* ==========================================================================
 * Check 6 - Schwarzwert und Spitzen
 * ========================================================================== */

/**
 * signalstats ueber die Datei: YMIN, YAVG, YMAX, YLOW.
 *
 * Absen-Panels heben Schwarz ohnehin an. Wenn das Material schon ueber dem
 * Referenzschwarz liegt, verlieren die Silhouetten ihre Kante. Umgekehrt
 * klebt Neon gern an der Obergrenze und clippt dann auf der Wand.
 */
export async function blackLevel(ctx, path) {
  const def = { id: 'blackLevel', label: 'Schwarzwert und Spitzen' };

  const probe = await probeFile(ctx, path);
  const total = Number(probe.frames) || 0;

  // Nicht jeder Frame muss durch signalstats - das ist der teure Teil.
  let sel = '';
  let sampled = total;
  if (total > BLACKLEVEL_MAX_SAMPLES) {
    const step = Math.ceil(total / BLACKLEVEL_MAX_SAMPLES);
    sel = `select='not(mod(n,${step}))',`;
    sampled = Math.ceil(total / step);
  }

  const r = await runFfmpeg(ctx, [
    '-i', path,
    '-vf', `${sel}format=yuv420p,signalstats,metadata=mode=print:file=-`,
    '-an', '-f', 'null', '-',
  ]);
  const frames = parseMetadataFrames(`${r.stdout}\n${r.stderr}`);
  if (frames.length === 0) {
    throw new Error('signalstats hat keine Werte geliefert.');
  }

  const yminAll = frames.map((f) => num(f.values.YMIN));
  const ymaxAll = frames.map((f) => num(f.values.YMAX));
  const yavgAll = frames.map((f) => num(f.values.YAVG));
  const ylowAll = frames.map((f) => num(f.values.YLOW)).filter((v) => Number.isFinite(v));

  const ymin = Math.min(...yminAll);
  const ymax = Math.max(...ymaxAll);
  const yavg = mean(yavgAll);
  const ylow = ylowAll.length ? mean(ylowAll) : null;

  const fullRange = probe.colorRange === 'pc';
  const blackRef = fullRange ? 0 : BLACK_TV_FLOOR;
  const blackWarn = fullRange ? BLACK_PC_WARN : BLACK_TV_WARN;
  const whiteClip = fullRange ? WHITE_PC_CLIP : WHITE_TV_CLIP;

  const clippedFrames = ymaxAll.filter((v) => v >= whiteClip).length;

  const problems = [];
  if (ymin > blackWarn) {
    problems.push(
      `Schwarz ist nicht schwarz: der dunkelste Wert der ganzen Datei ist ${ymin.toFixed(0)}, ` +
        `Referenzschwarz wäre ${blackRef} (${fullRange ? 'pc' : 'tv'}-Range). ` +
        'Die Absen-Panels heben Schwarz zusätzlich an — die Silhouetten verlieren dabei ihre Kante.'
    );
  }
  if (clippedFrames > 0) {
    problems.push(
      `Neon clippt: in ${clippedFrames} von ${frames.length} geprüften Frames klebt die Spitze bei ` +
        `${ymax.toFixed(0)} an der Obergrenze (${whiteClip}). Auf dem Monitor stimmig, auf der Wand ` +
        'meist brutal zu hell — Helligkeit im Layer zurücknehmen.'
    );
  }

  const artifacts = [];
  const hist = nodePath.join(workDir(ctx), 'histogram.png');
  try {
    const mid = (probe.durationSec || 0) / 2;
    await runFfmpeg(ctx, [
      '-ss', String(round3(mid)),
      '-i', path,
      '-vf', 'format=yuv420p,histogram=display_mode=stack:levels_mode=logarithmic',
      '-frames:v', '1', '-update', '1', '-an',
      hist,
    ]);
    artifacts.push({ type: 'image', path: hist, label: 'Histogramm (Frame aus der Mitte)' });
  } catch (err) {
    logLine(ctx, `Histogramm ließ sich nicht erzeugen: ${err.message}`);
  }

  const detail = {
    framesChecked: frames.length,
    framesTotal: total || null,
    sampledEveryNth: sampled !== total ? Math.ceil(total / sampled) : 1,
    colorRange: probe.colorRange || '(unbekannt)',
    YMIN: round3(ymin),
    YLOW: ylow == null ? null : round3(ylow),
    YAVG: round3(yavg),
    YMAX: round3(ymax),
    clippedFrames,
    reference: { black: blackRef, blackWarnAbove: blackWarn, whiteClipAt: whiteClip },
  };

  const zahlen =
    `YMIN ${ymin.toFixed(0)}, ${ylow == null ? '' : `YLOW ${ylow.toFixed(1)}, `}` +
    `YAVG ${yavg.toFixed(1)}, YMAX ${ymax.toFixed(0)}`;

  if (problems.length) {
    return { ...def, status: 'warn', message: `${zahlen}. ${problems.join(' ')}`, detail, artifacts };
  }
  return {
    ...def,
    status: 'pass',
    message: `${zahlen} — Schwarz sitzt auf ${blackRef}, nichts klebt an der Obergrenze.`,
    detail,
    artifacts,
  };
}

/* ==========================================================================
 * Check 7 - Banding
 * ========================================================================== */

/**
 * Grosse dunkle Gradienten sind auf LED die schwerste Uebung.
 *
 * Methode: einen Frame ziehen, eine per gradfun geglaettete Fassung erzeugen
 * und beide per SSIM vergleichen. Damit nur die dunklen Bereiche zaehlen,
 * werden vorher alle Werte oberhalb einer Schwelle plattgedrueckt - in beiden
 * Bildern gleich, dort ist der Vergleich dann per Definition identisch.
 */
export async function banding(ctx, path) {
  const def = { id: 'banding', label: 'Banding in dunklen Flächen' };

  const probe = await probeFile(ctx, path);
  const t = round3((probe.durationSec || 0) * 0.4);
  const frame = await frameAt(ctx, path, t);
  const smoothed = nodePath.join(workDir(ctx), 'banding_gradfun.png');
  const diff = nodePath.join(workDir(ctx), 'banding_diff.png');

  await runFfmpeg(ctx, [
    '-i', frame,
    '-vf', 'format=yuv420p,gradfun=strength=1.2:radius=16',
    '-frames:v', '1', '-update', '1', '-an',
    smoothed,
  ]);

  const ssimFull = await ssimOf(ctx, frame, smoothed);

  // Nur dunkle Bereiche: alles ueber der Schwelle wird in BEIDEN Bildern
  // auf denselben Wert geklemmt, dort ist SSIM dann exakt 1.
  const clamp2 = `format=yuv420p,lutyuv=y='min(val,${BANDING_DARK_CLAMP})'`;
  const rd = await runFfmpeg(ctx, [
    '-i', frame, '-i', smoothed,
    '-filter_complex', `[0:v]${clamp2}[a];[1:v]${clamp2}[b];[a][b]ssim`,
    '-an', '-f', 'null', '-',
  ]);
  const ssimDark = parseSsim(`${rd.stdout}\n${rd.stderr}`);
  if (ssimDark == null) {
    throw new Error('Der ssim-Filter hat für den Dunkelbereich keinen Wert geliefert.');
  }

  const artifacts = [
    { type: 'image', path: frame, label: `Frame bei ${t} s` },
    { type: 'image', path: smoothed, label: 'gradfun-geglättete Fassung' },
  ];
  try {
    await runFfmpeg(ctx, [
      '-i', frame, '-i', smoothed,
      '-filter_complex', '[0:v][1:v]blend=all_mode=difference,eq=contrast=6.0,format=rgb24',
      '-frames:v', '1', '-update', '1', '-an',
      diff,
    ]);
    artifacts.push({ type: 'image', path: diff, label: 'Differenz — hier saßen die Stufen' });
  } catch (err) {
    logLine(ctx, `Banding-Differenzbild ließ sich nicht erzeugen: ${err.message}`);
  }

  const stats = await statsOf(ctx, frame);
  const detail = {
    atSec: t,
    ssimFull: ssimFull == null ? null : round3(ssimFull),
    ssimDark: round3(ssimDark),
    darkClamp: BANDING_DARK_CLAMP,
    frameYAVG: round3(num(stats.YAVG)),
    thresholds: { warn: BANDING_SSIM_WARN, strong: BANDING_SSIM_STRONG },
  };

  if (ssimDark < BANDING_SSIM_STRONG) {
    return {
      ...def,
      status: 'warn',
      message:
        `Deutliche Gradientenstufen in den dunklen Flächen (SSIM zur geglätteten Fassung ` +
        `${ssimDark.toFixed(4)}, Grenze ${BANDING_SSIM_WARN}). Banding wahrscheinlich — auf der Wand ` +
        'sind das sichtbare Ringe im Nachthimmel. Dithering im Layer aktivieren und, wenn es bleibt, ' +
        'auf HAP Q statt HAP bestehen.',
      detail,
      artifacts,
    };
  }
  if (ssimDark < BANDING_SSIM_WARN) {
    return {
      ...def,
      status: 'warn',
      message:
        `Gradientenstufen in den dunklen Flächen messbar (SSIM ${ssimDark.toFixed(4)}, Grenze ` +
        `${BANDING_SSIM_WARN}). Banding wahrscheinlich — Dithering im Layer aktivieren.`,
      detail,
      artifacts,
    };
  }
  return {
    ...def,
    status: 'pass',
    message:
      `Dunkle Flächen laufen glatt durch (SSIM ${ssimDark.toFixed(4)} gegen die geglättete Fassung).`,
    detail,
    artifacts,
  };
}

/* ==========================================================================
 * Check 8 - Moire
 * ========================================================================== */

/**
 * Hochfrequenzanteil messen: Differenz zwischen Original und leicht
 * weichgezeichneter Fassung. Feine Strukturen nahe der Pixelaufloesung
 * (Kranstreben, Fenstergitter) geben auf LED Moire.
 */
export async function moire(ctx, path, venue) {
  const def = { id: 'moire', label: 'Moiré-Risiko' };

  const probe = await probeFile(ctx, path);
  const times = sampleTimes(probe.durationSec, SAMPLES_MOIRE);

  const chain =
    `[0:v]format=gray,split=2[m0][m1];` +
    `[m0]gblur=sigma=${MOIRE_BLUR_SIGMA}[bl];` +
    `[m1][bl]blend=all_mode=difference,format=yuv420p,signalstats,metadata=mode=print:file=-[out]`;

  const values = [];
  const peaks = [];
  let midFrame = null;

  for (const t of times) {
    throwIfCancelled(ctx);
    const frame = await frameAt(ctx, path, t);
    if (!midFrame) midFrame = frame;
    const r = await runFfmpeg(ctx, [
      '-i', frame,
      '-filter_complex', chain,
      '-map', '[out]', '-an', '-f', 'null', '-',
    ]);
    const f = parseMetadataFrames(`${r.stdout}\n${r.stderr}`)[0];
    if (!f) continue;
    values.push(num(f.values.YAVG));
    peaks.push(num(f.values.YMAX));
  }

  if (values.length === 0) {
    throw new Error('Die Hochfrequenzmessung hat keine Werte geliefert.');
  }

  const hf = mean(values);
  const hfPeak = Math.max(...peaks);
  const pitch = venue?.pixelPitchMm;

  const artifacts = [];
  if (midFrame) {
    const out = nodePath.join(workDir(ctx), 'moire_highpass.png');
    try {
      await runFfmpeg(ctx, [
        '-i', midFrame,
        '-filter_complex',
        `[0:v]format=gray,split=2[m0][m1];[m0]gblur=sigma=${MOIRE_BLUR_SIGMA}[bl];` +
          `[m1][bl]blend=all_mode=difference,eq=contrast=4.0[out]`,
        '-map', '[out]', '-frames:v', '1', '-update', '1', '-an',
        out,
      ]);
      artifacts.push({ type: 'image', path: out, label: 'Hochfrequenzanteil (hell = feine Struktur)' });
    } catch (err) {
      logLine(ctx, `Hochfrequenzbild ließ sich nicht erzeugen: ${err.message}`);
    }
  }

  const detail = {
    sampleTimesSec: times,
    highFrequencyEnergy: round3(hf),
    highFrequencyPeak: round3(hfPeak),
    blurSigma: MOIRE_BLUR_SIGMA,
    pixelPitchMm: pitch ?? null,
    thresholds: { warn: MOIRE_WARN, strong: MOIRE_STRONG },
  };

  const pitchSatz = pitch ? ` Auf ${pitch} mm Pitch` : ' Auf der LED-Wand';

  if (hf >= MOIRE_STRONG) {
    return {
      ...def,
      status: 'warn',
      message:
        `Sehr hoher Anteil feiner Strukturen (Hochfrequenzenergie ${hf.toFixed(1)} von 255, ` +
        `Grenze ${MOIRE_WARN}).${pitchSatz} geben Kranstreben und Fenstergitter in dieser Feinheit ` +
        'sichtbares Moiré. Struktur vergröbern oder mit Tiefpass skalieren.',
      detail,
      artifacts,
    };
  }
  if (hf >= MOIRE_WARN) {
    return {
      ...def,
      status: 'warn',
      message:
        `Feine Strukturen nahe der Pixelauflösung (Hochfrequenzenergie ${hf.toFixed(1)} von 255, ` +
        `Grenze ${MOIRE_WARN}).${pitchSatz} kann das Moiré geben — im Testfile gezielt auf ` +
        'Kranstreben und Fenstergitter schauen.',
      detail,
      artifacts,
    };
  }
  return {
    ...def,
    status: 'pass',
    message: `Hochfrequenzanteil unauffällig (${hf.toFixed(1)} von 255, Grenze ${MOIRE_WARN}).`,
    detail,
    artifacts,
  };
}

/* ==========================================================================
 * Check 9 - Flackerfrequenzen
 * ========================================================================== */

/**
 * Mittlere Helligkeit pro Frame sammeln und von Hand per DFT in Frequenzen
 * zerlegen. Ausgepraegte Peaks zwischen 4 und 15 Hz schlagen mit den
 * Kamerashuttern der Hausregie, falls die Show mitgeschnitten wird.
 *
 * Fuer die Messung wird das Bild klein skaliert (flags=area mittelt korrekt),
 * die mittlere Helligkeit bleibt dabei praktisch unveraendert.
 */
export async function flicker(ctx, path) {
  const def = { id: 'flicker', label: 'Flackerfrequenzen' };

  const probe = await probeFile(ctx, path);
  const fps = probe.fps > 0 ? probe.fps : 30;

  const r = await runFfmpeg(ctx, [
    '-i', path,
    '-vf',
    'scale=96:54:flags=area,format=yuv420p,signalstats,' +
      'metadata=mode=print:key=lavfi.signalstats.YAVG:file=-',
    '-an', '-f', 'null', '-',
  ]);
  const frames = parseMetadataFrames(`${r.stdout}\n${r.stderr}`);
  const series = frames.map((f) => num(f.values.YAVG)).filter((v) => Number.isFinite(v));

  if (series.length < 16) {
    return skipResult(
      def,
      `Zu wenige Frames für eine Frequenzanalyse (${series.length}). Mindestens 16 werden gebraucht.`
    );
  }

  const used = series.length > FLICKER_MAX_SAMPLES ? series.slice(0, FLICKER_MAX_SAMPLES) : series;
  const spectrum = spectrumOf(used, fps);

  const inBand = spectrum.peaks.filter(
    (p) => p.freqHz >= FLICKER_HZ_LOW && p.freqHz <= FLICKER_HZ_HIGH
  );
  const critical = inBand.filter(
    (p) =>
      p.amplitude >= FLICKER_AMP_WARN &&
      p.amplitude >= FLICKER_AMP_OVER_MEDIAN * Math.max(spectrum.medianAmplitude, 0.01)
  );

  // Die Helligkeitskurve als CSV mitgeben - damit laesst sich die Aussage
  // in jedem Tabellenprogramm nachvollziehen.
  const artifacts = [];
  const csv = nodePath.join(workDir(ctx), 'flicker.csv');
  try {
    const lines = ['frame;zeit_s;yavg'];
    for (let i = 0; i < used.length; i++) {
      lines.push(`${i};${(i / fps).toFixed(4)};${used[i].toFixed(4)}`);
    }
    lines.push('');
    lines.push('frequenz_hz;amplitude');
    for (const p of spectrum.peaks) lines.push(`${p.freqHz.toFixed(3)};${p.amplitude.toFixed(4)}`);
    fs.writeFileSync(csv, lines.join('\r\n'), 'utf8');
    artifacts.push({ type: 'text', path: csv, label: 'Helligkeitsverlauf und Spektrum' });
  } catch (err) {
    logLine(ctx, `Flicker-CSV ließ sich nicht schreiben: ${err.message}`);
  }

  const detail = {
    framesAnalysed: used.length,
    fps,
    frequencyResolutionHz: round3(fps / used.length),
    meanLuma: round3(spectrum.mean),
    medianAmplitude: round3(spectrum.medianAmplitude),
    topPeaks: spectrum.peaks.map((p) => ({ freqHz: round3(p.freqHz), amplitude: round3(p.amplitude) })),
    band: { lowHz: FLICKER_HZ_LOW, highHz: FLICKER_HZ_HIGH },
    criticalPeaks: critical.map((p) => ({ freqHz: round3(p.freqHz), amplitude: round3(p.amplitude) })),
  };

  const liste = spectrum.peaks
    .slice(0, 4)
    .map((p) => `${p.freqHz.toFixed(2)} Hz (${p.amplitude.toFixed(2)})`)
    .join(', ');

  if (critical.length) {
    const k = critical
      .map((p) => `${p.freqHz.toFixed(2)} Hz mit Amplitude ${p.amplitude.toFixed(2)}`)
      .join(', ');
    return {
      ...def,
      status: 'warn',
      message:
        `Ausgeprägte Flackerfrequenz im kritischen Band ${FLICKER_HZ_LOW}–${FLICKER_HZ_HIGH} Hz: ${k}. ` +
        'Das schlägt mit den Kamerashuttern der Hausregie — wenn mitgeschnitten wird, flimmert die ' +
        'Aufzeichnung. Blitzer/Stroboskop im Content entzerren oder auf eine andere Rate legen. ' +
        `Stärkste Frequenzen insgesamt: ${liste}.`,
      detail,
      artifacts,
    };
  }
  return {
    ...def,
    status: 'pass',
    message:
      `Keine ausgeprägte Frequenz zwischen ${FLICKER_HZ_LOW} und ${FLICKER_HZ_HIGH} Hz. ` +
      `Stärkste Frequenzen: ${liste || 'keine nennenswerten'}.`,
    detail,
    artifacts,
  };
}

/**
 * Diskrete Fourier-Transformation von Hand - keine Bibliothek, keine
 * Abhaengigkeit. Fuer ein paar tausend Werte ist das schnell genug.
 *
 * Mittelwert abziehen, Hann-Fenster legen (sonst schmiert der Loopsprung
 * ueber das ganze Spektrum), dann Amplitude je Frequenzbin.
 */
export function spectrumOf(series, fps) {
  const n = series.length;
  const avg = mean(series);

  const win = new Array(n);
  for (let i = 0; i < n; i++) {
    win[i] = (series[i] - avg) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  const bins = Math.floor(n / 2);
  const amp = new Array(bins).fill(0);
  for (let k = 1; k < bins; k++) {
    let re = 0;
    let im = 0;
    const w = (-2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      const a = w * i;
      re += win[i] * Math.cos(a);
      im += win[i] * Math.sin(a);
    }
    // 2/n fuer die einseitige Amplitude, /0.5 als Korrektur des Hann-Fensters.
    amp[k] = (4 * Math.sqrt(re * re + im * im)) / n;
  }

  const sorted = amp.slice(1).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const medianAmplitude = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  // Nur lokale Maxima zaehlen, sonst stehen im Ergebnis lauter Nachbarbins.
  const peaks = [];
  for (let k = 2; k < bins - 1; k++) {
    if (amp[k] > amp[k - 1] && amp[k] >= amp[k + 1]) {
      peaks.push({ freqHz: (k * fps) / n, amplitude: amp[k] });
    }
  }
  peaks.sort((a, b) => b.amplitude - a.amplitude);

  return { mean: avg, medianAmplitude, peaks: peaks.slice(0, 8), bins, fps, n };
}

/* ==========================================================================
 * Check 10 - Kontaktbogen
 * ========================================================================== */

/**
 * Gleichmaessig verteilte Frames im Raster, mit eingebrannten Zeitstempeln.
 * Das ist das Bild, das an den Kunden geht - deshalb immer als Artefakt.
 *
 * Fehlt eine Schriftdatei, entsteht der Bogen ohne Text und im Log steht,
 * warum.
 */
export async function contactSheet(ctx, path, opts = {}) {
  const def = { id: 'contactSheet', label: 'Kontaktbogen' };

  const columns = Math.max(1, Math.round(opts.columns || 4));
  let rows = Math.max(1, Math.round(opts.rows || 3));

  const probe = await probeFile(ctx, path);
  let total = Number(probe.frames) || 0;
  if (!total && probe.durationSec > 0 && probe.fps > 0) {
    total = Math.round(probe.durationSec * probe.fps);
  }
  if (!total) throw new Error('Die Framezahl ist unbekannt, der Kontaktbogen braucht sie.');

  while (rows > 1 && columns * rows > total) rows--;
  const count = Math.min(columns * rows, total);

  const indices = [];
  for (let i = 0; i < count; i++) {
    indices.push(Math.min(total - 1, Math.round(((i + 0.5) * total) / count)));
  }

  const tileW = Math.max(160, Math.round(CONTACTSHEET_WIDTH / columns / 2) * 2);
  const fontSize = Math.max(14, Math.round(tileW / 22));
  const sel = `select='${indices.map((n) => `eq(n,${n})`).join('+')}'`;
  const tile = `tile=${columns}x${rows}:margin=8:padding=6:color=black`;
  const out = nodePath.join(workDir(ctx), 'contactsheet.jpg');

  const font = findFontFile();
  const drawtext = font
    ? `drawtext=fontfile=${escapeFilterPath(font)}:text='%{pts:hms}':x=10:y=h-th-10:` +
      `fontsize=${fontSize}:fontcolor=white:borderw=2:bordercolor=black@0.85`
    : null;

  const build = (withText) =>
    [sel, `scale=${tileW}:-2`, ...(withText && drawtext ? [drawtext] : []), tile].join(',');

  const args = (withText) => [
    '-i', path,
    '-vf', build(withText),
    '-fps_mode', 'passthrough',
    '-frames:v', '1', '-q:v', '3', '-an',
    out,
  ];

  let withText = !!drawtext;
  if (!font) {
    logLine(
      ctx,
      'Keine Schriftdatei gefunden (weder in %WINDIR%\\Fonts noch an den üblichen Stellen) — ' +
        'der Kontaktbogen entsteht ohne eingebrannte Zeitstempel.'
    );
  }

  try {
    await runFfmpeg(ctx, args(withText));
  } catch (err) {
    if (!withText) throw err;
    logLine(
      ctx,
      `drawtext ist gescheitert (${err.message}) — der Kontaktbogen entsteht ohne eingebrannte Zeitstempel.`
    );
    withText = false;
    await runFfmpeg(ctx, args(false));
  }

  if (!fs.existsSync(out)) throw new Error('Der Kontaktbogen wurde nicht geschrieben.');

  const detail = {
    columns,
    rows,
    frames: indices,
    timesSec: indices.map((n) => round3(n / (probe.fps || 30))),
    tileWidth: tileW,
    withTimestamps: withText,
    fontFile: withText ? font : null,
  };

  return {
    ...def,
    status: 'pass',
    message:
      `Kontaktbogen ${columns}×${rows} aus ${indices.length} Frames erzeugt` +
      `${withText ? ' mit eingebrannten Zeitstempeln' : ' — ohne Zeitstempel, es fehlte die Schrift'}.`,
    detail,
    artifacts: [{ type: 'image', path: out, label: `Kontaktbogen ${columns}×${rows}` }],
  };
}

/** Erste brauchbare Schriftdatei auf diesem Rechner, sonst null. */
function findFontFile() {
  const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    nodePath.join(win, 'Fonts', 'arial.ttf'),
    nodePath.join(win, 'Fonts', 'consola.ttf'),
    nodePath.join(win, 'Fonts', 'segoeui.ttf'),
    nodePath.join(win, 'Fonts', 'verdana.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* Zugriffsfehler auf einen Kandidaten ist kein Grund aufzugeben. */
    }
  }
  return null;
}

/**
 * Windows-Pfad fuer ein ffmpeg-Filterargument: Backslashes zu Schraegstrichen,
 * Doppelpunkt maskieren - sonst zerlegt der Filterparser den Laufwerksbuchstaben.
 */
function escapeFilterPath(p) {
  return String(p).replace(/\\/g, '/').replace(/:/g, '\\:');
}

/* ==========================================================================
 * Ergebnis-Huellen
 * ========================================================================== */

function skipResult(def, message, detail = {}) {
  return { id: def.id, label: def.label, status: 'skip', message, detail, artifacts: [] };
}

/**
 * Fuehrt einen Check aus und faengt alles ab, was daneben gehen kann.
 * Ein gescheiterter ffmpeg-Aufruf macht genau diesen Check zu 'skip' -
 * nie den ganzen Job. Ein Abbruch durch den Nutzer fliegt bewusst durch.
 */
async function guarded(ctx, def, fn) {
  setOn(ctx, '__qcCommands', []);
  let out;
  try {
    out = await fn();
  } catch (err) {
    throwIfCancelled(ctx);
    if (err && err.cancelled) throw err;
    const msg = err?.message || String(err);
    logLine(ctx, `Check "${def.label}" übersprungen: ${msg}`);
    out = skipResult(def, `Übersprungen: ${msg}`, { error: msg, command: err?.command || null });
  }

  const res = {
    id: out?.id || def.id,
    label: out?.label || def.label,
    status: STATUS_RANK[out?.status] === undefined ? 'skip' : out.status,
    message: out?.message || '',
    detail: out?.detail && typeof out.detail === 'object' ? out.detail : {},
    artifacts: Array.isArray(out?.artifacts) ? out.artifacts : [],
  };
  const cmds = ctx?.__qcCommands;
  if (Array.isArray(cmds) && cmds.length) res.detail.commands = cmds.slice();
  logLine(ctx, `   ${res.status.toUpperCase()}: ${res.message}`);
  return res;
}

function summarize(results) {
  const s = { pass: 0, warn: 0, fail: 0, skip: 0, worst: 'pass' };
  for (const r of results) {
    if (s[r.status] !== undefined) s[r.status]++;
    if (STATUS_RANK[r.status] > STATUS_RANK[s.worst]) s.worst = r.status;
  }
  return s;
}

function normalizeCheckList(checks) {
  if (!checks || (Array.isArray(checks) && checks.length === 0)) return [...ALL_CHECK_IDS];
  const wanted = Array.isArray(checks) ? checks : [checks];
  const seen = new Set();
  const out = [];
  // Reihenfolge aus CHECKS gewinnt, damit der Bericht immer gleich aussieht.
  for (const id of ALL_CHECK_IDS) {
    if (wanted.includes(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of wanted) {
    if (typeof id === 'string' && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/* ==========================================================================
 * ffmpeg / ffprobe
 * ========================================================================== */

/**
 * Ruft ffmpeg auf. "-y -hide_banner -nostdin" steht immer vorne, die
 * Kommandozeile landet lesbar im Log und im Job-Objekt.
 * Wirft bei Exitcode != 0.
 */
export function runFfmpeg(ctx, args, opts = {}) {
  return runTool(ctx, resolveTools(ctx).ffmpeg, ['-y', '-hide_banner', '-nostdin', ...args], opts);
}

function runTool(ctx, bin, args, { maxBytes = 32 * 1024 * 1024, allowFail = false } = {}) {
  const command = commandLine(bin, args);
  noteCommand(ctx, command);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: abortSignal(ctx),
      });
    } catch (err) {
      reject(withCommand(new Error(`"${bin}" ließ sich nicht starten: ${err.message}`), command));
      return;
    }

    let out = '';
    let errTxt = '';
    child.stdout.on('data', (d) => {
      if (out.length < maxBytes) out += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      if (errTxt.length < maxBytes) errTxt += d.toString('utf8');
    });
    child.on('error', (err) => {
      const hint =
        err.code === 'ENOENT'
          ? ` — "${bin}" wurde nicht gefunden. ffmpeg über "Werkzeuge → ffmpeg installieren" holen.`
          : '';
      reject(withCommand(new Error(`${bin} ließ sich nicht ausführen: ${err.message}${hint}`), command));
    });
    child.on('close', (code) => {
      const res = { code, stdout: out, stderr: errTxt, command };
      if (code === 0 || allowFail) {
        resolve(res);
        return;
      }
      const e = withCommand(
        new Error(`ffmpeg brach mit Code ${code} ab. ${lastLines(errTxt, 4)}`.trim()),
        command
      );
      e.stderr = errTxt;
      reject(e);
    });
  });
}

function withCommand(err, command) {
  err.command = command;
  return err;
}

/**
 * ffprobe-Ergebnis in der Form aus shared/model.js -> probeShape().
 * Nutzt ctx.probe(), falls der Server eine eigene Probe-Implementierung
 * mitgibt; sonst wird ffprobe direkt aufgerufen.
 */
export async function probeFile(ctx, file) {
  const cached = probeCacheGet(ctx, file);
  if (cached) return cached;

  if (typeof ctx?.probe === 'function') {
    try {
      const p = await ctx.probe(file);
      if (p && p.width) {
        probeCacheSet(ctx, file, p);
        return p;
      }
    } catch (err) {
      logLine(ctx, `ctx.probe() ist gescheitert, ffprobe übernimmt: ${err.message}`);
    }
  }

  const bin = resolveTools(ctx).ffprobe;
  const r = await runTool(ctx, bin, [
    '-hide_banner', '-v', 'error',
    '-print_format', 'json',
    '-show_streams', '-show_format',
    file,
  ]);

  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch (err) {
    throw new Error(`ffprobe lieferte kein lesbares JSON: ${err.message}`);
  }
  const streams = json.streams || [];
  const v = streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error(`In ${nodePath.basename(file)} ist keine Videospur.`);

  const fpsExact = v.r_frame_rate && v.r_frame_rate !== '0/0' ? v.r_frame_rate : v.avg_frame_rate || '0/1';
  const fps = ratioToNumber(fpsExact);
  const durationSec = Number(v.duration) || Number(json.format?.duration) || 0;
  let frames = Number(v.nb_frames) || 0;
  if (!frames && durationSec > 0 && fps > 0) frames = Math.round(durationSec * fps);

  const info = {
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    fps: Math.round(fps * 1000) / 1000,
    fpsExact,
    durationSec,
    frames,
    codec: v.codec_name || '',
    pixFmt: v.pix_fmt || '',
    hasAlpha: /a$|rgba|yuva|argb|abgr/.test(v.pix_fmt || ''),
    colorRange: v.color_range || '',
    colorSpace: v.color_space || '',
    bitrate: Number(v.bit_rate) || Number(json.format?.bit_rate) || 0,
    sizeBytes: Number(json.format?.size) || 0,
    container: json.format?.format_name || '',
    audioStreams: streams.filter((s) => s.codec_type === 'audio').length,
  };
  probeCacheSet(ctx, file, info);
  return info;
}

const PROBE_CACHE = new WeakMap();

function probeCacheGet(ctx, file) {
  if (!ctx || typeof ctx !== 'object') return null;
  return PROBE_CACHE.get(ctx)?.get(file) || null;
}

function probeCacheSet(ctx, file, info) {
  if (!ctx || typeof ctx !== 'object') return;
  let m = PROBE_CACHE.get(ctx);
  if (!m) {
    m = new Map();
    PROBE_CACHE.set(ctx, m);
  }
  m.set(file, info);
}

function ratioToNumber(r) {
  const [a, b] = String(r).split('/');
  const num1 = Number(a);
  const den = Number(b);
  if (!Number.isFinite(num1)) return 0;
  if (!Number.isFinite(den) || den === 0) return num1;
  return num1 / den;
}

/* ==========================================================================
 * Messbausteine
 * ========================================================================== */

/** Einen Frame als PNG ziehen. Schon vorhandene Dateien werden wiederverwendet. */
async function frameAt(ctx, file, tSec) {
  const out = nodePath.join(
    workDir(ctx),
    `frame_${String(Math.round(Math.max(0, tSec) * 1000)).padStart(9, '0')}.png`
  );
  if (fileHasContent(out)) return out;
  await runFfmpeg(ctx, [
    '-ss', String(round3(Math.max(0, tSec))),
    '-i', file,
    '-frames:v', '1', '-update', '1', '-an',
    out,
  ]);
  if (!fileHasContent(out)) throw new Error(`Frame bei ${round3(tSec)} s ließ sich nicht extrahieren.`);
  return out;
}

/** Sobel-Kantenbild eines Frames. Hell = viel Detail. */
async function edgeMap(ctx, framePng) {
  const out = framePng.replace(/\.png$/i, '_edge.png');
  if (fileHasContent(out)) return out;
  await runFfmpeg(ctx, [
    '-i', framePng,
    '-vf', 'format=gray,edgedetect=low=0.06:high=0.18',
    '-frames:v', '1', '-update', '1', '-an',
    out,
  ]);
  if (!fileHasContent(out)) throw new Error('Das Kantenbild ließ sich nicht erzeugen (edgedetect fehlt?).');
  return out;
}

/**
 * signalstats eines Bildes, optional auf einen Ausschnitt begrenzt.
 * filterPrefix muss auf ein Komma enden, z.B. "crop=48:ih:1344:0,".
 */
async function statsOf(ctx, imagePath, filterPrefix = '') {
  const r = await runFfmpeg(ctx, [
    '-i', imagePath,
    '-vf', `${filterPrefix}format=yuv420p,signalstats,metadata=mode=print:file=-`,
    '-an', '-f', 'null', '-',
  ]);
  const f = parseMetadataFrames(`${r.stdout}\n${r.stderr}`)[0];
  if (!f) throw new Error('signalstats hat für dieses Bild keine Werte geliefert.');
  return f.values;
}

/** SSIM zweier Bilder ueber den ffmpeg-Filter ssim. */
async function ssimOf(ctx, aPath, bPath) {
  const r = await runFfmpeg(ctx, [
    '-i', aPath, '-i', bPath,
    '-filter_complex', 'ssim',
    '-an', '-f', 'null', '-',
  ]);
  return parseSsim(`${r.stdout}\n${r.stderr}`);
}

/** Gleichmaessig verteilte Zeitpunkte, jeweils in der Mitte ihres Abschnitts. */
function sampleTimes(durationSec, n) {
  const d = durationSec > 0 ? durationSec : 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push(round3((d * (i + 0.5)) / n));
  return out;
}

/* ==========================================================================
 * Parser
 * ========================================================================== */

/**
 * Ausgabe des metadata-Filters (mode=print) in Frames zerlegen.
 * Vertraegt beide Formen: mit "[Parsed_metadata_3 @ ...]"-Praefix (Log) und
 * ohne (file=-).
 */
export function parseMetadataFrames(text) {
  const frames = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^\[[^\]]*\]\s*/, '').trim();
    if (!line) continue;
    const fm = line.match(/^frame:(\d+)\s+pts:(\S+)\s+pts_time:(\S+)/);
    if (fm) {
      cur = { frame: Number(fm[1]), ptsTime: Number(fm[3]), values: {} };
      frames.push(cur);
      continue;
    }
    const kv = line.match(/^lavfi\.([A-Za-z0-9_.]+)=(.+)$/);
    if (kv && cur) {
      const key = kv[1].split('.').pop();
      const n = Number(kv[2]);
      cur.values[key] = Number.isFinite(n) ? n : kv[2];
    }
  }
  return frames;
}

/** Den Gesamt-SSIM ("All:") aus der ffmpeg-Ausgabe ziehen. */
export function parseSsim(text) {
  const re = /All:\s*([0-9]*\.?[0-9]+)/g;
  let m;
  let last = null;
  while ((m = re.exec(String(text))) !== null) last = Number(m[1]);
  return Number.isFinite(last) ? last : null;
}

function lastLines(text, n) {
  return String(text)
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-n)
    .join(' | ');
}

/* ==========================================================================
 * Pfade und Werkzeuge
 * ==========================================================================
 * Alles hier ist defensiv: der Job-Kontext darf die Werte mitbringen, muss
 * aber nicht. Ohne Kontext wird vom Ort dieser Datei aus gerechnet.
 */

function studioPaths(ctx) {
  const p = (ctx && ctx.paths) || {};
  const root = firstString(p.root) || ROOT_FALLBACK;
  return {
    root,
    bin: firstString(p.bin) || nodePath.join(root, 'bin'),
    cache: firstString(p.cache) || nodePath.join(root, '.cache'),
    out: firstString(p.out) || nodePath.join(root, 'out'),
  };
}

function resolveTools(ctx) {
  const c = ctx || {};
  return {
    ffmpeg:
      firstString(c.ffmpegPath, c.ffmpeg?.path, c.ffmpeg, c.tools?.ffmpeg, c.bin?.ffmpeg, c.health?.ffmpeg?.path) ||
      localBin(ctx, 'ffmpeg'),
    ffprobe:
      firstString(c.ffprobePath, c.ffprobe?.path, c.ffprobe, c.tools?.ffprobe, c.bin?.ffprobe, c.health?.ffprobe?.path) ||
      localBin(ctx, 'ffprobe'),
  };
}

/** bin/ffmpeg.exe wenn vorhanden, sonst der Name aus dem PATH. */
function localBin(ctx, name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const local = nodePath.join(studioPaths(ctx).bin, exe);
  try {
    if (fs.existsSync(local)) return local;
  } catch {
    /* Kein Zugriff auf bin/ - dann eben aus dem PATH. */
  }
  return exe;
}

/** Arbeitsordner fuer Artefakte. runChecks legt ihn an, Einzelchecks erben ihn. */
function workDir(ctx) {
  const c = ctx || {};
  const dir =
    firstString(c.qcWorkDir, c.workDir, c.artifactsDir) ||
    nodePath.join(studioPaths(ctx).cache, 'qc', 'einzelpruefung');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function firstString(...vals) {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v;
  return null;
}

function sanitizeName(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'qc';
}

function fileHasContent(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

/* ==========================================================================
 * Job-Kontext: Log, Kommandozeile, Fortschritt, Abbruch
 * ========================================================================== */

function commandLine(bin, args) {
  return [bin, ...args].map(quoteArg).join(' ');
}

function quoteArg(a) {
  const s = String(a);
  return /[\s"'^&|<>]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function logLine(ctx, line) {
  try {
    if (typeof ctx?.log === 'function') ctx.log(line);
    else if (typeof ctx?.onLog === 'function') ctx.onLog(line);
    else console.log(`[qc] ${line}`);
  } catch {
    /* Ein kaputter Logger darf keinen Check kippen. */
  }
}

/** Jede Kommandozeile geht ins Log und ins Feld "command" des Jobs. */
function noteCommand(ctx, command) {
  logLine(ctx, command);
  try {
    if (typeof ctx?.setCommand === 'function') ctx.setCommand(command);
    else if (ctx?.job) ctx.job.command = command;
    if (Array.isArray(ctx?.__qcCommands)) ctx.__qcCommands.push(command);
  } catch {
    /* Kontext ist eingefroren oder anders gebaut - kein Grund abzubrechen. */
  }
}

function setProgress(ctx, p) {
  const v = Math.max(0, Math.min(1, p));
  try {
    if (typeof ctx?.progress === 'function') ctx.progress(v);
    else if (typeof ctx?.setProgress === 'function') ctx.setProgress(v);
    else if (ctx?.job) ctx.job.progress = v;
  } catch (err) {
    logLine(ctx, `Fortschritt ließ sich nicht melden: ${err.message}`);
  }
}

function abortSignal(ctx) {
  const s = ctx?.signal;
  return s && typeof s.addEventListener === 'function' ? s : undefined;
}

function throwIfCancelled(ctx) {
  let cancelled = false;
  try {
    cancelled =
      ctx?.signal?.aborted === true ||
      ctx?.cancelled === true ||
      (typeof ctx?.isCancelled === 'function' && ctx.isCancelled() === true);
  } catch {
    cancelled = false;
  }
  if (cancelled) {
    const e = new Error('Die Qualitätskontrolle wurde abgebrochen.');
    e.cancelled = true;
    throw e;
  }
}

function setOn(ctx, key, value) {
  try {
    if (ctx && typeof ctx === 'object') ctx[key] = value;
  } catch {
    /* Eingefrorener Kontext: dann eben ohne. */
  }
}

/* ==========================================================================
 * Kleine Rechenhelfer
 * ========================================================================== */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mean(arr) {
  const vals = (arr || []).filter((v) => Number.isFinite(v));
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function round3(v) {
  return Math.round(num(v) * 1000) / 1000;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
