/**
 * Theater-Bild-Gelöte - Dateisystem-Browser (nur lesend).
 *
 * Antwortform siehe shared/API.md:
 *   { path, parent, entries: [{ name, path, dir, sizeBytes, mtime }],
 *     drives, shortcuts: [{ label, path }] }
 *
 * Ohne path kommt die Einstiegsansicht: Laufwerke bzw. Wurzel plus Schnellziele.
 *
 * Plattformen:
 *   win32   Laufwerke A: bis Z: durch Probieren - wmic ist auf Windows 11
 *           nicht mehr garantiert vorhanden.
 *   darwin  "/" plus die eingehaengten Datentraeger unter /Volumes
 *   linux   "/" plus die eingehaengten Datentraeger unter /media und /mnt
 *
 * Dieses Modul schreibt nie, es loescht nie, es legt nichts an.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isMediaFile } from './probe.js';
import { getPaths } from './paths.js';

/** Ordner, die beim Browsen nur stoeren. */
const HIDDEN_DIRS = new Set([
  'node_modules',
  '.git',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  '.DocumentRevisions-V100',
  'lost+found',
]);

function isDirSafe(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Eingehaengte Datentraeger unterhalb eines Sammelordners (/Volumes, /media).
 * Auf Linux liegen sie oft eine Ebene tiefer: /media/<benutzer>/<stick>.
 */
function mountsUnder(base, depth = 1) {
  const out = [];
  if (!isDirSafe(base)) return out;
  let names = [];
  try {
    names = fs.readdirSync(base);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = path.join(base, name);
    if (!isDirSafe(full)) continue;
    out.push(full);
    if (depth > 0) out.push(...mountsUnder(full, depth - 1));
  }
  return out;
}

/**
 * Vorhandene Laufwerke bzw. Wurzeln.
 * Windows: "C:\", "D:\", ... - sonst "/" plus eingehaengte Datentraeger.
 */
export function drives() {
  if (process.platform === 'win32') {
    const found = [];
    for (let i = 0; i < 26; i += 1) {
      const letter = String.fromCharCode(65 + i);
      const p = `${letter}:\\`;
      try {
        if (fs.existsSync(p)) found.push(p);
      } catch {
        /* Laufwerk nicht bereit - ueberspringen */
      }
    }
    return found;
  }

  const found = ['/'];
  if (process.platform === 'darwin') {
    found.push(...mountsUnder('/Volumes', 0));
  } else {
    found.push(...mountsUnder('/media', 1));
    found.push(...mountsUnder('/mnt', 0));
  }
  // Doppelte Eintraege (z.B. /Volumes/Macintosh HD) entfernen.
  return [...new Set(found)];
}

/**
 * Schnellziele. Deutsche Beschriftungen - der deutsche Text ist der
 * Uebersetzungsschluessel, der Client schickt ihn durch t().
 */
export function shortcuts() {
  const out = [];
  const seen = new Set();
  const add = (label, target) => {
    if (!target) return;
    const abs = path.resolve(target);
    const key = process.platform === 'win32' ? abs.toLowerCase() : abs;
    if (seen.has(key)) return;
    if (!isDirSafe(abs)) return;
    seen.add(key);
    out.push({ label, path: abs });
  };

  const home = os.homedir();
  add('Persoenlicher Ordner', home);

  if (home) {
    // Windows und Linux nutzen dieselben englischen Ordnernamen; auf einem
    // deutschen Windows sind sie nur im Explorer uebersetzt.
    add('Schreibtisch', path.join(home, 'Desktop'));
    add('Dokumente', path.join(home, 'Documents'));
    add('Downloads', path.join(home, 'Downloads'));
    add('Filme', path.join(home, 'Movies'));   // macOS
    add('Videos', path.join(home, 'Videos'));  // Windows und Linux
    // Deutsche Windows-Installationen mit umbenannten Ordnern.
    add('Dokumente', path.join(home, 'Dokumente'));
    add('Schreibtisch', path.join(home, 'Schreibtisch'));
  }

  if (process.platform === 'win32') {
    add('Dokumente', process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Documents') : null);
    add('OneDrive', process.env.OneDrive || null);
  } else if (process.platform === 'darwin') {
    for (const v of mountsUnder('/Volumes', 0)) add(path.basename(v), v);
  } else {
    for (const v of mountsUnder('/media', 1)) add(path.basename(v), v);
    for (const v of mountsUnder('/mnt', 0)) add(path.basename(v), v);
  }

  // Das Arbeitsverzeichnis des Nutzers - dort landen Renders und Projekte.
  try {
    const p = getPaths();
    add('Arbeitsverzeichnis', p.workspace);
    add('Ausgabeordner', p.out);
    add('Projekte', p.projects);
  } catch (err) {
    console.error(`[fsbrowse] Arbeitsverzeichnis nicht ermittelbar: ${err.message}`);
  }

  return out;
}

function parentOf(abs) {
  const p = path.dirname(abs);
  if (!p || p === abs) return null;
  return p;
}

/**
 * Verzeichnisinhalt lesen.
 *
 * opts:
 *   onlyDirs      nur Ordner zurueckgeben
 *   mediaOnly     Dateien auf bekannte Medienendungen beschraenken
 *   showHidden    versteckte Eintraege mitnehmen
 */
export function browse(target, opts = {}) {
  const { onlyDirs = false, mediaOnly = false, showHidden = false } = opts;

  if (!target || String(target).trim() === '') {
    return { path: null, parent: null, entries: [], drives: drives(), shortcuts: shortcuts() };
  }

  const raw0 = String(target).trim();
  let abs = path.resolve(raw0);
  // "D:" alleine meint das Wurzelverzeichnis des Laufwerks, nicht das cwd darauf.
  if (/^[a-zA-Z]:$/.test(raw0)) abs = `${raw0}\\`;

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (err) {
    throw Object.assign(new Error(`Pfad nicht lesbar: ${abs} (${err.message})`), { status: 404 });
  }
  if (!stat.isDirectory()) {
    abs = path.dirname(abs);
  }

  let raw;
  try {
    raw = fs.readdirSync(abs, { withFileTypes: true });
  } catch (err) {
    throw Object.assign(new Error(`Verzeichnis nicht lesbar: ${abs} (${err.message})`), {
      status: 403,
    });
  }

  const entries = [];
  for (const d of raw) {
    const name = d.name;
    if (!showHidden && name.startsWith('.')) continue;
    const full = path.join(abs, name);

    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) {
      try {
        isDir = fs.statSync(full).isDirectory();
      } catch {
        continue; // toter Link
      }
    }

    if (isDir && HIDDEN_DIRS.has(name)) continue;
    if (!isDir && onlyDirs) continue;
    if (!isDir && mediaOnly && !isMediaFile(full)) continue;

    let sizeBytes = 0;
    let mtime = null;
    try {
      const s = fs.statSync(full);
      sizeBytes = isDir ? 0 : s.size;
      mtime = s.mtime.toISOString();
    } catch {
      // Datei verschwunden oder gesperrt - trotzdem anzeigen, ohne Details.
    }

    entries.push({ name, path: full, dir: isDir, sizeBytes, mtime });
  }

  entries.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });
  });

  return { path: abs, parent: parentOf(abs), entries, drives: drives(), shortcuts: shortcuts() };
}

export default { browse, drives, shortcuts };
