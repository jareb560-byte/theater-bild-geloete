/**
 * Theater-Bild-Gelöte - ffmpeg/ffprobe-Anbindung.
 *
 * ffmpeg wird ausschliesslich per child_process.spawn aufgerufen, nie ueber
 * eine Bibliothek. Jeder Aufruf laesst sich als lesbare Kommandozeile
 * ausgeben (quoteCommand) - kein Schritt der Pipeline ist eine Black Box.
 *
 * Konventionen (siehe Projektvorgabe):
 *   -y -hide_banner -nostdin  wird jedem Aufruf vorangestellt
 *   -progress pipe:1 -nostats liefert den Fortschritt
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { binDir } from './paths.js';

const EXE = process.platform === 'win32' ? '.exe' : '';

/**
 * Hinweistext bei fehlendem ffmpeg.
 *
 * Als Funktion, nicht als Konstante: das Ziel haengt vom Arbeitsverzeichnis ab,
 * und der Ratschlag von der Plattform. In den fertigen Paketen gibt es weder
 * npm noch einen studio-Ordner — ein Hinweis auf "npm run setup:ffmpeg" waere
 * dort schlicht falsch.
 */
export function installHint() {
  // binDir ist ein "let"-Export aus paths.js, also eine lebende Bindung: beim
  // Laden noch leer, nach initPaths() gefuellt. Deshalb hier zur Laufzeit lesen
  // und nicht beim Import festhalten.
  const ziel = binDir || '<Arbeitsverzeichnis>/bin';
  const zeilen = [
    'ffmpeg wurde nicht gefunden.',
    `Im Programm: Reiter Systemzustand -> "ffmpeg jetzt holen" (landet in ${ziel}).`,
  ];
  if (process.platform === 'win32') {
    zeilen.push('Von Hand: winget install BtbN.FFmpeg.GPL');
  } else if (process.platform === 'darwin') {
    zeilen.push('Von Hand: brew install ffmpeg');
    zeilen.push('ACHTUNG: Homebrew-ffmpeg bringt oft KEINEN hap-Encoder mit — ohne den ist keine HAP-Auslieferung moeglich.');
  } else {
    zeilen.push('Von Hand: der Paketmanager der Distribution, z.B. apt install ffmpeg');
    zeilen.push('ACHTUNG: Distributions-ffmpeg bringt oft KEINEN hap-Encoder mit — ohne den ist keine HAP-Auslieferung moeglich.');
  }
  return zeilen.join(' ');
}


let located = null;      // Cache fuer locate()
let versionCache = null; // Cache fuer version()
let encoderCache = null; // Cache fuer probeEncoders()

