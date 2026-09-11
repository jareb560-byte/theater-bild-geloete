/**
 * Theater-Bild-Gelöte - Projektdatei.
 *
 * Ein Projekt ist genau das Objekt aus makeProject() in shared/model.js.
 * Beim Speichern bekommt jedes Medium zusaetzlich relPath (relativ zur
 * Projektdatei); beim Laden wird daraus absPath rekonstruiert, falls der
 * gespeicherte absPath nicht mehr existiert. Damit ueberlebt ein Projekt
 * den Umzug auf einen anderen Rechner oder ein anderes Laufwerk.
 *
 * current() haelt das aktive Projekt im Speicher und sichert es
 * automatisch nach <root>/project.tbg.json.
 */

import fs from 'node:fs';
import path from 'node:path';

import { makeProject, validateProject, SCHEMA_VERSION } from '../shared/model.js';
import { ensureDir, projectFile, root } from './paths.js';
import * as venues from './venues.js';

const AUTOSAVE_DELAY_MS = 600;

let currentProject = null;
let currentPath = null;
let autosaveTimer = null;

/* ==========================================================================
 * Lesen und Schreiben
 * ========================================================================== */

/** Rechnet relPath in absPath zurueck, wenn der gespeicherte Pfad fehlt. */
function relinkMedia(project, file) {
  const dir = path.dirname(path.resolve(file));
  const lost = [];
  for (const m of project.media || []) {
    const hasAbs = m.absPath && fs.existsSync(m.absPath);
    if (!hasAbs && m.relPath) {
      const guess = path.resolve(dir, m.relPath);
      if (fs.existsSync(guess)) {
        m.absPath = guess;
        continue;
      }
    }
    if (!hasAbs) lost.push(m.name || m.absPath || m.id);
  }
  if (lost.length > 0) {
    console.warn(
      `[project] ${lost.length} Datei(en) nicht gefunden: ${lost.slice(0, 8).join(', ')}` +
        (lost.length > 8 ? ' …' : '')
    );
  }
  return lost;
}

/** Schreibt relPath fuer jedes Medium, bezogen auf die Zieldatei. */
function writeRelPaths(project, file) {
  const dir = path.dirname(path.resolve(file));
  for (const m of project.media || []) {
    if (!m.absPath) {
      m.relPath = null;
      continue;
    }
    const rel = path.relative(dir, m.absPath);
    // Auf einem anderen Laufwerk liefert path.relative einen absoluten Pfad -
    // dann ist eine relative Angabe schlicht nicht moeglich.
    m.relPath = rel && !path.isAbsolute(rel) && !/^[a-zA-Z]:/.test(rel) ? rel : null;
  }
}

/** Laedt ein Projekt von der Platte. Wirft mit klarem Text, wenn etwas fehlt. */
export function load(file) {
  const abs = path.resolve(file);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    throw new Error(`Projektdatei ${abs} konnte nicht gelesen werden: ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Projektdatei ${abs} ist kein gültiges JSON: ${err.message}`);
  }
  if (!data || typeof data !== 'object' || !data.walls) {
    throw new Error(`Projektdatei ${abs} enthält kein Projekt (Feld "walls" fehlt).`);
  }
  if (data.schema !== SCHEMA_VERSION) {
    console.warn(
      `[project] ${path.basename(abs)} hat Schema "${data.schema}", erwartet wird "${SCHEMA_VERSION}".`
    );
  }
  const lost = relinkMedia(data, abs);
  data.missingMedia = lost;
  return data;
}

