/**
 * Theater-Bild-Gelöte - Venue-Verwaltung.
 *
 * Ein Venue beschreibt ein Haus: Waende, Panelaufteilung, Metermasse,
 * Kamerapositionen und Delivery-Presets. Es gibt zwei Quellen:
 *
 *   1. VORLAGEN  - die mitgelieferten Dateien in config/venues/.
 *                  Sie sind schreibgeschuetzt und werden nie veraendert.
 *   2. EIGENE    - alles im venues-Ordner des Arbeitsverzeichnisses.
 *                  Die legt der Nutzer selbst an, aendert und loescht sie.
 *
 * Eigene Venues haben Vorrang: liegt dort eine Datei mit derselben id wie eine
 * Vorlage, gewinnt die eigene. So kann man eine Vorlage kopieren, anpassen und
 * unter demselben Namen weiterbenutzen, ohne die Auslieferung anzufassen.
 *
 * Zwei Dateiformen sind erlaubt:
 *   a) Die Datei IST ein Venue          (mein-schiff-theater.json)
 *   b) Die Datei enthaelt { venues: [] } (weitere-venues.json)
 * Geschrieben wird immer Form a) - eine Datei je Venue, Dateiname <id>.json.
 *
 * Beim Laden laeuft validate() ueber jedes Venue. Fehler und Warnungen landen
 * in getWarnings(), damit doctor.js sie anzeigt; Fehler zusaetzlich sofort auf
 * der Konsole. Nichts wird still verschluckt.
 */

import fs from 'node:fs';
import path from 'node:path';

import * as pathsMod from './paths.js';

/** Venue, von dem die Nebenvenues Delivery-Presets und Kameras erben. */
export const BASE_VENUE_ID = 'mein-schiff-theater';

/**
 * Mitgelieferte Vorlagen - hier wird nur gelesen.
 * Als Funktion, weil paths.js seine Ordner erst in initPaths() festlegt und
 * das Arbeitsverzeichnis zur Laufzeit umgeschaltet werden kann.
 */
export function builtinVenuesDir() {
  return pathsMod.builtinVenuesDir || pathsMod.venuesDir || path.join(pathsMod.root, 'config', 'venues');
}

/**
 * Eigene Venues - venues/ im Arbeitsverzeichnis. Reihenfolge der Quellen:
 *   1. paths.js (userVenuesDir bzw. paths.venues) - der Normalfall
 *   2. Umgebungsvariable TBG_VENUES_DIR - fuer Sonderfaelle
 *   3. venues/ neben dem Programm, falls beides fehlt
 * Immer ueber node:path zusammengesetzt, nie per String-Verkettung.
 */
export function userVenuesDir() {
  const fromPaths = pathsMod.userVenuesDir || pathsMod.paths?.venues;
  if (typeof fromPaths === 'string' && fromPaths.trim()) return path.resolve(fromPaths.trim());
  const fromEnv = process.env.TBG_VENUES_DIR;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(pathsMod.root, 'venues');
}

let cache = null;      // Map<id, venue>
let cacheDirs = '';    // Ordner, aus denen der Cache stammt
let warnings = [];     // gesammelte Ladewarnungen, auch fuer doctor.js

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

/** Fehler mit HTTP-Status, damit der Router ihn ohne Raten weiterreichen kann. */
function fail(status, message, detail) {
  const err = new Error(message);
  err.status = status;
  if (detail) err.detail = detail;
  return err;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Tiefe Kopie ohne Fremdabhaengigkeit. */
function clone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

/** Zwei Nachkommastellen, ohne handgemachte Komma-Formatierung. */
function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Naechste durch 4 teilbare Kantenlaenge nach oben. */
function nextMultipleOf4(n) {
  return Math.ceil(n / 4) * 4;
}

/* ==========================================================================
 * IDs - aus einer id wird ein Dateiname, also darf da wenig drin stehen
 * ========================================================================== */

const ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Namen, die Windows fuer Geraete reserviert - als Datei nicht anlegbar. */
const RESERVED_IDS = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id) && !RESERVED_IDS.has(id);
}

/** Aus beliebigem Text eine brauchbare id machen - fuer Vorschlaege. */
export function slugify(text) {
  const map = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'Ä': 'ae', 'Ö': 'oe', 'Ü': 'ue' };
  const s = String(text ?? '')
    .replace(/[äöüßÄÖÜ]/g, (c) => map[c] || c)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'venue';
}