/* ==========================================================================
 * Auffinden
 * ========================================================================== */

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Sucht ein Programm im PATH. Gibt den vollen Pfad zurueck oder null. */
function findInPath(name) {
  const raw = process.env.PATH || process.env.Path || '';
  for (const dir of raw.split(path.delimiter)) {
    if (!dir) continue;
    let candidate;
    try {
      candidate = path.join(dir.replace(/^"|"$/g, ''), name + EXE);
    } catch {
      continue;
    }
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function locateOne(name) {
  const bundled = path.join(binDir, name + EXE);
  if (isFile(bundled)) return { found: true, path: bundled, source: 'bundled' };
  const onPath = findInPath(name);
  if (onPath) return { found: true, path: onPath, source: 'path' };
  return { found: false, path: null, source: 'none' };
}

/**
 * Sucht ffmpeg und ffprobe: erst bin/ im Projekt, dann PATH.
 * Das Ergebnis wird gecacht, refresh() macht den Cache ungueltig.
 */
export function locate() {
  if (located) return located;
  located = {
    ffmpeg: locateOne('ffmpeg'),
    ffprobe: locateOne('ffprobe'),
  };
  return located;
}

/** Cache leeren - nach einer Installation aufrufen. */
export function refresh() {
  located = null;
  versionCache = null;
  encoderCache = null;
  return locate();
}

/** Pfad zu ffmpeg oder ein aussagekraeftiger Fehler. */
export function requireFfmpeg() {
  const l = locate();
  if (!l.ffmpeg.found) throw new Error(installHint());
  return l.ffmpeg.path;
}

/** Pfad zu ffprobe oder ein aussagekraeftiger Fehler. */
export function requireFfprobe() {
  const l = locate();
  if (!l.ffprobe.found) {
    throw new Error('ffprobe wurde nicht gefunden. ' + installHint());
  }
  return l.ffprobe.path;
}

/* ==========================================================================
 * Kommandozeile fuer die Anzeige
 * ========================================================================== */

/**
 * Baut die anzeigbare Kommandozeile. NUR fuer die Anzeige im Job-Objekt und
 * in der UI, niemals zum Ausfuehren - ausgefuehrt wird immer das Argument-Array.
 */
export function quoteCommand(bin, args = []) {
  const q = (s) => {
    const v = String(s);
    if (v === '') return '""';
    if (/[\s"'^&|<>()%!,;=]/.test(v)) return `"${v.replace(/"/g, '\\"')}"`;
    return v;
  };
  return [q(bin), ...args.map(q)].join(' ');
}

/* ==========================================================================
 * Ausfuehren
 * ========================================================================== */

const BASE_ARGS = ['-y', '-hide_banner', '-nostdin'];

/** Stellt die Basisflags voran, ohne sie zu doppeln. */
function withBaseArgs(args) {
  const missing = BASE_ARGS.filter((a) => !args.includes(a));
  return [...missing, ...args];
}

const MAX_STDERR_LINES = 4000;

function pushCapped(arr, line) {
  arr.push(line);
  if (arr.length > MAX_STDERR_LINES) arr.splice(0, arr.length - MAX_STDERR_LINES);
}

/**
 * Fuehrt ffmpeg aus.
 *
 * Optionen:
 *   args        Argumentliste ohne Programmnamen
 *   onLine      Callback pro stderr-Zeile (Log)
 *   onProgress  Callback mit 0..1 - braucht totalFrames oder totalSec
 *   signal      AbortSignal; bei abort wird der Prozess getoetet
 *   cwd         Arbeitsverzeichnis
 *   totalFrames Zielframezahl, bevorzugte Fortschrittsbasis
 *   totalSec    Zieldauer in Sekunden, Fallback
 *   bin         abweichender Programmpfad (Standard: gefundenes ffmpeg)
 *
 * Liefert { code, stderr, command, cancelled, progress }.
 * Wirft nur, wenn der Prozess gar nicht startet.
 */
export function run({
  args = [],
  onLine,
  onProgress,
  signal,
  cwd,
  totalFrames = 0,
  totalSec = 0,
  bin,
} = {}) {
  const exePath = bin || requireFfmpeg();
  const full = withBaseArgs(args);
  const command = quoteCommand(exePath, full);

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ code: null, stderr: '', command, cancelled: true, progress: 0 });
      return;
    }

    let child;
    try {
      child = spawn(exePath, full, {
        cwd: cwd || undefined,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new Error(`ffmpeg konnte nicht gestartet werden: ${err.message}\n${command}`));
      return;
    }

    const stderrLines = [];
    let cancelled = false;
    let lastProgress = 0;
    let stdoutRest = '';
    let stderrRest = '';

    const onAbort = () => {
      cancelled = true;
      try {
        child.kill();
      } catch {
        /* Prozess war schon weg - nichts zu tun */
      }
      // Nachtreten, falls ffmpeg sich weigert.
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* egal */
        }
      }, 2000).unref?.();
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const emitProgress = (frames, seconds) => {
      let p = 0;
      if (totalFrames > 0 && frames > 0) p = frames / totalFrames;
      else if (totalSec > 0 && seconds > 0) p = seconds / totalSec;
      else return;
      p = Math.max(0, Math.min(1, p));
      if (p >= lastProgress) lastProgress = p;
      if (typeof onProgress === 'function') onProgress(lastProgress);
    };

    let curFrames = 0;
    let curSeconds = 0;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutRest += chunk;
      const lines = stdoutRest.split(/\r?\n/);
      stdoutRest = lines.pop() ?? '';
      for (const line of lines) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (key === 'frame') {
          const n = Number.parseInt(value, 10);
          if (Number.isFinite(n)) curFrames = n;
        } else if (key === 'out_time_us' || key === 'out_time_ms') {
          // ffmpeg liefert beide Felder in Mikrosekunden - bekannte Eigenart.
          const n = Number.parseInt(value, 10);
          if (Number.isFinite(n) && n >= 0) curSeconds = n / 1e6;
        } else if (key === 'progress') {
          if (value === 'end') {
            lastProgress = 1;
            if (typeof onProgress === 'function') onProgress(1);
          } else {
            emitProgress(curFrames, curSeconds);
          }
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrRest += chunk;
      const lines = stderrRest.split(/\r?\n/);
      stderrRest = lines.pop() ?? '';
      for (const line of lines) {
        pushCapped(stderrLines, line);
        if (typeof onLine === 'function' && line.trim() !== '') onLine(line);
      }
    });

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error(`ffmpeg konnte nicht gestartet werden: ${err.message}\n${command}`));
    });

    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (stderrRest.trim() !== '') {
        pushCapped(stderrLines, stderrRest);
        if (typeof onLine === 'function') onLine(stderrRest);
      }
      resolve({
        code,
        stderr: stderrLines.join('\n'),
        command,
        cancelled: cancelled || signal?.aborted === true,
        progress: lastProgress,
      });
    });
  });
}

