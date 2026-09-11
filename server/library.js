/**
 * Theater-Bild-Gelöte - Bibliothek einlesen.
 *
 * scanRoots() sammelt Mediendateien unter den angegebenen Wurzeln, fasst
 * Bildsequenzen zu EINEM Eintrag zusammen und laesst hoechstens vier
 * ffprobe-Prozesse gleichzeitig laufen. Fortschritt und Fehler werden
 * gemeldet, nie verschluckt.
 */

import fs from 'node:fs';
import path from 'node:path';

import { detectSequence, isImageExt, isMediaFile, probeFile, MEDIA_EXT } from './probe.js';
import * as venues from './venues.js';

/** Verzeichnisse, die beim Scan nichts zu suchen haben. */
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.cache',
  'proxies',
  'thumbs',
  '.git',
  '.svn',
  '$RECYCLE.BIN',
  'System Volume Information',
]);

const MAX_PARALLEL_PROBES = 4;
const MAX_FILES = 50000;

/** Alle Medienendungen, die der Scan aufsammelt. */
export const SCAN_EXT = MEDIA_EXT;

/* ==========================================================================
 * Dateien einsammeln
 * ========================================================================== */

/**
 * Sammelt Mediendateien unter root.
 * Liefert { files, errors }.
 */
export function collectFiles(rootPath, { recursive = true, signal, onDir } = {}) {
  const files = [];
  const errors = [];
  const stack = [path.resolve(rootPath)];
  const seenDirs = new Set();

  while (stack.length > 0) {
    if (signal?.aborted) break;
    const dir = stack.pop();
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seenDirs.has(key)) continue;
    seenDirs.add(key);

    if (typeof onDir === 'function') onDir(dir);

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      errors.push(`Verzeichnis übersprungen: ${dir} (${err.message})`);
      continue;
    }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        try {
          isDir = fs.statSync(full).isDirectory();
        } catch {
          continue;
        }
      }
      if (isDir) {
        if (!recursive) continue;
        if (IGNORED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        stack.push(full);
        continue;
      }
      if (!isMediaFile(full)) continue;
      files.push(full);
      if (files.length >= MAX_FILES) {
        errors.push(
          `Mehr als ${MAX_FILES} Dateien gefunden — der Scan wurde abgebrochen. Bitte einen engeren Ordner wählen.`
        );
        return { files, errors };
      }
    }
  }

  return { files, errors };
}

/**
 * Fasst Bildsequenzen zusammen: aus 3600 PNGs wird ein Eintrag.
 * Liefert eine Liste zu probender Dateien plus die erkannten Sequenzen.
 */
export function groupSequences(files) {
  const targets = [];
  const seenSeq = new Set();
  let sequences = 0;

  for (const f of files) {
    if (!isImageExt(f)) {
      targets.push(f);
      continue;
    }
    const seq = detectSequence(f);
    if (!seq) {
      targets.push(f);
      continue;
    }
    const key = process.platform === 'win32' ? seq.pattern.toLowerCase() : seq.pattern;
    if (seenSeq.has(key)) continue;
    seenSeq.add(key);
    sequences += 1;
    targets.push(seq.first);
  }

  return { targets, sequences };
}

/* ==========================================================================
 * Scannen
 * ========================================================================== */

/**
 * Liest eine oder mehrere Wurzeln ein und probet alles Gefundene.
 *
 * opts:
 *   recursive   Unterordner mitnehmen (Standard true)
 *   venue       Venue fuer die issues-Pruefung (Standard: Basisvenue)
 *   force       Probe-Cache ignorieren
 *   signal      AbortSignal
 *   onProgress  (0..1)
 *   log         (text)
 *
 * Liefert { media, errors, scanned, sequences }.
 */
