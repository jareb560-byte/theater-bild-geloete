/**
 * Theater-Bild-Gelöte — Zustand.
 *
 * Flacher Pub/Sub ohne Framework. Der State wird nie an Ort und Stelle
 * veraendert; jede Aenderung erzeugt neue Objekte entlang des betroffenen
 * Pfades. Abonnenten werden gebuendelt per queueMicrotask benachrichtigt,
 * damit ein Klick nicht zehn Neuzeichnungen ausloest.
 */

import { makeLayer } from '/shared/model.js';
import { putProject } from './api.js';
import { t, register, getLang } from './i18n.js';

register('en', {
  'Anzeigefehler: {msg}': 'Display error: {msg}',
  'Layer {id} wurde nicht gefunden — vermutlich schon gelöscht.':
    'Layer {id} was not found — it was probably deleted already.',
  'Layer konnte nicht geändert werden': 'The layer could not be changed',
  'Wand {id} gibt es im Projekt nicht.': 'Wall {id} does not exist in this project.',
  'Wand {id} gibt es im Projekt nicht': 'Wall {id} does not exist in this project',
  'Slot {id} gibt es auf Wand {wall} nicht': 'Slot {id} does not exist on wall {wall}',
  'Slot konnte nicht geändert werden': 'The slot could not be changed',
  'Kein Projekt geladen.': 'No project loaded.',
  'Medium {id} ist nicht in der Bibliothek.': 'Media item {id} is not in the library.',
  'Layer konnte nicht angelegt werden': 'The layer could not be created',
  '„{name}" auf {wall}/{slot} gelegt.': '"{name}" placed on {wall}/{slot}.',
  'Layer entfernt.': 'Layer removed.',
  'Layer {id} wurde nicht gefunden.': 'Layer {id} was not found.',
  'Slot {id} gibt es nirgends.': 'Slot {id} does not exist anywhere.',
  'Layer nach {wall}/{slot} verschoben.': 'Layer moved to {wall}/{slot}.',
  'Gespeichert {time}': 'Saved {time}',
  'Projekt konnte nicht gespeichert werden': 'The project could not be saved',
});

/* ==========================================================================
 * Ausgangszustand
 * ========================================================================== */

function initialState() {
  return {
    health: null,
    /** Das gerade benutzte Venue, volles JSON. */
    venue: null,
    /** Kurzliste aller bekannten Venues: [{ id, name, wallCount }]. */
    venues: [],
    /** Arbeitsordner des Rechners: { path, exists, writable, ... } oder null. */
    workspace: null,
    project: null,
    jobs: [],
    media: [], // Spiegel von project.media
    ui: {
      activeWallId: 'D',
      activeSlotId: 'master',
      selectedLayerId: null,
      /** 'stage3d' | 'editor' | 'library' | 'render' | 'qc' | 'venue' */
      view: 'stage3d',
      transport: { playing: false, timeSec: 0, loopSec: 20, rate: 1 },
      overlays: { seams: false, safeArea: false, grid: false, ruler: false, wireframe: false, sightlines: false },
      /**
       * Panels, die gemeinsam bewegt werden, als "wandId/panelId".
       * Reiner Anzeigezustand — wird nicht ins Projekt gespeichert. Was
       * gespeichert wird, sind die Fahrwege selbst (slot.travelOverrideM).
       */
      selectedPanels: [],
      stage: {
        cameraPreset: 'audience', showFloor: true, showFigure: true, ledRealism: true,
        showScenery: true, showReflections: true, testPattern: true,
        bezel: 0.4, blackLift: 0.02, brightness: 1.0, ambient: 0.15,
      },
      status: '',
    },
  };
}

let state = initialState();
const subscribers = new Set();
let notifyQueued = false;

function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    const snapshot = state;
    for (const fn of [...subscribers]) {
      try {
        fn(snapshot);
      } catch (e) {
        // Ein kaputter Abonnent darf nicht die ganze Oberflaeche lahmlegen.
        console.error('[store] Abonnent hat geworfen:', e);
        reportError(t('Anzeigefehler: {msg}', { msg: e.message }));
      }
    }
  });
}

/** Nur ui.status setzen, ohne Rekursion in reportError. */
function reportError(msg) {
  state = { ...state, ui: { ...state.ui, status: msg } };
  if (!notifyQueued) {
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      for (const fn of [...subscribers]) { try { fn(state); } catch { /* schon gemeldet */ } }
    });
  }
}