/**
 * Bequeme Huelle um run() fuer die ops-Module.
 *
 * ctx ist der Jobkontext aus server/jobs.js. Akzeptiert werden beide
 * Schreibweisen fuer den Fortschritt (ctx.progress und ctx.setProgress),
 * damit die ops-Module auch ohne Jobsystem aus der CLI laufen koennen.
 *
 * Die Kommandozeile landet im Job-Feld "command" - jeder ffmpeg-Aufruf ist
 * im Klartext sichtbar. Bei Exitcode != 0 wird geworfen, mit Kommandozeile
 * und den letzten stderr-Zeilen im Text. Nichts scheitert still.
 *
 * opts: { label, totalFrames, totalSec, cwd, allowFail }
 * Liefert { code, command, log, stderr, cancelled }.
 */
export async function runFfmpeg(ctx, args, opts = {}) {
  const { label = '', totalFrames = null, totalSec = null, cwd, allowFail = false } = opts;
  const lines = [];

  const tell = (p) => {
    if (typeof ctx?.progress === 'function') ctx.progress(p);
    else if (typeof ctx?.setProgress === 'function') ctx.setProgress(p);
  };
  const say = (line) => {
    lines.push(line);
    if (typeof ctx?.log === 'function') ctx.log(line);
  };

  const res = await run({
    args,
    cwd,
    signal: ctx?.signal,
    totalFrames: Number(totalFrames) || 0,
    totalSec: Number(totalSec) || 0,
    onLine: say,
    onProgress: tell,
  });

  if (typeof ctx?.setCommand === 'function') ctx.setCommand(res.command);
  else if (ctx?.job) ctx.job.command = res.command;
  if (typeof ctx?.log === 'function') ctx.log(`ffmpeg-Aufruf${label ? ` (${label})` : ''}: ${res.command}`);

  if (res.cancelled) throw new Error('Vom Nutzer abgebrochen.');

  if (res.code !== 0 && !allowFail) {
    const tail = lines.slice(-20).join('\n');
    throw new Error(
      `ffmpeg${label ? ` (${label})` : ''} endete mit Code ${res.code}.\n` +
        `Aufruf: ${res.command}\n${tail || '(keine Meldung von ffmpeg)'}`
    );
  }

  return { code: res.code, command: res.command, log: lines, stderr: res.stderr, cancelled: false };
}

/**
 * Fuehrt ffprobe aus und liefert das geparste JSON.
 * Die Argumente kommen vom Aufrufer, -hide_banner wird ergaenzt.
 */
