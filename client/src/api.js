/**
 * Theater-Bild-Gelöte — HTTP-Anbindung.
 *
 * Genau die Endpunkte aus shared/API.md, eine Funktion je Endpunkt.
 * Jede Funktion wirft bei !res.ok einen Error, dessen message die Servermeldung
 * ist ("error", bei Bedarf um "detail" ergaenzt). Nichts wird still geschluckt.
 */

import { t, register } from './i18n.js';

register('en', {
  'Jobstream konnte nicht geöffnet werden: {msg}': 'The job stream could not be opened: {msg}',
  'Unlesbare Jobmeldung: {text}': 'Unreadable job message: {text}',
  'Verbindung zum Jobstream verloren — neuer Versuch in 2 s.':
    'Lost the connection to the job stream — retrying in 2 s.',
  'Server nicht erreichbar ({method} {path}): {msg}':
    'Server unreachable ({method} {path}): {msg}',
  'Ohne Kennung kann kein Venue geladen werden.': 'A venue cannot be loaded without an id.',
  'Ohne Kennung kann kein Venue gespeichert werden.': 'A venue cannot be saved without an id.',
  'Ohne Kennung kann kein Venue gelöscht werden.': 'A venue cannot be deleted without an id.',
  'Ohne Kennung kann kein Venue dupliziert werden.': 'A venue cannot be duplicated without an id.',
  'Es wurde kein Venue übergeben.': 'No venue was passed in.',
  'Es wurde kein Pfad übergeben.': 'No path was passed in.',
  'Projekt konnte nicht gespeichert werden': 'The project could not be saved',
});

const BASE = ''; // gleicher Host wie die Seite: 127.0.0.1:7333

async function request(method, path, body, opts = {}) {
  const url = BASE + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    const err = new Error(t('Server nicht erreichbar ({method} {path}): {msg}', { method, path, msg: e.message }));
    err.cause = e;
    throw err;
  }

  const raw = await res.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = { error: raw.slice(0, 400) }; }
  }

  if (!res.ok) {
    const base = (data && data.error) || res.statusText || `HTTP ${res.status}`;
    const detail = data && data.detail ? ` — ${data.detail}` : '';
    const err = new Error(`${base}${detail}`);
    err.status = res.status;
    err.detail = data && data.detail;
    err.endpoint = `${method} ${path}`;
    throw err;
  }
  return data;
}

const GET = (p, o) => request('GET', p, undefined, o);
const POST = (p, b, o) => request('POST', p, b === undefined ? {} : b, o);
const PUT = (p, b, o) => request('PUT', p, b, o);
const DEL = (p, o) => request('DELETE', p, undefined, o);

/**
 * Diese Operationen lesen das aktive Projekt auf dem Server. Erst die letzte
 * Editor-Aenderung sichern, auch wenn der 800-ms-Autosave noch aussteht.
 * Dynamisch importieren: store.js importiert diese API selbst fuer putProject;
 * der Speicheraufruf bleibt bewusst ausserhalb dieser Schranke.
 */
async function postWithSavedProject(path, body) {
  const { isDirty, flushSave } = await import('./store.js');
  if (isDirty() && !(await flushSave())) {
    throw new Error(t('Projekt konnte nicht gespeichert werden'));
  }
  return POST(path, body);
}

/* ==========================================================================
 * Systemzustand
 * ========================================================================== */

export function getHealth() {
  return GET('/api/health');
}

/** Holt den BtbN-GPL-Build nach bin/. Nur auf ausdrueckliche Nutzeraktion. */
export function installFfmpeg() {
  return POST('/api/ffmpeg/install');
}

/* ==========================================================================
 * Venues
 *
 * Ein Venue beschreibt ein Haus: Waende, Panels, Metermasse, Bildrate,
 * Delivery-Vorgaben. Lesen konnte der Client das schon immer; angelegt und
 * gepflegt wird es jetzt ueber dieselbe Ressource nach REST-Sitte.
 * ========================================================================== */

/** Kurzliste: [{ id, name, wallCount }] */
export function listVenues() {
  return GET('/api/venues');
}

