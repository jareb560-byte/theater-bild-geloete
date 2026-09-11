/**
 * Theater-Bild-Gelöte - ffmpeg holen.
 *
 * Zielordner ist IMMER <workspace>/bin - nie das Programmverzeichnis. Ein per
 * npm installiertes Theater-Bild-Gelöte liegt schreibgeschuetzt in node_modules und waere
 * beim naechsten Update weg.
 *
 * Plattformen:
 *   win32   BtbN-GPL-ZIP, entpackt mit PowerShell Expand-Archive
 *   linux   BtbN-GPL-tar.xz, entpackt mit tar -xJf
 *   darwin  BtbN liefert KEIN macOS. Es wird nichts geraten: entweder liegt
 *           ein brauchbares ffmpeg im PATH, oder der Nutzer bekommt eine
 *           Anleitung (brew bzw. evermeet.cx). "brew install ffmpeg" laeuft
 *           nur, wenn es ausdruecklich verlangt wurde (--brew / allowBrew).
 *
 * Nach jeder Installation wird geprueft, ob hap und prores_ks vorhanden sind.
 * Ohne hap ist keine Delivery moeglich - das wird laut gemeldet, nie still.
 *
 * Aufruf:  npm run setup:ffmpeg      bzw.  Theater-Bild-Gelöte install-ffmpeg
 * Oder ueber POST /api/ffmpeg/install als Job (installFfmpeg()).
 */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { paths, ensureDir } from '../paths.js';
import * as ffmpeg from '../ffmpeg.js';

/* ==========================================================================
 * Quellen
 * ========================================================================== */

const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download';

/** Downloadquelle je Plattform. null = es gibt keine, siehe macOS. */
export const DOWNLOADS = {
  win32: { url: `${BTBN}/ffmpeg-master-latest-win64-gpl.zip`, archive: 'zip' },
  linux: { url: `${BTBN}/ffmpeg-master-latest-linux64-gpl.tar.xz`, archive: 'tar.xz' },
  darwin: null,
};

/** Rueckwaertskompatibel: der Windows-Link, den frueherer Code erwartet hat. */
export const DOWNLOAD_URL = DOWNLOADS.win32.url;

const EXE = process.platform === 'win32' ? '.exe' : '';
const NEEDED = ['ffmpeg', 'ffprobe'];

/** Zielordner: bin/ im Arbeitsverzeichnis. Lebende Bindung, nie einfrieren. */
function targetBin() {
  return paths.bin;
}

/* ==========================================================================
 * Anleitungen im Klartext
 * ========================================================================== */

/** Anleitung fuer macOS - dort gibt es keinen automatischen Download. */
export function macInstructions() {
  return [
    'Auf macOS liefert BtbN keine fertigen Programme. ffmpeg muss von Hand kommen:',
    '',
    '  1) Mit Homebrew (empfohlen):',
    '       brew install ffmpeg',
    '     Danach ein NEUES Terminal oeffnen, damit der PATH aktuell ist.',
    '     Wenn Homebrew schon installiert ist, macht Theater-Bild-Gelöte das auf Wunsch selbst:',
    '       Theater-Bild-Gelöte install-ffmpeg --brew',
    '     (Nur mit diesem Schalter - von allein wird hier nichts installiert.)',
    '',
    '  2) Ohne Homebrew, Einzeldownloads:',
    '       https://evermeet.cx/ffmpeg/          (ffmpeg)',
    '       https://evermeet.cx/ffmpeg/ffprobe/  (ffprobe)',
    '     Beide entpacken und hierher legen:',
    `       ${targetBin()}`,
    '     Danach im Terminal freigeben:',
    `       chmod 755 "${path.join(targetBin(), 'ffmpeg')}" "${path.join(targetBin(), 'ffprobe')}"`,
    '     Beim ersten Start meldet sich die Gatekeeper-Warnung - der Weg dorthin ist',
    '     Systemeinstellungen > Datenschutz & Sicherheit > "Dennoch oeffnen".',
    '',
    '  3) Kontrolle:',
    '       Theater-Bild-Gelöte doctor',
    '',
    'Wichtig: Der Build muss die Encoder "hap" und "prores_ks" koennen.',
    'Die Homebrew-Fassung kann beides.',
  ].join('\n');
}