export function runProbe(args = [], { signal, cwd } = {}) {
  const exePath = requireFfprobe();
  const full = args.includes('-hide_banner') ? [...args] : ['-hide_banner', ...args];
  const command = quoteCommand(exePath, full);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exePath, full, {
        cwd: cwd || undefined,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new Error(`ffprobe konnte nicht gestartet werden: ${err.message}\n${command}`));
      return;
    }

    let out = '';
    let err = '';
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        /* egal */
      }
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      err += d;
    });

    child.on('error', (e) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error(`ffprobe konnte nicht gestartet werden: ${e.message}\n${command}`));
    });

    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code !== 0) {
        reject(
          new Error(
            `ffprobe endete mit Code ${code}.\n${command}\n${err.trim() || '(keine Meldung)'}`
          )
        );
        return;
      }
      const text = out.trim();
      if (text === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(
          new Error(
            `ffprobe lieferte kein gueltiges JSON (${e.message}).\n${command}\n` +
              text.slice(0, 400)
          )
        );
      }
    });
  });
}

/* ==========================================================================
 * Version und Encoder
 * ========================================================================== */

/** Rohaufruf ohne Basisflags - fuer -version und -encoders. */
function capture(exePath, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exePath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: -1, out: '', err: err.message });
      return;
    }
    let out = '';
    let errText = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      errText += d;
    });
    child.on('error', (e) => resolve({ code: -1, out, err: e.message }));
    child.on('close', (code) => resolve({ code, out, err: errText }));
  });
}

/**
 * Erste Zeile von "ffmpeg -version" auswerten.
 * Liefert z.B. "n7.0-latest" oder null, wenn ffmpeg fehlt.
 */
export async function version() {
  if (versionCache !== null) return versionCache;
  const l = locate();
  if (!l.ffmpeg.found) {
    versionCache = null;
    return null;
  }
  const { out, err } = await capture(l.ffmpeg.path, ['-hide_banner', '-version']);
  const first = (out || err || '').split(/\r?\n/)[0] || '';
  const m = first.match(/^ffmpeg\s+version\s+(\S+)/i);
  versionCache = m ? m[1] : first.trim() || null;
  return versionCache;
}

const WANTED_ENCODERS = ['hap', 'prores_ks', 'mpeg2video', 'libx264'];

/**
 * Prueft, welche der fuer uns wichtigen Encoder der Build kann.
 * hap === false heisst: Delivery ans Schiff ist mit diesem Build unmoeglich.
 */
export async function probeEncoders() {
  if (encoderCache) return encoderCache;
  const empty = Object.fromEntries(WANTED_ENCODERS.map((n) => [n, false]));
  const l = locate();
  if (!l.ffmpeg.found) return empty;

  const { code, out, err } = await capture(l.ffmpeg.path, ['-hide_banner', '-encoders']);
  if (code !== 0 && !out) {
    console.error(`[ffmpeg] "-encoders" fehlgeschlagen: ${(err || '').trim()}`);
    return empty;
  }
  const names = new Set();
  for (const line of (out + '\n' + err).split(/\r?\n/)) {
    const m = line.match(/^\s*[A-Z.]{6}\s+(\S+)/);
    if (m) names.add(m[1]);
  }
  encoderCache = Object.fromEntries(WANTED_ENCODERS.map((n) => [n, names.has(n)]));
  return encoderCache;
}

/** Zusammenfassung fuer /api/health. */
export async function status() {
  const l = locate();
  const encoders = await probeEncoders();
  return {
    ffmpeg: {
      found: l.ffmpeg.found,
      path: l.ffmpeg.path,
      source: l.ffmpeg.source,
      version: await version(),
      encoders,
    },
    ffprobe: {
      found: l.ffprobe.found,
      path: l.ffprobe.path,
      source: l.ffprobe.source,
    },
  };
}

export default {
  locate,
  refresh,
  requireFfmpeg,
  requireFfprobe,
  probeEncoders,
  version,
  run,
  runFfmpeg,
  runProbe,
  quoteCommand,
  status,
  installHint,
};