/** Alter Name derselben Abfrage — bleibt, damit nichts bricht. */
export const getVenues = listVenues;

export function getVenue(id) {
  if (!id) return Promise.reject(new Error(t('Ohne Kennung kann kein Venue geladen werden.')));
  return GET(`/api/venues/${encodeURIComponent(id)}`);
}

/** Neues Venue anlegen. Body ist das volle Venue-JSON. */
export function createVenue(venue) {
  if (!venue) return Promise.reject(new Error(t('Es wurde kein Venue übergeben.')));
  return POST('/api/venues', venue);
}

/** Bestehendes Venue vollstaendig ersetzen. */
export function updateVenue(id, venue) {
  if (!id) return Promise.reject(new Error(t('Ohne Kennung kann kein Venue gespeichert werden.')));
  if (!venue) return Promise.reject(new Error(t('Es wurde kein Venue übergeben.')));
  return PUT(`/api/venues/${encodeURIComponent(id)}`, venue);
}

export function deleteVenue(id) {
  if (!id) return Promise.reject(new Error(t('Ohne Kennung kann kein Venue gelöscht werden.')));
  return DEL(`/api/venues/${encodeURIComponent(id)}`);
}

/**
 * Venue kopieren. `next` ist { id, name } fuer die Kopie; wird nur eine
 * Zeichenkette uebergeben, gilt sie als neue Kennung.
 */
export function duplicateVenue(id, next) {
  if (!id) return Promise.reject(new Error(t('Ohne Kennung kann kein Venue dupliziert werden.')));
  const body = typeof next === 'string' ? { id: next } : (next || {});
  return POST(`/api/venues/${encodeURIComponent(id)}/duplicate`, body);
}

/**
 * Venue pruefen, ohne es zu speichern.
 * → [{ level: 'error'|'warn'|'info', where, msg, hint }]
 */
export function validateVenue(venue) {
  if (!venue) return Promise.reject(new Error(t('Es wurde kein Venue übergeben.')));
  return POST('/api/venues/validate', venue);
}

/**
 * Geruest fuer ein neues Venue rechnen lassen → fertiges Venue-JSON, das der
 * Editor weiterbearbeitet. Erkannte Parameter:
 *   { walls, panels, width, height, fps, pixelPitchMm, id, name }
 * Der Endpunkt ist bewusst ein GET: er rechnet nur, er speichert nichts.
 */
export function venueTemplate(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return GET(`/api/venues/template${s ? `?${s}` : ''}`);
}

/* ==========================================================================
 * Arbeitsordner und Projektliste
 *
 * Der Arbeitsordner ist der Ort, an dem Projekte, Zwischenstaende und
 * Ausgaben liegen. Er ist NICHT fest verdrahtet — jeder Rechner darf einen
 * anderen haben, und der Pfad wird immer vom Server zusammengesetzt.
 * ========================================================================== */

/** → { path, exists, writable, projects?: [...] } */
export function getWorkspace() {
  return GET('/api/workspace');
}

export function setWorkspace(path) {
  if (!path) return Promise.reject(new Error(t('Es wurde kein Pfad übergeben.')));
  return POST('/api/workspace', { path });
}

/** Projekte im Arbeitsordner → [{ name, path, venueId, modifiedAt }] */
export function listProjects() {
  return GET('/api/projects');
}

/* ==========================================================================
 * Projekt
 * ========================================================================== */

export function getProject() {
  return GET('/api/project');
}

export function putProject(project) {
  return PUT('/api/project', project);
}

export function newProject(venueId, name) {
  return POST('/api/project/new', { venueId, name });
}

export function openProject(path) {
  return POST('/api/project/open', { path });
}

export function saveProject(path = null) {
  return POST('/api/project/save', path ? { path } : {});
}

export function validateProject() {
  return GET('/api/project/validate');
}

/* ==========================================================================
 * Medien
 * ========================================================================== */

export function scanLibrary(roots, recursive = true) {
  return POST('/api/library/scan', { roots: Array.isArray(roots) ? roots : [roots], recursive });
}