/* ==========================================================================
 * Laden
 * ========================================================================== */

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Venue-Datei ${path.basename(file)} ist kein gueltiges JSON: ${err.message}`);
  }
}

function looksLikeVenue(obj) {
  return obj && typeof obj === 'object' && typeof obj.id === 'string' && Array.isArray(obj.walls);
}

function noteWarning(msg, loud = true) {
  warnings.push(msg);
  if (loud) console.warn(`[venues] WARNUNG - ${msg}`);
}

/**
 * Ergaenzt fehlende Bloecke aus dem Basisvenue. Die Nebenvenues in
 * weitere-venues.json haben weder Kamerapresets noch Delivery-Presets;
 * ohne sie koennen Client und Renderer nicht arbeiten.
 */
function inherit(venue, base) {
  if (!base || venue.id === base.id) return venue;
  const v = { ...venue };
  if (!v.camera) v.camera = base.camera;
  if (!v.fps) v.fps = base.fps;
  if (!v.pixelPitchMm) v.pixelPitchMm = base.pixelPitchMm;
  const d = v.delivery || {};
  v.delivery = {
    namePattern: d.namePattern || base.delivery?.namePattern,
    presets: Array.isArray(d.presets) && d.presets.length ? d.presets : base.delivery?.presets || [],
    defaultPreset: d.defaultPreset || base.delivery?.defaultPreset,
    proxy: d.proxy || base.delivery?.proxy,
  };
  v.inheritsFrom = base.id;
  return v;
}

/**
 * Ein Verzeichnis einlesen. Fehlt es, ist das kein Fehler - der Ordner fuer
 * eigene Venues entsteht erst beim ersten Speichern.
 */
function loadDir(dir, builtin) {
  const out = [];
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .sort();
  } catch (err) {
    // Fehlt der Ordner fuer EIGENE Venues, ist das der Normalzustand vor dem
    // ersten Speichern. Fehlen die Vorlagen, ist die Installation kaputt.
    if (err.code === 'ENOENT' && !builtin) return out;
    noteWarning(`Venue-Verzeichnis ${dir} nicht lesbar: ${err.message}`);
    return out;
  }

  for (const f of files) {
    const file = path.join(dir, f);
    let data;
    try {
      data = readJson(file);
    } catch (err) {
      noteWarning(err.message);
      continue;
    }

    const found = [];
    if (Array.isArray(data?.venues)) found.push(...data.venues);
    if (looksLikeVenue(data)) found.push(data);

    if (found.length === 0) {
      noteWarning(`${f} enthaelt weder ein Venue noch ein "venues"-Array - uebersprungen`);
      continue;
    }
    for (const v of found) {
      if (!looksLikeVenue(v)) {
        noteWarning(`${f}: Eintrag ohne id/walls wird ignoriert`);
        continue;
      }
      out.push({ venue: v, file, builtin, bundle: found.length > 1 });
    }
  }
  return out;
}

function loadAll() {
  const map = new Map();
  warnings = [];

  const builtinDir = builtinVenuesDir();
  const userDir = userVenuesDir();
  cacheDirs = `${builtinDir}\u0000${userDir}`;

  // Erst die Vorlagen, dann die eigenen - die eigenen ueberschreiben.
  const entries = [
    ...loadDir(builtinDir, true),
    ...loadDir(userDir, false),
  ];

  const seen = new Map(); // id -> builtin?  fuer die Doppelten-Warnung je Ebene
  for (const e of entries) {
    const { venue, file, builtin, bundle } = e;
    const prev = seen.get(venue.id);
    if (prev !== undefined && prev === builtin) {
      noteWarning(
        `Venue-ID "${venue.id}" kommt mehrfach vor (zuletzt in ${path.basename(file)}) - der letzte gewinnt`
      );
    }
    // Eigenes verdeckt eine Vorlage: gewollt, deshalb nur eine Notiz im Log.
    if (prev === true && builtin === false) {
      console.log(`[venues] "${venue.id}" aus ${userVenuesDir()} hat Vorrang vor der gleichnamigen Vorlage.`);
    }
    seen.set(venue.id, builtin);

    venue.sourceFile = file;
    map.set(venue.id, { venue, file, builtin, bundle });
  }

  const baseEntry = map.get(BASE_VENUE_ID) || map.values().next().value || null;
  const baseVenue = baseEntry ? baseEntry.venue : null;

  const result = new Map();
  for (const [id, e] of map) {
    const full = inherit(e.venue, baseVenue);
    full._builtin = e.builtin;
    full._path = e.file;
    full._bundle = e.bundle === true;
    result.set(id, full);

    // Ladepruefung: was hier Fehler ist, macht das Rendern kaputt.
    let problems = [];
    try {
      problems = validate(full);
    } catch (err) {
      noteWarning(`${id}: Pruefung fehlgeschlagen: ${err.message}`);
    }
    for (const p of problems) {
      if (p.level === 'error') {
        noteWarning(`${full.name || id} / ${p.where}: ${p.msg}`);
      } else if (p.level === 'warn') {
        // Leise sammeln - doctor.js zeigt sie, die Konsole bleibt lesbar.
        warnings.push(`${full.name || id} / ${p.where}: ${p.msg}`);
      }
    }
  }
  return result;
}

function ensure() {
  // Wechselt das Arbeitsverzeichnis zur Laufzeit, zeigt der Cache auf die
  // falschen Dateien - dann neu einlesen.
  if (cache && cacheDirs !== `${builtinVenuesDir()} ${userVenuesDir()}`) cache = null;
  if (!cache) cache = loadAll();
  return cache;
}

/** Dateien neu einlesen (z.B. nach einer Aenderung im venues-Ordner). */
export function reload() {
  cache = null;
  return ensure();
}

/* ==========================================================================
 * Lesen
 * ========================================================================== */

/** Kurzliste fuer GET /api/venues. Eigene zuerst, dann die Vorlagen. */
export function list() {
  return [...ensure().values()]
    .map((v) => ({
      id: v.id,
      name: v.name || v.id,
      wallCount: (v.walls || []).length,
      builtin: v._builtin === true,
      path: v._path || null,
    }))
    .sort((a, b) => {
      if (a.builtin !== b.builtin) return a.builtin ? 1 : -1;
      return String(a.name).localeCompare(String(b.name), 'de');
    });
}

/** Volles Venue-JSON, ergaenzt um _builtin und _path. Wirft bei unbekannter ID. */
export function get(id) {
  const v = ensure().get(id);
  if (!v) {
    const known = [...ensure().keys()].join(', ') || '(keine)';
    throw fail(404, `Venue "${id}" ist unbekannt.`, `Vorhanden: ${known}`);
  }
  return v;
}

/** Wie get(), aber null statt Fehler. */
export function find(id) {
  return ensure().get(id) || null;
}

/** Standardvenue fuer neue Projekte. */
export function base() {
  return find(BASE_VENUE_ID) || [...ensure().values()][0] || null;
}

/** Alle Ladewarnungen - doctor.js zeigt sie an. */
export function getWarnings() {
  ensure();
  return [...warnings];
}

/* ==========================================================================
 * Schreiben
 * ========================================================================== */

/** Felder, die nur im Speicher existieren und nie in die Datei gehoeren. */
const INTERNAL_FIELDS = ['_builtin', '_path', '_bundle', 'sourceFile', 'inheritsFrom'];

function stripInternal(venue) {
  const v = clone(venue);
  for (const f of INTERNAL_FIELDS) delete v[f];
  return v;
}

function fileFor(id) {
  return path.join(userVenuesDir(), `${id}.json`);
}

/**
 * Venue in den venues-Ordner des Arbeitsverzeichnisses schreiben.
 *
 * Atomar: erst <id>.json.tmp schreiben, dann umbenennen. Faellt der Strom
 * mitten im Schreiben aus, ist die alte Datei noch vollstaendig da.
 * Vorlagen werden nie ueberschrieben - sie liegen in einem anderen Ordner.
 */
export function save(venue) {
  if (!venue || typeof venue !== 'object') {
    throw fail(400, 'Kein Venue-Objekt zum Speichern uebergeben.');
  }
  const problems = validate(venue);
  const errors = problems.filter((p) => p.level === 'error');
  if (errors.length > 0) {
    const err = fail(
      400,
      `Das Venue hat ${errors.length} Fehler und wurde nicht gespeichert.`,
      errors.map((p) => `${p.where}: ${p.msg}`).join('\n')
    );
    err.problems = problems;
    throw err;
  }

  const id = venue.id;
  const data = stripInternal(venue);
  const target = fileFor(id);
  const tmp = `${target}.tmp`;

  const dir = userVenuesDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw fail(500, `Der Ordner ${dir} konnte nicht angelegt werden: ${err.message}`, err.code || null);
  }

  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (cleanupErr) {
      console.error(`[venues] Aufraeumen von ${tmp} fehlgeschlagen: ${cleanupErr.message}`);
    }
    console.error(`[venues] Speichern von ${target} fehlgeschlagen: ${err.message}`);
    throw fail(500, `Venue "${id}" konnte nicht gespeichert werden: ${err.message}`, target);
  }

  console.log(`[venues] gespeichert: ${target}`);
  reload();
  return get(id);
}

/** Eigenes Venue loeschen. Vorlagen bleiben unangetastet. */
export function remove(id) {
  const v = get(id); // wirft 404, wenn unbekannt
  if (v._builtin) {
    throw fail(
      403,
      `"${v.name || id}" ist eine mitgelieferte Vorlage und kann nicht geloescht werden.`,
      'Vorlagen sind schreibgeschuetzt. Erst duplizieren, dann die Kopie bearbeiten oder loeschen.'
    );
  }
  const file = v._path;
  if (!file || !pathsMod.isInside(userVenuesDir(), file)) {
    throw fail(
      403,
      `"${id}" liegt ausserhalb des eigenen Venue-Ordners und wird nicht geloescht.`,
      `Datei: ${file || '(unbekannt)'} - eigene Venues liegen in ${userVenuesDir()}`
    );
  }
  if (v._bundle) {
    throw fail(
      409,
      `Die Datei ${path.basename(file)} enthaelt mehrere Venues.`,
      'Zum Loeschen einzelner Eintraege die Datei von Hand bearbeiten - das Tool loescht nur Dateien mit genau einem Venue.'
    );
  }

  try {
    fs.unlinkSync(file);
  } catch (err) {
    console.error(`[venues] Loeschen von ${file} fehlgeschlagen: ${err.message}`);
    throw fail(500, `Venue "${id}" konnte nicht geloescht werden: ${err.message}`, file);
  }

  console.log(`[venues] geloescht: ${file}`);
  reload();
  return { id, path: file };
}

/**
 * Venue kopieren. Die Kopie landet immer im eigenen Ordner, auch wenn die
 * Quelle eine Vorlage ist - genau so macht man aus einer Vorlage ein eigenes
 * Haus.
 */
export function duplicate(id, neueId, neuerName) {
  const src = get(id); // wirft 404, wenn unbekannt
  const targetId = isNonEmptyString(neueId) ? neueId.trim() : slugify(`${src.id}-kopie`);

  if (!isValidId(targetId)) {
    throw fail(
      400,
      `"${targetId}" ist als Venue-ID nicht erlaubt.`,
      `Erlaubt sind Kleinbuchstaben a-z, Ziffern 0-9 und Bindestriche. Vorschlag: "${slugify(targetId)}"`
    );
  }
  if (find(targetId)) {
    throw fail(
      409,
      `Ein Venue mit der ID "${targetId}" gibt es schon.`,
      'Andere ID waehlen oder das vorhandene Venue direkt bearbeiten.'
    );
  }

  const copy = stripInternal(src);
  copy.id = targetId;
  copy.name = isNonEmptyString(neuerName) ? neuerName.trim() : `${src.name || src.id} (Kopie)`;
  return save(copy);
}

/* ==========================================================================
 * Geruest fuer ein neues Venue
 * ========================================================================== */

/** Wand-Kennungen A, B, C, ... danach A1, B1, ... */
function wallLetter(i) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (i < letters.length) return letters[i];
  return `${letters[i % letters.length]}${Math.floor(i / letters.length) + 1}`;
}

/**
 * Breite gleichmaessig auf n Panels aufteilen. Jedes Panel wird moeglichst ein
 * Vielfaches von 4 (HAP-Vorgabe); der Rest geht auf das letzte Panel, damit die
 * Summe exakt der Wandbreite entspricht.
 */
export function splitWidth(total, n) {
  const count = Math.max(1, Math.floor(n));
  const width = Math.max(1, Math.floor(total));
  const each = Math.max(4, Math.floor(width / count / 4) * 4);
  const out = new Array(count).fill(each);
  let rest = width - each * count;
  // Rest in 4er-Schritten von links nach rechts verteilen.
  let i = 0;
  while (rest >= 4) {
    out[i % count] += 4;
    rest -= 4;
    i += 1;
  }
  if (rest !== 0) out[count - 1] += rest;
  // Sicherheitsnetz: kein Panel darf 0 oder negativ werden.
  const sum = out.reduce((a, b) => a + b, 0);
  if (sum !== width) out[count - 1] += width - sum;
  return out;
}

function freeId(wanted) {
  if (!find(wanted)) return wanted;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${wanted}-${i}`;
    if (!find(candidate)) return candidate;
  }
  return `${wanted}-${Date.now().toString(36)}`;
}

