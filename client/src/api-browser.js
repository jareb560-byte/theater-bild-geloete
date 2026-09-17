/**
 * Theater-Bild-Geloete - API der BROWSER-FASSUNG.
 * ===========================================================================
 *
 * Dieselben Exporte wie client/src/api.js, aber ohne Server. Das Bauskript
 * legt diese Datei spaeter als client/src/api.js in die statische Fassung —
 * jede Aufrufstelle bleibt dadurch unveraendert. Signaturen und Rueckgabe-
 * formen sind deshalb 1:1 aus api.js uebernommen: was dort synchron ist,
 * ist hier synchron; was dort ein Promise liefert, liefert hier eines.
 *
 * ---------------------------------------------------------------------------
 * WAS DIESE FASSUNG KANN
 * ---------------------------------------------------------------------------
 *   3D-Buehne, Panel-Editor, Venue-Verwaltung, Projektplanung, Naht- und
 *   Sperrzonenpruefung, Sichtgrenzen, Panels von Hand fahren, Vorschau von
 *   browsertauglichen Videos (mp4/webm/mov mit H.264), Bilder,
 *   Filtergraph-Vorschau (der fertige ffmpeg-Befehl zum Kopieren).
 *
 * WAS SIE NICHT KANN — und das wird ehrlich gesagt, nicht still geschluckt
 * ---------------------------------------------------------------------------
 *   HAP/ProRes-Lieferdateien, Conform, Proxies, QC, ffmpeg installieren.
 *   Diese Funktionen brauchen die Desktop-Fassung. MP4-Wandexport laeuft
 *   separat in export/browserMp4.js mit WebCodecs auf dem eigenen Rechner.
 *
 *   Diese Vorgaenge werfen einen Fehler mit name === 'NichtVerfuegbar' und
 *   err.nichtVerfuegbar === true, damit die Oberflaeche sie erkennen und
 *   anders darstellen kann als einen echten Fehlschlag.
 *
 * ---------------------------------------------------------------------------
 * WO DIE DATEN LIEGEN
 * ---------------------------------------------------------------------------
 *   Vorlagen-Venues   ./config/venues/index.json + die dort genannten Dateien
 *                     (statisch ausgeliefert, schreibgeschuetzt)
 *   Eigene Venues     localStorage  "tbg.venues"   (Array von Venues)
 *   Projekt           localStorage  "tbg.project"
 *   Medien            File-Objekte im Speicher, Ordner-Handles in IndexedDB
 *
 * ---------------------------------------------------------------------------
 * DIE BRUECKE ZUR DESKTOP-FASSUNG
 * ---------------------------------------------------------------------------
 *   Im Browser planen -> saveProject() laedt die Projektdatei (.tbg.json)
 *   herunter -> in der Desktop-Fassung oeffnen -> dort rendern. Das Modell in
 *   shared/model.js ist auf beiden Seiten dasselbe, die Datei passt also ohne
 *   Umweg.
 *
 * ---------------------------------------------------------------------------
 * ZIELBROWSER
 * ---------------------------------------------------------------------------
 *   Chrome und Edge. Firefox und Safari haben keine File System Access API;
 *   scanLibrary/addMedia sagen das im Klartext, statt still zu scheitern.
 *   getHealth() meldet unter browser:{ fsAccess, opfs }, was da ist.
 */

import { t, register } from './i18n.js';
import {
  makeId, makeMedia, makeProject, validateProject as validateProjectModel,
  SCHEMA_VERSION,
} from '/shared/model.js';

register('en', {
  'Projekt konnte nicht gespeichert werden': 'The project could not be saved',
  'Projektdatei ist unvollständig oder beschädigt.': 'The project file is incomplete or damaged.',
  'Mediendatei erneut auswählen': 'Select the media file again',
  'Nach dem Neuladen die ursprünglichen Dateien oder denselben Medienordner erneut auswählen. Die Slot-Zuordnung bleibt erhalten.':
    'After reloading, select the original files or the same media folder again. Slot assignments are preserved.',
  'Es wurde kein Venue übergeben.': 'No venue was passed in.',
  'Ohne Kennung kann kein Venue geladen werden.': 'A venue cannot be loaded without an id.',
  'Ohne Kennung kann kein Venue gespeichert werden.': 'A venue cannot be saved without an id.',
  'Ohne Kennung kann kein Venue gelöscht werden.': 'A venue cannot be deleted without an id.',
  'Ohne Kennung kann kein Venue dupliziert werden.': 'A venue cannot be duplicated without an id.',
  'Die Ordnerauswahl (File System Access API) gibt es in diesem Browser nicht. Bitte Chrome oder Edge benutzen — Firefox und Safari können keine Ordner lesen.':
    'This browser has no directory picker (File System Access API). Please use Chrome or Edge — Firefox and Safari cannot read folders.',
  'Die Dateiauswahl (File System Access API) gibt es in diesem Browser nicht. Bitte Chrome oder Edge benutzen.':
    'This browser has no file picker (File System Access API). Please use Chrome or Edge.',
  'In der Browser-Fassung gibt es kein Arbeitsverzeichnis. Alles liegt im Browser: Projekt und eigene Venues im lokalen Speicher, Mediendateien nur solange die Seite offen ist. Zum Ausliefern das Projekt herunterladen und in der Desktop-Fassung öffnen.':
    'The browser edition has no workspace folder. Everything lives in the browser: project and custom venues in local storage, media files only while the page is open. To deliver, download the project and open it in the desktop edition.',
  'Ein Arbeitsverzeichnis gibt es in der Browser-Fassung nicht.':
    'A workspace folder does not exist in the browser edition.',
  'Einen Dateisystem-Browser gibt es in der Browser-Fassung nicht. Material wird über „Ordner einlesen" ausgewählt — dort öffnet sich der Ordnerdialog des Browsers.':
    'The browser edition has no file system browser. Footage is chosen via "Scan folder", which opens the browser\'s own directory dialog.',
  'Es ist kein Projekt gespeichert.': 'No project is stored.',
  'Es wurde kein Projekt übergeben.': 'No project was passed in.',
  'Das ist keine Projektdatei von Theater-Bild-Gelöte (Feld „schema" fehlt).':
    'This is not a Theater-Bild-Gelöte project file (field "schema" is missing).',
  'Bildrate im Browser nicht ermittelbar': 'Frame rate cannot be determined in the browser',
  'Der Browser kann dieses Format nicht abspielen — Vorschau bleibt schwarz. Für HAP und ProRes die Desktop-Fassung benutzen.':
    'The browser cannot play this format — the preview stays black. Use the desktop edition for HAP and ProRes.',
  'Proxies gibt es in der Browser-Fassung nicht — es wird direkt aus der Originaldatei abgespielt.':
    'The browser edition has no proxies — playback comes straight from the original file.',
});

/**
 * Fassungsnummer. Das Bauskript darf die Zeile ersetzen; ein Zugriff auf
 * package.json ist im Browser nicht moeglich.
 */
const VERSION = '0.2.0';

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

function fehler(msg, extra = {}) {
  const err = new Error(msg);
  Object.assign(err, extra);
  return err;
}

/**
 * Fehler fuer alles, was ffmpeg braucht. Die Oberflaeche erkennt ihn an
 * name === 'NichtVerfuegbar' bzw. err.nichtVerfuegbar.
 */
function nichtVerfuegbar(was) {
  const err = fehler(
    `${was} gibt es in der Browser-Fassung nicht. Dafür wird ffmpeg gebraucht, und das läuft nur in der `
    + 'Desktop-Fassung. Projekt herunterladen und dort weiterarbeiten.'
  );
  err.name = 'NichtVerfuegbar';
  err.nichtVerfuegbar = true;
  err.status = 501;
  return err;
}

const nichtVerfuegbarAsync = (was) => Promise.reject(nichtVerfuegbar(was));