/** Speichert ein Projekt. Legt fehlende Verzeichnisse an. */
export function save(file, project) {
  const abs = path.resolve(file);
  if (!project) throw new Error('save() ohne Projekt aufgerufen');
  ensureDir(path.dirname(abs));
  writeRelPaths(project, abs);
  project.modifiedAt = new Date().toISOString();
  const tmp = `${abs}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(project, null, 2), 'utf8');
    fs.renameSync(tmp, abs);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* Aufraeumen darf scheitern */
    }
    throw new Error(`Projekt konnte nicht nach ${abs} geschrieben werden: ${err.message}`);
  }
  return abs;
}

/* ==========================================================================
 * Aktives Projekt
 * ========================================================================== */

/** Neues, leeres Projekt fuer ein Venue. */
export function create(venueId, name = 'Unbenannt') {
  const venue = venues.get(venueId);
  const p = makeProject(venue, { name });
  return p;
}

function bootstrap() {
  if (fs.existsSync(projectFile)) {
    try {
      const p = load(projectFile);
      currentPath = projectFile;
      return p;
    } catch (err) {
      console.error(`[project] Autosave-Datei unbrauchbar, starte mit leerem Projekt: ${err.message}`);
    }
  }
  const venue = venues.base();
  if (!venue) {
    throw new Error(
      'Kein Venue gefunden. In config/venues/ muss mindestens eine gültige Venue-Datei liegen.'
    );
  }
  return makeProject(venue, { name: 'Unbenannt' });
}

/** Das aktive Projekt. Beim ersten Aufruf wird es geladen oder angelegt. */
export function current() {
  if (!currentProject) currentProject = bootstrap();
  return currentProject;
}

/** Pfad der zuletzt geoeffneten/gespeicherten Projektdatei (oder null). */
export function currentFile() {
  return currentPath;
}

/** Venue des aktiven Projekts. */
export function currentVenue() {
  const p = current();
  return venues.get(p.venueId);
}

/**
 * Setzt das aktive Projekt und stoesst den Autosave an.
 * file = null laesst den bisherigen Projektpfad stehen.
 */
export function setCurrent(project, file = undefined) {
  if (!project) throw new Error('setCurrent() ohne Projekt aufgerufen');
  currentProject = project;
  if (file !== undefined) currentPath = file ? path.resolve(file) : null;
  scheduleAutosave();
  return currentProject;
}

/** Autosave anstossen, ohne das Projekt zu ersetzen. */
export function touch() {
  scheduleAutosave();
}

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    autosaveNow();
  }, AUTOSAVE_DELAY_MS);
  // KEIN unref(): ein unref'ter Timer haelt den Prozess nicht am Leben. Wird
  // der Server innerhalb der Entprellzeit beendet (Strg+C, Neustart durch
  // node --watch), laeuft er nie ab und der letzte PUT landet nie auf der
  // Platte. Der HTTP-Server haelt den Event-Loop ohnehin offen, der Timer
  // verhindert also kein sauberes Beenden. Zusaetzlich holt der SIGINT-Handler
  // in server/index.js den Autosave beim Beenden nach.
}

/** Sofort nach <root>/project.tbg.json sichern. */
export function autosaveNow() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  if (!currentProject) return null;
  try {
    return save(projectFile, currentProject);
  } catch (err) {
    console.error(`[project] Autosave fehlgeschlagen: ${err.message}`);
    return null;
  }
}

/** Projekt oeffnen und zum aktiven machen. */
export function open(file) {
  const p = load(file);
  currentProject = p;
  currentPath = path.resolve(file);
  scheduleAutosave();
  return p;
}

/** Aktives Projekt speichern. Ohne Pfad wird der zuletzt benutzte genommen. */
export function saveCurrent(file) {
  const target = file ? path.resolve(file) : currentPath || projectFile;
  const abs = save(target, current());
  currentPath = abs;
  if (abs !== projectFile) autosaveNow();
  return abs;
}

/** Probleme des aktiven Projekts, Form siehe validateProject(). */
export function validate(project = current()) {
  const venue = venues.find(project.venueId);
  if (!venue) {
    return [
      {
        level: 'error',
        where: 'projekt',
        msg: `Venue "${project.venueId}" ist unbekannt`,
        hint: 'Venue-Datei in config/venues/ ergänzen oder Projekt neu anlegen.',
      },
    ];
  }
  return validateProject(project, venue);
}

/** Standardpfad der Autosave-Datei - fuer die UI-Anzeige. */
export const autosaveFile = projectFile;
export const projectRoot = root;

export default {
  load,
  save,
  create,
  current,
  currentFile,
  currentVenue,
  setCurrent,
  open,
  saveCurrent,
  validate,
  autosaveNow,
  touch,
};