/** Standard-Delivery-Presets fuer ein frisches Venue. */
function defaultDelivery() {
  return {
    namePattern: '{WALL}_{W}x{H}_{FPS}p_{CODEC}',
    presets: [
      {
        id: 'hap_q',
        label: 'HAP Q - Standard fuer LED-Mediaserver',
        ext: 'mov',
        codecTag: 'HAP',
        args: ['-c:v', 'hap', '-format', 'hap_q', '-chunks', '4', '-an'],
        bytesPerPixel: 0.5,
        alpha: false,
      },
      {
        id: 'hap_alpha',
        label: 'HAP Alpha - mit Transparenz',
        ext: 'mov',
        codecTag: 'HAPAlpha',
        args: ['-c:v', 'hap', '-format', 'hap_alpha', '-chunks', '4', '-an'],
        bytesPerPixel: 1.0,
        alpha: true,
      },
      {
        id: 'prores422',
        label: 'ProRes 422 - Archiv und Austausch',
        ext: 'mov',
        codecTag: 'ProRes422',
        args: ['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-an'],
        bytesPerPixel: 0.62,
        alpha: false,
      },
      {
        id: 'h264_review',
        label: 'H.264 - Ansichtsexemplar / Freigabe',
        ext: 'mp4',
        codecTag: 'h264',
        args: ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p',
               '-movflags', '+faststart', '-an'],
        bytesPerPixel: 0.02,
        alpha: false,
      },
    ],
    defaultPreset: 'hap_q',
    proxy: {
      maxWidth: 1280,
      args: ['-c:v', 'libx264', '-crf', '26', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
             '-movflags', '+faststart', '-an'],
    },
  };
}