function istText(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function zahl(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function runde(v, stellen = 3) {
  const f = 10 ** stellen;
  return Math.round(v * f) / f;
}

function klone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

/* ==========================================================================
 * localStorage — nie still scheitern
 * ========================================================================== */

const LS_VENUES = 'tbg.venues';
const LS_PROJECT = 'tbg.project';

function lsLesen(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[tbg-browser] ${key} ist unlesbar und wird ignoriert:`, e);
    return fallback;
  }
}

function lsSchreiben(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Quota voll oder Speicher gesperrt (privates Fenster). Das MUSS oben
    // ankommen, sonst glaubt der Nutzer, sein Projekt sei gesichert.
    throw fehler(
      `Der lokale Speicher des Browsers nimmt die Daten nicht an: ${e.message}. `
      + 'Projekt über „Speichern" als Datei sichern.',
      { cause: e }
    );
  }
}

/* ==========================================================================
 * Faehigkeiten des Browsers
 * ========================================================================== */

function hatFsAccess() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

function hatVerzeichnisAuswahl() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function hatOpfs() {
  return !!(navigator.storage && typeof navigator.storage.getDirectory === 'function');
}

/* ==========================================================================
 * Jobs — dieselbe Form wie server/jobs.js, nur im Fenster
 * ========================================================================== */

const MAX_LOG_LINES = 2000;
const KEEP_JOBS = 200;

const jobOrder = [];
const jobById = new Map();
const jobMeta = new Map();          // id -> { abbruch: boolean }
const jobHoerer = new Set();        // Rueckrufe von connectJobStream

function jobSenden(nachricht) {
  for (const fn of [...jobHoerer]) {
    try { fn(nachricht); } catch (e) { console.error('[tbg-browser] Jobhoerer hat geworfen:', e); }
  }
}

/** Job-Objekt ohne Log — genau wie der Server es ueber SSE schickt. */
function schlank(job) {
  const { log, ...rest } = job;
  return rest;
}

function jobMelden(job) {
  jobSenden({ type: 'job', job: schlank(job) });
}

function jobAnlegen({ type = 'job', label = '' } = {}) {
  const job = {
    id: makeId('job'),
    type,
    label: label || type,
    status: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    command: null,
    log: [],
    result: null,
    error: null,
  };
  jobOrder.push(job);
  jobById.set(job.id, job);
  jobMeta.set(job.id, { abbruch: false });
  while (jobOrder.length > KEEP_JOBS) {
    const alt = jobOrder.shift();
    jobById.delete(alt.id);
    jobMeta.delete(alt.id);
  }
  jobMelden(job);
  return job;
}

function jobLog(job, zeile) {
  if (zeile == null) return;
  for (const teil of String(zeile).split(/\r?\n/)) {
    if (teil.trim() === '') continue;
    job.log.push(teil);
    if (job.log.length > MAX_LOG_LINES) job.log.splice(0, 500);
    jobSenden({ type: 'log', id: job.id, line: teil });
  }
}

function jobFortschritt(job, p) {
  job.progress = Math.max(0, Math.min(1, Number(p) || 0));
  jobMelden(job);
}

/** Arbeitsfunktion eines Jobs laufen lassen. Lehnt nie ab. */
function jobStarten(job, fn) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.progress = 0;
  jobMelden(job);

  const ctx = {
    job,
    log: (zeile) => jobLog(job, zeile),
    progress: (p) => jobFortschritt(job, p),
    setProgress: (p) => jobFortschritt(job, p),
    setResult: (v) => { job.result = v ?? null; },
    setCommand: (c) => { job.command = c == null ? null : String(c); jobMelden(job); },
    get abgebrochen() { return jobMeta.get(job.id)?.abbruch === true; },
  };

  return Promise.resolve()
    .then(() => fn(ctx))
    .then((wert) => {
      if (ctx.abgebrochen) {
        job.status = 'cancelled';
        job.error = job.error || 'Abgebrochen.';
      } else {
        if (job.result == null && wert !== undefined) job.result = wert ?? null;
        job.status = 'done';
        job.progress = 1;
      }
    })
    .catch((err) => {
      if (ctx.abgebrochen) {
        job.status = 'cancelled';
        job.error = 'Abgebrochen.';
      } else {
        job.status = 'error';
        job.error = err?.message ? String(err.message) : String(err);
        console.error(`[tbg-browser] Job ${job.type} ${job.id} fehlgeschlagen:`, err);
        jobLog(job, `FEHLER: ${job.error}`);
      }
    })
    .finally(() => {
      job.endedAt = new Date().toISOString();
      jobMelden(job);
    });
}

function jobStats() {
  const running = jobOrder.filter((j) => j.status === 'running').length;
  const queued = jobOrder.filter((j) => j.status === 'queued').length;
  return { running, queued, total: jobOrder.length, maxParallel: 1 };
}

/* ==========================================================================
 * Systemzustand
 * ========================================================================== */

/**
 * Zustand der Browser-Fassung.
 *
 * ffmpeg ist hier grundsaetzlich nicht da — alle Encoder stehen auf false,
 * damit die Oberflaeche gar nicht erst eine HAP-Auslieferung anbietet.
 * Zusaetzlich sagt browser:{ fsAccess, opfs }, ob dieser Browser Ordner und
 * Dateien lesen kann. Firefox und Safari koennen es nicht.
 */
export function getHealth() {
  return Promise.resolve({
    ok: true,
    mode: 'browser',
    version: VERSION,
    platform: {
      os: 'browser',
      label: 'Browser',
      release: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
      arch: '',
      node: '',
      homedir: '',
    },
    workspace: null,
    browser: {
      fsAccess: hatFsAccess() && hatVerzeichnisAuswahl(),
      opfs: hatOpfs(),
    },
    ffmpeg: {
      found: false,
      path: null,
      source: 'none',
      version: null,
      encoders: { hap: false, prores_ks: false, mpeg2video: false, libx264: false },
    },
    ffprobe: { found: false, path: null, source: 'none' },
    paths: {
      root: null,
      workspace: null,
      projects: null,
      venues: null,
      builtinVenues: null,
      cache: null,
      proxies: null,
      thumbs: null,
      out: null,
      bin: null,
      project: null,
    },
    jobs: jobStats(),
    hint: 'Diese Fassung läuft komplett im Browser und ist zum Planen und Zeigen da. '
      + 'Rendern, Conform, Proxies und QC brauchen ffmpeg und bleiben der Desktop-Fassung vorbehalten.',
  });
}

/** Es gibt nichts zu installieren — hier laeuft kein ffmpeg. */
export function installFfmpeg() {
  return nichtVerfuegbarAsync('Das Nachinstallieren von ffmpeg');
}

/* ==========================================================================
 * Venues — Vorlagen aus ./config/venues/, eigene im localStorage
 * ========================================================================== */

/**
 * Basisadresse der mitgelieferten Venues.
 *
 * GitHub Pages liefert unter einem Unterpfad aus (https://name.github.io/repo/).
 * Absolute Pfade wie "/config/venues/" zeigen dort ins Leere. Deshalb wird
 * zuerst relativ zu DIESER Datei gesucht (client/src -> Wurzel) und, falls das
 * nichts liefert, relativ zur Seite selbst.
 */
const VENUE_BASEN = [
  new URL('../config/venues/', import.meta.url).href,
  new URL('./config/venues/', document.baseURI).href,
];

let venueBasis = null;         // die Basis, die funktioniert hat
let vorlagenCache = null;      // Map id -> Venue
let vorlagenWarnungen = [];

async function holeJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw fehler(`${url} — HTTP ${res.status}`);
  return res.json();
}

/** index.json einlesen. Form: { "venues": ["a.json", "b.json"] } */
async function ladeVorlagenIndex() {
  const fehlerTexte = [];
  for (const basis of venueBasis ? [venueBasis] : VENUE_BASEN) {
    try {
      const daten = await holeJson(`${basis}index.json`);
      venueBasis = basis;
      const liste = Array.isArray(daten?.venues) ? daten.venues : [];
      return liste.filter((n) => typeof n === 'string');
    } catch (e) {
      fehlerTexte.push(e.message);
    }
  }
  vorlagenWarnungen.push(
    `Die Liste der mitgelieferten Venues (config/venues/index.json) wurde nicht gefunden: ${fehlerTexte.join(' · ')}`
  );
  return [];
}

/**
 * Vorlagen laden. Beide Dateiformen werden gelesen:
 *   - die Datei IST ein Venue          (mein-schiff-theater.json)
 *   - die Datei enthaelt { venues: [] } (weitere-venues.json)
 */
async function ladeVorlagen() {
  if (vorlagenCache) return vorlagenCache;
  const map = new Map();
  vorlagenWarnungen = [];

  const dateien = await ladeVorlagenIndex();
  for (const datei of dateien) {
    let daten;
    try {
      daten = await holeJson(`${venueBasis}${datei}`);
    } catch (e) {
      vorlagenWarnungen.push(`${datei} konnte nicht geladen werden: ${e.message}`);
      continue;
    }
    const eintraege = Array.isArray(daten?.venues) ? daten.venues
      : Array.isArray(daten) ? daten
        : [daten];
    for (const v of eintraege) {
      if (!v || typeof v !== 'object' || !istText(v.id)) {
        vorlagenWarnungen.push(`${datei} enthält einen Eintrag ohne id — übersprungen.`);
        continue;
      }
      map.set(v.id, { ...klone(v), _builtin: true, _path: `config/venues/${datei}` });
    }
  }

  vorlagenCache = map;
  for (const w of vorlagenWarnungen) console.warn(`[tbg-browser] ${w}`);
  return map;
}

/** Eigene Venues aus dem localStorage. */
function eigeneVenues() {
  const roh = lsLesen(LS_VENUES, []);
  const liste = Array.isArray(roh) ? roh : (Array.isArray(roh?.venues) ? roh.venues : []);
  return liste.filter((v) => v && typeof v === 'object' && istText(v.id));
}

function eigeneVenuesSchreiben(liste) {
  lsSchreiben(LS_VENUES, liste);
}

/** Alle Venues. Eigene gewinnen bei gleicher id gegen die Vorlage. */
async function alleVenues() {
  const map = new Map();
  for (const [id, v] of await ladeVorlagen()) map.set(id, v);
  for (const v of eigeneVenues()) {
    map.set(v.id, { ...klone(v), _builtin: false, _path: `localStorage:${LS_VENUES}` });
  }
  return map;
}

/** Kurzliste: [{ id, name, wallCount, builtin, path }] — eigene zuerst. */
export async function listVenues() {
  const map = await alleVenues();
  return [...map.values()]
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

/** Alter Name derselben Abfrage — bleibt, damit nichts bricht. */
export const getVenues = listVenues;

export async function getVenue(id) {
  if (!id) throw fehler(t('Ohne Kennung kann kein Venue geladen werden.'));
  const map = await alleVenues();
  const v = map.get(id);
  if (!v) {
    const bekannt = [...map.keys()].join(', ') || '(keine)';
    throw fehler(`Venue „${id}" ist unbekannt.`, { status: 404, detail: `Vorhanden: ${bekannt}` });
  }
  return klone(v);
}

function vorlagenSchutz(venue, id) {
  const err = fehler(
    `„${venue.name || id}" ist eine mitgelieferte Vorlage und ist schreibgeschützt.`,
    {
      status: 403,
      detail: 'Vorlagen werden mit der Anwendung ausgeliefert und liegen nicht im Browser. '
        + 'Erst duplizieren (duplicateVenue), dann die Kopie bearbeiten.',
    }
  );
  return err;
}

/** Prueflauf, der auch beim Speichern gilt: Fehler verhindern das Schreiben. */
function pruefenOderWerfen(venue) {
  const probleme = pruefeVenue(venue);
  const fehlerListe = probleme.filter((p) => p.level === 'error');
  if (fehlerListe.length > 0) {
    const err = fehler(
      `Das Venue hat ${fehlerListe.length} Fehler und wurde nicht gespeichert.`,
      {
        status: 400,
        detail: fehlerListe.map((p) => `${p.where}: ${p.msg}`).join('\n'),
      }
    );
    err.problems = probleme;
    throw err;
  }
}

export async function createVenue(venue) {
  if (!venue) throw fehler(t('Es wurde kein Venue übergeben.'));
  const map = await alleVenues();
  const vorhanden = map.get(venue.id);
  if (vorhanden && vorhanden._builtin) throw vorlagenSchutz(vorhanden, venue.id);
  pruefenOderWerfen(venue);

  const rein = klone(venue);
  delete rein._builtin;
  delete rein._path;
  const liste = eigeneVenues().filter((v) => v.id !== rein.id);
  liste.push(rein);
  eigeneVenuesSchreiben(liste);
  return getVenue(rein.id);
}

export async function updateVenue(id, venue) {
  if (!id) throw fehler(t('Ohne Kennung kann kein Venue gespeichert werden.'));
  if (!venue) throw fehler(t('Es wurde kein Venue übergeben.'));
  if (venue.id !== undefined && venue.id !== id) {
    throw fehler(
      `Die ID im Venue („${venue.id}") passt nicht zur angefragten ID („${id}").`,
      { status: 400, detail: 'Eine ID lässt sich nicht nachträglich ändern. Dafür das Venue duplizieren und das alte löschen.' }
    );
  }
  const map = await alleVenues();
  const vorhanden = map.get(id);
  if (vorhanden && vorhanden._builtin) throw vorlagenSchutz(vorhanden, id);
  return createVenue({ ...venue, id });
}

export async function deleteVenue(id) {
  if (!id) throw fehler(t('Ohne Kennung kann kein Venue gelöscht werden.'));
  const map = await alleVenues();
  const vorhanden = map.get(id);
  if (!vorhanden) throw fehler(`Venue „${id}" ist unbekannt.`, { status: 404 });
  if (vorhanden._builtin) throw vorlagenSchutz(vorhanden, id);
  eigeneVenuesSchreiben(eigeneVenues().filter((v) => v.id !== id));
  return { ok: true, id, path: null };
}

/**
 * Venue kopieren. Die Kopie landet immer bei den eigenen Venues — genau so
 * macht man aus einer schreibgeschuetzten Vorlage ein eigenes Haus.
 */
export async function duplicateVenue(id, next) {
  if (!id) throw fehler(t('Ohne Kennung kann kein Venue dupliziert werden.'));
  const quelle = await getVenue(id);
  const wunsch = typeof next === 'string' ? { id: next } : (next || {});

  const zielId = istText(wunsch.id) ? wunsch.id.trim() : slugify(`${quelle.id}-kopie`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(zielId)) {
    throw fehler(
      `„${zielId}" ist als Venue-ID nicht erlaubt.`,
      { status: 400, detail: `Erlaubt sind Kleinbuchstaben a-z, Ziffern 0-9 und Bindestriche. Vorschlag: „${slugify(zielId)}"` }
    );
  }
  const map = await alleVenues();
  if (map.has(zielId)) {
    throw fehler(
      `Ein Venue mit der ID „${zielId}" gibt es schon.`,
      { status: 409, detail: 'Andere ID wählen oder das vorhandene Venue direkt bearbeiten.' }
    );
  }

  const kopie = klone(quelle);
  delete kopie._builtin;
  delete kopie._path;
  kopie.id = zielId;
  kopie.name = istText(wunsch.name) ? wunsch.name.trim() : `${quelle.name || quelle.id} (Kopie)`;
  return createVenue(kopie);
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'venue';
}

/**
 * Venue pruefen, ohne es zu speichern.
 * -> [{ level: 'error'|'warn'|'info', where, msg, hint }]
 *
 * Die vollstaendige Pruefung aus server/venues.js gibt es hier nicht (sie
 * haengt an node:fs). Diese Fassung prueft dieselbe Form und das Wichtige:
 * Summe der Panelbreiten, lueckenlose aufsteigende Panels, Panel-ids,
 * Vielfache von 4 und die Bildrate.
 */
export function validateVenue(venue) {
  if (!venue) return Promise.reject(fehler(t('Es wurde kein Venue übergeben.')));
  return Promise.resolve(pruefeVenue(venue));
}

function naechstesVielfachesVon4(n) {
  return Math.ceil(n / 4) * 4;
}

function pruefeVenue(venue) {
  const probleme = [];
  const add = (level, where, msg, hint) => probleme.push({ level, where, msg, hint: hint || null });

  if (!venue || typeof venue !== 'object' || Array.isArray(venue)) {
    add('error', 'venue', 'Das ist kein Venue-Objekt.',
      'Erwartet wird ein JSON-Objekt mit id, name, fps und walls.');
    return probleme;
  }

  /* --- id und name ------------------------------------------------------- */
  if (!istText(venue.id)) {
    add('error', 'id', 'Die Venue-ID fehlt.',
      'Kurze ID vergeben, z. B. „kleines-theater" — daraus wird der Dateiname in der Desktop-Fassung.');
  } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(venue.id)) {
    add('error', 'id', `Die ID „${venue.id}" enthält unerlaubte Zeichen.`,
      `Erlaubt sind Kleinbuchstaben a-z, Ziffern 0-9 und Bindestriche dazwischen. Vorschlag: „${slugify(venue.id)}"`);
  }
  if (!istText(venue.name)) {
    add('error', 'name', 'Das Venue hat keinen Namen.',
      'Der Name steht in der Auswahlliste — „Kleines Theater, Saal 1" ist besser als die ID.');
  }

  /* --- fps --------------------------------------------------------------- */
  const fps = zahl(venue.fps);
  if (fps === null || fps <= 0) {
    add('error', 'fps', `Die Bildrate ist ${venue.fps ?? 'nicht gesetzt'}.`,
      'Bildrate des Hauses eintragen, üblich sind 25, 30, 50 oder 60.');
  }

  /* --- Waende ------------------------------------------------------------ */
  const walls = Array.isArray(venue.walls) ? venue.walls : [];
  if (walls.length === 0) {
    add('error', 'walls', 'Das Venue hat keine einzige Wand.',
      'Mindestens eine Wand anlegen — ohne Wand gibt es nichts zu rendern.');
  }

  const wandIds = new Set();
  walls.forEach((wall, index) => {
    const wallId = istText(wall?.id) ? wall.id : `#${index + 1}`;
    const where = `Wand ${wallId}`;

    if (!wall || typeof wall !== 'object') {
      add('error', where, 'Der Eintrag ist keine Wand.',
        'Erwartet wird ein Objekt mit id, width, height und panels.');
      return;
    }
    if (!istText(wall.id)) {
      add('error', where, 'Die Wand hat keine id.',
        'Kurze Kennung vergeben, z. B. „A" — sie steht später im Dateinamen.');
    } else if (wandIds.has(wall.id)) {
      add('error', where, `Die Wand-ID „${wall.id}" kommt mehrfach vor.`,
        'IDs müssen im Venue eindeutig sein.');
    } else {
      wandIds.add(wall.id);
    }

    const w = zahl(wall.width);
    const h = zahl(wall.height);
    const wM = zahl(wall.widthM);
    const hM = zahl(wall.heightM);

    if (w === null || w <= 0) {
      add('error', where, `Die Wandbreite ist ${wall.width ?? 'nicht gesetzt'} px.`,
        'Breite in Pixeln eintragen — das ist die Auflösung, die der Mediaserver bekommt.');
    }
    if (h === null || h <= 0) {
      add('error', where, `Die Wandhöhe ist ${wall.height ?? 'nicht gesetzt'} px.`,
        'Höhe in Pixeln eintragen.');
    }
    if (wM === null || wM <= 0) {
      add('error', where, `Die Wandbreite in Metern ist ${wall.widthM ?? 'nicht gesetzt'}.`,
        'Ohne Metermaß gibt es keine 3D-Ansicht und keinen Pixelpitch.');
    }
    if (hM === null || hM <= 0) {
      add('error', where, `Die Wandhöhe in Metern ist ${wall.heightM ?? 'nicht gesetzt'}.`,
        'Ohne Metermaß gibt es keine 3D-Ansicht und keinen Pixelpitch.');
    }

    /* Kantenlaengen durch 4 teilbar — HAP arbeitet in 4x4-Bloecken. */
    if (w !== null && w > 0 && w % 4 !== 0) {
      add('warn', where, `Die Breite ${w} px ist kein Vielfaches von 4.`,
        `HAP verlangt Kantenlängen in Vielfachen von 4. Nächster gültiger Wert: ${naechstesVielfachesVon4(w)} px.`);
    }
    if (h !== null && h > 0 && h % 4 !== 0) {
      add('warn', where, `Die Höhe ${h} px ist kein Vielfaches von 4.`,
        `HAP verlangt Kantenlängen in Vielfachen von 4. Nächster gültiger Wert: ${naechstesVielfachesVon4(h)} px.`);
    }

    /* --- Panels ---------------------------------------------------------- */
    const panels = Array.isArray(wall.panels) ? wall.panels : [];
    if (panels.length === 0) {
      add('error', where, 'Die Wand hat keine Panels.',
        'Ist die Wand nicht geteilt, ein einziges Panel über die volle Breite anlegen.');
      return;
    }

    let summe = 0;
    let erwartetX = 0;
    const panelIds = new Set();

    panels.forEach((p, pi) => {
      const pid = istText(p?.id) ? p.id : `#${pi + 1}`;
      const pWhere = `${where} / Panel ${pid}`;

      // Die Panel-id wird zum DATEINAMEN der Einzelausgabe. Fehlt sie oder
      // kommt sie zweimal vor, ueberschreiben sich zwei Panels gegenseitig.
      if (!istText(p?.id)) {
        add('error', pWhere, 'Dem Panel fehlt die id.',
          'Die id wird zum Dateinamen der Einzelausgabe, z. B. D1. Ohne sie kann nicht ausgeliefert werden.');
      } else if (panelIds.has(p.id)) {
        add('error', pWhere, `Die Panel-id „${p.id}" kommt mehrfach vor.`,
          'Zwei Panels mit derselben id schreiben in dieselbe Datei — die zweite überschreibt die erste.');
      } else {
        panelIds.add(p.id);
        if (!/^[A-Za-z0-9_-]+$/.test(p.id)) {
          add('warn', pWhere, `Die Panel-id „${p.id}" enthält Sonderzeichen.`,
            'Sie wird Teil des Dateinamens. Nur Buchstaben, Ziffern, Bindestrich und Unterstrich sind überall sicher.');
        }
      }

      const pw = zahl(p?.width);
      if (pw === null || pw <= 0) {
        add('error', pWhere, `Die Panelbreite ist ${p?.width ?? 'nicht gesetzt'} px.`,
          'Breite des einzelnen Panels in Pixeln eintragen.');
        return;
      }
      if (pw % 4 !== 0) {
        add('warn', pWhere, `Die Panelbreite ${pw} px ist kein Vielfaches von 4.`,
          `HAP verlangt Kantenlängen in Vielfachen von 4. Nächster gültiger Wert: ${naechstesVielfachesVon4(pw)} px.`);
      }

      const px = zahl(p?.x);
      if (px === null) {
        add('error', pWhere, 'Das Panel hat keinen x-Wert.',
          `Panels liegen lückenlos nebeneinander — hier wäre x=${erwartetX}.`);
      } else if (px !== erwartetX) {
        const luecke = px - erwartetX;
        add('error', pWhere,
          `Das Panel beginnt bei x=${px}, lückenlos wäre x=${erwartetX} `
          + `(${luecke > 0 ? `Lücke von ${luecke} px` : `Überlappung von ${-luecke} px`}).`,
          'Panels müssen aufsteigend und ohne Lücke aneinanderstoßen, sonst sitzt der Ausschnitt falsch.');
      }
      erwartetX += pw;
      summe += pw;
    });

    if (w !== null && w > 0 && summe !== w) {
      const diff = w - summe;
      add('error', where,
        `Summe der Panelbreiten ist ${summe} px, die Wand ist ${w} px breit `
        + `(Differenz ${diff} px — es ${diff > 0 ? `fehlen ${diff}` : `sind ${-diff} zu viel`} px).`,
        'Panelbreiten oder Wandbreite korrigieren. Solange das nicht stimmt, schneidet der Panel-Export falsch.');
    }

    /* --- centerSeamX ----------------------------------------------------- */
    if (wall.centerSeamX !== undefined && wall.centerSeamX !== null) {
      const seam = zahl(wall.centerSeamX);
      if (seam === null) {
        add('error', where, `centerSeamX ist „${wall.centerSeamX}" und damit keine Zahl.`,
          'centerSeamX ist die x-Position der Mittelnaht in Pixeln.');
      } else if (w !== null && w > 0 && (seam < 0 || seam > w)) {
        add('error', where, `centerSeamX liegt bei ${seam} px, die Wand geht aber nur von 0 bis ${w} px.`,
          'Mittelnaht innerhalb der Wand setzen, üblich auf der Panelgrenze in der Mitte.');
      }
    }
  });

  /* --- delivery ---------------------------------------------------------- */
  const presets = venue?.delivery?.presets;
  if (!Array.isArray(presets) || presets.length === 0) {
    add('warn', 'delivery', 'Das Venue hat keine Delivery-Presets.',
      'In der Browser-Fassung wird nicht gerendert — für die Desktop-Fassung braucht es mindestens ein Preset.');
  }

  return probleme;
}