/** Anleitung, die bei jedem Fehlschlag ausgegeben wird. */
export function manualInstructions() {
  if (process.platform === 'darwin') return macInstructions();

  const src = DOWNLOADS[process.platform];
  const lines = [
    'FFmpeg konnte nicht automatisch installiert werden. So geht es von Hand:',
    '',
  ];

  if (process.platform === 'win32') {
    lines.push(
      '  1) Am einfachsten ueber winget:',
      '       winget install BtbN.FFmpeg.GPL',
      '     Danach ein NEUES Terminal oeffnen, damit der PATH aktuell ist.',
      ''
    );
  } else {
    lines.push(
      '  1) Am einfachsten ueber die Paketverwaltung:',
      '       sudo apt install ffmpeg        (Debian, Ubuntu)',
      '       sudo dnf install ffmpeg        (Fedora, RHEL - RPM Fusion noetig)',
      '       sudo pacman -S ffmpeg          (Arch)',
      '     Achtung: manche Distributionen liefern ffmpeg OHNE hap. Dann Schritt 2.',
      ''
    );
  }

  lines.push(
    '  2) Oder das Archiv von Hand holen:',
    `       ${src ? src.url : '(fuer diese Plattform gibt es keinen fertigen Build)'}`,
    '     Entpacken, dann ffmpeg und ffprobe aus dem Unterordner bin/ hierher kopieren:',
    `       ${targetBin()}`,
    '',
    '  3) Kontrolle:',
    '       Theater-Bild-Gelöte doctor',
    '',
    'Wichtig: Der Build muss die Encoder "hap" und "prores_ks" koennen.',
    'Der BtbN-GPL-Build kann beides - schlanke Builds oft nicht.'
  );
  return lines.join('\n');
}

/* ==========================================================================
 * Download
 * ========================================================================== */

/** Laedt url nach dest, folgt Redirects, meldet Prozent. */
function download(url, dest, { log, onProgress, signal, depth = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (depth > 10) {
      reject(new Error('Zu viele Weiterleitungen beim Download.'));
      return;
    }
    if (signal?.aborted) {
      reject(new Error('Abgebrochen.'));
      return;
    }

    const req = https.get(
      url,
      { headers: { 'User-Agent': 'theater-bild-geloete', Accept: '*/*' } },
      (res) => {
        const code = res.statusCode || 0;

        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          download(next, dest, { log, onProgress, signal, depth: depth + 1 }).then(resolve, reject);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`Download fehlgeschlagen: HTTP ${code} bei ${url}`));
          return;
        }

        const total = Number.parseInt(res.headers['content-length'] || '0', 10);
        let got = 0;
        let lastPct = -1;

        let file;
        try {
          file = fs.createWriteStream(dest);
        } catch (err) {
          res.resume();
          reject(new Error(`Zieldatei ${dest} nicht beschreibbar: ${err.message}`));
          return;
        }

        const abort = () => {
          res.destroy();
          file.destroy();
          reject(new Error('Abgebrochen.'));
        };
        if (signal) signal.addEventListener('abort', abort, { once: true });

        res.on('data', (chunk) => {
          got += chunk.length;
          if (total > 0) {
            const pct = Math.floor((got / total) * 100);
            if (pct !== lastPct && pct % 5 === 0) {
              lastPct = pct;
              if (typeof log === 'function') {
                log(`Download ${pct} % (${(got / 1e6).toFixed(1)} von ${(total / 1e6).toFixed(1)} MB)`);
              }
            }
            if (typeof onProgress === 'function') onProgress(0.8 * (got / total));
          } else if (typeof log === 'function' && got % (8 * 1024 * 1024) < chunk.length) {
            log(`Download ${(got / 1e6).toFixed(1)} MB …`);
          }
        });

        res.on('error', (err) => {
          if (signal) signal.removeEventListener('abort', abort);
          file.destroy();
          reject(new Error(`Uebertragungsfehler: ${err.message}`));
        });

        file.on('error', (err) => {
          if (signal) signal.removeEventListener('abort', abort);
          reject(new Error(`Schreibfehler in ${dest}: ${err.message}`));
        });

        file.on('finish', () => {
          if (signal) signal.removeEventListener('abort', abort);
          file.close(() => resolve({ bytes: got, url }));
        });

        res.pipe(file);
      }
    );

    req.setTimeout(120000, () => {
      req.destroy(new Error('Zeitueberschreitung beim Download (120 s ohne Daten).'));
    });
    req.on('error', (err) => reject(new Error(`Verbindung fehlgeschlagen: ${err.message}`)));
  });
}