/**
 * Vollstaendiges, gueltiges Venue-Geruest. Metermasse aus dem Pixelpitch
 * gerechnet (Vorgabe 4 mm), Panels gleichmaessig aufgeteilt, Kameras auf die
 * Buehnengroesse gerechnet. validate() meldet darauf keinen Fehler.
 */
export function template(opts = {}) {
  const wallCount = Math.max(1, Math.min(12, Math.floor(num(opts.walls) ?? 1)));
  const panelCount = Math.max(1, Math.min(32, Math.floor(num(opts.panels) ?? 4)));
  const width = Math.max(16, Math.min(32768, Math.floor(num(opts.width) ?? 1920)));
  const height = Math.max(16, Math.min(32768, Math.floor(num(opts.height) ?? 1080)));
  const fps = Math.max(1, Math.min(240, num(opts.fps) ?? 30));
  const pitchMm = Math.max(0.1, Math.min(100, num(opts.pixelPitchMm) ?? 4));
  const wallGapM = 3.0; // Standardabstand zwischen zwei Ebenen

  const widthM = round((width * pitchMm) / 1000, 3);
  const heightM = round((height * pitchMm) / 1000, 3);

  const walls = [];
  for (let i = 0; i < wallCount; i += 1) {
    const wallId = wallLetter(i);
    const widths = splitWidth(width, panelCount);
    const panels = [];
    let x = 0;
    for (let p = 0; p < widths.length; p += 1) {
      panels.push({ id: `${wallId}${p + 1}`, x, width: widths[p] });
      x += widths[p];
    }
    // Mittelnaht auf die Panelgrenze legen, die der Wandmitte am naechsten ist.
    const bounds = [0];
    for (const w of widths) bounds.push(bounds[bounds.length - 1] + w);
    const mid = width / 2;
    const centerSeamX = bounds.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a), 0);

    walls.push({
      id: wallId,
      label: `Wand ${wallId}`,
      width,
      height,
      widthM,
      heightM,
      panels,
      centerSeamX,
      safeAreaPct: 0.15,
      stage: {
        z: round(i * wallGapM, 2),
        floorOffsetM: 0,
        travelMaxM: round(widthM / 2, 2),
        verified: false,
      },
    });
  }

  const depthM = round((wallCount - 1) * wallGapM, 2);
  const centerZ = round(depthM / 2, 2);
  const eyeM = 1.2;
  const backM = round(-(widthM * 1.2 + 2), 2);   // Zuschauer sitzen bei negativem z
  const frontM = round(-(widthM * 0.5 + 2), 2);
  const target = [0, round(heightM / 2, 2), centerZ];

  const venue = {
    id: freeId(isValidId(opts.id) ? opts.id : 'neues-venue'),
    name: isNonEmptyString(opts.name) ? String(opts.name).trim() : 'Neues Venue',
    fps,
    pixelPitchMm: pitchMm,
    walls,
    camera: {
      presets: [
        { id: 'audience', label: 'Zuschauer Mitte', pos: [0, eyeM, backM], target, fov: 40 },
        { id: 'frontrow', label: 'Erste Reihe', pos: [0, eyeM, frontM], target, fov: 55 },
        {
          id: 'balcony',
          label: 'Rang',
          pos: [0, round(heightM * 1.2, 2), round(backM - widthM * 0.4, 2)],
          target,
          fov: 35,
        },
        {
          id: 'sideleft',
          label: 'Seitenplatz links',
          pos: [round(-widthM * 0.8, 2), round(eyeM + 0.4, 2), round(frontM - 2, 2)],
          target,
          fov: 45,
        },
        {
          id: 'plan',
          label: 'Draufsicht / Plan',
          pos: [0, round(widthM * 2, 2), centerZ],
          target: [0, 0, centerZ],
          fov: 40,
        },
        {
          id: 'iso',
          label: 'Isometrisch',
          pos: [round(-widthM, 2), round(heightM * 1.4, 2), round(backM * 0.8, 2)],
          target,
          fov: 40,
        },
      ],
      default: 'audience',
    },
    delivery: defaultDelivery(),
    assumptions: [
      `Metermasse aus ${pitchMm} mm Pixelpitch gerechnet - echte Masse nachtragen.`,
      `Abstand der Waende zueinander mit ${wallGapM} m angenommen.`,
      'Panelaufteilung gleichmaessig angenommen - echte Panelbreiten eintragen.',
    ],
  };
  return venue;
}