/* ==========================================================================
 * Zusammenfuehren von Patches
 * ========================================================================== */

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node);
}

/** Tiefe Verschmelzung: Objekte rekursiv, alles andere ersetzt. */
export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/**
 * Patch auf den Wurzelstate anwenden. ui und dessen bekannte Unterobjekte
 * werden verschmolzen statt ersetzt, damit store.set({ ui:{ view:'render' } })
 * nicht den halben Zustand loescht.
 */
function applyPatch(base, patch) {
  if (!isPlainObject(patch)) return base;
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'ui' && isPlainObject(v)) next.ui = deepMerge(base.ui, v);
    else next[k] = v;
  }
  // media haengt immer am Projekt
  if (patch.project && !('media' in patch)) next.media = patch.project?.media || [];
  return next;
}

/* ==========================================================================
 * Store
 * ========================================================================== */

export const store = {
  /** Aktueller State. NICHT mutieren. */
  get() {
    return state;
  },

  /**
   * set(patch) oder set(state => patchOderNeuerState).
   * Zweites Argument { silent: true } aendert den Zustand ohne Benachrichtigung —
   * gedacht fuer die Transportzeit waehrend der Wiedergabe, damit die Panels
   * nicht 60-mal je Sekunde neu gezeichnet werden.
   */
  set(updaterOrPatch, opts = {}) {
    const patch = typeof updaterOrPatch === 'function' ? updaterOrPatch(state) : updaterOrPatch;
    if (patch == null) return state;
    state = applyPatch(state, patch);
    if (!opts.silent) notify();
    return state;
  },

  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
};

/* ==========================================================================
 * Statuszeile
 * ========================================================================== */

/** Text in der Statuszeile unten. level: '' | 'ok' | 'warn' | 'err' */
export function setStatus(text, level = '') {
  store.set({ ui: { status: text, statusLevel: level } });
  if (level === 'err') console.error('[tbg]', text);
}

/** Einheitliche Fehlerbehandlung: loggen UND dem Nutzer zeigen. */
export function showError(prefix, err) {
  const msg = `${prefix}: ${err && err.message ? err.message : String(err)}`;
  console.error('[tbg]', prefix, err);
  setStatus(msg, 'err');
  return msg;
}

/* ==========================================================================
 * Suchen im Projekt
 * ========================================================================== */

/** { wallId, slotId, slot, layer, index } oder null. */
export function layerLocation(st, layerId) {
  const project = (st && st.project) || null;
  if (!project || !layerId) return null;
  for (const [wallId, wall] of Object.entries(project.walls || {})) {
    for (const [slotId, slot] of Object.entries(wall.slots || {})) {
      const index = (slot.layers || []).findIndex((l) => l.id === layerId);
      if (index >= 0) return { wallId, slotId, slot, layer: slot.layers[index], index };
    }
  }
  return null;
}

/** Der aktuell ausgewaehlte Layer oder null. */
export function activeLayer(st = state) {
  const loc = layerLocation(st, st?.ui?.selectedLayerId);
  return loc ? loc.layer : null;
}

/** Der aktive Slot (Wand + Slot aus ui) oder null. */
export function activeSlot(st = state) {
  const wall = st?.project?.walls?.[st?.ui?.activeWallId];
  return wall ? wall.slots?.[st.ui.activeSlotId] || null : null;
}

/* ==========================================================================
 * Projekt veraendern — jede Funktion erzeugt neue Objekte und markiert dreckig
 * ========================================================================== */

function withSlot(project, wallId, slotId, mutate) {
  const wall = project.walls?.[wallId];
  if (!wall) throw new Error(t('Wand {id} gibt es im Projekt nicht', { id: wallId }));
  const slot = wall.slots?.[slotId];
  if (!slot) throw new Error(t('Slot {id} gibt es auf Wand {wall} nicht', { id: slotId, wall: wallId }));
  const newSlot = mutate(slot);
  return {
    ...project,
    walls: {
      ...project.walls,
      [wallId]: { ...wall, slots: { ...wall.slots, [slotId]: newSlot } },
    },
  };
}

function commit(project, extraUi) {
  const patch = { project: { ...project, modifiedAt: new Date().toISOString() } };
  if (extraUi) patch.ui = extraUi;
  store.set(patch);
  markDirty();
}