/* ==========================================================================
 * Fremdprogramme aufrufen
 * ========================================================================== */

function runTool(cmd, args, { log, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Error(`${cmd} konnte nicht gestartet werden: ${err.message}`));
      return;
    }
    let errText = '';
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
      const t = String(d).trim();
      if (t && typeof log === 'function') log(t);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      errText += d;
      const t = String(d).trim();
      if (t && typeof log === 'function') log(t);
    });
    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error(`${cmd} konnte nicht gestartet werden: ${err.message}`));
    });
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} endete mit Code ${code}. ${errText.trim()}`));
    });
  });
}

/** Liegt ein Programm im PATH? Liefert den Pfad oder null. */
export function whichSync(name) {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const raw = process.env.PATH || process.env.Path || '';
  for (const dir of raw.split(path.delimiter)) {
    if (!dir) continue;
    try {
      const cand = path.join(dir.replace(/^"|"$/g, ''), name + exe);
      if (fs.statSync(cand).isFile()) return cand;
    } catch {
      /* Eintrag im PATH existiert nicht - weiter */
    }
  }
  // Homebrew liegt auf Apple Silicon in /opt/homebrew/bin, das nicht in jedem
  // nicht-interaktiven PATH steht.
  if (process.platform === 'darwin') {
    for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
      try {
        const cand = path.join(dir, name);
        if (fs.statSync(cand).isFile()) return cand;
      } catch {
        /* weiter */
      }
    }
  }
  return null;
}

/** PowerShell-String literal: einfache Anfuehrungszeichen verdoppeln. */
function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

async function extract(archiveFile, destDir, kind, { log, signal } = {}) {
  ensureDir(destDir);

  if (kind === 'zip') {
    if (process.platform === 'win32') {
      const cmd = `Expand-Archive -LiteralPath ${psQuote(archiveFile)} -DestinationPath ${psQuote(
        destDir
      )} -Force`;
      await runTool('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
        log,
        signal,
      });
      return;
    }
    await runTool('unzip', ['-o', '-q', archiveFile, '-d', destDir], { log, signal });
    return;
  }

  if (kind === 'tar.xz') {
    // -J ist xz. GNU tar und bsdtar koennen beide -xJf.
    await runTool('tar', ['-xJf', archiveFile, '-C', destDir], { log, signal });
    return;
  }

  throw new Error(`Unbekanntes Archivformat: ${kind}`);
}

/* ==========================================================================
 * Suchen und Kopieren
 * ========================================================================== */

/** Sucht rekursiv nach einer Datei mit genau diesem Namen. */
function findFile(dir, name, depth = 0) {
  if (depth > 8) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return full;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = findFile(path.join(dir, e.name), name, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function rmrf(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    console.error(`[setup] Aufraeumen fehlgeschlagen (${target}): ${err.message}`);
  }
}

/** Ausfuehrbar machen. Auf Windows bedeutungslos, sonst Pflicht. */
function makeExecutable(file, log) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(file, 0o755);
  } catch (err) {
    if (typeof log === 'function') {
      log(`Achtung: ${file} konnte nicht ausfuehrbar gemacht werden (${err.message}).`);
      log(`Von Hand: chmod 755 "${file}"`);
    }
  }
}

/* ==========================================================================
 * Encoder-Ampel
 * ========================================================================== */

/**
 * Prueft nach der Installation, was der Build wirklich kann, und meldet es
 * im Klartext. Wirft, wenn hap oder prores_ks fehlen.
 */
async function verifyEncoders(log) {
  ffmpeg.refresh();
  const version = await ffmpeg.version();
  const encoders = await ffmpeg.probeEncoders();
  const ja = (b) => (b ? 'ja' : 'NEIN');

  log(`ffmpeg-Version: ${version || '(unbekannt)'}`);
  log(
    `Encoder: hap=${ja(encoders.hap)}, prores_ks=${ja(encoders.prores_ks)}, ` +
      `mpeg2video=${ja(encoders.mpeg2video)}, libx264=${ja(encoders.libx264)}`
  );

  const fehlt = [];
  if (!encoders.hap) fehlt.push('hap');
  if (!encoders.prores_ks) fehlt.push('prores_ks');
  if (fehlt.length > 0) {
    throw new Error(
      `Dieser ffmpeg-Build kann ${fehlt.join(' und ')} nicht. ` +
        'Damit ist keine Delivery moeglich.'
    );
  }
  if (!encoders.libx264) {
    log('Achtung: libx264 fehlt - ohne den gibt es keine Proxies und keine Browser-Vorschau.');
  }
  return { version, encoders };
}

/* ==========================================================================
 * macOS
 * ========================================================================== */

async function installMac({ log, onProgress, signal, allowBrew }) {
  // 1. Liegt schon etwas Brauchbares da oder im PATH?
  ffmpeg.refresh();
  const loc = ffmpeg.locate();
  if (loc.ffmpeg.found && loc.ffprobe.found) {
    log(`ffmpeg gefunden: ${loc.ffmpeg.path} (Quelle: ${loc.ffmpeg.source})`);
    const { version, encoders } = await verifyEncoders(log);
    onProgress?.(1);
    return {
      ok: true,
      installed: [loc.ffmpeg.path, loc.ffprobe.path],
      version,
      encoders,
      binDir: targetBin(),
      root: paths.root,
      skipped: true,
      source: loc.ffmpeg.source,
    };
  }

  // 2. Homebrew - nur auf ausdrueckliche Ansage.
  const brew = whichSync('brew');
  if (!allowBrew) {
    const hint = brew
      ? `Homebrew ist vorhanden (${brew}). Theater-Bild-Gelöte installiert nichts von allein.\n` +
        'Ausdruecklich erlauben mit:  Theater-Bild-Gelöte install-ffmpeg --brew\n\n'
      : '';
    throw new Error(`${hint}${macInstructions()}`);
  }
  if (!brew) {
    throw new Error(
      `--brew wurde verlangt, aber Homebrew ist nicht installiert.\n\n${macInstructions()}`
    );
  }

  log(`Homebrew: ${brew}`);
  log('Fuehre "brew install ffmpeg" aus - das kann einige Minuten dauern.');
  onProgress?.(0.05);
  try {
    await runTool(brew, ['install', 'ffmpeg'], { log, signal });
  } catch (err) {
    throw new Error(`${err.message}\n\n${macInstructions()}`);
  }

  onProgress?.(0.9);
  ffmpeg.refresh();
  const after = ffmpeg.locate();
  if (!after.ffmpeg.found) {
    throw new Error(
      'brew meldete Erfolg, ffmpeg ist aber trotzdem nicht im PATH.\n' +
        'Ein neues Terminal oeffnen und erneut versuchen.\n\n' +
        macInstructions()
    );
  }
  const { version, encoders } = await verifyEncoders(log);
  onProgress?.(1);
  return {
    ok: true,
    installed: [after.ffmpeg.path, after.ffprobe.path].filter(Boolean),
    version,
    encoders,
    binDir: targetBin(),
    root: paths.root,
    source: 'brew',
  };
}

/* ==========================================================================
 * Hauptablauf
 * ========================================================================== */

/**
 * Holt ffmpeg nach <workspace>/bin.
 *
 * opts: { log, onProgress, signal, force, allowBrew }
 * Liefert { ok, installed: [Pfade], version, encoders, binDir, root }.
 * Wirft mit Anleitung im Text, wenn irgendetwas schiefgeht.
 */
export async function installFfmpeg(opts = {}) {
  const { onProgress, signal, force = false, allowBrew = false } = opts;
  const log = typeof opts.log === 'function' ? opts.log : () => {};

  const bin = ensureDir(targetBin());
  const cache = ensureDir(paths.cache);
  log(`Plattform: ${process.platform} ${process.arch}`);
  log(`Zielordner: ${bin}`);

  // Schon da? Dann nicht ueber 100 MB laden, sondern nur pruefen.
  const already = NEEDED.map((n) => path.join(bin, n + EXE)).filter((p) => fs.existsSync(p));
  if (already.length === NEEDED.length && !force) {
    log(`ffmpeg liegt bereits in ${bin} — kein Download, nur Pruefung.`);
    for (const f of already) makeExecutable(f, log);
    try {
      const { version, encoders } = await verifyEncoders(log);
      onProgress?.(1);
      return { ok: true, installed: already, version, encoders, binDir: bin, root: paths.root, skipped: true };
    } catch (err) {
      log(`${err.message} Der vorhandene Build wird ersetzt.`);
    }
  }

  if (process.platform === 'darwin') {
    return installMac({ log, onProgress, signal, allowBrew });
  }

  const src = DOWNLOADS[process.platform];
  if (!src) {
    throw new Error(
      `Fuer ${process.platform} gibt es keinen fertigen Build zum Herunterladen.\n\n` +
        manualInstructions()
    );
  }

  const ext = src.archive === 'zip' ? '.zip' : '.tar.xz';
  const archiveFile = path.join(cache, `ffmpeg-btbn${ext}`);
  const extractDir = path.join(cache, 'ffmpeg-extract');

  try {
    log(`Lade ${src.url}`);
    onProgress?.(0.01);
    rmrf(archiveFile);
    const { bytes } = await download(src.url, archiveFile, { log, onProgress, signal });
    if (bytes < 1_000_000) {
      throw new Error(`Die geladene Datei ist nur ${bytes} Byte gross — das kann nicht stimmen.`);
    }
    log(`Download fertig: ${(bytes / 1e6).toFixed(1)} MB`);
  } catch (err) {
    rmrf(archiveFile);
    throw new Error(`${err.message}\n\n${manualInstructions()}`);
  }

  try {
    onProgress?.(0.82);
    log(`Entpacke (${src.archive}) …`);
    rmrf(extractDir);
    await extract(archiveFile, extractDir, src.archive, { log, signal });

    onProgress?.(0.9);
    const installed = [];
    for (const name of NEEDED) {
      const found = findFile(extractDir, name + EXE) || findFile(extractDir, name);
      if (!found) throw new Error(`${name}${EXE} war im Archiv nicht zu finden.`);
      const dst = path.join(bin, name + EXE);
      fs.copyFileSync(found, dst);
      makeExecutable(dst, log);
      installed.push(dst);
      log(`Kopiert: ${dst}`);
    }

    log('Raeume auf …');
    rmrf(extractDir);
    rmrf(archiveFile);

    onProgress?.(0.95);
    const { version, encoders } = await verifyEncoders(log);
    onProgress?.(1);
    return { ok: true, installed, version, encoders, binDir: bin, root: paths.root };
  } catch (err) {
    rmrf(extractDir);
    throw new Error(`${err.message}\n\n${manualInstructions()}`);
  }
}

/* ==========================================================================
 * CLI
 * ========================================================================== */

function usage() {
  return [
    'Theater-Bild-Gelöte — ffmpeg einrichten',
    '',
    '  --force            neu laden, auch wenn schon etwas in bin/ liegt',
    '  --brew             (nur macOS) "brew install ffmpeg" ausfuehren duerfen',
    '  --workspace <pfad> Arbeitsverzeichnis',
    '',
    'Theater-Bild-Gelöte — set up ffmpeg',
    '',
    '  --force            download again even if bin/ already holds a build',
    '  --brew             (macOS only) allow running "brew install ffmpeg"',
    '  --workspace <path> workspace directory',
  ].join('\n');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    process.exit(0);
  }

  console.log('Theater-Bild-Gelöte — ffmpeg einrichten');
  console.log(`Ziel: ${targetBin()}`);
  console.log('');
  try {
    const res = await installFfmpeg({
      log: (line) => console.log(`  ${line}`),
      force: process.argv.includes('--force'),
      allowBrew: process.argv.includes('--brew') || process.argv.includes('--yes-brew'),
    });
    console.log('');
    console.log('  FERTIG. ffmpeg und ffprobe sind einsatzbereit und koennen HAP und ProRes.');
    console.log(`  Version: ${res.version}`);
    console.log(`  Ort: ${res.installed.join('\n       ')}`);
    console.log('  Naechster Schritt: Theater-Bild-Gelöte doctor');
    process.exit(0);
  } catch (err) {
    console.error('');
    console.error(err.message);
    process.exit(1);
  }
}

const invokedDirectly = (() => {
  try {
    return path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) main();

export default { installFfmpeg, manualInstructions, macInstructions, DOWNLOAD_URL, DOWNLOADS };
