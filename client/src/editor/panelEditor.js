/**
 * Theater-Bild-Gelöte — 2D-Panel-Editor.
 *
 * Reines Canvas-2D. Kein three, keine Bibliothek, kein Build-Schritt.
 *
 * ---------------------------------------------------------------------------
 * WAS DIESE ANSICHT ZEIGT
 * ---------------------------------------------------------------------------
 * Die aktive Wand (state.ui.activeWallId) in WANDPIXELN, eingepasst in den
 * Canvas, mit freiem Zoom/Pan. Darauf alle Layer aller Slots dieser Wand,
 * gezeichnet aus den <video>-Elementen des videoPool.
 *
 * Koordinatenraeume, die hier vorkommen — Verwechslung ist die haeufigste
 * Fehlerquelle, deshalb ausbuchstabiert:
 *
 *   QUELLE   Pixel der Mediendatei.   transform.crop lebt hier.
 *   SLOT     Pixel des Slots.          transform.dest und transform.offset leben hier.
 *   WAND     Pixel der ganzen Wand.    = SLOT + slot.x (Slots sind immer volle Hoehe).
 *   SCHIRM   CSS-Pixel im Canvas.      = WAND * view.scale + view.tx/ty.
 *
 * Alles Rechnen passiert in WAND-Pixeln, erst beim Zeichnen wird auf SCHIRM
 * umgerechnet. Geschrieben wird immer zurueck in SLOT-Pixeln.
 * ---------------------------------------------------------------------------
 */

import {
  wallLayersInOrder,
  defaultTransform,
  defaultFilters,
  findMedia,
} from '/shared/model.js';
import { t, register, fmtNum, fmtMeters, onLangChange } from '../i18n.js';

/*
 * ACHTUNG beim Lesen: die Geometriefunktionen benutzen `t` als lokale Variable
 * fuer layer.transform (cropRect, layerGeom) beziehungsweise fuer die Oberkante
 * eines Rechtecks (resizeRect). Dort ist das importierte `t` verdeckt — und dort
 * wird auch kein Text ausgegeben. Wer das aendert, muss erst umbenennen.
 */

register('en', {
  // Aufbau und Fehler
  'panelEditor: kein Canvas uebergeben.': 'panelEditor: no canvas given.',
  'panelEditor: kein videoPool uebergeben.': 'panelEditor: no videoPool given.',
  'panelEditor: onChange(layerId, transformPatch) fehlt.':
    'panelEditor: onChange(layerId, transformPatch) is missing.',
  'panelEditor: 2D-Kontext nicht verfuegbar.': 'panelEditor: 2D context not available.',
  'Layerliste konnte nicht gebildet werden: {msg}':
    'The layer list could not be built: {msg}',
  'Videoelement fuer {id} nicht verfuegbar: {msg}':
    'Video element for {id} not available: {msg}',
  'Layer {name} kann nicht gezeichnet werden: {msg}':
    'Layer {name} cannot be drawn: {msg}',
  'Feather wird bei diesem Zoom nicht dargestellt — Zwischenbild zu gross.':
    'Feather is not shown at this zoom level — the intermediate image is too large.',
  'Änderung konnte nicht übernommen werden: {msg}':
    'The change could not be applied: {msg}',
  'Layer konnte nicht entfernt werden: {msg}': 'The layer could not be removed: {msg}',
  'Editor-Fehler: {msg}': 'Editor error: {msg}',
  'Zeichnen fehlgeschlagen:': 'Drawing failed:',
  'Neu zeichnen nach Sprachwechsel fehlgeschlagen: {msg}':
    'Redrawing after the language change failed: {msg}',

  // Leere Zustaende
  'Kein Zustand geladen.': 'No state loaded.',
  'Kein Venue geladen — /api/venues/:id liefert nichts.':
    'No venue loaded — /api/venues/:id returns nothing.',
  'Wand {wall} gibt es im Venue {venue} nicht.':
    'Venue {venue} has no wall {wall}.',
  'Wand {wall} fehlt im Projekt.': 'Wall {wall} is missing from the project.',
  'Datei fehlt im Projekt': 'File missing from the project',
  '{name} — Proxy fehlt oder laedt noch': '{name} — proxy missing or still loading',

  // Panelbeschriftung auf der Wand
  '{panel}  ·  {px} px  ·  {m}': '{panel}  ·  {px} px  ·  {m}',

  // Modusschalter
  'Platzieren  [P]': 'Place  [P]',
  'Croppen  [C]': 'Crop  [C]',

  // Infozeile oben links
  'Kein Layer gewaehlt — Klick auf ein Bild waehlt es aus. Rechtsklick oeffnet das Menue.':
    'No layer selected — click an image to select it. Right-click opens the menu.',
  '{label}{name}   —   Slot {slot} auf Wand {wall}{off}':
    '{label}{name}   —   slot {slot} on wall {wall}{off}',
  '   (Layer ist abgeschaltet)': '   (layer is switched off)',
  '(Datei fehlt)': '(file missing)',
  'Quelle {src}    Ausschnitt {crop}    Ziel {dest}    fit {fit}{note}':
    'Source {src}    Crop {crop}    Target {dest}    fit {fit}{note}',
  ' (dest noch aus fit gerechnet)': ' (dest still derived from fit)',
  '{w} × {h} px': '{w} × {h} px',
  'unbekannt (noch nicht geprobt)': 'unknown (not probed yet)',
  'ganze Quelle': 'entire source',
  'x {x} · y {y} · {w} × {h} px': 'x {x} · y {y} · {w} × {h} px',
  'x {x} · y {y} · {w} × {h} px (Wand)': 'x {x} · y {y} · {w} × {h} px (wall)',
  'Skalierung {x} %': 'Scaling {x} %',
  'Skalierung {x} % / {y} % (nicht proportional)':
    'Scaling {x} % / {y} % (not proportional)',
  'Quelle wird auf {n} % vergrößert — wird auf der LED weich.':
    'Source is scaled up to {n} % — will look soft on the LED wall.',
  'Motiv liegt auf der Mittelnaht — reißt beim Auffahren.':
    'Content sits on the centre seam — it tears when the wall opens.',
  'Layer ragt in die äußeren {n} % (Sperrzone).':
    'Layer reaches into the outer {n} % (safe area).',

  // Kontextmenue
  'Auf Panel einpassen': 'Fit to panel',
  'Auf Wand einpassen': 'Fit to wall',
  'Originalgröße': 'Original size',
  'Horizontal zentrieren': 'Centre horizontally',
  'Vertikal zentrieren': 'Centre vertically',
  'Crop zurücksetzen': 'Reset crop',
  'Layer entfernen': 'Remove layer',
  'Entfernen ist hier nicht angeschlossen — der Editor bekam kein onRemove(layerId).':
    'Removing is not wired up here — the editor was given no onRemove(layerId).',
  'Aktion nicht verfügbar.': 'Action not available.',
  'Unbekannte Menüaktion "{id}".': 'Unknown menu action "{id}".',

  // Statusmeldungen
  'Kein Layer unter dem Zeiger.': 'No layer under the pointer.',
  'Croppen geht erst, wenn die Quellauflösung bekannt ist.':
    'Cropping only works once the source resolution is known.',
  'Ziehen abgebrochen.': 'Drag cancelled.',
  'Croppen: der helle Rahmen ist der Ausschnitt aus der Quelle.':
    'Crop: the bright frame is the crop taken from the source.',
  'Platzieren: der Rahmen ist das Zielrechteck auf der Wand.':
    'Place: the frame is the target rectangle on the wall.',
  'Layer auf Slot {slot} eingepasst (cover).': 'Layer fitted to slot {slot} (cover).',
  'Auf ganze Wand gelegt — sichtbar bleibt nur der Teil im Slot {slot}.':
    'Placed across the whole wall — only the part inside slot {slot} stays visible.',
  'Quellauflösung unbekannt — erst Bibliothek einlesen.':
    'Source resolution unknown — scan the library first.',
  'Originalgröße: {w} × {h} px.': 'Original size: {w} × {h} px.',
  'Quellauflösung unbekannt — Crop kann nicht zurückgesetzt werden.':
    'Source resolution unknown — the crop cannot be reset.',
  'Ausschnitt zurückgesetzt — ganze Quelle.': 'Crop reset — entire source.',
});

/* ==========================================================================
 * Konstanten
 * ========================================================================== */

const COL = {
  bg: '#0b0d10',
  bgGrid: '#151a20',
  wallVoid: '#000000',
  panelLine: 'rgba(255,255,255,0.22)',
  seam: 'rgba(255,255,255,0.55)',
  seamCenter: '#ff4d5e',
  wallEdge: 'rgba(255,255,255,0.75)',
  text: '#e8edf2',
  textDim: '#93a1b0',
  accent: '#54d6ff',
  accentDark: '#0b2b36',
  warn: '#ffb300',
  danger: '#ff4d5e',
  ok: '#5ce08a',
  guide: '#ffe14d',
  menuBg: 'rgba(18,22,28,0.97)',
  menuHover: 'rgba(84,214,255,0.18)',
  chip: 'rgba(10,13,17,0.82)',
};