export function addMedia(paths) {
  return POST('/api/media/add', { paths: Array.isArray(paths) ? paths : [paths] });
}

export function makeProxies(mediaIds, force = false) {
  return POST('/api/media/proxy', { mediaIds: Array.isArray(mediaIds) ? mediaIds : [mediaIds], force });
}

export function deleteMedia(id) {
  return DEL(`/api/media/${encodeURIComponent(id)}`);
}

/** URL des H.264-Proxies. Unterstuetzt serverseitig HTTP-Range. */
export function proxyUrl(id) {
  return `${BASE}/api/media/${encodeURIComponent(id)}/proxy`;
}

/** URL des Posterframes. */
export function thumbUrl(id) {
  return `${BASE}/api/media/${encodeURIComponent(id)}/thumb`;
}

/* ==========================================================================
 * Dateisystem-Browser
 * ========================================================================== */

/** Ohne path: Laufwerksliste. */
export function browse(path) {
  const q = path ? `?path=${encodeURIComponent(path)}` : '';
  return GET(`/api/fs/browse${q}`);
}

/* ==========================================================================
 * Verarbeitung — alles asynchron, Antwort ist { jobId }
 * ========================================================================== */

export function conform(body) {
  return postWithSavedProject('/api/conform', body);
}

export function renderWall(body) {
  return postWithSavedProject('/api/render/wall', body);
}

export function renderPanels(body) {
  return postWithSavedProject('/api/render/panels', body);
}

export function renderAll(body) {
  return postWithSavedProject('/api/render/all', body);
}

export function renderStill(body) {
  return postWithSavedProject('/api/render/still', body);
}

/* ==========================================================================
 * QC
 * ========================================================================== */

export function runQc(body) {
  return postWithSavedProject('/api/qc/run', body);
}

/* ==========================================================================
 * Jobs
 * ========================================================================== */

export function getJobs() {
  return GET('/api/jobs');
}

export function getJob(id) {
  return GET(`/api/jobs/${encodeURIComponent(id)}`);
}

export function cancelJob(id) {
  return POST(`/api/jobs/${encodeURIComponent(id)}/cancel`);
}

/**
 * SSE-Anbindung an /api/jobs/stream.
 * Reicht jedes Ereignis unveraendert an onEvent durch:
 *   { type:'hello', jobs:[Job] } | { type:'job', job:Job } | { type:'log', id, line }
 * Bei Verbindungsabbruch wird nach 2 s neu verbunden.
 * Rueckgabe: { close() } — beendet die Verbindung endgueltig.
 */
export function connectJobStream(onEvent) {
  let es = null;
  let timer = null;
  let closed = false;

  const open = () => {
    if (closed) return;
    try {
      es = new EventSource(`${BASE}/api/jobs/stream`);
    } catch (e) {
      onEvent({ type: 'streamError', message: t('Jobstream konnte nicht geöffnet werden: {msg}', { msg: e.message }) });
      retry();
      return;
    }

    es.onopen = () => onEvent({ type: 'streamOpen' });

    es.onmessage = (ev) => {
      if (!ev.data) return;
      let msg;
      try { msg = JSON.parse(ev.data); }
      catch (e) {
        onEvent({ type: 'streamError', message: t('Unlesbare Jobmeldung: {text}', { text: String(ev.data).slice(0, 200) }) });
        return;
      }
      onEvent(msg);
    };

    es.onerror = () => {
      // EventSource verbindet selbst neu, aber unkontrolliert. Wir machen das selbst.
      try { es.close(); } catch { /* egal */ }
      es = null;
      if (!closed) {
        onEvent({ type: 'streamError', message: t('Verbindung zum Jobstream verloren — neuer Versuch in 2 s.') });
        retry();
      }
    };
  };

  const retry = () => {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = null; open(); }, 2000);
  };

  open();

  return {
    close() {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (es) { try { es.close(); } catch { /* egal */ } es = null; }
    },
  };
}

/* ==========================================================================
 * Render-Vorschau ohne Rendern
 * ========================================================================== */

export function previewFiltergraph(wallId) {
  return postWithSavedProject('/api/preview/filtergraph', { wallId });
}