/* ==========================================================================
 * Venue-Geruest
 * ========================================================================== */

/** Breite gleichmaessig auf n Panels aufteilen, moeglichst in Vielfachen von 4. */
function breiteAufteilen(total, n) {
  const anzahl = Math.max(1, Math.floor(n));
  const breite = Math.max(1, Math.floor(total));
  const je = Math.max(4, Math.floor(breite / anzahl / 4) * 4);
  const out = new Array(anzahl).fill(je);
  let rest = breite - je * anzahl;
  let i = 0;
  while (rest >= 4) { out[i % anzahl] += 4; rest -= 4; i += 1; }
  if (rest !== 0) out[anzahl - 1] += rest;
  const summe = out.reduce((a, b) => a + b, 0);
  if (summe !== breite) out[anzahl - 1] += breite - summe;
  return out;
}

function wandBuchstabe(i) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (i < letters.length) return letters[i];
  return `${letters[i % letters.length]}${Math.floor(i / letters.length) + 1}`;
}

function standardDelivery() {
  return {
    namePattern: '{WALL}_{W}x{H}_{FPS}p_{CODEC}',
    presets: [
      {
        id: 'hap_q',
        label: 'HAP Q — Standard für LED-Mediaserver',
        ext: 'mov',
        codecTag: 'HAP',
        args: ['-c:v', 'hap', '-format', 'hap_q', '-chunks', '4', '-an'],
        bytesPerPixel: 1,
        alpha: false,
      },
      {
        id: 'hap_alpha',
        label: 'HAP Alpha — mit Transparenz',
        ext: 'mov',
        codecTag: 'HAPAlpha',
        args: ['-c:v', 'hap', '-format', 'hap_alpha', '-chunks', '4', '-an'],
        bytesPerPixel: 1.0,
        alpha: true,
      },
      {
        id: 'prores422',
        label: 'ProRes 422 — Archiv und Austausch',
        ext: 'mov',
        codecTag: 'ProRes422',
        args: ['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-an'],
        bytesPerPixel: 0.62,
        alpha: false,
      },
      {
        id: 'h264_review',
        label: 'H.264 — Ansichtsexemplar / Freigabe',
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
 * Geruest fuer ein neues Venue rechnen — es speichert nichts.
 * Erkannte Parameter: { walls, panels, width, height, fps, pixelPitchMm, id, name }
 */
export async function venueTemplate(params) {
  const o = params || {};
  const wandZahl = Math.max(1, Math.min(12, Math.floor(zahl(o.walls) ?? 1)));
  const panelZahl = Math.max(1, Math.min(32, Math.floor(zahl(o.panels) ?? 4)));
  const width = Math.max(16, Math.min(32768, Math.floor(zahl(o.width) ?? 1920)));
  const height = Math.max(16, Math.min(32768, Math.floor(zahl(o.height) ?? 1080)));
  const fps = Math.max(1, Math.min(240, zahl(o.fps) ?? 30));
  const pitchMm = Math.max(0.1, Math.min(100, zahl(o.pixelPitchMm) ?? 4));
  const wandAbstandM = 3.0;

  const widthM = runde((width * pitchMm) / 1000, 3);
  const heightM = runde((height * pitchMm) / 1000, 3);

  const walls = [];
  for (let i = 0; i < wandZahl; i += 1) {
    const wallId = wandBuchstabe(i);
    const breiten = breiteAufteilen(width, panelZahl);
    const panels = [];
    let x = 0;
    for (let p = 0; p < breiten.length; p += 1) {
      panels.push({ id: `${wallId}${p + 1}`, x, width: breiten[p] });
      x += breiten[p];
    }
    // Mittelnaht auf die Panelgrenze legen, die der Wandmitte am naechsten ist.
    const grenzen = [0];
    for (const b of breiten) grenzen.push(grenzen[grenzen.length - 1] + b);
    const mitte = width / 2;
    const centerSeamX = grenzen.reduce((a, b) => (Math.abs(b - mitte) < Math.abs(a - mitte) ? b : a), 0);

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
      stage: { z: runde(i * wandAbstandM, 2), floorOffsetM: 0, travelMaxM: runde(widthM / 2, 2), verified: false },
    });
  }

  const tiefeM = runde((wandZahl - 1) * wandAbstandM, 2);
  const mitteZ = runde(tiefeM / 2, 2);
  const augeM = 1.2;
  const hintenM = runde(-(widthM * 1.2 + 2), 2);
  const vornM = runde(-(widthM * 0.5 + 2), 2);
  const ziel = [0, runde(heightM / 2, 2), mitteZ];

  // Freie ID suchen, damit das Geruest nicht ueber ein vorhandenes Venue faellt.
  const vorhanden = await alleVenues();
  const wunsch = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(o.id || '')) ? String(o.id) : 'neues-venue';
  let id = wunsch;
  for (let i = 2; vorhanden.has(id) && i < 1000; i += 1) id = `${wunsch}-${i}`;

  return {
    id,
    name: istText(o.name) ? String(o.name).trim() : 'Neues Venue',
    fps,
    pixelPitchMm: pitchMm,
    walls,
    camera: {
      presets: [
        { id: 'audience', label: 'Zuschauer Mitte', pos: [0, augeM, hintenM], target: ziel, fov: 40 },
        { id: 'frontrow', label: 'Erste Reihe', pos: [0, augeM, vornM], target: ziel, fov: 55 },
        {
          id: 'balcony',
          label: 'Rang',
          pos: [0, runde(heightM * 1.2, 2), runde(hintenM - widthM * 0.4, 2)],
          target: ziel,
          fov: 35,
        },
        {
          id: 'sideleft',
          label: 'Seitenplatz links',
          pos: [runde(-widthM * 0.8, 2), runde(augeM + 0.4, 2), runde(vornM - 2, 2)],
          target: ziel,
          fov: 45,
        },
        { id: 'plan', label: 'Draufsicht / Plan', pos: [0, runde(widthM * 2, 2), mitteZ], target: [0, 0, mitteZ], fov: 40 },
        {
          id: 'iso',
          label: 'Isometrisch',
          pos: [runde(-widthM, 2), runde(heightM * 1.4, 2), runde(hintenM * 0.8, 2)],
          target: ziel,
          fov: 40,
        },
      ],
      default: 'audience',
    },
    delivery: standardDelivery(),
    assumptions: [
      `Metermaße aus ${pitchMm} mm Pixelpitch gerechnet — echte Maße nachtragen.`,
      `Abstand der Wände zueinander mit ${wandAbstandM} m angenommen.`,
      'Panelaufteilung gleichmäßig angenommen — echte Panelbreiten eintragen.',
    ],
  };
}

/* ==========================================================================
 * Arbeitsverzeichnis — gibt es hier nicht
 * ========================================================================== */

export function getWorkspace() {
  return Promise.resolve({
    workspace: null,
    mode: 'browser',
    source: 'browser',
    projects: null,
    venues: `localStorage:${LS_VENUES}`,
    builtinVenues: venueBasis || VENUE_BASEN[0],
    cache: null,
    proxies: null,
    thumbs: null,
    out: null,
    bin: null,
    root: null,
    platform: { os: 'browser', label: 'Browser' },
    freeBytes: null,
    note: t('In der Browser-Fassung gibt es kein Arbeitsverzeichnis. Alles liegt im Browser: Projekt und eigene Venues im lokalen Speicher, Mediendateien nur solange die Seite offen ist. Zum Ausliefern das Projekt herunterladen und in der Desktop-Fassung öffnen.'),
  });
}

export function setWorkspace() {
  return Promise.reject(fehler(
    t('Ein Arbeitsverzeichnis gibt es in der Browser-Fassung nicht.'),
    {
      status: 501,
      detail: 'Der Browser darf nicht frei ins Dateisystem schreiben. Projekt über „Speichern" '
        + 'herunterladen und in der Desktop-Fassung weiterarbeiten.',
    }
  ));
}

/** Es gibt genau ein Projekt im lokalen Speicher — oder keins. */
export function listProjects() {
  const p = lsLesen(LS_PROJECT, null);
  if (!p || typeof p !== 'object') return Promise.resolve([]);
  return Promise.resolve([{
    name: p.name || 'Unbenannt',
    path: `localStorage:${LS_PROJECT}`,
    venueId: p.venueId || null,
    modifiedAt: p.modifiedAt || null,
  }]);
}

/* ==========================================================================
 * Projekt
 * ========================================================================== */

export function getProject() {
  const p = lsLesen(LS_PROJECT, null);
  if (!p || typeof p !== 'object') {
    // Genau wie beim Server ein Fehlschlag: main.js legt daraufhin ein neues an.
    return Promise.reject(fehler(t('Es ist kein Projekt gespeichert.'), { status: 404 }));
  }
  // Blob URLs cannot survive a page reload. Report the actual availability,
  // instead of displaying the persisted green "ready" flag for missing files.
  if (Array.isArray(p.media)) p.media = p.media.map((media) => ({
    ...media,
    proxy: { ...media.proxy, path: null, ready: blobUrls.has(media.id) && media.proxy?.ready !== false },
    thumb: { ...media.thumb, path: null, ready: thumbUrls.has(media.id) },
  }));
  return Promise.resolve(p);
}

export function putProject(project) {
  if (!project || typeof project !== 'object') {
    return Promise.reject(fehler(t('Es wurde kein Projekt übergeben.')));
  }
  const modifiedAt = new Date().toISOString();
  try {
    const stored = klone({ ...project, modifiedAt });
    // Persist metadata, never a session-specific blob URL masquerading as a
    // portable path. Original desktop paths remain available for relinking.
    for (const media of stored.media || []) {
      for (const artifact of [media.proxy, media.thumb]) {
        if (typeof artifact?.path === 'string' && artifact.path.startsWith('blob:')) artifact.path = null;
      }
    }
    lsSchreiben(LS_PROJECT, stored);
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.resolve({ ok: true, modifiedAt });
}

export async function newProject(venueId, name) {
  const venue = await getVenue(venueId);
  const project = makeProject(venue, name ? { name } : {});
  const { modifiedAt } = await putProject(project);
  // Genau das zurueckgeben, was auch im Speicher liegt — sonst laufen
  // Oberflaeche und Ablage mit zwei verschiedenen Zeitstempeln.
  return { ...project, modifiedAt };
}

/**
 * Rueckfallebene fuer Browser ohne File System Access API: ein verstecktes
 * <input type="file">. Liefert die Datei oder null, wenn nichts gewaehlt wurde.
 *
 * Der Abbruch wird doppelt abgesichert — ueber das 'cancel'-Ereignis (Chrome)
 * und ueber die Rueckkehr des Fensterfokus. Ohne das zweite wuerde das
 * Versprechen bei einem abgebrochenen Dialog fuer immer haengen bleiben.
 */
function dateiUeberInput(accept) {
  return new Promise((fertig) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    let erledigt = false;
    const schluss = (datei) => {
      if (erledigt) return;
      erledigt = true;
      window.removeEventListener('focus', beiFokus);
      input.remove();
      fertig(datei || null);
    };
    const gewaehlt = () => (input.files && input.files[0]) || null;
    function beiFokus() {
      // Der Dialog ist zu. Die Auswahl steht erst kurz danach im Element.
      setTimeout(() => schluss(gewaehlt()), 500);
    }

    input.addEventListener('change', () => schluss(gewaehlt()), { once: true });
    input.addEventListener('cancel', () => schluss(null), { once: true });
    window.addEventListener('focus', beiFokus);
    input.click();
  });
}

/**
 * Projektdatei oeffnen.
 *
 * DAS IST DIE BRUECKE ZUR DESKTOP-FASSUNG — in beide Richtungen: eine am
 * Desktop gespeicherte .tbg.json laesst sich hier oeffnen und weiterplanen,
 * und was hier gespeichert wird, rendert die Desktop-Fassung. Das Modell in
 * shared/model.js ist auf beiden Seiten dasselbe, deshalb passt die Datei
 * ohne jede Umwandlung.
 *
 * Der Parameter `path` aus der Desktop-Fassung wird ignoriert: Pfade gibt es
 * im Browser nicht, die Datei waehlt der Nutzer im Dialog.
 */
export async function openProject(path) {
  if (path === `localStorage:${LS_PROJECT}`) return getProject();
  let datei = null;

  if (hatFsAccess()) {
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        multiple: false,
        types: [{
          description: 'Theater-Bild-Gelöte Projekt',
          accept: { 'application/json': ['.json', '.tbg.json'] },
        }],
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw fehler('Es wurde keine Datei ausgewählt.', { abgebrochen: true });
      throw e;
    }
    datei = await handles[0].getFile();
  } else {
    datei = await dateiUeberInput('.json,.tbg.json,application/json');
    if (!datei) throw fehler('Es wurde keine Datei ausgewählt.', { abgebrochen: true });
  }

  let daten;
  try {
    daten = JSON.parse(await datei.text());
  } catch (e) {
    throw fehler(`„${datei.name}" ist kein lesbares JSON: ${e.message}`, { cause: e });
  }

  if (!daten || typeof daten !== 'object' || !istText(daten.schema)) {
    throw fehler(t('Das ist keine Projektdatei von Theater-Bild-Gelöte (Feld „schema" fehlt).'), {
      detail: `Erwartet wird ein Projekt mit schema „${SCHEMA_VERSION}".`,
    });
  }
  if (!String(daten.schema).startsWith('Theater-Bild-Gel')) {
    throw fehler(`Unbekanntes Schema „${daten.schema}".`, {
      detail: `Diese Fassung liest Projekte mit dem Schema „${SCHEMA_VERSION}".`,
    });
  }
  // Abweichende VERSION ist kein Abbruch — validateProject() meldet das als Hinweis.

  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  if (!istText(daten.venueId) || !Array.isArray(daten.media) || !object(daten.walls) ||
      !Number.isFinite(daten.fps) || daten.fps <= 0 ||
      !Number.isFinite(daten.loopSeconds) || daten.loopSeconds <= 0 ||
      daten.media.some((media) => !object(media) || !istText(media.id)) ||
      Object.values(daten.walls).some((wall) => !object(wall?.slots) ||
        Object.values(wall.slots).some((slot) => !Array.isArray(slot?.layers) ||
          slot.layers.some((layer) => !object(layer) || !istText(layer.id))))) {
    throw fehler(t('Projektdatei ist unvollständig oder beschädigt.'));
  }
  // Validate the dependency before replacing the saved project. A missing
  // custom venue must not strand the user in an unusable imported project.
  await getVenue(daten.venueId);

  await putProject(daten);
  return getProject();
}