/** Bildschirmpixel — Anfassergroesse, unabhaengig vom Zoom. */
const HANDLE_PX = 9;
/** Fangtoleranz in Bildschirmpixeln (Vorgabe). */
const SNAP_TOL_PX = 6;
/** Wie lange eine getroffene Hilfslinie aufleuchtet, Millisekunden. */
const SNAP_FLASH_MS = 420;
/** Kleinste zulaessige Kantenlaenge eines Zielrechtecks in Wandpixeln. */
const MIN_RECT = 8;
/** Groesster Zwischen-Canvas fuer Feather. Darueber wird ohne Feather gezeichnet. */
const SCRATCH_MAX = 4096;

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
};

const BLEND_MAP = {
  normal: 'source-over',
  add: 'lighter',
  screen: 'screen',
  multiply: 'multiply',
};

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function num(v, fallback = 0) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function intersectRect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bo = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, bo - y) };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/* ==========================================================================
 * Fabrik
 * ========================================================================== */

/**
 * @param {object}   opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {object}   opts.videoPool  - aus media/videoPool.js
 * @param {(layerId:string, transformPatch:object)=>void} opts.onChange
 * @param {(layerId:string|null)=>void} [opts.onSelect]  - optional, siehe Kopfnotiz
 * @param {(layerId:string)=>void}      [opts.onRemove]  - optional, siehe Kopfnotiz
 * @param {(text:string)=>void}         [opts.onStatus]  - optional, Statuszeile
 */