/** Layer irgendwo im Projekt finden und tief patchen. */
export function updateLayer(layerId, patch) {
  const loc = layerLocation(state, layerId);
  if (!loc) {
    setStatus(t('Layer {id} wurde nicht gefunden — vermutlich schon gelöscht.', { id: layerId }), 'warn');
    return null;
  }
  try {
    const project = withSlot(state.project, loc.wallId, loc.slotId, (slot) => ({
      ...slot,
      layers: slot.layers.map((l) => (l.id === layerId ? deepMerge(l, patch) : l)),
    }));
    commit(project);
    return layerLocation(store.get(), layerId).layer;
  } catch (e) {
    showError(t('Layer konnte nicht geändert werden'), e);
    return null;
  }
}

/** Wandzustand patchen (travel, travelMode, visible, previewGain, ...). */
export function updateWall(wallId, patch) {
  const wall = state.project?.walls?.[wallId];
  if (!wall) {
    setStatus(t('Wand {id} gibt es im Projekt nicht.', { id: wallId }), 'warn');
    return null;
  }
  const project = {
    ...state.project,
    walls: { ...state.project.walls, [wallId]: deepMerge(wall, patch) },
  };
  commit(project);
  return store.get().project.walls[wallId];
}

/** Slot patchen (enabled, travelOverrideM). */
export function updateSlot(wallId, slotId, patch) {
  try {
    const project = withSlot(state.project, wallId, slotId, (slot) => deepMerge(slot, patch));
    commit(project);
  } catch (e) {
    showError(t('Slot konnte nicht geändert werden'), e);
  }
}

/** Neuen Layer aus einem Medium auf einen Slot legen und auswaehlen. */
export function addLayer(wallId, slotId, mediaId) {
  const project0 = state.project;
  if (!project0) { setStatus(t('Kein Projekt geladen.'), 'err'); return null; }
  const media = (project0.media || []).find((m) => m.id === mediaId);
  if (!media) { setStatus(t('Medium {id} ist nicht in der Bibliothek.', { id: mediaId }), 'err'); return null; }

  let created = null;
  try {
    const project = withSlot(project0, wallId, slotId, (slot) => {
      const layer = makeLayer(mediaId, { label: media.name || '' });
      // Zielrechteck vorbelegen: ganzer Slot. Beim Render rechnet fit das ohnehin neu,
      // aber die Oberflaeche soll sofort etwas Sinnvolles anzeigen.
      layer.transform.dest = { x: 0, y: 0, w: slot.width, h: slot.height };
      created = layer;
      return { ...slot, layers: [...slot.layers, layer] };
    });
    commit(project, { activeWallId: wallId, activeSlotId: slotId, selectedLayerId: created.id });
    setStatus(t('„{name}" auf {wall}/{slot} gelegt.', { name: media.name, wall: wallId, slot: slotId }), 'ok');
    return created;
  } catch (e) {
    showError(t('Layer konnte nicht angelegt werden'), e);
    return null;
  }
}

/** Layer entfernen. */
export function removeLayer(layerId) {
  const loc = layerLocation(state, layerId);
  if (!loc) return;
  const project = withSlot(state.project, loc.wallId, loc.slotId, (slot) => ({
    ...slot,
    layers: slot.layers.filter((l) => l.id !== layerId),
  }));
  const ui = state.ui.selectedLayerId === layerId ? { selectedLayerId: null } : null;
  commit(project, ui);
  setStatus(t('Layer entfernt.'));
}

/**
 * Layer in einen anderen Slot verschieben. Zuerst wird in der eigenen Wand
 * gesucht, sonst in allen anderen Waenden — "master" gibt es schliesslich
 * auf jeder Wand.
 */
export function moveLayer(layerId, toSlotId) {
  const loc = layerLocation(state, layerId);
  if (!loc) { setStatus(t('Layer {id} wurde nicht gefunden.', { id: layerId }), 'warn'); return; }

  let targetWallId = null;
  if (state.project.walls[loc.wallId]?.slots?.[toSlotId]) targetWallId = loc.wallId;
  else {
    for (const [wid, w] of Object.entries(state.project.walls)) {
      if (w.slots?.[toSlotId]) { targetWallId = wid; break; }
    }
  }
  if (!targetWallId) { setStatus(t('Slot {id} gibt es nirgends.', { id: toSlotId }), 'err'); return; }
  if (targetWallId === loc.wallId && toSlotId === loc.slotId) return;

  const layer = loc.layer;
  let project = withSlot(state.project, loc.wallId, loc.slotId, (slot) => ({
    ...slot,
    layers: slot.layers.filter((l) => l.id !== layerId),
  }));
  project = withSlot(project, targetWallId, toSlotId, (slot) => {
    // Zielrechteck auf die neue Slotgroesse ziehen, sonst haengt der Layer im Nichts.
    const t = layer.transform || {};
    const dest = t.fit === 'manual' ? t.dest : { x: 0, y: 0, w: slot.width, h: slot.height };
    return { ...slot, layers: [...slot.layers, { ...layer, transform: { ...t, dest } }] };
  });
  commit(project, { activeWallId: targetWallId, activeSlotId: toSlotId, selectedLayerId: layerId });
  setStatus(t('Layer nach {wall}/{slot} verschoben.', { wall: targetWallId, slot: toSlotId }));
}