/**
 * Projekt als Datei sichern (.tbg.json).
 *
 * DAS IST DIE BRUECKE ZUR DESKTOP-FASSUNG: im Browser planen, die
 * Projektdatei herunterladen, am Desktop rendern. Ohne diesen Schritt bleibt
 * die Arbeit im lokalen Speicher dieses einen Browsers liegen.
 */
export async function saveProject(/* path */) {
  const { isDirty, flushSave } = await import('./store.js');
  if (isDirty() && !(await flushSave())) throw fehler(t('Projekt konnte nicht gespeichert werden'));
  const project = await getProject();
  const inhalt = `${JSON.stringify(project, null, 2)}\n`;
  const name = `${(project.name || 'projekt').replace(/[^\w\-. ]+/g, '_').trim() || 'projekt'}.tbg.json`;

  if (typeof window.showSaveFilePicker === 'function') {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Theater-Bild-Gelöte Projekt', accept: { 'application/json': ['.tbg.json'] } }],
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw fehler('Es wurde nichts gespeichert.', { abgebrochen: true });
      throw e;
    }
    const strom = await handle.createWritable();
    await strom.write(inhalt);
    await strom.close();
    return { ok: true, path: handle.name };
  }

  // Rueckfallebene: Download ausloesen. Wohin die Datei geht, entscheidet der
  // Browser — der Pfad ist uns deshalb nicht bekannt.
  const url = URL.createObjectURL(new Blob([inhalt], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { ok: true, path: name };
}

export async function validateProject() {
  const project = await getProject();
  const venue = await getVenue(project.venueId);
  const issues = validateProjectModel(project, venue);
  for (const media of project.media || []) {
    if (!blobUrls.has(media.id)) issues.push({
      level: 'warn', where: media.name || media.id,
      msg: t('Mediendatei erneut auswählen'),
      hint: t('Nach dem Neuladen die ursprünglichen Dateien oder denselben Medienordner erneut auswählen. Die Slot-Zuordnung bleibt erhalten.'),
    });
  }
  return issues;
}

/* ==========================================================================
 * Medien — Dateien statt Pfade
 * ========================================================================== */

const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'mov']);
const BILD_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif']);