/* ==========================================================================
 * Pruefung
 * ========================================================================== */

/**
 * Ein Venue pruefen. Liefert [{ level, where, msg, hint }] mit
 * level 'error' | 'warn' | 'info' - dieselbe Form wie validateProject()
 * in shared/model.js.
 *
 * Wirft nie. Was hier nicht geprueft werden kann, wird gemeldet.
 */
export function validate(venue) {
  const problems = [];
  const add = (level, where, msg, hint) => problems.push({ level, where, msg, hint: hint || null });

  if (!venue || typeof venue !== 'object' || Array.isArray(venue)) {
    add('error', 'venue', 'Das ist kein Venue-Objekt.',
        'Erwartet wird ein JSON-Objekt mit id, name, fps, walls und delivery.');
    return problems;
  }

  /* --- id ---------------------------------------------------------------- */
  if (!isNonEmptyString(venue.id)) {
    add('error', 'id', 'Die Venue-ID fehlt.',
        'Kurze ID vergeben, z.B. "kleines-theater" - daraus wird der Dateiname.');
  } else if (!ID_RE.test(venue.id)) {
    add('error', 'id', `Die ID "${venue.id}" enthaelt unerlaubte Zeichen.`,
        `Erlaubt sind Kleinbuchstaben a-z, Ziffern 0-9 und Bindestriche dazwischen. Vorschlag: "${slugify(venue.id)}"`);
  } else if (RESERVED_IDS.has(venue.id)) {
    add('error', 'id', `Die ID "${venue.id}" ist unter Windows ein reservierter Geraetename.`,
        `Eine Datei mit diesem Namen laesst sich nicht anlegen. Vorschlag: "${venue.id}-1"`);
  }

  /* --- name -------------------------------------------------------------- */
  if (!isNonEmptyString(venue.name)) {
    add('error', 'name', 'Das Venue hat keinen Namen.',
        'Der Name steht in der Auswahlliste - "Kleines Theater, Saal 1" ist besser als die ID.');
  }

  /* --- fps --------------------------------------------------------------- */
  const fps = num(venue.fps);
  if (fps === null || fps <= 0) {
    add('error', 'fps', `Die Bildrate ist ${venue.fps ?? 'nicht gesetzt'}.`,
        'Bildrate des Hauses eintragen, ueblich sind 25, 30, 50 oder 60.');
  }

  /* --- Waende ------------------------------------------------------------ */
  const walls = Array.isArray(venue.walls) ? venue.walls : [];
  if (walls.length === 0) {
    add('error', 'walls', 'Das Venue hat keine einzige Wand.',
        'Mindestens eine Wand anlegen - ohne Wand gibt es nichts zu rendern.');
  }

  const wallIds = new Set();
  const pitches = [];  // { wallId, pitchMm }
  const depths = new Map(); // z -> [wallId]

  walls.forEach((wall, index) => {
    const wallId = isNonEmptyString(wall?.id) ? wall.id : `#${index + 1}`;
    const where = `Wand ${wallId}`;

    if (!wall || typeof wall !== 'object') {
      add('error', where, 'Der Eintrag ist keine Wand.', 'Erwartet wird ein Objekt mit id, width, height und panels.');
      return;
    }
    if (!isNonEmptyString(wall.id)) {
      add('error', where, 'Die Wand hat keine id.', 'Kurze Kennung vergeben, z.B. "A" - sie steht spaeter im Dateinamen.');
    } else if (wallIds.has(wall.id)) {
      add('error', where, `Die Wand-ID "${wall.id}" kommt mehrfach vor.`, 'IDs muessen im Venue eindeutig sein.');
    } else {
      wallIds.add(wall.id);
    }

    const w = num(wall.width);
    const h = num(wall.height);
    const wM = num(wall.widthM);
    const hM = num(wall.heightM);

    if (w === null || w <= 0) {
      add('error', where, `Die Wandbreite ist ${wall.width ?? 'nicht gesetzt'} px.`,
          'Breite in Pixeln eintragen - das ist die Aufloesung, die der Mediaserver bekommt.');
    }
    if (h === null || h <= 0) {
      add('error', where, `Die Wandhoehe ist ${wall.height ?? 'nicht gesetzt'} px.`,
          'Hoehe in Pixeln eintragen.');
    }
    if (wM === null || wM <= 0) {
      add('error', where, `Die Wandbreite in Metern ist ${wall.widthM ?? 'nicht gesetzt'}.`,
          'Ohne Metermass gibt es keine 3D-Ansicht und keinen Pixelpitch.');
    }
    if (hM === null || hM <= 0) {
      add('error', where, `Die Wandhoehe in Metern ist ${wall.heightM ?? 'nicht gesetzt'}.`,
          'Ohne Metermass gibt es keine 3D-Ansicht und keinen Pixelpitch.');
    }

    /* Kantenlaengen durch 4 teilbar - HAP verlangt das. */
    if (w !== null && w > 0 && w % 4 !== 0) {
      add('warn', where, `Die Breite ${w} px ist kein Vielfaches von 4.`,
          `HAP verlangt Kantenlaengen in Vielfachen von 4. Naechster gueltiger Wert: ${nextMultipleOf4(w)} px.`);
    }
    if (h !== null && h > 0 && h % 4 !== 0) {
      add('warn', where, `Die Hoehe ${h} px ist kein Vielfaches von 4.`,
          `HAP verlangt Kantenlaengen in Vielfachen von 4. Naechster gueltiger Wert: ${nextMultipleOf4(h)} px.`);
    }

    /* Panels */
    const panels = Array.isArray(wall.panels) ? wall.panels : [];
    if (panels.length === 0) {
      add('error', where, 'Die Wand hat keine Panels.',
          'Ist die Wand nicht geteilt, ein einziges Panel ueber die volle Breite anlegen.');
    } else {
      let sum = 0;
      let expectedX = 0;
      // Die Panel-id wird zum DATEINAMEN der Einzelausgabe. Fehlt sie oder
      // kommt sie zweimal vor, ueberschreiben sich zwei Panels gegenseitig —
      // und zwar erst nach dem Render, wenn die Datei schon weg ist.
      const panelIds = new Set();
      panels.forEach((p, pi) => {
        const pid = isNonEmptyString(p?.id) ? p.id : `#${pi + 1}`;
        const pWhere = `${where} / Panel ${pid}`;

        if (!isNonEmptyString(p?.id)) {
          add('error', pWhere, 'Dem Panel fehlt die id.',
              'Die id wird zum Dateinamen der Einzelausgabe, z.B. D1. Ohne sie kann nicht ausgeliefert werden.');
        } else if (panelIds.has(p.id)) {
          add('error', pWhere, `Die Panel-id "${p.id}" kommt mehrfach vor.`,
              'Zwei Panels mit derselben id schreiben in dieselbe Datei — die zweite ueberschreibt die erste.');
        } else {
          panelIds.add(p.id);
          if (!/^[A-Za-z0-9_-]+$/.test(p.id)) {
            add('warn', pWhere, `Die Panel-id "${p.id}" enthaelt Sonderzeichen.`,
                'Sie wird Teil des Dateinamens. Nur Buchstaben, Ziffern, Bindestrich und Unterstrich sind ueberall sicher.');
          }
        }

        const pw = num(p?.width);
        if (pw === null || pw <= 0) {
          add('error', pWhere, `Die Panelbreite ist ${p?.width ?? 'nicht gesetzt'} px.`,
              'Breite des einzelnen Panels in Pixeln eintragen.');
          return;
        }
        if (pw % 4 !== 0) {
          add('warn', pWhere, `Die Panelbreite ${pw} px ist kein Vielfaches von 4.`,
              `HAP verlangt Kantenlaengen in Vielfachen von 4. Naechster gueltiger Wert: ${nextMultipleOf4(pw)} px.`);
        }
        const px = num(p?.x);
        if (px === null) {
          add('error', pWhere, 'Das Panel hat keinen x-Wert.',
              `Panels liegen lueckenlos nebeneinander - hier waere x=${expectedX}.`);
        } else if (px !== expectedX) {
          const gap = px - expectedX;
          add('error', pWhere,
              `Das Panel beginnt bei x=${px}, lueckenlos waere x=${expectedX} ` +
              `(${gap > 0 ? `Luecke von ${gap} px` : `Ueberlappung von ${-gap} px`}).`,
              'Panels muessen aufsteigend und ohne Luecke aneinanderstossen, sonst sitzt der Ausschnitt falsch.');
        }
        expectedX += pw;
        sum += pw;
      });

      if (w !== null && w > 0 && sum !== w) {
        const diff = w - sum;
        add('error', where,
            `Summe der Panelbreiten ist ${sum} px, die Wand ist ${w} px breit ` +
            `(Differenz ${diff} px - es ${diff > 0 ? `fehlen ${diff}` : `sind ${-diff} zu viel`} px).`,
            'Panelbreiten oder Wandbreite korrigieren. Solange das nicht stimmt, schneidet der Panel-Export falsch.');
      }
    }

    /* centerSeamX */
    if (wall.centerSeamX !== undefined && wall.centerSeamX !== null) {
      const seam = num(wall.centerSeamX);
      if (seam === null) {
        add('error', where, `centerSeamX ist "${wall.centerSeamX}" und damit keine Zahl.`,
            'centerSeamX ist die x-Position der Mittelnaht in Pixeln.');
      } else if (w !== null && w > 0 && (seam < 0 || seam > w)) {
        add('error', where, `centerSeamX liegt bei ${seam} px, die Wand geht aber nur von 0 bis ${w} px.`,
            'Mittelnaht innerhalb der Wand setzen, ueblich auf der Panelgrenze in der Mitte.');
      }
    }

    /* Pixelpitch aus Hoehe - dort sind die Masse am verlaesslichsten. */
    if (h !== null && h > 0 && hM !== null && hM > 0) {
      pitches.push({ wallId, pitchMm: (hM * 1000) / h });
    }

    /* Tiefenlage */
    const z = num(wall.stage?.z);
    if (z !== null) {
      const key = String(round(z, 3));
      if (!depths.has(key)) depths.set(key, []);
      depths.get(key).push(wallId);
    }
  });

  /* --- Pixelpitch zwischen den Waenden ----------------------------------- */
  if (pitches.length >= 2) {
    let min = pitches[0];
    let max = pitches[0];
    for (const p of pitches) {
      if (p.pitchMm < min.pitchMm) min = p;
      if (p.pitchMm > max.pitchMm) max = p;
    }
    if (min.pitchMm > 0) {
      const dev = (max.pitchMm - min.pitchMm) / min.pitchMm;
      if (dev > 0.02) {
        add('warn', 'walls',
            `Der Pixelpitch ist nicht ueberall gleich: Wand ${min.wallId} hat ${round(min.pitchMm, 3)} mm, ` +
            `Wand ${max.wallId} hat ${round(max.pitchMm, 3)} mm (${round(dev * 100, 1)} % Abweichung).`,
            'Bei unterschiedlichem Pitch stimmt die Parallaxe zwischen den Ebenen nicht mehr: ein Motiv, ' +
            'das ueber mehrere Waende hinweg gleich gross wirken soll, ist es real nicht. ' +
            'Metermasse pruefen - meist ist ein widthM/heightM falsch abgeschrieben.');
      }
    }
  }

  /* --- gleiche Tiefe ----------------------------------------------------- */
  for (const [z, ids] of depths) {
    if (ids.length > 1) {
      add('info', 'walls', `${ids.map((i) => `Wand ${i}`).join(' und ')} stehen beide bei z = ${z} m.`,
          'Zwei Ebenen in derselben Tiefe. Ist das gewollt, ist alles gut - sonst die z-Werte trennen, ' +
          'sonst gibt es in der 3D-Ansicht keine Parallaxe zwischen ihnen.');
    }
  }

  /* --- Delivery ---------------------------------------------------------- */
  const presets = Array.isArray(venue.delivery?.presets) ? venue.delivery.presets : [];
  if (presets.length === 0) {
    add('error', 'delivery', 'Es ist kein einziges Delivery-Preset hinterlegt.',
        'Mindestens ein Ausgabeformat anlegen, z.B. HAP Q fuer den Mediaserver.');
  } else {
    const presetIds = new Set();
    presets.forEach((p, i) => {
      const where = `delivery / Preset ${isNonEmptyString(p?.id) ? p.id : `#${i + 1}`}`;
      if (!p || typeof p !== 'object') {
        add('error', where, 'Der Eintrag ist kein Preset.', 'Erwartet wird ein Objekt mit id, label, ext und args.');
        return;
      }
      if (!isNonEmptyString(p.id)) {
        add('error', where, 'Dem Preset fehlt die id.', 'Kurze Kennung, z.B. "hap_q".');
      } else if (presetIds.has(p.id)) {
        add('error', where, `Die Preset-ID "${p.id}" kommt mehrfach vor.`, 'IDs muessen eindeutig sein.');
      } else {
        presetIds.add(p.id);
      }
      if (!isNonEmptyString(p.label)) {
        add('error', where, 'Dem Preset fehlt die Beschriftung (label).',
            'Der Text steht in der Auswahlliste der Auslieferung.');
      }
      if (!isNonEmptyString(p.ext)) {
        add('error', where, 'Dem Preset fehlt die Dateiendung (ext).', 'Ohne Punkt angeben, z.B. "mov".');
      }
      if (!Array.isArray(p.args) || p.args.length === 0) {
        add('error', where, 'Dem Preset fehlen die ffmpeg-Argumente (args).',
            'Als Liste angeben, z.B. ["-c:v", "hap", "-format", "hap_q"].');
      } else if (p.args.some((a) => typeof a !== 'string')) {
        add('error', where, 'In args stehen Werte, die keine Zeichenkette sind.',
            'Jedes Argument einzeln als Text, Zahlen ebenfalls in Anfuehrungszeichen.');
      }
    });

    const def = venue.delivery?.defaultPreset;
    if (isNonEmptyString(def) && !presetIds.has(def)) {
      add('warn', 'delivery', `Das Standard-Preset "${def}" gibt es in der Liste nicht.`,
          `Vorhanden: ${[...presetIds].join(', ') || '(keine)'}`);
    }
  }

  return problems;
}

export default {
  list,
  get,
  find,
  base,
  save,
  remove,
  duplicate,
  validate,
  template,
  reload,
  getWarnings,
  isValidId,
  slugify,
  splitWidth,
  builtinVenuesDir,
  userVenuesDir,
  BASE_VENUE_ID,
};