/** Reihenfolge innerhalb eines Slots aendern (delta -1 = weiter nach unten stapeln). */
export function reorderLayer(layerId, delta) {
  const loc = layerLocation(state, layerId);
  if (!loc) return;
  const to = loc.index + delta;
  if (to < 0 || to >= loc.slot.layers.length) return;
  const project = withSlot(state.project, loc.wallId, loc.slotId, (slot) => {
    const layers = [...slot.layers];
    const [l] = layers.splice(loc.index, 1);
    layers.splice(to, 0, l);
    return { ...slot, layers };
  });
  commit(project);
}

/** Projekt-Kopfdaten (name, loopSeconds, fps, background, notes). */
export function updateProject(patch) {
  if (!state.project) return;
  commit(deepMerge(state.project, patch));
}

/** Medienliste ersetzen bzw. ergaenzen. */
export function mergeMedia(list) {
  if (!state.project || !Array.isArray(list) || list.length === 0) return;
  const byId = new Map((state.project.media || []).map((m) => [m.id, m]));
  const byPath = new Map((state.project.media || []).map((m) => [m.absPath, m]));
  for (const m of list) {
    const existing = byId.get(m.id) || byPath.get(m.absPath);
    if (existing) byId.set(existing.id, { ...existing, ...m, id: existing.id });
    else byId.set(m.id, m);
  }
  commit({ ...state.project, media: [...byId.values()] });
}

/** Medium aus der Bibliothek werfen und alle Layer darauf mit entfernen. */
export function dropMedia(mediaId) {
  if (!state.project) return;
  const walls = {};
  for (const [wid, wall] of Object.entries(state.project.walls)) {
    const slots = {};
    for (const [sid, slot] of Object.entries(wall.slots)) {
      slots[sid] = { ...slot, layers: slot.layers.filter((l) => l.mediaId !== mediaId) };
    }
    walls[wid] = { ...wall, slots };
  }
  commit({ ...state.project, walls, media: state.project.media.filter((m) => m.id !== mediaId) });
}

/* ==========================================================================
 * Speichern — gebuendelt, 800 ms nach der letzten Aenderung
 * ========================================================================== */

let saveTimer = null;
let savePending = false;
let saveInFlight = false;
let savePromise = null;
let saveFailures = 0;
let retryAt = 0;

function scheduleSave(delay = 800) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, Math.max(delay, retryAt - Date.now()));
}

export function markDirty() {
  savePending = true;
  // Die laufende Anfrage nimmt weitere Aenderungen direkt danach mit.
  if (!saveInFlight) scheduleSave();
}

/** Sofort speichern. true erst, wenn auch zwischenzeitliche Aenderungen gesichert sind. */
export async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (savePromise) return savePromise;
  if (!state.project) { savePending = false; return true; }
  savePending = true;
  saveInFlight = true;
  savePromise = (async () => {
    while (savePending && state.project) {
      savePending = false;
      try {
        const res = await putProject(state.project);
        saveFailures = 0;
        retryAt = 0;
        if (!savePending) {
          setStatus(t('Gespeichert {time}', { time: new Date(res?.modifiedAt || Date.now()).toLocaleTimeString(getLang() === 'de' ? 'de-DE' : 'en-US') }), 'ok');
        }
      } catch (e) {
        savePending = true;
        // Offline oder voller Browser-Speicher: weiter als ungespeichert
        // markieren, aber nicht dauerhaft alle 800 ms dieselbe Anfrage senden.
        saveFailures += 1;
        retryAt = Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(saveFailures, 5));
        showError(t('Projekt konnte nicht gespeichert werden'), e);
        return false;
      }
    }
    return true;
  })().finally(() => {
    saveInFlight = false;
    savePromise = null;
    if (savePending) scheduleSave();
  });
  return savePromise;
}

/** Gibt es ungespeicherte Aenderungen? */
export function isDirty() {
  return savePending || saveInFlight;
}