/** File-Objekte der Bibliothek. Sie leben nur, solange die Seite offen ist. */
const dateien = new Map();      // mediaId -> File

/** Only explicitly selected local files can be used by the browser exporter. */
export function getBrowserMediaFile(id) { return dateien.get(id) || null; }

const blobUrls = new Map();     // mediaId -> blob:-URL (einmal erzeugt, gemerkt)
const thumbUrls = new Map();    // mediaId -> DataURL
const thumbLaeuft = new Set();  // mediaId, deren Standbild gerade entsteht
const thumbHinueber = new Set();// mediaId, bei denen kein Standbild moeglich ist

function endung(name) {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function artFuer(name) {
  const e = endung(name);
  if (VIDEO_EXT.has(e)) return 'video';
  if (BILD_EXT.has(e)) return 'image';
  return null;
}

/* --- Bildratenmessung ----------------------------------------------------- */

const GAENGIGE_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

/** Gemessene Rate auf eine gaengige runden — aber nur, wenn sie nahe genug liegt. */
function fpsRunden(roh) {
  if (!(roh > 0)) return 0;
  let best = GAENGIGE_FPS[0];
  let abstand = Infinity;
  for (const c of GAENGIGE_FPS) {
    const d = Math.abs(c - roh);
    if (d < abstand) { abstand = d; best = c; }
  }
  return abstand <= Math.max(0.2, best * 0.02) ? best : runde(roh, 3);
}

function fpsExakt(fps) {
  if (Math.abs(fps - 23.976) < 0.01) return '24000/1001';
  if (Math.abs(fps - 29.97) < 0.01) return '30000/1001';
  if (Math.abs(fps - 59.94) < 0.01) return '60000/1001';
  return `${fps}/1`;
}

/**
 * Bildrate ueber requestVideoFrameCallback messen (rund 10 Frames).
 * Gibt es die Funktion nicht, kommt null zurueck — dann wird NICHT geraten.
 */
function messeFps(video) {
  if (typeof video.requestVideoFrameCallback !== 'function') return Promise.resolve(null);

  return new Promise((fertig) => {
    const zeiten = [];
    let abgebrochen = false;
    const wecker = setTimeout(() => { abgebrochen = true; auswerten(); }, 4000);

    const auswerten = () => {
      clearTimeout(wecker);
      try { video.pause(); } catch { /* egal */ }
      const abstaende = [];
      for (let i = 1; i < zeiten.length; i += 1) {
        const d = zeiten[i] - zeiten[i - 1];
        if (d > 0.0005 && d < 1) abstaende.push(d);
      }
      if (abstaende.length < 3) { fertig(null); return; }
      abstaende.sort((a, b) => a - b);
      const median = abstaende[Math.floor(abstaende.length / 2)];
      fertig(median > 0 ? 1 / median : null);
    };

    const schritt = (_now, meta) => {
      if (abgebrochen) return;
      zeiten.push(typeof meta?.mediaTime === 'number' ? meta.mediaTime : video.currentTime);
      if (zeiten.length >= 12) { auswerten(); return; }
      video.requestVideoFrameCallback(schritt);
    };

    video.muted = true;
    video.requestVideoFrameCallback(schritt);
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { abgebrochen = true; clearTimeout(wecker); fertig(null); });
    }
  });
}