export async function scanRoots(roots, opts = {}) {
  const {
    recursive = true,
    force = false,
    signal,
    onProgress,
    log,
  } = opts;
  const venue = opts.venue !== undefined ? opts.venue : venues.base();

  const list = (Array.isArray(roots) ? roots : [roots]).filter(Boolean).map(String);
  if (list.length === 0) throw new Error('Kein Ordner angegeben — bitte mindestens eine Wurzel wählen.');

  const say = (t) => {
    if (typeof log === 'function') log(t);
  };
  const tell = (p) => {
    if (typeof onProgress === 'function') onProgress(Math.max(0, Math.min(1, p)));
  };

  const errors = [];
  const allFiles = [];

  for (const r of list) {
    const abs = path.resolve(r);
    if (!fs.existsSync(abs)) {
      errors.push(`Ordner existiert nicht: ${abs}`);
      say(`Ordner existiert nicht: ${abs}`);
      continue;
    }
    say(`Durchsuche ${abs} …`);
    const res = collectFiles(abs, { recursive, signal });
    allFiles.push(...res.files);
    errors.push(...res.errors);
    for (const e of res.errors) say(e);
  }

  // Doppelte Pfade (ueberlappende Wurzeln) entfernen.
  const uniq = [];
  const seen = new Set();
  for (const f of allFiles) {
    const k = process.platform === 'win32' ? f.toLowerCase() : f;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(f);
  }

  const { targets, sequences } = groupSequences(uniq);
  say(
    `${uniq.length} Datei(en) gefunden, davon ${sequences} Bildsequenz(en) — ${targets.length} Analysen.`
  );
  tell(targets.length === 0 ? 1 : 0);

  const media = [];
  let done = 0;
  let index = 0;

  async function worker() {
    for (;;) {
      if (signal?.aborted) return;
      const i = index;
      index += 1;
      if (i >= targets.length) return;
      const file = targets[i];
      try {
        const m = await probeFile(file, { venue, force, signal });
        media.push(m);
      } catch (err) {
        const msg = `${path.basename(file)}: ${err.message}`;
        errors.push(msg);
        say(msg);
      } finally {
        done += 1;
        tell(done / targets.length);
        if (done % 25 === 0) say(`${done} von ${targets.length} analysiert …`);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(MAX_PARALLEL_PROBES, targets.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  media.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }));

  if (signal?.aborted) say('Scan abgebrochen.');
  else say(`Fertig: ${media.length} Medium/Medien, ${errors.length} Problem(e).`);
  tell(1);

  return { media, errors, scanned: targets.length, sequences };
}

/**
 * Einzelne Pfade analysieren (POST /api/media/add, synchron aus Sicht des Clients).
 * Liefert { media, errors }.
 */
export async function addPaths(paths_, opts = {}) {
  const venue = opts.venue !== undefined ? opts.venue : venues.base();
  const list = (Array.isArray(paths_) ? paths_ : [paths_]).filter(Boolean).map(String);
  const media = [];
  const errors = [];

  for (const p of list) {
    const abs = path.resolve(p);
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        const res = await scanRoots([abs], { ...opts, venue, recursive: false });
        media.push(...res.media);
        errors.push(...res.errors);
        continue;
      }
      if (!isMediaFile(abs)) {
        errors.push(`${path.basename(abs)}: keine bekannte Medienendung (${SCAN_EXT.join(' ')})`);
        continue;
      }
      media.push(await probeFile(abs, { venue, force: opts.force, signal: opts.signal }));
    } catch (err) {
      errors.push(`${abs}: ${err.message}`);
    }
  }

  return { media, errors };
}

/**
 * Fuegt Medien in ein Projekt ein, ohne Dubletten.
 * Gleicher absPath -> vorhandener Eintrag wird aktualisiert, ID bleibt.
 * Liefert die tatsaechlich im Projekt liegenden Objekte.
 */
export function mergeIntoProject(project, incoming) {
  const byPath = new Map();
  for (const m of project.media) {
    byPath.set(process.platform === 'win32' ? m.absPath.toLowerCase() : m.absPath, m);
  }
  const result = [];
  for (const m of incoming) {
    const key = process.platform === 'win32' ? m.absPath.toLowerCase() : m.absPath;
    const existing = byPath.get(key);
    if (existing) {
      existing.probe = m.probe;
      existing.kind = m.kind;
      existing.issues = m.issues;
      existing.name = m.name;
      result.push(existing);
    } else {
      project.media.push(m);
      byPath.set(key, m);
      result.push(m);
    }
  }
  return result;
}

export default { scanRoots, addPaths, collectFiles, groupSequences, mergeIntoProject };