export function createPanelEditor({ canvas, videoPool, onChange, onSelect, onRemove, onStatus }) {
  if (!canvas) throw new Error(t('panelEditor: kein Canvas uebergeben.'));
  if (!videoPool) throw new Error(t('panelEditor: kein videoPool uebergeben.'));
  if (typeof onChange !== 'function') {
    throw new Error(t('panelEditor: onChange(layerId, transformPatch) fehlt.'));
  }

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error(t('panelEditor: 2D-Kontext nicht verfuegbar.'));

  /* --- interner Zustand ------------------------------------------------- */

  let state = null;               // letzter State aus dem Store
  let dirty = true;               // Neuzeichnen noetig?
  let disposed = false;

  let cssW = 0, cssH = 0, dpr = 1;

  /** Ansicht: Wandpixel -> CSS-Pixel. */
  const view = { scale: 1, tx: 0, ty: 0, fittedFor: null };

  /** 'place' = Zielrechteck aendern, 'crop' = Ausschnitt aus der Quelle aendern. */
  let mode = 'place';

  /** Lokale Auswahl. Wird aus state.ui.selectedLayerId uebernommen, wenn die sich aendert. */
  let selectedLayerId = null;
  let lastSeenSelection = undefined;

  let spaceDown = false;
  let hoverHandle = null;
  let hoverMenuIndex = -1;
  let lastTimeSec = -1;

  /** Aktive Zieh-Operation. */
  let drag = null;

  /** Kontextmenue, direkt auf den Canvas gezeichnet. */
  let menu = null;

  /** Aufleuchtende Fanglinien: { axis:'x'|'y', v:number, t:number } */
  let flashes = [];

  /** Meldung in Warnfarbe unter der Infozeile, mit Verfallszeit. */
  let notice = null;

  /** Fehler, die schon geloggt wurden — verhindert Logspam pro Frame. */
  const warned = new Set();

  /** Drosselung der onChange-Meldungen waehrend des Ziehens. */
  let pendingEmit = null;
  let emitRaf = 0;

  /* --- Hilfs-Canvasse --------------------------------------------------- */

  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d');

  const hatch = (() => {
    const c = document.createElement('canvas');
    c.width = 10; c.height = 10;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,77,94,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-2, 12); g.lineTo(12, -2);
    g.moveTo(3, 12); g.lineTo(12, 3);
    g.stroke();
    return ctx.createPattern(c, 'repeat');
  })();

  /* --- Trefferflaechen, bei jedem Zeichnen neu gefuellt ------------------ */

  let hitModeButtons = [];   // [{ id, x, y, w, h, label }]

  /* ======================================================================
   * Zugriff auf das Modell
   * ====================================================================== */

  function wallSpec() {
    const venue = state?.venue;
    const id = state?.ui?.activeWallId;
    if (!venue || !Array.isArray(venue.walls) || !id) return null;
    return venue.walls.find((w) => w.id === id) || null;
  }

  function wallState() {
    const id = state?.ui?.activeWallId;
    if (!state?.project?.walls || !id) return null;
    return state.project.walls[id] || null;
  }

  function pixelsPerMeter() {
    const spec = wallSpec();
    const derived = num(state?.venue?.derived?.pixelsPerMeter, 0);
    if (derived > 0) return derived;
    if (spec && num(spec.widthM, 0) > 0) return spec.width / spec.widthM;
    return 251;
  }

  /** Alle sichtbaren Layer der aktiven Wand in Renderreihenfolge. */
  function visibleLayers() {
    const ws = wallState();
    const spec = wallSpec();
    if (!ws || !spec) return [];
    try {
      return wallLayersInOrder(ws, spec);
    } catch (err) {
      warnOnce('wallLayersInOrder',
        t('Layerliste konnte nicht gebildet werden: {msg}', { msg: err.message }));
      return [];
    }
  }

  /** Sucht einen Layer in allen Slots der aktiven Wand — auch abgeschaltete. */
  function findLayerAnywhere(layerId) {
    const ws = wallState();
    if (!ws || !layerId) return null;
    for (const slotId of Object.keys(ws.slots || {})) {
      const slot = ws.slots[slotId];
      const layer = (slot.layers || []).find((l) => l.id === layerId);
      if (layer) return { slot, layer };
    }
    return null;
  }

  function mediaOf(layer) {
    if (!state?.project || !layer) return null;
    try {
      return findMedia(state.project, layer.mediaId);
    } catch {
      return null;
    }
  }

  function sourceSize(layer) {
    const media = mediaOf(layer);
    let w = num(media?.probe?.width, 0);
    let h = num(media?.probe?.height, 0);
    if (w > 0 && h > 0) return { w, h };
    const el = tryAcquire(layer.mediaId);
    if (el && el.naturalWidth > 0) return { w: el.naturalWidth, h: el.naturalHeight };
    if (el && el.videoWidth > 0) return { w: el.videoWidth, h: el.videoHeight };
    return { w: 0, h: 0 };
  }

  function tryAcquire(mediaId) {
    if (!mediaId) return null;
    try {
      return videoPool.acquire(mediaId) || null;
    } catch (err) {
      warnOnce(`acquire:${mediaId}`,
        t('Videoelement fuer {id} nicht verfuegbar: {msg}', { id: mediaId, msg: err.message }));
      return null;
    }
  }

  function warnOnce(key, msg) {
    if (warned.has(key)) return;
    warned.add(key);
    // Fehler sind nie still: Konsole UND sichtbare Meldung.
    console.warn('[panelEditor]', msg);
    setNotice(msg, 6000);
  }

  function setNotice(text, ms = 4000) {
    notice = { text, until: performance.now() + ms };
    dirty = true;
    if (typeof onStatus === 'function') {
      try { onStatus(text); } catch (err) { console.warn('[panelEditor] onStatus:', err); }
    }
  }

  /* ======================================================================
   * Geometrie
   * ====================================================================== */

  /**
   * Ausschnitt aus der Quelle in Quellpixeln. crop === null heisst ganze Quelle.
   */
  function cropRect(layer, src) {
    const t = layer.transform || defaultTransform();
    const c = t.crop;
    if (!c || !(num(c.w, 0) > 0) || !(num(c.h, 0) > 0)) {
      return { x: 0, y: 0, w: src.w, h: src.h, full: true };
    }
    return { x: num(c.x), y: num(c.y), w: num(c.w), h: num(c.h), full: false };
  }

  /**
   * Zielrechteck aus fit + Ausschnitt, falls dest noch leer ist.
   * Spiegelt, was der Renderer bei fit != 'manual' rechnet.
   */
  function fitRect(slot, fit, crop) {
    const sw = slot.width, sh = slot.height;
    if (!(crop.w > 0) || !(crop.h > 0)) return { x: 0, y: 0, w: sw, h: sh };
    let k;
    switch (fit) {
      case 'contain': k = Math.min(sw / crop.w, sh / crop.h); break;
      case 'stretch': return { x: 0, y: 0, w: sw, h: sh };
      case 'native':  k = 1; break;
      case 'cover':
      default:        k = Math.max(sw / crop.w, sh / crop.h); break;
    }
    const w = crop.w * k, h = crop.h * k;
    return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
  }

  /**
   * Alles, was zum Zeichnen eines Layers gebraucht wird.
   * dest ist bereits in WANDPIXELN und enthaelt offset und zoom.
   */
  function layerGeom(slot, layer) {
    const t = layer.transform || defaultTransform();
    const src = sourceSize(layer);
    const crop = cropRect(layer, src);

    let d = t.dest;
    const destLeer = !d || !(num(d.w, 0) > 0) || !(num(d.h, 0) > 0);
    if (destLeer) d = fitRect(slot, t.fit || 'cover', crop);

    const off = t.offset || { x: 0, y: 0 };
    const zoom = num(t.zoom, 1) || 1;

    const cx = num(d.x) + num(off.x) + num(d.w) / 2;
    const cy = num(d.y) + num(off.y) + num(d.h) / 2;
    const w = num(d.w) * zoom;
    const h = num(d.h) * zoom;

    return {
      src,
      crop,
      // WANDPIXEL:
      dest: { x: slot.x + cx - w / 2, y: cy - h / 2, w, h },
      rotate: ((num(t.rotate) % 360) + 360) % 360,
      flipH: !!t.flipH,
      flipV: !!t.flipV,
      fit: t.fit || 'cover',
      destWasEmpty: destLeer,
    };
  }

  function slotWallRect(slot) {
    return { x: slot.x, y: 0, w: slot.width, h: slot.height };
  }

  /**
   * Zielrechteck (Wandpixel) -> transform-Patch.
   * offset und zoom werden dabei in dest eingebacken, damit nichts doppelt zaehlt,
   * und fit auf 'manual' gesetzt — sonst rechnet der Renderer dest wieder weg.
   */
  function destPatch(slot, wallRect) {
    return {
      fit: 'manual',
      dest: {
        x: Math.round(wallRect.x - slot.x),
        y: Math.round(wallRect.y),
        w: Math.round(Math.max(MIN_RECT, wallRect.w)),
        h: Math.round(Math.max(MIN_RECT, wallRect.h)),
      },
      offset: { x: 0, y: 0 },
      zoom: 1,
    };
  }

  /* ======================================================================
   * Ansicht: Zoom, Pan, Einpassen
   * ====================================================================== */

  function toScreenX(wx) { return wx * view.scale + view.tx; }
  function toScreenY(wy) { return wy * view.scale + view.ty; }
  function toWallX(sx) { return (sx - view.tx) / view.scale; }
  function toWallY(sy) { return (sy - view.ty) / view.scale; }

  function fitView() {
    const spec = wallSpec();
    if (!spec || cssW <= 0 || cssH <= 0) return;
    const padX = 40;
    const padTop = 92;      // Platz fuer Infozeile und Modusschalter
    const padBottom = 74;   // Platz fuer das Lineal
    const availW = Math.max(40, cssW - padX * 2);
    const availH = Math.max(40, cssH - padTop - padBottom);
    view.scale = Math.min(availW / spec.width, availH / spec.height);
    view.tx = (cssW - spec.width * view.scale) / 2;
    view.ty = padTop + (availH - spec.height * view.scale) / 2;
    view.fittedFor = `${spec.id}:${cssW}x${cssH}`;
    dirty = true;
  }

  function zoomAt(sx, sy, factor) {
    const next = clamp(view.scale * factor, 0.01, 40);
    const f = next / view.scale;
    view.tx = sx - (sx - view.tx) * f;
    view.ty = sy - (sy - view.ty) * f;
    view.scale = next;
    dirty = true;
  }

  /* ======================================================================
   * Fanglinien
   * ====================================================================== */

  /** Alle Fangwerte in Wandpixeln, getrennt nach Achse. */
  function guides() {
    const spec = wallSpec();
    if (!spec) return { x: [], y: [] };
    const W = spec.width, H = spec.height;
    const safe = num(spec.safeAreaPct, 0.15);

    const gx = new Set([0, W, W / 2]);
    if (num(spec.centerSeamX, 0) > 0) gx.add(spec.centerSeamX);
    for (const p of spec.panels || []) {
      gx.add(p.x);
      gx.add(p.x + p.width);
    }
    gx.add(W / 3); gx.add((W * 2) / 3);
    gx.add(W * safe); gx.add(W * (1 - safe));

    const gy = new Set([0, H, H / 2, H / 3, (H * 2) / 3, H * safe, H * (1 - safe)]);

    return { x: [...gx], y: [...gy] };
  }

  /**
   * Sucht den kleinsten Versatz, der einen der Kandidatenwerte auf eine
   * Hilfslinie zieht. Liefert null, wenn nichts in Reichweite ist.
   */
  function snapDelta(values, delta, lines, tolWall) {
    let best = null;
    for (const v of values) {
      for (const g of lines) {
        const d = g - (v + delta);
        if (Math.abs(d) <= tolWall && (!best || Math.abs(d) < Math.abs(best.d))) {
          best = { d, g };
        }
      }
    }
    return best;
  }

  function flashGuide(axis, v) {
    const now = performance.now();
    const known = flashes.find((f) => f.axis === axis && Math.abs(f.v - v) < 0.5);
    if (known) known.t = now;
    else flashes.push({ axis, v, t: now });
  }

  /* ======================================================================
   * Zeichnen
   * ====================================================================== */

  function draw() {
    dirty = false;
    if (cssW <= 0 || cssH <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const spec = wallSpec();
    const ws = wallState();

    if (!state) { drawCentered(t('Kein Zustand geladen.')); return; }
    if (!state.venue) { drawCentered(t('Kein Venue geladen — /api/venues/:id liefert nichts.')); return; }
    if (!spec) {
      drawCentered(t('Wand {wall} gibt es im Venue {venue} nicht.', {
        wall: state.ui?.activeWallId ?? '?',
        venue: state.venue.id,
      }));
      return;
    }
    if (!ws) { drawCentered(t('Wand {wall} fehlt im Projekt.', { wall: spec.id })); return; }

    if (view.fittedFor !== `${spec.id}:${cssW}x${cssH}` && !drag) fitView();

    const wallScreen = {
      x: toScreenX(0), y: toScreenY(0),
      w: spec.width * view.scale, h: spec.height * view.scale,
    };

    drawWallBase(spec, wallScreen);
    drawLayers(spec, ws, wallScreen);
    drawOverlays(spec, wallScreen);
    drawSelection(spec);
    drawFlashes(spec, wallScreen);
    if (state.ui?.overlays?.ruler !== false) drawRuler(spec, wallScreen);
    drawModeSwitch();
    drawInfo(spec);
    if (menu) drawMenu();
  }

  function drawCentered(text) {
    ctx.fillStyle = COL.textDim;
    ctx.font = '14px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cssW / 2, cssH / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawWallBase(spec, r) {
    // Hintergrundfarbe der Wand aus dem Projekt.
    ctx.fillStyle = state.project?.background || COL.wallVoid;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    if (state.ui?.overlays?.grid) {
      const step = 100;
      if (step * view.scale >= 6) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.lineWidth = 1;
        for (let x = 0; x <= spec.width; x += step) {
          ctx.strokeStyle = x % 500 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)';
          const sx = Math.round(toScreenX(x)) + 0.5;
          ctx.beginPath(); ctx.moveTo(sx, r.y); ctx.lineTo(sx, r.y + r.h); ctx.stroke();
        }
        for (let y = 0; y <= spec.height; y += step) {
          ctx.strokeStyle = y % 500 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)';
          const sy = Math.round(toScreenY(y)) + 0.5;
          ctx.beginPath(); ctx.moveTo(r.x, sy); ctx.lineTo(r.x + r.w, sy); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /* --- Layer ------------------------------------------------------------ */

  function drawLayers(spec, ws, wallScreen) {
    const list = visibleLayers();
    for (const { slot, layer } of list) {
      const geom = liveGeom(slot, layer);
      drawOneLayer(slot, layer, geom, wallScreen);
    }

    // Im Croppen-Modus liegt die Quelle des gewaehlten Layers als Overlay darueber.
    if (mode === 'crop') {
      const sel = findLayerAnywhere(selectedLayerId);
      if (sel && sel.layer.enabled !== false) drawCropOverlay(sel.slot, sel.layer);
    }
  }

  /** Geometrie unter Beruecksichtigung einer laufenden Zieh-Operation. */
  function liveGeom(slot, layer) {
    if (drag && drag.layerId === layer.id && drag.live) {
      const g = layerGeom(slot, layer);
      return { ...g, dest: drag.live.dest || g.dest, crop: drag.live.crop || g.crop };
    }
    return layerGeom(slot, layer);
  }

  function cssFilter(f) {
    const parts = [];
    const b = num(f.brightness, 0);
    // ffmpeg eq=brightness ist additiv, CSS brightness multiplikativ — das hier
    // ist bewusst nur eine Naeherung fuer die Vorschau, nicht der Renderwert.
    if (Math.abs(b) > 1e-3) parts.push(`brightness(${clamp(1 + b, 0, 4).toFixed(3)})`);
    const c = num(f.contrast, 1);
    if (Math.abs(c - 1) > 1e-3) parts.push(`contrast(${clamp(c, 0, 4).toFixed(3)})`);
    const s = num(f.saturation, 1);
    if (Math.abs(s - 1) > 1e-3) parts.push(`saturate(${clamp(s, 0, 4).toFixed(3)})`);
    const hue = num(f.hueDeg, 0);
    if (Math.abs(hue) > 0.5) parts.push(`hue-rotate(${hue.toFixed(1)}deg)`);
    const blur = num(f.blurPx, 0);
    if (blur > 0.01) parts.push(`blur(${(blur * view.scale).toFixed(2)}px)`);
    return parts.length ? parts.join(' ') : 'none';
  }

  function drawOneLayer(slot, layer, geom, wallScreen) {
    const filters = layer.filters || defaultFilters();
    const el = tryAcquire(layer.mediaId);
    const media = mediaOf(layer);

    const dst = {
      x: toScreenX(geom.dest.x), y: toScreenY(geom.dest.y),
      w: geom.dest.w * view.scale, h: geom.dest.h * view.scale,
    };
    const clip = intersectRect(
      { x: toScreenX(slot.x), y: toScreenY(0), w: slot.width * view.scale, h: slot.height * view.scale },
      wallScreen
    );
    if (clip.w <= 0 || clip.h <= 0) return;
    if (!rectsOverlap(dst, clip)) return;

    const ready = el && typeof videoPool.isReady === 'function' ? videoPool.isReady(layer.mediaId) : false;

    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();

    if (!media) {
      drawPlaceholder(dst, t('Datei fehlt im Projekt'), COL.danger);
    } else if (!ready) {
      drawPlaceholder(dst, t('{name} — Proxy fehlt oder laedt noch', { name: media.name }), COL.warn);
    } else {
      const swap = geom.rotate === 90 || geom.rotate === 270;
      const dw = swap ? dst.h : dst.w;
      const dh = swap ? dst.w : dst.h;
      const feather = filters.feather || { l: 0, r: 0, t: 0, b: 0 };
      const hasFeather = num(feather.l) + num(feather.r) + num(feather.t) + num(feather.b) > 0.01;

      ctx.globalAlpha = clamp(num(filters.opacity, 1), 0, 1);
      ctx.globalCompositeOperation = BLEND_MAP[layer.blend] || 'source-over';
      ctx.translate(dst.x + dst.w / 2, dst.y + dst.h / 2);
      if (geom.rotate) ctx.rotate((geom.rotate * Math.PI) / 180);
      ctx.scale(geom.flipH ? -1 : 1, geom.flipV ? -1 : 1);

      const src = geom.crop;
      try {
        if (hasFeather && Math.abs(dw) <= SCRATCH_MAX && Math.abs(dh) <= SCRATCH_MAX) {
          drawFeathered(el, src, dw, dh, feather, cssFilter(filters));
        } else {
          if (hasFeather) {
            warnOnce('feather-zoom',
              t('Feather wird bei diesem Zoom nicht dargestellt — Zwischenbild zu gross.'));
          }
          ctx.filter = cssFilter(filters);
          ctx.drawImage(el, src.x, src.y, src.w, src.h, -dw / 2, -dh / 2, dw, dh);
          ctx.filter = 'none';
        }
      } catch (err) {
        ctx.filter = 'none';
        warnOnce(`draw:${layer.id}`,
          t('Layer {name} kann nicht gezeichnet werden: {msg}', {
            name: media.name, msg: err.message,
          }));
      }
    }
    ctx.restore();

    // Duenner Rahmen um jeden Layer, damit auch schwarze Bilder auffindbar sind.
    ctx.save();
    ctx.setLineDash(layer.id === selectedLayerId ? [] : [4, 4]);
    ctx.strokeStyle = layer.id === selectedLayerId ? COL.accent : 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(dst.x) + 0.5, Math.round(dst.y) + 0.5, Math.round(dst.w), Math.round(dst.h));
    ctx.restore();
  }

  function drawPlaceholder(dst, text, color) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(dst.x, dst.y, dst.w, dst.h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(dst.x + 0.5, dst.y + 0.5, dst.w - 1, dst.h - 1);
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '12px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(text, dst.x + 8, dst.y + 20);
  }

  /**
   * Feather ueber einen Zwischen-Canvas: Bild zeichnen, dann mit
   * 'destination-out' und linearen Verlaeufen die Kanten wegradieren.
   */
  function drawFeathered(el, src, dw, dh, feather, filterStr) {
    const w = Math.max(1, Math.round(Math.abs(dw)));
    const h = Math.max(1, Math.round(Math.abs(dh)));
    if (scratch.width !== w || scratch.height !== h) {
      scratch.width = w;
      scratch.height = h;
    } else {
      sctx.clearRect(0, 0, w, h);
    }
    sctx.globalCompositeOperation = 'source-over';
    sctx.filter = filterStr;
    sctx.drawImage(el, src.x, src.y, src.w, src.h, 0, 0, w, h);
    sctx.filter = 'none';
    sctx.globalCompositeOperation = 'destination-out';

    const fl = num(feather.l) * view.scale;
    const fr = num(feather.r) * view.scale;
    const ft = num(feather.t) * view.scale;
    const fb = num(feather.b) * view.scale;
    const solid = 'rgba(0,0,0,1)', clear = 'rgba(0,0,0,0)';

    if (fl > 0.5) {
      const g = sctx.createLinearGradient(0, 0, Math.min(fl, w), 0);
      g.addColorStop(0, solid); g.addColorStop(1, clear);
      sctx.fillStyle = g; sctx.fillRect(0, 0, Math.min(fl, w), h);
    }
    if (fr > 0.5) {
      const g = sctx.createLinearGradient(w, 0, w - Math.min(fr, w), 0);
      g.addColorStop(0, solid); g.addColorStop(1, clear);
      sctx.fillStyle = g; sctx.fillRect(w - Math.min(fr, w), 0, Math.min(fr, w), h);
    }
    if (ft > 0.5) {
      const g = sctx.createLinearGradient(0, 0, 0, Math.min(ft, h));
      g.addColorStop(0, solid); g.addColorStop(1, clear);
      sctx.fillStyle = g; sctx.fillRect(0, 0, w, Math.min(ft, h));
    }
    if (fb > 0.5) {
      const g = sctx.createLinearGradient(0, h, 0, h - Math.min(fb, h));
      g.addColorStop(0, solid); g.addColorStop(1, clear);
      sctx.fillStyle = g; sctx.fillRect(0, h - Math.min(fb, h), w, Math.min(fb, h));
    }
    sctx.globalCompositeOperation = 'source-over';

    ctx.drawImage(scratch, -dw / 2, -dh / 2, dw, dh);
  }

  /* --- Croppen-Modus: Quelle abgedunkelt, Ausschnitt hell --------------- */

  /**
   * Rechteck der GANZEN Quelle in Wandpixeln, so dass der aktuelle Ausschnitt
   * genau auf dem Zielrechteck liegt. Bleibt beim Ziehen fest — dadurch
   * verschiebt sich beim Croppen das Bild nicht unter der Maus weg.
   */
  function sourceViewRect(slot, layer) {
    const g = liveGeom(slot, layer);
    if (!(g.crop.w > 0) || !(g.crop.h > 0) || !(g.src.w > 0)) return null;
    const kx = g.dest.w / g.crop.w;
    const ky = g.dest.h / g.crop.h;
    return {
      x: g.dest.x - g.crop.x * kx,
      y: g.dest.y - g.crop.y * ky,
      w: g.src.w * kx,
      h: g.src.h * ky,
      kx, ky,
    };
  }

  function drawCropOverlay(slot, layer) {
    const g = liveGeom(slot, layer);
    const el = tryAcquire(layer.mediaId);
    const sv = sourceViewRect(slot, layer);
    if (!sv || !el || !videoPool.isReady?.(layer.mediaId)) return;

    const S = {
      x: toScreenX(sv.x), y: toScreenY(sv.y),
      w: sv.w * view.scale, h: sv.h * view.scale,
    };

    ctx.save();
    // Ganze Quelle, abgedunkelt.
    ctx.globalAlpha = 0.38;
    try {
      ctx.drawImage(el, 0, 0, g.src.w, g.src.h, S.x, S.y, S.w, S.h);
    } catch { /* Element noch nicht bespielbar — die Warnung kam schon aus drawOneLayer */ }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(S.x, S.y, S.w, S.h);

    // Ausschnitt hell.
    const C = {
      x: S.x + g.crop.x * sv.kx * view.scale,
      y: S.y + g.crop.y * sv.ky * view.scale,
      w: g.crop.w * sv.kx * view.scale,
      h: g.crop.h * sv.ky * view.scale,
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(C.x, C.y, C.w, C.h);
    ctx.clip();
    try {
      ctx.drawImage(el, 0, 0, g.src.w, g.src.h, S.x, S.y, S.w, S.h);
    } catch { /* siehe oben */ }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(S.x + 0.5, S.y + 0.5, S.w - 1, S.h - 1);
    ctx.setLineDash([]);
    ctx.strokeStyle = COL.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(C.x, C.y, C.w, C.h);
    ctx.restore();

    drawHandles(C);
  }

  /* --- Naehte, Panels, Sperrzonen --------------------------------------- */

  function drawOverlays(spec, r) {
    const showSeams = state.ui?.overlays?.seams !== false;
    const safe = num(spec.safeAreaPct, 0.15);

    if (state.ui?.overlays?.safeArea) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.fillStyle = hatch;
      const insetX = spec.width * safe * view.scale;
      const insetY = spec.height * safe * view.scale;
      ctx.fillRect(r.x, r.y, insetX, r.h);
      ctx.fillRect(r.x + r.w - insetX, r.y, insetX, r.h);
      ctx.fillRect(r.x + insetX, r.y, r.w - insetX * 2, insetY);
      ctx.fillRect(r.x + insetX, r.y + r.h - insetY, r.w - insetX * 2, insetY);
      ctx.strokeStyle = 'rgba(255,77,94,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(r.x + insetX, r.y + insetY, r.w - insetX * 2, r.h - insetY * 2);
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (!showSeams) return;

    ctx.save();
    for (const p of spec.panels || []) {
      const px = toScreenX(p.x), pw = p.width * view.scale;
      // Keine Flaechenfuellung: sie wuerde ueber dem Bild liegen und den
      // Schwarzwert anheben — genau den will man hier beurteilen koennen.
      ctx.strokeStyle = COL.panelLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(px) + 0.5, Math.round(r.y) + 0.5, Math.round(pw), Math.round(r.h));
    }

    // Naehte zwischen den Panels.
    for (const p of (spec.panels || []).slice(1)) {
      const sx = Math.round(toScreenX(p.x)) + 0.5;
      const isCenter = Math.abs(p.x - num(spec.centerSeamX, -1)) < 0.5;
      ctx.strokeStyle = isCenter ? COL.seamCenter : COL.seam;
      ctx.lineWidth = isCenter ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, r.y);
      ctx.lineTo(sx, r.y + r.h);
      ctx.stroke();
    }

    // Wandkante.
    ctx.strokeStyle = COL.wallEdge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));

    // Panelnamen und Breiten.
    const ppm = pixelsPerMeter();
    ctx.font = '11px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'alphabetic';
    for (const p of spec.panels || []) {
      const px = toScreenX(p.x), pw = p.width * view.scale;
      if (pw < 54) continue;
      const wm = num(p.widthM, 0) > 0 ? p.widthM : p.width / ppm;
      const label = t('{panel}  ·  {px} px  ·  {m}', {
        panel: p.id, px: fmtNum(p.width, 0), m: fmtMeters(wm),
      });
      const tw = ctx.measureText(label).width;
      const bx = px + pw / 2 - tw / 2 - 6;
      const by = r.y + 6;
      ctx.fillStyle = COL.chip;
      roundRectPath(ctx, bx, by, tw + 12, 19, 4);
      ctx.fill();
      ctx.fillStyle = COL.text;
      ctx.fillText(label, bx + 6, by + 13);
    }
    ctx.restore();
  }

  /* --- Anfasser --------------------------------------------------------- */

  function selectedContext() {
    const found = findLayerAnywhere(selectedLayerId);
    if (!found) return null;
    return { ...found, geom: liveGeom(found.slot, found.layer) };
  }

  function drawSelection() {
    if (mode === 'crop') return; // dort zeichnet drawCropOverlay die Anfasser
    const sel = selectedContext();
    if (!sel) return;
    const g = sel.geom;
    const S = {
      x: toScreenX(g.dest.x), y: toScreenY(g.dest.y),
      w: g.dest.w * view.scale, h: g.dest.h * view.scale,
    };
    ctx.save();
    ctx.strokeStyle = COL.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(S.x, S.y, S.w, S.h);
    ctx.restore();
    drawHandles(S);
  }

  function handleRects(S) {
    const h = HANDLE_PX;
    const cx = S.x + S.w / 2, cy = S.y + S.h / 2;
    const pos = {
      nw: [S.x, S.y], n: [cx, S.y], ne: [S.x + S.w, S.y],
      e: [S.x + S.w, cy], se: [S.x + S.w, S.y + S.h], s: [cx, S.y + S.h],
      sw: [S.x, S.y + S.h], w: [S.x, cy],
    };
    const out = {};
    for (const id of HANDLES) {
      const [x, y] = pos[id];
      out[id] = { x: x - h / 2, y: y - h / 2, w: h, h };
    }
    return out;
  }

  function drawHandles(S) {
    const rects = handleRects(S);
    ctx.save();
    for (const id of HANDLES) {
      const r = rects[id];
      ctx.fillStyle = COL.accentDark;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    ctx.restore();
  }

  /* --- Fanglinien-Aufleuchten ------------------------------------------- */

  function drawFlashes(spec, r) {
    if (!flashes.length) return;
    const now = performance.now();
    flashes = flashes.filter((f) => now - f.t < SNAP_FLASH_MS);
    ctx.save();
    for (const f of flashes) {
      const a = 1 - (now - f.t) / SNAP_FLASH_MS;
      ctx.strokeStyle = COL.guide;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (f.axis === 'x') {
        const sx = Math.round(toScreenX(f.v)) + 0.5;
        ctx.moveTo(sx, r.y - 24); ctx.lineTo(sx, r.y + r.h + 24);
      } else {
        const sy = Math.round(toScreenY(f.v)) + 0.5;
        ctx.moveTo(r.x - 24, sy); ctx.lineTo(r.x + r.w + 24, sy);
      }
      ctx.stroke();
    }
    ctx.restore();
    if (flashes.length) dirty = true;
  }

  /* --- Lineal ----------------------------------------------------------- */

  function niceStep(minPxOnScreen, candidates) {
    for (const c of candidates) {
      if (c * view.scale >= minPxOnScreen) return c;
    }
    return candidates[candidates.length - 1];
  }

  function drawRuler(spec, r) {
    const top = r.y + r.h + 10;
    const bandH = 22;
    const ppm = pixelsPerMeter();

    ctx.save();
    ctx.font = '10px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'alphabetic';

    // Band 1 — Pixel.
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(r.x, top, r.w, bandH);
    const stepPx = niceStep(58, [50, 100, 200, 250, 500, 1000, 2000, 5000]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.fillStyle = COL.textDim;
    ctx.lineWidth = 1;
    for (let x = 0; x <= spec.width + 0.5; x += stepPx) {
      const sx = Math.round(toScreenX(x)) + 0.5;
      ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx, top + 7); ctx.stroke();
      ctx.fillText(fmtNum(x, 0), sx + 3, top + 15);
    }
    ctx.fillStyle = COL.textDim;
    // 'px' und 'm' sind Einheitenzeichen und in beiden Sprachen gleich.
    ctx.fillText('px', r.x - 22, top + 15);

    // Band 2 — Meter.
    const top2 = top + bandH + 2;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(r.x, top2, r.w, bandH);
    const stepM = niceStep(58, [0.1, 0.25, 0.5, 1, 2, 5, 10].map((m) => m * ppm)) / ppm;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    const totalM = spec.width / ppm;
    for (let m = 0; m <= totalM + 1e-6; m += stepM) {
      const sx = Math.round(toScreenX(m * ppm)) + 0.5;
      ctx.beginPath(); ctx.moveTo(sx, top2); ctx.lineTo(sx, top2 + 7); ctx.stroke();
      ctx.fillStyle = COL.textDim;
      ctx.fillText(fmtNum(m, stepM < 1 ? 2 : 1), sx + 3, top2 + 15);
    }
    ctx.fillStyle = COL.textDim;
    ctx.fillText('m', r.x - 22, top2 + 15);

    // Panelgrenzen in beiden Baendern hervorheben.
    for (const p of spec.panels || []) {
      for (const x of [p.x, p.x + p.width]) {
        const sx = Math.round(toScreenX(x)) + 0.5;
        const isCenter = Math.abs(x - num(spec.centerSeamX, -1)) < 0.5;
        ctx.strokeStyle = isCenter ? COL.seamCenter : 'rgba(255,255,255,0.55)';
        ctx.lineWidth = isCenter ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx, top2 + bandH); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* --- Modusschalter ---------------------------------------------------- */

  function drawModeSwitch() {
    const items = [
      { id: 'place', label: t('Platzieren  [P]') },
      { id: 'crop', label: t('Croppen  [C]') },
    ];
    ctx.save();
    ctx.font = '12px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    const h = 26;
    let totalW = 0;
    const widths = items.map((it) => {
      const w = ctx.measureText(it.label).width + 22;
      totalW += w;
      return w;
    });
    let x = cssW - 14 - totalW;
    const y = 12;
    hitModeButtons = [];
    items.forEach((it, i) => {
      const w = widths[i];
      const active = mode === it.id;
      ctx.fillStyle = active ? COL.accent : 'rgba(255,255,255,0.07)';
      roundRectPath(ctx, x, y, w, h, 5);
      ctx.fill();
      ctx.fillStyle = active ? '#04222c' : COL.text;
      ctx.textAlign = 'center';
      ctx.fillText(it.label, x + w / 2, y + h / 2 + 1);
      hitModeButtons.push({ id: it.id, x, y, w, h });
      x += w;
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  /* --- Infozeile -------------------------------------------------------- */

  function drawInfo(spec) {
    const lines = [];
    const warnLines = [];

    const sel = selectedContext();
    if (!sel) {
      lines.push({
        t: t('Kein Layer gewaehlt — Klick auf ein Bild waehlt es aus. Rechtsklick oeffnet das Menue.'),
        c: COL.textDim,
      });
    } else {
      const { slot, layer, geom } = sel;
      const media = mediaOf(layer);
      const name = media ? media.name : t('(Datei fehlt)');
      const label = layer.label ? `${layer.label} · ` : '';

      lines.push({
        t: t('{label}{name}   —   Slot {slot} auf Wand {wall}{off}', {
          label,
          name,
          slot: slot.id,
          wall: spec.id,
          off: layer.enabled === false ? t('   (Layer ist abgeschaltet)') : '',
        }),
        c: COL.text,
      });

      const srcTxt = geom.src.w > 0
        ? t('{w} × {h} px', { w: fmtNum(geom.src.w, 0), h: fmtNum(geom.src.h, 0) })
        : t('unbekannt (noch nicht geprobt)');
      const cropTxt = geom.crop.full
        ? t('ganze Quelle')
        : t('x {x} · y {y} · {w} × {h} px', {
          x: fmtNum(geom.crop.x, 0), y: fmtNum(geom.crop.y, 0),
          w: fmtNum(geom.crop.w, 0), h: fmtNum(geom.crop.h, 0),
        });
      const dTxt = t('x {x} · y {y} · {w} × {h} px (Wand)', {
        x: fmtNum(geom.dest.x, 0), y: fmtNum(geom.dest.y, 0),
        w: fmtNum(geom.dest.w, 0), h: fmtNum(geom.dest.h, 0),
      });

      lines.push({
        t: t('Quelle {src}    Ausschnitt {crop}    Ziel {dest}    fit {fit}{note}', {
          src: srcTxt,
          crop: cropTxt,
          dest: dTxt,
          // fit ist ein Modellwert ('cover', 'contain', ...) und bleibt unuebersetzt.
          fit: geom.fit,
          note: geom.destWasEmpty ? t(' (dest noch aus fit gerechnet)') : '',
        }),
        c: COL.textDim,
      });

      const sx = geom.crop.w > 0 ? (geom.dest.w / geom.crop.w) * 100 : 0;
      const sy = geom.crop.h > 0 ? (geom.dest.h / geom.crop.h) * 100 : 0;
      const scaleTxt = Math.abs(sx - sy) > 0.5
        ? t('Skalierung {x} % / {y} % (nicht proportional)', {
          x: fmtNum(sx, 0), y: fmtNum(sy, 0),
        })
        : t('Skalierung {x} %', { x: fmtNum(sx, 0) });
      const upscale = Math.max(sx, sy);
      lines.push({ t: scaleTxt, c: upscale > 100.5 ? COL.warn : COL.textDim });

      if (upscale > 100.5) {
        warnLines.push({
          t: t('Quelle wird auf {n} % vergrößert — wird auf der LED weich.', {
            n: fmtNum(upscale, 0),
          }),
          c: COL.warn,
        });
      }

      const seam = num(spec.centerSeamX, spec.width / 2);
      if (geom.dest.x < seam - 0.5 && geom.dest.x + geom.dest.w > seam + 0.5) {
        warnLines.push({
          t: t('Motiv liegt auf der Mittelnaht — reißt beim Auffahren.'),
          c: COL.danger,
        });
      }

      const safe = num(spec.safeAreaPct, 0.15);
      const inner = {
        x: spec.width * safe, y: spec.height * safe,
        w: spec.width * (1 - 2 * safe), h: spec.height * (1 - 2 * safe),
      };
      if (geom.dest.x < inner.x - 0.5 || geom.dest.y < inner.y - 0.5 ||
          geom.dest.x + geom.dest.w > inner.x + inner.w + 0.5 ||
          geom.dest.y + geom.dest.h > inner.y + inner.h + 0.5) {
        warnLines.push({
          t: t('Layer ragt in die äußeren {n} % (Sperrzone).', { n: fmtNum(safe * 100, 0) }),
          c: COL.warn,
        });
      }
    }

    if (notice && performance.now() < notice.until) {
      warnLines.push({ t: notice.text, c: COL.warn });
      dirty = true;
    } else if (notice) {
      notice = null;
    }

    const all = [...lines, ...warnLines];
    ctx.save();
    ctx.font = '12px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'alphabetic';
    let maxW = 0;
    for (const l of all) maxW = Math.max(maxW, ctx.measureText(l.t).width);
    const boxW = Math.max(160, Math.min(maxW + 20, cssW - 220));
    const boxH = all.length * 17 + 14;
    ctx.fillStyle = COL.chip;
    roundRectPath(ctx, 12, 12, boxW, boxH, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
    let y = 12 + 20;
    ctx.save();
    ctx.beginPath();
    ctx.rect(12, 12, boxW, boxH);
    ctx.clip();
    for (const l of all) {
      ctx.fillStyle = l.c;
      ctx.fillText(l.t, 22, y);
      y += 17;
    }
    ctx.restore();
    ctx.restore();
  }

  /* --- Kontextmenue ----------------------------------------------------- */

  function drawMenu() {
    ctx.save();
    ctx.font = '12px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    const itemH = 24;
    let w = 0;
    for (const it of menu.items) w = Math.max(w, ctx.measureText(it.label).width);
    w += 28;
    const h = menu.items.length * itemH + 8;
    const x = Math.min(menu.x, cssW - w - 4);
    const y = Math.min(menu.y, cssH - h - 4);
    menu.box = { x, y, w, h, itemH };

    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = COL.menuBg;
    roundRectPath(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    menu.items.forEach((it, i) => {
      const iy = y + 4 + i * itemH;
      if (i === hoverMenuIndex) {
        ctx.fillStyle = COL.menuHover;
        ctx.fillRect(x + 3, iy, w - 6, itemH);
      }
      ctx.fillStyle = it.disabled ? COL.textDim : COL.text;
      ctx.fillText(it.label, x + 14, iy + itemH / 2 + 1);
    });
    ctx.restore();
  }

  /* ======================================================================
   * Treffersuche
   * ====================================================================== */

  function layerAt(sx, sy) {
    const list = visibleLayers();
    for (let i = list.length - 1; i >= 0; i--) {
      const { slot, layer } = list[i];
      const g = liveGeom(slot, layer);
      const S = {
        x: toScreenX(g.dest.x), y: toScreenY(g.dest.y),
        w: g.dest.w * view.scale, h: g.dest.h * view.scale,
      };
      const clipS = {
        x: toScreenX(slot.x), y: toScreenY(0),
        w: slot.width * view.scale, h: slot.height * view.scale,
      };
      const vis = intersectRect(S, clipS);
      if (vis.w > 0 && vis.h > 0 && pointInRect(sx, sy, vis)) return { slot, layer };
    }
    return null;
  }

  /** Aktives Rechteck auf dem Schirm — je nach Modus Ziel- oder Ausschnittsrechteck. */
  function activeScreenRect() {
    const sel = selectedContext();
    if (!sel) return null;
    if (mode === 'crop') {
      const sv = sourceViewRect(sel.slot, sel.layer);
      if (!sv) return null;
      const S = { x: toScreenX(sv.x), y: toScreenY(sv.y) };
      return {
        x: S.x + sel.geom.crop.x * sv.kx * view.scale,
        y: S.y + sel.geom.crop.y * sv.ky * view.scale,
        w: sel.geom.crop.w * sv.kx * view.scale,
        h: sel.geom.crop.h * sv.ky * view.scale,
      };
    }
    return {
      x: toScreenX(sel.geom.dest.x), y: toScreenY(sel.geom.dest.y),
      w: sel.geom.dest.w * view.scale, h: sel.geom.dest.h * view.scale,
    };
  }

  function handleAt(sx, sy) {
    const S = activeScreenRect();
    if (!S) return null;
    const rects = handleRects(S);
    for (const id of HANDLES) {
      const r = rects[id];
      if (pointInRect(sx, sy, { x: r.x - 3, y: r.y - 3, w: r.w + 6, h: r.h + 6 })) return id;
    }
    return null;
  }

  /* ======================================================================
   * Rechteck-Manipulation
   * ====================================================================== */

  function resizeRect(start, handle, dx, dy, keepAspect, symmetric) {
    let l = start.x, t = start.y, r = start.x + start.w, b = start.y + start.h;
    const cx = start.x + start.w / 2, cy = start.y + start.h / 2;
    const west = handle.includes('w'), east = handle.includes('e');
    const north = handle.includes('n'), south = handle.includes('s');

    if (west) l = start.x + dx;
    if (east) r = start.x + start.w + dx;
    if (north) t = start.y + dy;
    if (south) b = start.y + start.h + dy;

    if (symmetric) {
      if (west) r = 2 * cx - l;
      if (east) l = 2 * cx - r;
      if (north) b = 2 * cy - t;
      if (south) t = 2 * cy - b;
    }

    let w = r - l, h = b - t;

    if (keepAspect && start.w > 0 && start.h > 0) {
      const a = start.w / start.h;
      const corner = (west || east) && (north || south);
      if (corner || west || east) {
        const nh = (Math.abs(w) / a) * (Math.sign(h) || 1);
        if (symmetric || (!north && !south)) { t = cy - nh / 2; b = cy + nh / 2; }
        else if (north) t = b - nh;
        else b = t + nh;
      } else {
        const nw = Math.abs(h) * a * (Math.sign(w) || 1);
        l = cx - nw / 2; r = cx + nw / 2;
      }
      w = r - l; h = b - t;
    }

    if (w < 0) { const tmp = l; l = r; r = tmp; w = -w; }
    if (h < 0) { const tmp = t; t = b; b = tmp; h = -h; }
    if (w < MIN_RECT) { l = cx - MIN_RECT / 2; w = MIN_RECT; }
    if (h < MIN_RECT) { t = cy - MIN_RECT / 2; h = MIN_RECT; }

    return { x: l, y: t, w, h };
  }

  /* ======================================================================
   * Meldungen an den Store — waehrend des Ziehens gedrosselt
   * ====================================================================== */

  function emitThrottled(layerId, patch) {
    pendingEmit = { layerId, patch };
    if (emitRaf) return;
    emitRaf = requestAnimationFrame(() => {
      emitRaf = 0;
      if (!pendingEmit) return;
      const p = pendingEmit;
      pendingEmit = null;
      emitNow(p.layerId, p.patch);
    });
  }

  function emitNow(layerId, patch) {
    if (emitRaf) { cancelAnimationFrame(emitRaf); emitRaf = 0; }
    pendingEmit = null;
    try {
      onChange(layerId, patch);
    } catch (err) {
      console.error('[panelEditor] onChange hat geworfen:', err);
      setNotice(t('Änderung konnte nicht übernommen werden: {msg}', { msg: err.message }), 6000);
    }
  }

  /* ======================================================================
   * Zeigerereignisse
   * ====================================================================== */

  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e) {
    if (disposed) return;
    const { x, y } = localPos(e);

    // 1. Kontextmenue hat Vorrang.
    if (menu) {
      const idx = menuIndexAt(x, y);
      if (idx >= 0) {
        const item = menu.items[idx];
        const m = menu;
        menu = null;
        dirty = true;
        e.preventDefault();
        if (!item.disabled) runMenuAction(item.id, m.slot, m.layer);
        else setNotice(item.hint || t('Aktion nicht verfügbar.'), 5000);
        return;
      }
      menu = null;
      dirty = true;
    }

    // 2. Modusschalter.
    for (const b of hitModeButtons) {
      if (pointInRect(x, y, b)) {
        setMode(b.id);
        e.preventDefault();
        return;
      }
    }

    // 3. Rechtsklick -> Menue.
    if (e.button === 2) {
      const hit = layerAt(x, y);
      if (hit) {
        selectLayer(hit.layer.id);
        openMenu(x, y, hit.slot, hit.layer);
      } else {
        setNotice(t('Kein Layer unter dem Zeiger.'), 2500);
      }
      e.preventDefault();
      return;
    }

    // 4. Verschieben der Ansicht.
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      drag = { kind: 'pan', sx: x, sy: y, tx0: view.tx, ty0: view.ty };
      canvas.setPointerCapture?.(e.pointerId);
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;

    // 5. Anfasser des gewaehlten Layers.
    const handle = handleAt(x, y);
    if (handle) {
      startTransformDrag(handle, x, y, e);
      return;
    }

    // 6. Layer auswaehlen und verschieben.
    const hit = layerAt(x, y);
    if (hit) {
      selectLayer(hit.layer.id);
      startTransformDrag('move', x, y, e);
      return;
    }

    selectLayer(null);
    dirty = true;
  }

  function startTransformDrag(handle, x, y, e) {
    const sel = selectedContext();
    if (!sel) return;
    const { slot, layer, geom } = sel;

    const base = { slot, layer };
    if (mode === 'crop') {
      const sv = sourceViewRect(slot, layer);
      if (!sv) {
        setNotice(t('Croppen geht erst, wenn die Quellauflösung bekannt ist.'), 4000);
        return;
      }
      drag = {
        kind: 'crop', handle, layerId: layer.id, ...base,
        sx: x, sy: y,
        startCrop: { ...geom.crop },
        startDest: { ...geom.dest },
        sv,
        live: null,
      };
    } else {
      drag = {
        kind: 'transform', handle, layerId: layer.id, ...base,
        sx: x, sy: y,
        startDest: { ...geom.dest },
        startOffset: { ...(layer.transform?.offset || { x: 0, y: 0 }) },
        live: null,
      };
    }
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (disposed) return;
    const { x, y } = localPos(e);

    if (menu) {
      const idx = menuIndexAt(x, y);
      if (idx !== hoverMenuIndex) { hoverMenuIndex = idx; dirty = true; }
      return;
    }

    if (!drag) {
      const h = handleAt(x, y);
      if (h !== hoverHandle) {
        hoverHandle = h;
        canvas.style.cursor = h ? HANDLE_CURSOR[h]
          : spaceDown ? 'grab'
          : layerAt(x, y) ? 'move' : 'default';
        dirty = true;
      }
      return;
    }

    if (drag.kind === 'pan') {
      view.tx = drag.tx0 + (x - drag.sx);
      view.ty = drag.ty0 + (y - drag.sy);
      dirty = true;
      return;
    }

    const noSnap = e.ctrlKey;
    const tolWall = SNAP_TOL_PX / view.scale;
    let dxw = (x - drag.sx) / view.scale;
    let dyw = (y - drag.sy) / view.scale;

    if (drag.kind === 'transform') {
      const g = guides();
      if (drag.handle === 'move') {
        const r = drag.startDest;
        if (!noSnap) {
          const bx = snapDelta([r.x, r.x + r.w / 2, r.x + r.w], dxw, g.x, tolWall);
          if (bx) { dxw += bx.d; flashGuide('x', bx.g); }
          const by = snapDelta([r.y, r.y + r.h / 2, r.y + r.h], dyw, g.y, tolWall);
          if (by) { dyw += by.d; flashGuide('y', by.g); }
        }
        const dest = { x: r.x + dxw, y: r.y + dyw, w: r.w, h: r.h };
        drag.live = { dest };
        // Verschieben aendert ausschliesslich offset — dest und fit bleiben, wie sie sind.
        drag.patch = {
          offset: {
            x: Math.round(drag.startOffset.x + dxw),
            y: Math.round(drag.startOffset.y + dyw),
          },
        };
      } else {
        const r = drag.startDest;
        if (!noSnap) {
          const vx = [];
          if (drag.handle.includes('w')) vx.push(r.x);
          if (drag.handle.includes('e')) vx.push(r.x + r.w);
          if (vx.length) {
            const bx = snapDelta(vx, dxw, g.x, tolWall);
            if (bx) { dxw += bx.d; flashGuide('x', bx.g); }
          }
          const vy = [];
          if (drag.handle.includes('n')) vy.push(r.y);
          if (drag.handle.includes('s')) vy.push(r.y + r.h);
          if (vy.length) {
            const by = snapDelta(vy, dyw, g.y, tolWall);
            if (by) { dyw += by.d; flashGuide('y', by.g); }
          }
        }
        const dest = resizeRect(r, drag.handle, dxw, dyw, e.shiftKey, e.altKey);
        drag.live = { dest };
        drag.patch = destPatch(drag.slot, dest);
      }
      emitThrottled(drag.layerId, drag.patch);
      dirty = true;
      return;
    }

    if (drag.kind === 'crop') {
      // Im Croppen-Modus bleibt die Quellansicht fest stehen; veraendert wird
      // der Ausschnitt, und dest folgt daraus, damit nichts springt.
      const sv = drag.sv;
      const dxSrc = dxw / sv.kx;
      const dySrc = dyw / sv.ky;
      const c0 = drag.startCrop;
      let crop;
      if (drag.handle === 'move') {
        crop = { x: c0.x + dxSrc, y: c0.y + dySrc, w: c0.w, h: c0.h };
      } else {
        crop = resizeRect(c0, drag.handle, dxSrc, dySrc, e.shiftKey, e.altKey);
      }
      // Innerhalb der Quelle halten.
      const sel = findLayerAnywhere(drag.layerId);
      const src = sel ? sourceSize(sel.layer) : { w: 0, h: 0 };
      if (src.w > 0) {
        crop.w = clamp(crop.w, MIN_RECT, src.w);
        crop.h = clamp(crop.h, MIN_RECT, src.h);
        crop.x = clamp(crop.x, 0, src.w - crop.w);
        crop.y = clamp(crop.y, 0, src.h - crop.h);
      }
      const dest = {
        x: sv.x + crop.x * sv.kx, y: sv.y + crop.y * sv.ky,
        w: crop.w * sv.kx, h: crop.h * sv.ky,
      };
      drag.live = { crop: { ...crop, full: false }, dest };
      drag.patch = {
        crop: {
          x: Math.round(crop.x), y: Math.round(crop.y),
          w: Math.round(crop.w), h: Math.round(crop.h),
        },
        ...destPatch(drag.slot, dest),
      };
      emitThrottled(drag.layerId, drag.patch);
      dirty = true;
    }
  }

  function onPointerUp(e) {
    if (disposed || !drag) return;
    canvas.releasePointerCapture?.(e.pointerId);
    if (drag.kind !== 'pan' && drag.patch) {
      emitNow(drag.layerId, drag.patch);   // endgueltige Meldung, ungedrosselt
    }
    drag = null;
    canvas.style.cursor = 'default';
    dirty = true;
  }

  function onWheel(e) {
    if (disposed) return;
    e.preventDefault();
    const { x, y } = localPos(e);
    const f = Math.exp(-e.deltaY * 0.0015);
    zoomAt(x, y, f);
  }

  function onDblClick(e) {
    if (disposed) return;
    e.preventDefault();
    fitView();
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  function onKeyDown(e) {
    if (disposed) return;

    // Der Handler haengt an window und feuert auch, wenn der Editor gar nicht
    // sichtbar ist. Ohne diese Sperre schalten 'p'/'c' aus der Bibliotheks-,
    // Render- oder QC-Ansicht heraus den Editormodus um und loesen ueber
    // setNotice -> onStatus -> setStatus ein volles Neuzeichnen aus.
    if (!canvas.isConnected || canvas.offsetParent === null) return;

    // Der Textfeld-Schutz muss VOR den Space-Zweig: sonst setzt das Tippen
    // eines Leerzeichens in ein Eingabefeld spaceDown und den Greifcursor.
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '')) return;
    if (e.target && e.target.isContentEditable) return;

    if (e.code === 'Space' && !spaceDown) {
      spaceDown = true;
      canvas.style.cursor = 'grab';
      return;
    }
    if (e.key === 'Escape') {
      if (menu) { menu = null; dirty = true; }
      else if (drag && drag.kind !== 'pan') { cancelDrag(); }
      return;
    }
    if (e.key === 'p' || e.key === 'P') setMode('place');
    if (e.key === 'c' || e.key === 'C') setMode('crop');
    if (e.key === 'f' || e.key === 'F') fitView();
  }

  function onKeyUp(e) {
    if (e.code === 'Space') {
      spaceDown = false;
      canvas.style.cursor = 'default';
    }
  }

  function cancelDrag() {
    if (!drag) return;
    const layerId = drag.layerId;
    const slot = drag.slot;
    const startDest = drag.startDest;
    const startCrop = drag.startCrop;
    const startOffset = drag.startOffset;
    drag = null;
    dirty = true;
    if (!layerId) return;
    // Ausgangszustand zurueckmelden, damit der Store nicht auf halbem Weg stehen bleibt.
    if (startCrop) {
      emitNow(layerId, {
        crop: startCrop.full ? null : {
          x: Math.round(startCrop.x), y: Math.round(startCrop.y),
          w: Math.round(startCrop.w), h: Math.round(startCrop.h),
        },
        ...destPatch(slot, startDest),
      });
    } else if (startOffset) {
      emitNow(layerId, { offset: { x: startOffset.x, y: startOffset.y } });
    }
    setNotice(t('Ziehen abgebrochen.'), 2000);
  }

  function setMode(m) {
    if (mode === m) return;
    mode = m;
    dirty = true;
    setNotice(m === 'crop'
      ? t('Croppen: der helle Rahmen ist der Ausschnitt aus der Quelle.')
      : t('Platzieren: der Rahmen ist das Zielrechteck auf der Wand.'), 2500);
  }

  function selectLayer(id) {
    if (selectedLayerId === id) return;
    selectedLayerId = id;
    dirty = true;
    if (typeof onSelect === 'function') {
      try { onSelect(id); } catch (err) { console.warn('[panelEditor] onSelect:', err); }
    }
  }

  /* ======================================================================
   * Kontextmenue
   * ====================================================================== */

  function openMenu(x, y, slot, layer) {
    menu = {
      x, y, slot, layer,
      items: [
        { id: 'fitPanel', label: t('Auf Panel einpassen') },
        { id: 'fitWall', label: t('Auf Wand einpassen') },
        { id: 'native', label: t('Originalgröße') },
        { id: 'centerH', label: t('Horizontal zentrieren') },
        { id: 'centerV', label: t('Vertikal zentrieren') },
        { id: 'resetCrop', label: t('Crop zurücksetzen') },
        {
          id: 'remove',
          label: t('Layer entfernen'),
          disabled: typeof onRemove !== 'function',
          hint: t('Entfernen ist hier nicht angeschlossen — der Editor bekam kein onRemove(layerId).'),
        },
      ],
    };
    hoverMenuIndex = -1;
    dirty = true;
  }

  function menuIndexAt(x, y) {
    if (!menu || !menu.box) return -1;
    const b = menu.box;
    if (!pointInRect(x, y, b)) return -1;
    const i = Math.floor((y - b.y - 4) / b.itemH);
    return i >= 0 && i < menu.items.length ? i : -1;
  }

  function runMenuAction(id, slot, layer) {
    const spec = wallSpec();
    if (!spec) return;
    const geom = layerGeom(slot, layer);
    const src = geom.src;
    const crop = geom.crop;

    switch (id) {
      case 'fitPanel': {
        // fit 'cover' auf die Slotgroesse — der Renderer rechnet dasselbe.
        emitNow(layer.id, {
          fit: 'cover',
          dest: { x: 0, y: 0, w: slot.width, h: slot.height },
          offset: { x: 0, y: 0 },
          zoom: 1,
        });
        setNotice(t('Layer auf Slot {slot} eingepasst (cover).', { slot: slot.id }), 2500);
        break;
      }
      case 'fitWall': {
        const rect = { x: 0, y: 0, w: spec.width, h: spec.height };
        emitNow(layer.id, destPatch(slot, rect));
        if (slot.id !== 'master') {
          setNotice(t('Auf ganze Wand gelegt — sichtbar bleibt nur der Teil im Slot {slot}.', {
            slot: slot.id,
          }), 5000);
        }
        break;
      }
      case 'native': {
        if (!(crop.w > 0)) {
          setNotice(t('Quellauflösung unbekannt — erst Bibliothek einlesen.'), 4000);
          break;
        }
        const rect = {
          x: slot.x + (slot.width - crop.w) / 2,
          y: (slot.height - crop.h) / 2,
          w: crop.w, h: crop.h,
        };
        emitNow(layer.id, destPatch(slot, rect));
        setNotice(t('Originalgröße: {w} × {h} px.', {
          w: fmtNum(crop.w, 0), h: fmtNum(crop.h, 0),
        }), 2500);
        break;
      }
      case 'centerH': {
        const rect = { ...geom.dest, x: slot.x + (slot.width - geom.dest.w) / 2 };
        emitNow(layer.id, destPatch(slot, rect));
        break;
      }
      case 'centerV': {
        const rect = { ...geom.dest, y: (slot.height - geom.dest.h) / 2 };
        emitNow(layer.id, destPatch(slot, rect));
        break;
      }
      case 'resetCrop': {
        if (!(src.w > 0)) {
          setNotice(t('Quellauflösung unbekannt — Crop kann nicht zurückgesetzt werden.'), 4000);
          break;
        }
        emitNow(layer.id, { crop: null });
        setNotice(t('Ausschnitt zurückgesetzt — ganze Quelle.'), 2500);
        break;
      }
      case 'remove': {
        if (typeof onRemove === 'function') {
          try { onRemove(layer.id); } catch (err) {
            console.error('[panelEditor] onRemove:', err);
            setNotice(t('Layer konnte nicht entfernt werden: {msg}', { msg: err.message }), 6000);
          }
          if (selectedLayerId === layer.id) selectLayer(null);
        }
        break;
      }
      default:
        setNotice(t('Unbekannte Menüaktion "{id}".', { id }), 4000);
    }
    dirty = true;
  }

  /* ======================================================================
   * Ereignisse anhaengen
   * ====================================================================== */

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  let unsubscribeReady = null;
  if (typeof videoPool.onReady === 'function') {
    try {
      unsubscribeReady = videoPool.onReady(() => { dirty = true; });
    } catch (err) {
      console.warn('[panelEditor] videoPool.onReady:', err);
    }
  }

  /**
   * Sprachwechsel: alle Texte entstehen in draw() neu, es reicht also, sofort
   * neu zu zeichnen. Das offene Kontextmenue haelt dagegen fertige Beschriftungen
   * und wird deshalb geschlossen.
   */
  const offLangChange = onLangChange(() => {
    if (disposed) return;
    menu = null;
    hoverMenuIndex = -1;
    notice = null;
    dirty = true;
    try {
      draw();
    } catch (err) {
      console.error('[panelEditor]', t('Zeichnen fehlgeschlagen:'), err);
      setNotice(t('Neu zeichnen nach Sprachwechsel fehlgeschlagen: {msg}', {
        msg: err.message,
      }), 6000);
    }
  });

  /* ======================================================================
   * Oeffentliche Schnittstelle
   * ====================================================================== */

  function update(next) {
    if (disposed) return;
    state = next || null;

    // Auswahl aus dem Store uebernehmen, sobald sie sich dort aendert.
    const sel = state?.ui?.selectedLayerId ?? null;
    if (sel !== lastSeenSelection) {
      lastSeenSelection = sel;
      if (sel !== selectedLayerId) {
        selectedLayerId = sel;
      }
    }

    // Optionaler Modus aus dem State, falls die Oberflaeche ihn spaeter fuehrt.
    const uiMode = state?.ui?.editorMode;
    if (uiMode === 'place' || uiMode === 'crop') mode = uiMode;

    dirty = true;
  }

  function tick(timeSec) {
    if (disposed) return;
    if (typeof timeSec === 'number' && timeSec !== lastTimeSec) {
      lastTimeSec = timeSec;
      dirty = true;
    }
    const playing = !!state?.ui?.transport?.playing;
    if (playing || dirty || flashes.length) {
      try {
        draw();
      } catch (err) {
        console.error('[panelEditor]', t('Zeichnen fehlgeschlagen:'), err);
        dirty = false;
        try {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = COL.bg;
          ctx.fillRect(0, 0, cssW, cssH);
          ctx.fillStyle = COL.danger;
          ctx.font = '13px system-ui, "Segoe UI", sans-serif';
          ctx.fillText(t('Editor-Fehler: {msg}', { msg: err.message }), 16, 28);
        } catch { /* dann geht wirklich nichts mehr */ }
      }
    }
  }

  function resize() {
    if (disposed) return;
    dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 0;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 0;
    if (w <= 0 || h <= 0) return;
    cssW = w; cssH = h;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.fittedFor = null;   // erzwingt neues Einpassen im naechsten draw()
    dirty = true;
    draw();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('dblclick', onDblClick);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    if (typeof unsubscribeReady === 'function') {
      try { unsubscribeReady(); } catch { /* egal */ }
    }
    if (typeof offLangChange === 'function') {
      try { offLangChange(); } catch (err) { console.warn('[panelEditor] onLangChange:', err); }
    }
    if (emitRaf) { cancelAnimationFrame(emitRaf); emitRaf = 0; }
    pendingEmit = null;
    drag = null;
    menu = null;
    state = null;
    scratch.width = 0;
    scratch.height = 0;
    // videoPool.release() wird bewusst NICHT gerufen: der Pool ist geteilt,
    // stage3d haengt an denselben Elementen. Freigabe macht die Anwendung.
  }

  // Erste Einmessung, falls der Canvas schon Groesse hat.
  resize();

  return { update, tick, resize, dispose };
}