/** Video-Element auf eine Datei setzen und auf die Metadaten warten. */
function videoOeffnen(url, timeoutMs = 15000) {
  return new Promise((fertig) => {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.crossOrigin = 'anonymous';

    let erledigt = false;
    const wecker = setTimeout(() => schluss(null, 'Zeitüberschreitung beim Öffnen'), timeoutMs);
    const schluss = (el, grund) => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(wecker);
      fertig({ video: el, grund: grund || null });
    };

    v.addEventListener('loadedmetadata', () => schluss(v, null), { once: true });
    v.addEventListener('error', () => {
      const code = v.error?.code;
      schluss(null, code === 4 ? 'Format wird nicht unterstützt' : `Mediafehler ${code ?? '?'}`);
    }, { once: true });

    v.src = url;
    v.load();
  });
}

/** Bildmasse einer Bilddatei ermitteln. */
function bildOeffnen(url) {
  return new Promise((fertig) => {
    const img = new Image();
    img.onload = () => fertig({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => fertig(null);
    img.src = url;
  });
}

/** Standbild aus einem Video ziehen -> DataURL, oder null. */
async function standbild(video) {
  try {
    const zielZeit = Math.min(1, (video.duration || 0) * 0.1) || 0;
    if (Number.isFinite(zielZeit) && Math.abs(video.currentTime - zielZeit) > 0.05) {
      await new Promise((fertig) => {
        const wecker = setTimeout(fertig, 3000);
        video.addEventListener('seeked', () => { clearTimeout(wecker); fertig(); }, { once: true });
        try { video.currentTime = zielZeit; } catch { clearTimeout(wecker); fertig(); }
      });
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const breite = Math.min(320, w);
    const hoehe = Math.max(1, Math.round((h / w) * breite));
    const c = document.createElement('canvas');
    c.width = breite;
    c.height = hoehe;
    c.getContext('2d').drawImage(video, 0, 0, breite, hoehe);
    return c.toDataURL('image/jpeg', 0.7);
  } catch (e) {
    console.warn('[tbg-browser] Standbild nicht möglich:', e);
    return null;
  }
}

/* --- Bemaengelungen, so weit der Browser sie sehen kann ------------------- */

function sammleIssues(probe, kind, venue, unlesbar) {
  const issues = [];
  const add = (level, code, msg, hint) => issues.push({ level, code, msg, hint: hint || null });

  if (unlesbar) {
    add('warn', 'codec',
      kind === 'image'
        ? 'Der Browser kann dieses Bildformat nicht anzeigen — Vorschau bleibt schwarz.'
        : t('Der Browser kann dieses Format nicht abspielen — Vorschau bleibt schwarz. Für HAP und ProRes die Desktop-Fassung benutzen.'),
      'Die Datei bleibt in der Bibliothek und lässt sich planen — nur sehen kann man sie hier nicht.');
    return issues;
  }
  if (!probe) return issues;

  if (kind !== 'image' && !(probe.fps > 0)) {
    add('info', 'fps-unbekannt', t('Bildrate im Browser nicht ermittelbar'),
      'Dieser Browser bietet requestVideoFrameCallback nicht an. Die Bildrate wird NICHT geraten — '
      + 'in der Desktop-Fassung liest ffprobe sie exakt aus.');
  } else if (venue && kind !== 'image' && Math.abs(probe.fps - venue.fps) > 0.01) {
    add('warn', 'fps', `${probe.fps} fps statt ${venue.fps} fps`,
      'Im Reiter Conform auf die Zielrate angleichen — das geht nur in der Desktop-Fassung, '
      + 'sonst rechnet ffmpeg beim Render stumm um.');
  }

  if (probe.width > 0 && probe.height > 0) {
    if (probe.width % 2 !== 0 || probe.height % 2 !== 0) {
      add('error', 'odd', `Ungerade Kantenlänge ${probe.width}x${probe.height}`,
        'Die meisten Codecs verlangen gerade Kanten. Im Conform auf gerade Maße bringen.');
    } else if (probe.width % 4 !== 0 || probe.height % 4 !== 0) {
      add('warn', 'mod4', `${probe.width}x${probe.height} ist nicht durch 4 teilbar`,
        'HAP arbeitet in 4x4-Blöcken. ffmpeg paddet sonst stillschweigend.');
    }

    if (venue) {
      const passt = [];
      for (const wall of venue.walls || []) {
        if (probe.width === wall.width && probe.height === wall.height) passt.push(wall.id);
        for (const p of wall.panels || []) {
          if (probe.width === p.width && probe.height === wall.height) passt.push(p.id);
        }
      }
      if (venue.holo && probe.width === venue.holo.width && probe.height === venue.holo.height) {
        passt.push(venue.holo.id || 'H');
      }
      if (passt.length === 0) {
        add('info', 'resolution',
          `${probe.width}x${probe.height} passt zu keiner Wand und keinem Panel von ${venue.name || venue.id}`,
          'Kein Fehler — das Material wird im Editor skaliert oder beschnitten.');
      } else {
        probe.matches = passt;
      }
    }
  }

  return issues;
}

/* --- eine Datei analysieren ---------------------------------------------- */

function mediaImportContext() {
  const stored = lsLesen(LS_PROJECT, null);
  return { known: Array.isArray(stored?.media) ? stored.media : [], claimed: new Set() };
}

function matchingMedia(file, pseudoPath, relativePath, context) {
  const normalize = (path) => String(path || '').replaceAll('\\', '/').replace(/^\.\//, '');
  const full = normalize(pseudoPath);
  const relative = normalize(relativePath);
  const available = context.known.filter((media) => media?.id && !context.claimed.has(media.id));
  const unique = (items) => items.length === 1 ? items[0] : null;
  // Preserve existing IDs first: layers from a desktop project reference
  // random IDs, while a newly scanned browser file used to get a path hash.
  const exact = available.filter((media) => normalize(media.browserPath || media.absPath) === full);
  if (exact.length === 1) return exact[0];
  const pathMatches = available.filter((media) =>
    (full.includes('/') && normalize(media.absPath).endsWith(`/${full}`)) ||
    (relative && normalize(media.relPath) === relative));
  if (pathMatches.length === 1) return pathMatches[0];
  // A file picker exposes no parent path. Name+size is a safe fallback only
  // when exactly one unavailable item matches; never guess between duplicates.
  return unique(available.filter((media) => !dateien.has(media.id) &&
    (media.name || normalize(media.absPath).split('/').pop()) === file.name &&
    Number(media.probe?.sizeBytes) > 0 && Number(media.probe.sizeBytes) === file.size));
}

/**
 * Aus einer Datei ein Media-Objekt nach makeMedia() bauen und probe{} so weit
 * fuellen, wie der Browser es hergibt. Was nicht messbar ist, bleibt leer und
 * steht in issues[] — geraten wird nichts.
 */
async function analysiere(file, pseudoPfad, relPfad, venue, importContext = mediaImportContext()) {
  const kind = artFuer(file.name) || 'video';
  const existing = matchingMedia(file, pseudoPfad, relPfad, importContext);
  const pathId = 'med_' + [...pseudoPfad].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
  const usedId = importContext.claimed.has(pathId) || importContext.known.some((media) => media.id === pathId);
  const media = makeMedia(existing?.absPath || pseudoPfad, {
    ...existing,
    // STABILE ID aus dem Pfad, nicht gewuerfelt.
    //
    // store.mergeMedia() erkennt bereits bekannte Medien am Pfad und BEHAELT
    // dabei deren alte ID. Eine neue Zufalls-ID bei jedem Einlesen fuehrt
    // deshalb dazu, dass blobUrls/dateien unter einem Schluessel liegen, den
    // niemand mehr abfragt: proxyUrl() liefert null, die Vorschau bleibt
    // dauerhaft schwarz, und jede alte blob-URL haelt ihre Datei im Speicher
    // fest. Aus dem Pfad abgeleitet ist die ID ueber Seitenneuladen hinweg
    // dieselbe.
    id: existing?.id || (usedId ? makeId('med') : pathId),
    name: file.name,
    relPath: existing?.relPath || relPfad || null,
    browserPath: pseudoPfad,
    kind,
    // Proxies entfallen: gespielt wird direkt aus der Originaldatei.
    proxy: { path: null, width: 0, height: 0, ready: true },
    thumb: { path: null, ready: false },
  });
  importContext.claimed.add(media.id);

  // Alte blob-URL desselben Mediums freigeben, sonst leckt bei jedem
  // erneuten Einlesen eine URL samt festgehaltener Datei.
  const alt = blobUrls.get(media.id);
  if (alt) { try { URL.revokeObjectURL(alt); } catch { /* schon weg */ } }
  thumbUrls.delete(media.id);
  thumbLaeuft.delete(media.id);
  thumbHinueber.delete(media.id);
  const url = URL.createObjectURL(file);
  blobUrls.set(media.id, url);
  dateien.set(media.id, file);

  const basis = {
    ...leereProbe(),
    sizeBytes: file.size,
    container: endung(file.name),
  };

  if (kind === 'image') {
    const masse = await bildOeffnen(url);
    if (masse) {
      basis.width = masse.width;
      basis.height = masse.height;
      basis.frames = 1;
      media.thumb = { path: null, ready: true };
      thumbUrls.set(media.id, url);
    }
    media.probe = basis;
    media.issues = sammleIssues(basis, kind, venue, !masse);
    if (!masse) media.proxy.ready = false;
    return media;
  }

  const { video, grund } = await videoOeffnen(url);
  if (!video) {
    // HAP, ProRes, MPEG-2 und andere: kind bleibt 'video', probe bleibt leer.
    media.probe = basis;
    media.issues = sammleIssues(basis, kind, venue, true);
    if (grund) media.issues.push({ level: 'info', code: 'codec-detail', msg: `Browser meldet: ${grund}`, hint: null });
    media.proxy = { path: null, width: 0, height: 0, ready: false };
    return media;
  }

  basis.width = video.videoWidth || 0;
  basis.height = video.videoHeight || 0;
  basis.durationSec = Number.isFinite(video.duration) ? runde(video.duration, 3) : 0;
  basis.audioStreams = anzahlTonspuren(video);

  const rohFps = await messeFps(video);
  if (rohFps && rohFps > 0) {
    basis.fps = fpsRunden(rohFps);
    basis.fpsExact = fpsExakt(basis.fps);
    basis.fpsSource = 'gemessen';
    basis.frames = basis.durationSec > 0 ? Math.round(basis.durationSec * basis.fps) : 0;
  } else {
    basis.fps = 0;
    basis.fpsExact = '';
    basis.fpsSource = 'unbekannt';
  }

  const bild = await standbild(video);
  if (bild) {
    thumbUrls.set(media.id, bild);
    media.thumb = { path: null, ready: true };
  }

  try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* egal */ }

  media.probe = basis;
  media.issues = sammleIssues(basis, kind, venue, false);
  return media;
}

function leereProbe() {
  return {
    width: 0, height: 0, fps: 0, fpsExact: '', durationSec: 0, frames: 0,
    codec: '', pixFmt: '', hasAlpha: false, colorRange: '', colorSpace: '',
    bitrate: 0, sizeBytes: 0, container: '', audioStreams: 0,
  };
}

/** Tonspuren, sofern der Browser sie ueberhaupt auflistet. */
function anzahlTonspuren(video) {
  if (video.audioTracks && typeof video.audioTracks.length === 'number') return video.audioTracks.length;
  if (typeof video.mozHasAudio === 'boolean') return video.mozHasAudio ? 1 : 0;
  if (typeof video.webkitAudioDecodedByteCount === 'number') return video.webkitAudioDecodedByteCount > 0 ? 1 : 0;
  return 0;
}

/* --- IndexedDB fuer Ordner-Handles --------------------------------------- */

const IDB_NAME = 'tbg-browser';
const IDB_STORE = 'handles';

function idbOeffnen() {
  return new Promise((fertig, ab) => {
    if (typeof indexedDB === 'undefined') { ab(fehler('IndexedDB steht nicht zur Verfügung.')); return; }
    const anfrage = indexedDB.open(IDB_NAME, 1);
    anfrage.onupgradeneeded = () => {
      if (!anfrage.result.objectStoreNames.contains(IDB_STORE)) anfrage.result.createObjectStore(IDB_STORE);
    };
    anfrage.onsuccess = () => fertig(anfrage.result);
    anfrage.onerror = () => ab(anfrage.error || fehler('IndexedDB ließ sich nicht öffnen.'));
  });
}

function idbSchreiben(key, wert) {
  return idbOeffnen().then((db) => new Promise((fertig, ab) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(wert, key);
    tx.oncomplete = () => { db.close(); fertig(true); };
    tx.onerror = () => { db.close(); ab(tx.error); };
  }));
}

function idbLesen(key) {
  return idbOeffnen().then((db) => new Promise((fertig, ab) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const anfrage = tx.objectStore(IDB_STORE).get(key);
    anfrage.onsuccess = () => { db.close(); fertig(anfrage.result ?? null); };
    anfrage.onerror = () => { db.close(); ab(anfrage.error); };
  }));
}

/**
 * Zuletzt gewaehlter Ordner. FileSystemDirectoryHandle ist strukturiert
 * klonbar und uebersteht damit einen Seitenneuladen — die Erlaubnis dazu
 * allerdings nicht immer, deshalb wird sie beim Benutzen neu geprueft.
 */
let letzterOrdner = null;

idbLesen('letzterOrdner')
  .then((h) => { if (h) letzterOrdner = h; })
  .catch((e) => console.warn('[tbg-browser] Ordner-Handle nicht lesbar:', e.message));

async function erlaubnisHolen(handle, schreibend = false) {
  if (!handle || typeof handle.queryPermission !== 'function') return true;
  const modus = { mode: schreibend ? 'readwrite' : 'read' };
  if (await handle.queryPermission(modus) === 'granted') return true;
  // requestPermission() braucht eine Nutzeraktion — es wird deshalb nur aus
  // scanLibrary/addMedia heraus aufgerufen, nie beim Laden der Seite.
  return (await handle.requestPermission(modus)) === 'granted';
}

/* --- Ordner durchlaufen --------------------------------------------------- */

async function sammleDateien(dirHandle, rekursiv, praefix, hinein) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') {
      if (!rekursiv) continue;
      if (name.startsWith('.')) continue;
      await sammleDateien(handle, rekursiv, `${praefix}${name}/`, hinein);
      continue;
    }
    if (!artFuer(name)) continue;
    hinein.push({ handle, rel: `${praefix}${name}` });
  }
}

/** Venue des aktuellen Projekts — fuer die Pruefung von fps und Aufloesung. */
async function venueFuerPruefung() {
  try {
    const p = lsLesen(LS_PROJECT, null);
    if (p?.venueId) return await getVenue(p.venueId);
  } catch { /* dann eben ohne */ }
  try {
    const liste = await listVenues();
    if (liste[0]) return await getVenue(liste[0].id);
  } catch { /* dann eben ohne */ }
  return null;
}

/**
 * Ordner einlesen.
 *
 * `roots` kommt aus der Desktop-Fassung (absolute Pfade) und wird ignoriert —
 * im Browser waehlt der Nutzer den Ordner im Dialog. Zweiter Parameter ist wie
 * in api.js das Rekursionsflag; ein Objekt { recursive } wird ebenfalls
 * verstanden.
 *
 * Antwort ist { jobId } wie beim Server; das Ergebnis des Jobs ist
 * { media: [...] } und wird von main.js in die Bibliothek uebernommen.
 */
export async function scanLibrary(roots, opts = true) {
  const rekursiv = typeof opts === 'object' && opts !== null ? opts.recursive !== false : opts !== false;

  if (!hatVerzeichnisAuswahl()) {
    throw fehler(
      t('Die Ordnerauswahl (File System Access API) gibt es in diesem Browser nicht. Bitte Chrome oder Edge benutzen — Firefox und Safari können keine Ordner lesen.'),
      { status: 501, browserFehlt: 'showDirectoryPicker' }
    );
  }

  // showDirectoryPicker() MUSS in derselben Aufgabe wie der Klick laufen —
  // deshalb steht der Aufruf vor jedem await.
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker(
      letzterOrdner ? { mode: 'read', startIn: letzterOrdner } : { mode: 'read' }
    );
  } catch (e) {
    if (e && e.name === 'AbortError') throw fehler('Es wurde kein Ordner ausgewählt.', { abgebrochen: true });
    throw e;
  }

  if (!(await erlaubnisHolen(dirHandle))) {
    throw fehler('Der Browser hat den Zugriff auf den Ordner nicht erlaubt.', { status: 403 });
  }

  letzterOrdner = dirHandle;
  idbSchreiben('letzterOrdner', dirHandle)
    .catch((e) => console.warn('[tbg-browser] Ordner-Handle nicht speicherbar:', e.message));

  const job = jobAnlegen({ type: 'library.scan', label: `Ordner „${dirHandle.name}" einlesen` });
  jobStarten(job, async (ctx) => {
    ctx.log(`Ordner: ${dirHandle.name}${rekursiv ? ' (mit Unterordnern)' : ''}`);
    const gefunden = [];
    await sammleDateien(dirHandle, rekursiv, '', gefunden);
    ctx.log(`${gefunden.length} Datei(en) gefunden.`);
    if (gefunden.length === 0) {
      ctx.setResult({ media: [] });
      return;
    }

    const venue = await venueFuerPruefung();
    const importContext = mediaImportContext();
    const media = [];
    for (let i = 0; i < gefunden.length; i += 1) {
      if (ctx.abgebrochen) break;
      const eintrag = gefunden[i];
      try {
        const file = await eintrag.handle.getFile();
        const m = await analysiere(file, `${dirHandle.name}/${eintrag.rel}`, eintrag.rel, venue, importContext);
        media.push(m);
        ctx.log(`${eintrag.rel} — ${m.probe?.width || '?'}x${m.probe?.height || '?'}`
          + `${m.probe?.fps ? ` · ${m.probe.fps} fps` : ''}`);
      } catch (e) {
        ctx.log(`${eintrag.rel} konnte nicht gelesen werden: ${e.message}`);
      }
      ctx.progress((i + 1) / gefunden.length);
    }
    ctx.setResult({ media });
  });

  return { jobId: job.id };
}

/**
 * Einzelne Dateien hinzufuegen.
 *
 * `paths` wird ignoriert — im Browser gibt es keine Pfade. Rueckgabe ist wie
 * beim Server { media: [...] }, also synchron im Sinne des Vertrags: das
 * Promise loest erst auf, wenn alles analysiert ist.
 */
export async function addMedia(/* paths */) {
  if (!hatFsAccess()) {
    throw fehler(
      t('Die Dateiauswahl (File System Access API) gibt es in diesem Browser nicht. Bitte Chrome oder Edge benutzen.'),
      { status: 501, browserFehlt: 'showOpenFilePicker' }
    );
  }

  let handles;
  try {
    handles = await window.showOpenFilePicker({
      multiple: true,
      types: [{
        description: 'Video und Bild',
        accept: {
          'video/*': ['.mp4', '.m4v', '.webm', '.mov'],
          'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.avif'],
        },
      }],
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw fehler('Es wurde keine Datei ausgewählt.', { abgebrochen: true });
    throw e;
  }

  const venue = await venueFuerPruefung();
  const importContext = mediaImportContext();
  const media = [];
  for (const h of handles) {
    try {
      const file = await h.getFile();
      if (!artFuer(file.name)) continue;
      media.push(await analysiere(file, file.name, file.name, venue, importContext));
    } catch (e) {
      console.warn('[tbg-browser] Datei nicht lesbar:', e);
    }
  }
  return { media };
}

/**
 * Proxies gibt es hier nicht — und sie werden auch nicht gebraucht: die
 * Vorschau spielt direkt aus der Originaldatei. Der Job meldet das und ist
 * sofort fertig, damit die Oberflaeche nicht auf etwas wartet, das nie kommt.
 */
export function makeProxies(mediaIds /* , force */) {
  const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  const job = jobAnlegen({ type: 'media.proxy', label: `Proxy für ${ids.length} Datei(en)` });
  jobStarten(job, async (ctx) => {
    ctx.log(t('Proxies gibt es in der Browser-Fassung nicht — es wird direkt aus der Originaldatei abgespielt.'));
    ctx.log('Was der Browser nicht dekodieren kann (HAP, ProRes, MPEG-2), bleibt in der Vorschau schwarz. '
      + 'Dafür die Desktop-Fassung benutzen.');
    ctx.setResult({ media: [], note: 'proxy-entfaellt' });
  });
  return Promise.resolve({ jobId: job.id });
}

export function deleteMedia(id) {
  const url = blobUrls.get(id);
  if (url) {
    try { URL.revokeObjectURL(url); } catch { /* egal */ }
    blobUrls.delete(id);
  }
  dateien.delete(id);
  thumbUrls.delete(id);
  thumbLaeuft.delete(id);
  thumbHinueber.delete(id);
  return Promise.resolve({ ok: true, id });
}

/**
 * Adresse zum Abspielen. Signatur wie in api.js: synchron, liefert einen
 * String — hier eine blob:-URL aus dem gehaltenen File-Objekt. Sie wird EINMAL
 * erzeugt und gemerkt; bei jedem Aufruf eine neue zu bauen, wuerde Speicher
 * lecken. Ist die Datei nicht (mehr) da, kommt null — der Videopool kommt
 * damit klar und meldet eine fehlende Vorschau.
 */
export function proxyUrl(id) {
  return blobUrls.get(id) || null;
}

/**
 * Standbild als DataURL. Es entsteht beim Einlesen; fehlt es, wird es im
 * Hintergrund nachgezogen und steht beim naechsten Aufruf bereit. Geht das
 * nicht (nicht dekodierbares Format), bleibt es bei null.
 */
export function thumbUrl(id) {
  const da = thumbUrls.get(id);
  if (da) return da;
  if (thumbLaeuft.has(id) || thumbHinueber.has(id)) return null;

  const url = blobUrls.get(id);
  const file = dateien.get(id);
  if (!url || !file) return null;

  thumbLaeuft.add(id);
  (async () => {
    try {
      if (artFuer(file.name) === 'image') { thumbUrls.set(id, url); return; }
      const { video } = await videoOeffnen(url);
      if (!video) { thumbHinueber.add(id); return; }
      const bild = await standbild(video);
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* egal */ }
      if (bild) thumbUrls.set(id, bild); else thumbHinueber.add(id);
    } catch (e) {
      console.warn('[tbg-browser] Standbild fehlgeschlagen:', e);
      thumbHinueber.add(id);
    } finally {
      thumbLaeuft.delete(id);
    }
  })();

  return null;
}

/* ==========================================================================
 * Dateisystem-Browser — gibt es hier nicht
 * ========================================================================== */

export function browse() {
  return Promise.reject(fehler(
    t('Einen Dateisystem-Browser gibt es in der Browser-Fassung nicht. Material wird über „Ordner einlesen" ausgewählt — dort öffnet sich der Ordnerdialog des Browsers.'),
    {
      status: 501,
      detail: 'Der Browser darf aus Sicherheitsgründen nicht frei im Dateisystem blättern. '
        + 'Zugriff gibt es nur auf das, was der Nutzer im Dialog selbst auswählt.',
    }
  ));
}

/* ==========================================================================
 * Verarbeitung — alles, was ffmpeg braucht
 * ========================================================================== */

export function conform() { return nichtVerfuegbarAsync('Conform (Bildraten und Raster angleichen)'); }
export function renderWall() { return nichtVerfuegbarAsync('Das Rendern einer Wand'); }
export function renderPanels() { return nichtVerfuegbarAsync('Das Schneiden der Panels'); }
export function renderAll() { return nichtVerfuegbarAsync('Das Rendern aller Wände'); }
export function renderStill() { return nichtVerfuegbarAsync('Das Rendern eines Standbildes'); }
export function runQc() { return nichtVerfuegbarAsync('Die Qualitätskontrolle'); }

/* ==========================================================================
 * Jobs
 * ========================================================================== */

export function getJobs() {
  return Promise.resolve(jobOrder.slice().reverse().map(klone));
}

export function getJob(id) {
  const job = jobById.get(id);
  if (!job) return Promise.reject(fehler(`Job ${id} ist unbekannt.`, { status: 404 }));
  return Promise.resolve(klone(job));
}

export function cancelJob(id) {
  const job = jobById.get(id);
  if (!job) return Promise.reject(fehler(`Job ${id} ist unbekannt.`, { status: 404 }));
  const info = jobMeta.get(id);
  if (info && (job.status === 'running' || job.status === 'queued')) {
    info.abbruch = true;
    jobLog(job, 'Abbruch angefordert …');
    return Promise.resolve({ ok: true, status: job.status });
  }
  return Promise.resolve({ ok: false, status: job.status });
}

/**
 * Ersatz fuer die SSE-Verbindung: derselbe Ereignisstrom, nur im Fenster.
 *   { type:'hello', jobs:[Job] } | { type:'job', job:Job } | { type:'log', id, line }
 *
 * Rueckgabe ist eine Abmeldefunktion, die zusaetzlich close() traegt — damit
 * funktioniert sowohl `ab()` als auch der Vertrag `{ close() }` aus api.js.
 */
export function connectJobStream(onEvent) {
  if (typeof onEvent !== 'function') {
    throw fehler('connectJobStream() braucht eine Rückruffunktion.');
  }
  jobHoerer.add(onEvent);

  // Wie beim Server kommt „hello" erst nach dem Verbindungsaufbau, also nicht
  // im selben Durchlauf — sonst laeuft der Aufrufer in seinen eigenen Aufruf.
  setTimeout(() => {
    if (!jobHoerer.has(onEvent)) return;
    try {
      onEvent({ type: 'streamOpen' });
      onEvent({ type: 'hello', jobs: jobOrder.slice().reverse().map(schlank) });
    } catch (e) {
      console.error('[tbg-browser] Jobhoerer hat beim Anmelden geworfen:', e);
    }
  }, 0);

  const abmelden = () => { jobHoerer.delete(onEvent); };
  abmelden.close = abmelden;
  abmelden.unsubscribe = abmelden;
  return abmelden;
}

/* ==========================================================================
 * Render-Vorschau ohne Rendern
 *
 * Das GEHT hier: der Filtergraph wird rein gerechnet, dafuer braucht es kein
 * ffmpeg. server/ops/filtergraph.js importiert ausschliesslich aus
 * shared/model.js und laeuft deshalb unveraendert im Browser. Der Nutzer kann
 * sich den fertigen ffmpeg-Befehl erzeugen lassen und ihn am Desktop einfach
 * einfuegen — genau dafuer ist die Kommandozeile im Klartext da.
 * ========================================================================== */

let filtergraphModul = null;
let filtergraphFehler = null;

async function ladeFiltergraph() {
  if (filtergraphModul) return filtergraphModul;
  if (filtergraphFehler) throw filtergraphFehler;
  try {
    const mod = await import('/server/ops/filtergraph.js');
    if (typeof mod.buildWallGraph !== 'function'
      || typeof mod.graphToCommand !== 'function'
      || typeof mod.formatCommandLine !== 'function') {
      throw fehler('Dem Modul fehlen buildWallGraph, graphToCommand oder formatCommandLine.');
    }
    filtergraphModul = mod;
    return mod;
  } catch (e) {
    filtergraphFehler = fehler(
      `Die Filtergraph-Vorschau ist nicht verfügbar: ${e.message}`,
      {
        cause: e,
        detail: 'server/ops/filtergraph.js ließ sich im Browser nicht laden. Es darf nur aus shared/ '
          + 'importieren; sobald es ein node:-Modul braucht, geht es hier nicht mehr.',
      }
    );
    throw filtergraphFehler;
  }
}

export async function previewFiltergraph(wallId) {
  if (!wallId) throw fehler('Es wurde keine Wand angegeben.', { status: 400 });

  // Auch die lokale Vorschau liest das gespeicherte Projekt. Eine gerade
  // vorgenommene Bearbeitung muss vor der Graph-Berechnung dort ankommen.
  const { isDirty, flushSave } = await import('./store.js');
  if (isDirty() && !(await flushSave())) {
    throw fehler(t('Projekt konnte nicht gespeichert werden'));
  }

  const project = await getProject();
  const venue = await getVenue(project.venueId);
  const { buildWallGraph, graphToCommand, formatCommandLine } = await ladeFiltergraph();

  const graph = buildWallGraph(project, venue, wallId, { rangeSec: null, forPanels: false });

  // Die Kommandozeile ist nur Anzeige — ein Fehler dabei darf die Vorschau
  // des Graphen nicht kaputtmachen.
  let command = null;
  try {
    const args = graphToCommand(graph, {
      ffmpegPath: 'ffmpeg',
      outArgs: [],
      outPath: '<Zieldatei>',
      fps: graph.meta?.fps ?? project.fps,
    });
    command = formatCommandLine('ffmpeg', args);
  } catch (e) {
    graph.warnings = [...(graph.warnings || []), `Kommandozeile nicht darstellbar: ${e.message}`];
  }

  return {
    ...graph,
    command,
    // Deutlich machen, wo dieser Befehl hingehoert: hier laeuft er nicht.
    notes: [
      ...(graph.notes || []),
      'Dieser Befehl wird in der Browser-Fassung NICHT ausgeführt. Er ist zum Kopieren gedacht: '
      + 'in der Desktop-Fassung oder direkt in einer Konsole mit ffmpeg einfügen.',
    ],
  };
}
