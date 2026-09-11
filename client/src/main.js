/**
 * Theater-Bild-Gelöte — Bootstrap und Rahmen.
 *
 * Holt Zustand, Venue und Projekt, verbindet den Jobstream, baut die
 * Ansichten, haelt die Wiedergabeschleife und die Tastenkuerzel.
 *
 * 3D-Viewport und Panel-Editor kommen aus fremden Modulen
 * (three/stage3d.js, editor/panelEditor.js). Sie werden dynamisch geladen:
 * fehlt eines, bleibt der Rest der Oberflaeche bedienbar und der Viewport
 * sagt im Klartext, was fehlt.
 */

import { h, on, clear, timecode, num, closeTopModal, modal } from './dom.js';
import {
  getHealth, getVenue, getProject, newProject, connectJobStream, makeProxies, validateProject,
  getWorkspace, listVenues,
} from './api.js';
import {
  store, setStatus, showError, updateWall, updateSlot, updateProject, updateLayer,
  removeLayer, layerLocation, flushSave, isDirty, mergeMedia,
} from './store.js';
import {
  t, register, applyStatic, onLangChange, setLang, getLang, LANGUAGES,
} from './i18n.js';
import { createVideoPool } from './media/videoPool.js';
import { createLibraryView } from './ui/library.js';
import { createInspector } from './ui/inspector.js';
import { createJobsBar } from './ui/jobs.js';
import { createStageControls } from './ui/stageControls.js';
import { createRenderView } from './ui/render.js';
import { createQcView } from './ui/qc.js';
import { createSetupView, ffmpegLevel, ffmpegSummary } from './ui/setup.js';
import { getWallSpec } from '/shared/model.js';

/* Woerterbuch dieses Moduls — inklusive der statischen Texte aus index.html,
   denn die gehoeren zum Rahmen und haben kein eigenes Modul. */
register('en', {
  'Wandliste schließen': 'Close wall list',
  'Projekt verwalten': 'Manage project',
  'Projektdatei herunterladen': 'Download project file',
  'Projekt öffnen oder anlegen': 'Open or create project',
  'Die Projektdatei enthält deine Planung. Mediendateien werden separat benötigt.': 'The project file contains your plan. Media files are needed separately.',
  'Wiedergabe und Zeitleiste': 'Playback and timeline',
  'Arbeitsbereiche': 'Workspaces',
  'Wände und Panels': 'Walls and panels',
  'Interaktive 3D-Bühne': 'Interactive 3D stage',
  'Einstellungen': 'Settings',
  "Sichtgrenzen": "Sightlines",
  "{n} Panel gewählt": "{n} panel(s) selected",
  "Panel anklicken · Strg = dazu · Umschalt = Bereich · ziehen = fahren": "Click a panel · Ctrl = add · Shift = range · drag = move",
  "Auswahl aufheben": "Clear selection",
  "koppeln ({n})": "recouple ({n})",
  "Von Hand gefahrene Panels wieder an den Fahrweg-Regler der Wand koppeln": "Recouple manually moved panels to the wall travel slider",
  "Alle Panels wieder gekoppelt.": "All panels recoupled.",
  "{panel} auf {m} gefahren": "{panel} moved to {m}",
  "{n} Panels gemeinsam gefahren": "{n} panels moved together",
  // index.html
  'Projektname': 'Project name',
  'Wiedergabe (Leertaste)': 'Play / pause (space bar)',
  'Wiedergabe': 'Play',
  'Zeitleiste': 'Timeline',
  'Looplänge in Sekunden': 'Loop length in seconds',
  '3D-Bühne': '3D stage',
  'Panel-Editor': 'Panel editor',
  'Bibliothek': 'Library',
  'Qualitätskontrolle': 'Quality control',
  'Venues — Häuser, Wände, Panels': 'Venues — houses, walls, panels',
  'ffmpeg-Status — klicken für Einrichtung': 'ffmpeg status — click to set up',
  'Sprache': 'Language',
  'Startet …': 'Starting …',

  // Kopfzeile und Statuszeile
  '{name} · {fps} fps · {pitch} mm Pitch': '{name} · {fps} fps · {pitch} mm pitch',
  'Proxy fehlt: {name}': 'Proxy missing: {name}',
  'Proxy erzeugen': 'Create proxy',
  'Proxy wird erzeugt (Job {id}) …': 'Creating the proxy (job {id}) …',
  'Proxy konnte nicht erzeugt werden': 'The proxy could not be created',
  '{what} ist fehlgeschlagen': '{what} failed',

  // Linke Spalte
  'Wand in der 3D-Ansicht zeigen': 'Show this wall in the 3D view',
  'leer': 'empty',
  'Fahrweg': 'Travel',
  'Fahrweg der Wandteile: 0 = geschlossen, 1 = ganz auf':
    'Travel of the wall sections: 0 = closed, 1 = fully open',
  'Slot stummschalten': 'Mute slot',
  'ein-/ausschalten': 'enable / disable',
  'Layer entfernen': 'Remove layer',
  'leer — Material aus der Bibliothek hierher legen':
    'empty — drop material from the library here',

  // Viewport-Leisten
  'Kamera': 'Camera',
  'Nähte': 'Seams',
  'Sperrzonen': 'Safe areas',
  'Raster': 'Grid',
  'Lineal': 'Ruler',
  'Drahtgitter': 'Wireframe',
  'Boden': 'Floor',
  'Figur': 'Figure',
  'LED-Look': 'LED look',
  'Rahmen': 'Bezel',
  'Helligkeit': 'Brightness',
  'Schwarz': 'Black level',
  'Umgebung': 'Ambient',
  'Foto': 'Snapshot',
  'Bildschirmfoto des Viewports': 'Screenshot of the viewport',
  'Die 3D-Ansicht ist nicht geladen.': 'The 3D view is not loaded.',
  'Wand {wall} · Slot {slot}': 'Wall {wall} · slot {slot}',
  'kein Layer ausgewählt': 'no layer selected',

  // Jobs
  'Job „{label}" ist fehlgeschlagen: {msg}': 'Job "{label}" failed: {msg}',
  'kein Grund geliefert': 'no reason given',
  'Fertig: {label}': 'Finished: {label}',
  'Serverzustand konnte nicht gelesen werden': 'The server status could not be read',
  'Projekt konnte nicht neu geladen werden': 'The project could not be reloaded',
  'Jobmeldung konnte nicht verarbeitet werden': 'The job message could not be processed',

  // Start
  'Verbinde mit dem Server …': 'Connecting to the server …',
  'Der Server antwortet nicht — läuft „npm start"?':
    'The server is not responding — is "npm start" running?',
  'Kein Projekt geladen ({msg}) — es wird ein neues angelegt.':
    'No project loaded ({msg}) — a new one is being created.',
  'Neues Projekt': 'New project',
  'Es konnte kein Projekt angelegt werden': 'No project could be created',
  'Die Venue-Beschreibung konnte nicht geladen werden': 'The venue description could not be loaded',
  'Es ist kein Venue eingerichtet — der Einstiegsassistent hilft weiter.':
    'No venue is set up yet — the onboarding assistant will help.',
  'Der Arbeitsordner konnte nicht gelesen werden: {msg}':
    'The workspace folder could not be read: {msg}',
  'Die Venue-Liste konnte nicht geladen werden: {msg}':
    'The venue list could not be loaded: {msg}',
  'Server verbunden. ffmpeg fehlt — ohne das kann nichts umgewandelt oder gerendert werden.':
    'Connected to the server. ffmpeg is missing — without it nothing can be converted or rendered.',
  'Bereit.': 'Ready.',
  '{n} Fehler im Projekt: {where} — {msg}': '{n} error(s) in the project: {where} — {msg}',
  '{n} Hinweis(e): {where} — {msg}': '{n} note(s): {where} — {msg}',

  // Nachgeladene Ansichten
  '3D-Ansicht nicht verfügbar.': '3D view unavailable.',
  'Panel-Editor nicht verfügbar.': 'Panel editor unavailable.',
  'Venue-Verwaltung nicht verfügbar.': 'Venue management unavailable.',
  '{file} konnte nicht geladen werden: ': '{file} could not be loaded: ',
  'Der Rest des Werkzeugs funktioniert weiter.': 'The rest of the tool keeps working.',
  'Der Venue-Editor ist nicht geladen.': 'The venue editor is not loaded.',
  'Der Behälter #viewVenue fehlt in index.html': 'The #viewVenue container is missing from index.html',
  'createVenueEditor() liefert kein Element el': 'createVenueEditor() returns no el element',
  'Der Einstiegsassistent konnte nicht geladen werden: {msg}':
    'The onboarding assistant could not be loaded: {msg}',
  'Unerwarteter Fehler': 'Unexpected error',
  'Unerledigter Fehler': 'Unhandled error',
  'Der Start ist fehlgeschlagen': 'Startup failed',

  // Hilfe
  'Tastenkürzel': 'Keyboard shortcuts',
  'Taste': 'Key',
  'Wirkung': 'Effect',
  'Leertaste': 'Space bar',
  'Wiedergabe starten und anhalten': 'Start and stop playback',
  'Wand wählen': 'Select wall',
  'Raster ein/aus': 'Toggle grid',
  'Nähte ein/aus': 'Toggle seams',
  'Sperrzonen ein/aus': 'Toggle safe areas',
  'Viewport auf Vollbild': 'Viewport to full screen',
  'Venue-Verwaltung öffnen': 'Open venue management',
  'Pfeiltasten': 'Arrow keys',
  'Ausgewählten Layer verschieben, mit Umschalt um 10 px':
    'Move the selected layer, 10 px with Shift held',
  'Strg + S': 'Ctrl + S',
  'Projekt sofort speichern': 'Save the project right away',
  'Obersten Dialog schließen': 'Close the topmost dialog',
  'Diese Hilfe': 'This help',
  'Schließen': 'Close',
});

/**
 * Venue, mit dem gestartet wird, wenn der Server kein Projekt hat.
 * Nur eine Rueckfallebene: gibt es das Venue nicht, uebernimmt der
 * Einstiegsassistent und laesst den Nutzer eines anlegen.
 */
const DEFAULT_VENUE = 'mein-schiff-theater';

/**
 * Venue, mit dem ein NEUES Projekt startet.
 *
 * Vorrang hat DEFAULT_VENUE, sofern es die Liste kennt. Erst wenn nicht, wird
 * das erste Venue der Liste genommen — und das ist alphabetisch sortiert.
 * Ohne diese Reihenfolge landete eine frische Installation in "Agora" statt im
 * Theater, weil A vor M kommt.
 */
function startVenueId() {
  const liste = store.get().venues || [];
  if (liste.some((v) => v.id === DEFAULT_VENUE)) return DEFAULT_VENUE;
  return liste[0]?.id || DEFAULT_VENUE;
}

/* ==========================================================================
 * Elemente aus index.html
 * ========================================================================== */

const $ = (id) => document.getElementById(id);
const elLeft = $('left');
const elRight = $('right');
const elStatusText = $('statusText');
const elStatusDot = $('statusDot');
const elStatusBar = $('statusbar');
const elProjName = $('projName');
const elVenueName = $('venueName');
const elBtnPlay = $('btnPlay');
const elScrub = $('tlScrub');
const elTime = $('tlTime');
const elLoop = $('tlLoop');
const elFfmpegDot = $('ffmpegDot');
const elFfmpegTxt = $('ffmpegTxt');
const elLangSel = $('langSel');

const VIEWS = {
  stage3d: $('viewStage3d'),
  editor: $('viewEditor'),
  library: $('viewLibrary'),
  render: $('viewRender'),
  qc: $('viewQc'),
  venue: $('viewVenue'),
};

/* ==========================================================================
 * Bausteine
 * ========================================================================== */

const pool = createVideoPool();
const library = createLibraryView();
const inspector = createInspector();
const jobsBar = createJobsBar();
const renderView = createRenderView();
const qcView = createQcView();
const setup = createSetupView();

let stage3d = null;
let panelEditor = null;
let venueEditor = null;  // ui/venueEditor.js, wird nachgeladen
let onboarding = null;   // ui/onboarding.js, wird nachgeladen
let clock = 0;           // Zeitleistenposition in Sekunden
let statusAction = null; // zusaetzlicher Knopf in der Statuszeile
let helpHandle = null;   // offener Hilfe-Dialog

VIEWS.library.appendChild(library.el);
VIEWS.render.appendChild(renderView.el);
VIEWS.qc.appendChild(qcView.el);
const stageControls = createStageControls(() => stage3d);
elRight.appendChild(stageControls.el);
inspector.el.id = 'layerInspector';
elRight.appendChild(inspector.el);
$('bottom').prepend($('transport'));
$('statusbar').appendChild(h('span.status-shortcuts', 'SPACE  Play / Pause    ·    F  Fullscreen    ·    ?  Help'));
$('jobsRoot').appendChild(jobsBar.el);

/* ==========================================================================
 * Videopool: welche Layer sind gerade relevant
 * ========================================================================== */

pool.setLayerSource(() => {
  const st = store.get();
  const project = st.project;
  if (!project) return [];
  const out = [];
  for (const wall of Object.values(project.walls || {})) {
    if (wall.visible === false) continue;
    for (const slot of Object.values(wall.slots || {})) {
      if (!slot.enabled) continue;
      for (const layer of slot.layers || []) {
        if (layer.enabled) out.push({ mediaId: layer.mediaId, time: layer.time });
      }
    }
  }
  return out;
});

pool.onError((err) => {
  if (err.kind === 'noProxy') {
    const st = store.get();
    const media = (st.media || []).find((m) => m.id === err.mediaId);
    setStatusAction(t('Proxy fehlt: {name}', { name: media ? media.name : err.mediaId }), 'warn', t('Proxy erzeugen'), async () => {
      try {
        const res = await makeProxies([err.mediaId], false);
        setStatus(t('Proxy wird erzeugt (Job {id}) …', { id: res.jobId }));
      } catch (e) {
        showError(t('Proxy konnte nicht erzeugt werden'), e);
      }
    });
  } else if (err.kind === 'autoplay') {
    setStatus(err.message, 'warn');
  } else {
    setStatus(`${err.message} (${err.mediaId})`, 'warn');
  }
});

pool.onReady(() => {
  // Texturen der Ansichten neu binden lassen.
  const st = store.get();
  if (stage3d) safe(() => stage3d.update(st), 'stage3d.update');
  if (panelEditor) safe(() => panelEditor.update(st), 'panelEditor.update');
});

// Fehler aus fremden Modulen: melden, aber nicht in eine Schleife laufen.
// Dieselbe Meldung derselben Stelle wird nur einmal in die Statuszeile
// geschrieben — sonst wuerde ein dauerhaft werfendes update() endlos
// Zustandsaenderungen und damit neue update()-Aufrufe erzeugen.
const seenFailures = new Map();

function safe(fn, what) {
  try {
    return fn();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (seenFailures.get(what) === msg) {
      console.warn(`[tbg] ${what} erneut:`, msg);
    } else {
      seenFailures.set(what, msg);
      showError(t('{what} ist fehlgeschlagen', { what }), e);
    }
    return null;
  }
}

/* ==========================================================================
 * Statuszeile
 * ========================================================================== */

function setStatusAction(text, level, buttonLabel, onClick) {
  setStatus(text, level);
  if (statusAction) { statusAction.remove(); statusAction = null; }
  statusAction = h('button.btn.sm', { type: 'button' }, buttonLabel);
  on(statusAction, 'click', () => {
    onClick();
    if (statusAction) { statusAction.remove(); statusAction = null; }
  });
  elStatusBar.appendChild(statusAction);
}

/* ==========================================================================
 * Kopfzeile
 * ========================================================================== */

on(elProjName, 'change', () => updateProject({ name: elProjName.value }));

on($('projectMenu'), 'click', () => modal({
  title: t('Projekt verwalten'),
  body: h('div.col', h('strong', store.get().project?.name || '—'),
    h('p', t('Die Projektdatei enthält deine Planung. Mediendateien werden separat benötigt.'))),
  actions: [
    { label: t('Projektdatei herunterladen'), kind: 'primary', onClick: () => {
      const project = store.get().project;
      if (!project) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2) + '\n'], {type:'application/json'}));
      const a = h('a', {href:url,download:`${(project.name || 'projekt').replace(/[^\p{L}\p{N}_. -]/gu, '_')}.tbg.json`});
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } },
    { label: t('Projekt öffnen oder anlegen'), onClick: () => onboarding?.open() },
  ],
}));

on(elBtnPlay, 'click', () => togglePlay());

on(elScrub, 'input', () => {
  clock = Number(elScrub.value) || 0;
  store.set({ ui: { transport: { timeSec: clock } } });
  pool.seek(clock);
  drawTime();
});

on(elLoop, 'change', () => {
  const v = Math.max(1, Number(elLoop.value) || 20);
  updateProject({ loopSeconds: v });
  store.set({ ui: { transport: { loopSec: v } } });
});

on($('ffmpegAmp'), 'click', () => setup.open());

for (const b of $('viewSwitch').children) {
  on(b, 'click', () => setView(b.dataset.view));
}

function setView(view) {
  if (!VIEWS[view]) return;
  store.set({ ui: { view } });
}

/* ==========================================================================
 * Sprache
 * ========================================================================== */

// Statisches Markup einmal uebersetzen, bevor irgendetwas gezeichnet wird.
applyStatic(document);

if (elLangSel) {
  clear(elLangSel);
  // Sprachnamen stehen in ihrer eigenen Sprache und laufen NICHT durch t().
  for (const l of LANGUAGES) elLangSel.appendChild(h('option', { value: l.id }, l.label));
  elLangSel.value = getLang();
  on(elLangSel, 'change', () => setLang(elLangSel.value));
} else {
  console.warn('[tbg] Sprachumschalter #langSel fehlt in index.html.');
}

onLangChange(() => {
  if (elLangSel) elLangSel.value = getLang();

  // PFLICHT: der Schluessel der linken Spalte kennt die Sprache nicht. Ohne
  // das Zuruecksetzen bliebe die Wand- und Slotliste in der alten Sprache
  // stehen, weil sich am Projekt ja nichts geaendert hat.
  leftKeyCache = null;

  // Der Hilfe-Dialog haelt fertigen Text — neu aufbauen statt uebersetzen.
  if (helpHandle) { helpHandle.close(); openHelp(); }

  render(store.get());
});

function togglePlay() {
  const st = store.get();
  const playing = !st.ui.transport.playing;
  store.set({ ui: { transport: { playing } } });
  if (playing) pool.play(); else pool.pause();
}

/* ==========================================================================
 * Linke Spalte — Waende, Slots, Layer
 * ========================================================================== */

let leftKeyCache = null;

/**
 * Schluessel fuer den Neuaufbau der linken Spalte.
 *
 * Das Venue MUSS mit hinein. buildLeft() braucht beides und steigt ohne Venue
 * kommentarlos aus — der Bootstrap setzt project und venue aber in getrennten
 * store.set()-Aufrufen. Ohne das Venue im Schluessel passierte Folgendes:
 * beim Render zwischen den beiden Aufrufen wurde der Cache schon auf den
 * endgueltigen Schluessel gesetzt, buildLeft brach mangels Venue ab, und beim
 * naechsten Render war der Schluessel unveraendert — die Wandliste blieb nach
 * dem Laden dauerhaft leer, bis der Nutzer zufaellig etwas anderes aenderte.
 */
function leftKey(state) {
  const p = state.project;
  if (!p || !state.venue) return '';
  const parts = [JSON.stringify(state.venue.walls), state.ui.activeWallId, state.ui.activeSlotId, state.ui.selectedLayerId, p.media?.length];
  for (const [wid, w] of Object.entries(p.walls)) {
    parts.push(wid, w.visible ? 1 : 0, w.travelMode);
    for (const [sid, s] of Object.entries(w.slots)) {
      parts.push(sid, s.enabled ? 1 : 0,
        (s.layers || []).map((l) => `${l.id}:${l.enabled ? 1 : 0}:${l.label || ''}`).join(','));
    }
  }
  return parts.join('|');
}

function buildLeft(state) {
  clear(elLeft);
  const project = state.project;
  const venue = state.venue;
  if (!project || !venue) return;

  elLeft.appendChild(h('div.panel-heading', h('div.eyebrow', t('Bühnenbild')), h('div.row', h('h2', t('Wände & Panels')), h('span.tag', String(venue.walls.length)),
    h('button.btn.sm.ghost.walls-drawer-close', {type:'button','aria-label':t('Wandliste schließen'),onClick:()=>document.body.classList.remove('walls-open')}, '×'))));
  for (const wallSpec of venue.walls) {
    const wall = project.walls[wallSpec.id];
    if (!wall) continue;
    const isActive = state.ui.activeWallId === wallSpec.id;
    const layerCount = Object.values(wall.slots).reduce((n, s) => n + (s.layers?.length || 0), 0);

    const chkVis = h('input', { type: 'checkbox', checked: wall.visible !== false, title: t('Wand in der 3D-Ansicht zeigen') });
    on(chkVis, 'change', (ev) => { ev.stopPropagation(); updateWall(wallSpec.id, { visible: chkVis.checked }); });

    const title = h('div.ttl',
      chkVis,
      h('b', wallSpec.id),
      h('span.dim.grow.nowrap', `${wallSpec.width} × ${wallSpec.height}`),
      layerCount ? h('span.tag', `${layerCount}`) : h('span.tag.warn', t('leer')));
    on(title, 'click', (ev) => {
      if (ev.target === chkVis) return;
      store.set({ ui: { activeWallId: wallSpec.id, activeSlotId: 'master', selectedLayerId: null, selectedPanels: [] } });
    });
    title.tabIndex = 0;
    title.setAttribute('role', 'button');
    title.setAttribute('aria-label', wallSpec.label || wallSpec.id);
    on(title, 'keydown', ev => { if(ev.target===title && (ev.key==='Enter'||ev.key===' ')) { ev.preventDefault(); title.click(); } });

    const travel = h('input', {
      type: 'range', min: '0', max: '1', step: '0.01', value: String(wall.travel ?? 0),
      class: 'grow', dataset: { travel: wallSpec.id }, title: t('Fahrweg der Wandteile: 0 = geschlossen, 1 = ganz auf'),
    });
    const travelTxt = h('span.dim.mono', { style: 'width:52px;text-align:right;font-size:11px', dataset: { travelTxt: wallSpec.id } },
      travelLabel(wallSpec, wall));
    on(travel, 'input', () => updateWall(wallSpec.id, { travel: Number(travel.value) }));

    const modeSeg = h('div.seg',
      ...['2+2', '4x'].map((m) => {
        const b = h('button.btn.sm', { type: 'button', class: wall.travelMode === m ? 'btn sm on' : 'btn sm' }, m);
        on(b, 'click', () => updateWall(wallSpec.id, { travelMode: m }));
        return b;
      }));

    const block = h('div.wall', { class: isActive ? 'wall active' : 'wall' },
      title,
      h('div.row', { style: 'margin-top:3px' }, h('span.dim', { style: 'font-size:11px' }, t('Fahrweg')), travel, travelTxt),
      h('div.row', modeSeg,
        h('span.dim.right', { style: 'font-size:11px' },
          wallSpec.note ? '⚠' : '', wallSpec.label ? wallSpec.label.replace(/^.\s*—\s*/, '') : '')));
    if (wallSpec.note) block.title = wallSpec.note;
    elLeft.appendChild(block);

    if (isActive) elLeft.appendChild(buildSlots(state, wallSpec, wall));
  }
}

function travelLabel(wallSpec, wall) {
  const max = wallSpec.stage?.travelMaxM ?? wallSpec.widthM / 2;
  return `${Math.round((wall.travel ?? 0) * 100)} % · ${num((wall.travel ?? 0) * max, 1)} m`;
}

function buildSlots(state, wallSpec, wall) {
  const box = h('div.slots');
  const order = ['master', ...wallSpec.panels.map((p) => p.id)];
  for (const slotId of order) {
    const slot = wall.slots[slotId];
    if (!slot) continue;
    const isActive = state.ui.activeSlotId === slotId;

    const chk = h('input', { type: 'checkbox', checked: slot.enabled !== false, title: t('Slot stummschalten') });
    on(chk, 'change', (ev) => { ev.stopPropagation(); updateSlot(wallSpec.id, slotId, { enabled: chk.checked }); });

    const head = h('div.sh', chk,
      h('b', slotId === 'master' ? 'master' : slotId),
      h('span.dim.grow.nowrap', { style: 'font-size:11px' }, `${slot.width}×${slot.height}${slot.x ? ` · x=${slot.x}` : ''}`),
      slot.layers.length ? h('span.tag', String(slot.layers.length)) : null);
    on(head, 'click', ev => { if (ev.target !== chk) store.set({ ui: { activeWallId: wallSpec.id, activeSlotId: slotId, selectedLayerId: null } }); });

    const layers = h('div.layers');
    // Oberster Layer zuerst anzeigen — so, wie er auch liegt.
    for (const layer of [...slot.layers].reverse()) {
      const media = (state.media || []).find((m) => m.id === layer.mediaId);
      const sel = state.ui.selectedLayerId === layer.id;
      const row = h('div.layer', { class: `layer${sel ? ' sel' : ''}${layer.enabled ? '' : ' off'}` },
        h('span', { style: 'font-size:10px', title: t('ein-/ausschalten') }, layer.enabled ? '●' : '○'),
        h('span.nm', { title: media?.absPath || '' }, layer.label || media?.name || layer.mediaId),
        media ? null : h('span.tag.err', '!'),
        h('span.dim.mono', { style: 'font-size:10px' }, `${num(layer.time?.startSec || 0, 1)}s`),
        h('span.x', { title: t('Layer entfernen') }, '✕'));

      on(row, 'click', (ev) => {
        const t = ev.target;
        if (t.classList.contains('x')) { removeLayer(layer.id); return; }
        if (t.textContent === '●' || t.textContent === '○') {
          updateLayer(layer.id, { enabled: !layer.enabled });
          return;
        }
        store.set({ ui: { activeWallId: wallSpec.id, activeSlotId: slotId, selectedLayerId: layer.id } });
      });
      layers.appendChild(row);
    }
    if (slot.layers.length === 0) {
      layers.appendChild(h('div.layer.dim', { style: 'font-style:italic' },
        h('span.nm', t('leer — Material aus der Bibliothek hierher legen'))));
    }

    box.appendChild(h('div.slot', { class: isActive ? 'slot active' : 'slot' }, head, layers));
  }
  return box;
}

/** Werte, die sich oft aendern, ohne Neuaufbau nachziehen. */
function syncLeftValues(state) {
  const project = state.project;
  if (!project) return;
  for (const input of elLeft.querySelectorAll('input[data-travel]')) {
    const wid = input.dataset.travel;
    const wall = project.walls[wid];
    if (!wall || document.activeElement === input) continue;
    input.value = String(wall.travel ?? 0);
  }
  for (const span of elLeft.querySelectorAll('span[data-travel-txt]')) {
    const wid = span.dataset.travelTxt;
    const wall = project.walls[wid];
    if (!wall || !state.venue) continue;
    try { span.textContent = travelLabel(getWallSpec(state.venue, wid), wall); } catch { /* Venue kennt die Wand nicht */ }
  }
}

/* ==========================================================================
 * Viewport-Leisten
 * ========================================================================== */

function buildStageBar(state) {
  stageControls.update(state);
}

function buildEditorBar(state) {
  const bar = $('editorBar');
  if (bar.contains(document.activeElement)) return;
  clear(bar);
  const loc = layerLocation(state, state.ui.selectedLayerId);
  bar.appendChild(h('span.dim', { style: 'font-size:11px' },
    t('Wand {wall} · Slot {slot}', { wall: state.ui.activeWallId, slot: state.ui.activeSlotId })));
  bar.appendChild(h('span.sep'));
  bar.appendChild(h('span', loc ? (loc.layer.label || loc.layer.mediaId) : t('kein Layer ausgewählt')));
  bar.appendChild(h('span.right'));
  for (const [key, label] of [['seams', t('Nähte')], ['safeArea', t('Sperrzonen')], ['grid', t('Raster')], ['ruler', t('Lineal')]]) {
    const b = h('button.btn.sm', { type: 'button', class: state.ui.overlays[key] ? 'btn sm on' : 'btn sm' }, label);
    on(b, 'click', () => store.set({ ui: { overlays: { [key]: !store.get().ui.overlays[key] } } }));
    bar.appendChild(b);
  }
}

/* ==========================================================================
 * Zeichnen
 * ========================================================================== */

let lastView = null;

function drawTime() {
  const st = store.get();
  const loop = st.ui.transport.loopSec || st.project?.loopSeconds || 20;
  elTime.textContent = `${timecode(clock)} / ${num(loop, 1)} s`;
  if (document.activeElement !== elScrub) {
    elScrub.max = String(loop);
    elScrub.value = String(clock);
  }
}

function render(state) {
  document.body.dataset.view = state.ui.view;
  // Kopfzeile
  if (state.project) {
    if (document.activeElement !== elProjName) elProjName.value = state.project.name || '';
    if (document.activeElement !== elLoop) elLoop.value = String(state.project.loopSeconds ?? 20);
  }
  if (state.venue) {
    elVenueName.textContent = t('{name} · {fps} fps · {pitch} mm Pitch', {
      name: state.venue.name, fps: state.venue.fps, pitch: num(state.venue.pixelPitchMm, 1),
    });
    elVenueName.title = state.venue.source || '';
  }
  elBtnPlay.textContent = state.ui.transport.playing ? '❚❚' : '▶';
  elBtnPlay.classList.toggle('on', state.ui.transport.playing);

  // ffmpeg-Ampel
  const lvl = ffmpegLevel(state.health);
  elFfmpegDot.className = `amp ${lvl}`;
  elFfmpegTxt.textContent = ffmpegSummary(state.health);
  elFfmpegTxt.style.color = lvl === 'err' ? 'var(--err)' : '';

  // Statuszeile
  // Die Statuszeile wird beim Setzen auf Deutsch abgelegt und ERST HIER
  // uebersetzt. Der deutsche Text ist ja der Schluessel, also uebersteht die
  // Meldung damit einen Sprachwechsel. Meldungen mit eingesetzten Werten
  // ("3 Fehler in Wand D …") stehen in keinem Woerterbuch und kommen
  // unveraendert durch — das ist gewollt und schadet nicht.
  elStatusText.textContent = t(state.ui.status || '');
  const sLvl = state.ui.statusLevel || '';
  elStatusDot.className = `amp ${sLvl === 'err' ? 'err' : sLvl === 'warn' ? 'warn' : sLvl === 'ok' ? 'ok' : ''}`;
  elStatusBar.className = sLvl === 'err' ? 'err' : sLvl === 'warn' ? 'warn' : '';

  // Ansicht umschalten
  if (state.ui.view !== lastView) {
    const prev = lastView;
    lastView = state.ui.view;
    for (const [name, el] of Object.entries(VIEWS)) {
      if (el) el.classList.toggle('on', name === state.ui.view);
    }
    for (const b of $('viewSwitch').children) {
      b.classList.toggle('on', b.dataset.view === state.ui.view);
      b.setAttribute('aria-current', b.dataset.view === state.ui.view ? 'page' : 'false');
    }
    if (state.ui.view === 'stage3d' && stage3d) safe(() => stage3d.resize(), 'stage3d.resize');
    if (state.ui.view === 'editor' && panelEditor) safe(() => panelEditor.resize(), 'panelEditor.resize');
    if (state.ui.view === 'render') renderView.loadPreview();
    // Der Venue-Editor holt seine Liste selbst — beim Betreten der Ansicht
    // oeffnen, beim Verlassen schliessen (der Entwurf bleibt dabei erhalten).
    if (state.ui.view === 'venue') {
      openVenueEditorNow(pendingVenueId);
      pendingVenueId = null;
    }
    else if (prev === 'venue' && venueEditor && typeof venueEditor.close === 'function') {
      safe(() => venueEditor.close(), 'venueEditor.close');
    }
  }

  // Linke Spalte
  const key = leftKey(state);
  if (key !== leftKeyCache) { leftKeyCache = key; buildLeft(state); }
  syncLeftValues(state);

  // Viewport-Leisten (billig genug, um sie neu zu bauen)
  if (state.ui.view === 'stage3d') buildStageBar(state);
  if (state.ui.view === 'editor') buildEditorBar(state);

  // Module
  inspector.update(state);
  jobsBar.update(state);
  library.update(state);
  renderView.update(state);
  qcView.update(state);
  setup.update(state);
  if (venueEditor) safe(() => venueEditor.update(state), 'venueEditor.update');

  if (stage3d) safe(() => stage3d.update(state), 'stage3d.update');
  if (panelEditor) safe(() => panelEditor.update(state), 'panelEditor.update');

  // Videoelemente fuer alles besorgen, was gebraucht wird
  const needed = new Set();
  for (const wall of Object.values(state.project?.walls || {})) {
    for (const slot of Object.values(wall.slots || {})) {
      for (const layer of slot.layers || []) if (layer.enabled) needed.add(layer.mediaId);
    }
  }
  for (const id of needed) pool.acquire(id);
  pool.retain([...needed]);

  drawTime();
}

store.subscribe(render);

/* ==========================================================================
 * Wiedergabeschleife
 * ========================================================================== */

let lastFrame = performance.now();

function frame(now) {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  const st = store.get();
  const tr = st.ui.transport;

  if (tr.playing) {
    const loop = tr.loopSec || st.project?.loopSeconds || 20;
    clock += dt * (tr.rate || 1);
    if (clock >= loop) clock -= loop * Math.floor(clock / loop);
    // Ohne Benachrichtigung, sonst zeichnet die halbe Oberflaeche 60-mal je Sekunde neu.
    store.set({ ui: { transport: { timeSec: clock } } }, { silent: true });
    drawTime();
  }

  pool.seek(clock);
  if (st.ui.view === 'stage3d' && stage3d) safe(() => stage3d.tick(clock), 'stage3d.tick');
  if (st.ui.view === 'editor' && panelEditor) safe(() => panelEditor.tick(clock), 'panelEditor.tick');

  requestAnimationFrame(frame);
}

/* ==========================================================================
 * Tastenkuerzel
 * ========================================================================== */

function isTyping(ev) {
  const el = ev.target;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Alle Kuerzel in einer Tabelle. Quelle fuer den Hilfe-Dialog. */
function shortcutList() {
  return [
    [t('Leertaste'), t('Wiedergabe starten und anhalten')],
    ['1 … 4', t('Wand wählen')],
    ['G', t('Raster ein/aus')],
    ['S', t('Nähte ein/aus')],
    ['A', t('Sperrzonen ein/aus')],
    ['F', t('Viewport auf Vollbild')],
    ['V', t('Venue-Verwaltung öffnen')],
    [t('Pfeiltasten'), t('Ausgewählten Layer verschieben, mit Umschalt um 10 px')],
    [t('Strg + S'), t('Projekt sofort speichern')],
    ['Escape', t('Obersten Dialog schließen')],
    ['?', t('Diese Hilfe')],
  ];
}

function openHelp() {
  if (helpHandle) return helpHandle;
  const table = h('table.tbl',
    h('tr', h('th', t('Taste')), h('th', t('Wirkung'))),
    ...shortcutList().map(([key, what]) => h('tr', h('td.mono', key), h('td', what))));
  helpHandle = modal({
    title: t('Tastenkürzel'),
    body: table,
    actions: [{ label: 'Schließen', kind: 'primary' }],
    onClose: () => { helpHandle = null; },
  });
  return helpHandle;
}

on(window, 'keydown', (ev) => {
  if (ev.key === 'Escape') { if (closeTopModal()) ev.preventDefault(); return; }

  if (ev.ctrlKey && (ev.key === 's' || ev.key === 'S')) {
    ev.preventDefault();
    flushSave();
    return;
  }
  if (isTyping(ev) || ev.ctrlKey || ev.altKey || ev.metaKey) return;

  const st = store.get();
  const walls = Object.keys(st.project?.walls || {});

  switch (ev.key) {
    case ' ':
      ev.preventDefault(); togglePlay(); break;
    case '1': case '2': case '3': case '4': {
      const wid = walls[Number(ev.key) - 1];
      if (wid) store.set({ ui: { activeWallId: wid, activeSlotId: 'master' } });
      break;
    }
    case 'g': case 'G':
      store.set({ ui: { overlays: { grid: !st.ui.overlays.grid } } }); break;
    case 's': case 'S':
      store.set({ ui: { overlays: { seams: !st.ui.overlays.seams } } }); break;
    case 'a': case 'A':
      store.set({ ui: { overlays: { safeArea: !st.ui.overlays.safeArea } } }); break;
    case 'f': case 'F': {
      document.body.classList.toggle('viewport-full');
      if (stage3d) safe(() => stage3d.resize(), 'stage3d.resize');
      if (panelEditor) safe(() => panelEditor.resize(), 'panelEditor.resize');
      break;
    }
    case 'v': case 'V':
      setView('venue'); break;
    case '?':
      ev.preventDefault(); openHelp(); break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      const loc = layerLocation(st, st.ui.selectedLayerId);
      if (!loc) break;
      ev.preventDefault();
      const d = ev.shiftKey ? 10 : 1;
      const off = loc.layer.transform?.offset || { x: 0, y: 0 };
      const patch = { x: off.x || 0, y: off.y || 0 };
      if (ev.key === 'ArrowLeft') patch.x -= d;
      if (ev.key === 'ArrowRight') patch.x += d;
      if (ev.key === 'ArrowUp') patch.y -= d;
      if (ev.key === 'ArrowDown') patch.y += d;
      updateLayer(loc.layer.id, { transform: { offset: patch } });
      break;
    }
    default: break;
  }
});

on(window, 'resize', () => {
  if (stage3d) safe(() => stage3d.resize(), 'stage3d.resize');
  if (panelEditor) safe(() => panelEditor.resize(), 'panelEditor.resize');
});

// Das Fenster-Ereignis allein reicht nicht.
//
// resize() liest canvas.clientWidth/clientHeight. Beim ersten Aufruf direkt
// nach dem Erzeugen steht das Layout aber noch nicht: clientHeight ist 0, der
// Canvas behaelt seine Standardhoehe von 150 px und bleibt dabei, weil danach
// nie wieder ein resize kommt (das Fenster aendert sich ja nicht). Ergebnis
// war ein 848x150 grosser Viewport in einem 848x414 grossen Kasten.
//
// Ein ResizeObserver auf den Viewport-Kaesten faengt jede Layoutaenderung ab:
// erster Aufbau, Ansichtswechsel, Vollbild, Fensterwechsel, Zoom.
if (typeof ResizeObserver === 'function') {
  const ro = new ResizeObserver(() => {
    if (stage3d) safe(() => stage3d.resize(), 'stage3d.resize');
    if (panelEditor) safe(() => panelEditor.resize(), 'panelEditor.resize');
  });
  for (const id of ['vpStage', 'vpEditor']) {
    const el = document.getElementById(id);
    if (el) ro.observe(el);
  }
}

on(window, 'beforeunload', (ev) => {
  if (isDirty()) { ev.preventDefault(); ev.returnValue = ''; }
});

/* ==========================================================================
 * Jobstream
 * ========================================================================== */

function mergeJob(job) {
  const jobs = [...store.get().jobs];
  const i = jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) jobs[i] = { ...jobs[i], ...job, log: job.log || jobs[i].log || [] };
  else jobs.unshift({ ...job, log: job.log || [] });
  store.set({ jobs: jobs.slice(0, 200) });
  return jobs[i >= 0 ? i : 0];
}

function appendLog(id, line) {
  const jobs = [...store.get().jobs];
  const i = jobs.findIndex((j) => j.id === id);
  if (i < 0) return;
  const log = [...(jobs[i].log || []), line].slice(-2000);
  jobs[i] = { ...jobs[i], log };
  store.set({ jobs });
}

async function onJobFinished(job) {
  if (job.status === 'error') {
    setStatus(t('Job „{label}" ist fehlgeschlagen: {msg}', {
      label: job.label || job.type, msg: job.error || t('kein Grund geliefert'),
    }), 'err');
  } else if (job.status === 'done') {
    setStatus(t('Fertig: {label}', { label: job.label || job.type }), 'ok');
  }

  // Ergebnisse einsammeln
  if (job.result && Array.isArray(job.result.media) && job.result.media.length) {
    mergeMedia(job.result.media);
  }
  if (String(job.type || '').startsWith('ffmpeg')) {
    try { store.set({ health: await getHealth() }); } catch (e) { showError(t('Serverzustand konnte nicht gelesen werden'), e); }
  }
  if (/proxy|conform|library|media/i.test(String(job.type || '')) && !isDirty()) {
    // Der Server haelt das Projekt (Proxy-Flags, neue Medien) — sofern wir nichts Ungespeichertes haben.
    try {
      const project = await getProject();
      store.set({ project });
    } catch (e) {
      showError(t('Projekt konnte nicht neu geladen werden'), e);
    }
  }
}

/* ==========================================================================
 * Start
 * ========================================================================== */

async function boot() {
  setStatus(t('Verbinde mit dem Server …'));

  // Warnungen, die beim Start auffallen, aber den Start nicht abbrechen.
  // Sie wuerden von spaeteren Statusmeldungen ueberschrieben — deshalb werden
  // sie gesammelt und ganz am Ende noch einmal gezeigt.
  const bootWarnings = [];

  // --- Zustand
  let health = null;
  try {
    health = await getHealth();
    store.set({ health });
  } catch (e) {
    showError(t('Der Server antwortet nicht — läuft „npm start"?'), e);
  }

  // --- Arbeitsordner und bekannte Venues
  try {
    store.set({ workspace: await getWorkspace() });
  } catch (e) {
    console.warn('[tbg] Arbeitsordner:', e);
    store.set({ workspace: null });
    bootWarnings.push(t('Der Arbeitsordner konnte nicht gelesen werden: {msg}', { msg: e.message }));
  }
  try {
    const venues = await listVenues();
    store.set({ venues: Array.isArray(venues) ? venues : [] });
  } catch (e) {
    console.warn('[tbg] Venue-Liste:', e);
    store.set({ venues: [] });
    bootWarnings.push(t('Die Venue-Liste konnte nicht geladen werden: {msg}', { msg: e.message }));
  }

  // --- Projekt
  let project = null;
  try {
    project = await getProject();
  } catch (e) {
    setStatus(t('Kein Projekt geladen ({msg}) — es wird ein neues angelegt.', { msg: e.message }), 'warn');
    try {
      project = await newProject(startVenueId(), t('Neues Projekt'));
    } catch (e2) {
      showError(t('Es konnte kein Projekt angelegt werden'), e2);
    }
  }
  if (project) {
    clock = 0;
    store.set({
      project,
      media: project.media || [],
      ui: { transport: { loopSec: project.loopSeconds || 20, timeSec: 0 } },
    });
  }

  // --- Venue
  const venueId = project?.venueId || startVenueId();
  try {
    const venue = await getVenue(venueId);
    const walls = venue.walls.map((w) => w.id);
    store.set({
      venue,
      ui: { activeWallId: walls.includes(store.get().ui.activeWallId) ? store.get().ui.activeWallId : walls[walls.length - 1] },
    });
  } catch (e) {
    // Ohne Venue ist die Oberflaeche leer, aber nicht kaputt: der
    // Einstiegsassistent bietet gleich an, eines anzulegen.
    showError(t('Die Venue-Beschreibung konnte nicht geladen werden'), e);
    bootWarnings.push(t('Es ist kein Venue eingerichtet — der Einstiegsassistent hilft weiter.'));
  }

  // --- Jobstream
  connectJobStream((ev) => {
    try {
      if (ev.type === 'hello') {
        store.set({ jobs: Array.isArray(ev.jobs) ? ev.jobs : [] });
      } else if (ev.type === 'job' && ev.job) {
        const before = store.get().jobs.find((j) => j.id === ev.job.id);
        mergeJob(ev.job);
        const wasOpen = !before || before.status === 'running' || before.status === 'queued';
        if (wasOpen && ['done', 'error', 'cancelled'].includes(ev.job.status)) onJobFinished(ev.job);
      } else if (ev.type === 'log') {
        appendLog(ev.id, ev.line);
      } else if (ev.type === 'streamError') {
        setStatus(ev.message, 'warn');
      }
    } catch (e) {
      showError(t('Jobmeldung konnte nicht verarbeitet werden'), e);
    }
  });

  // --- Fremde Ansichten nachladen
  await loadViewports();

  // --- ffmpeg pruefen
  if (ffmpegLevel(store.get().health) === 'err') {
    // Auch hier eine Statusmeldung setzen. Sonst bleibt "Verbinde mit dem
    // Server …" vom Anfang von boot() stehen und behauptet einen Fehler,
    // den es nicht gibt — der Server laeuft ja, nur ffmpeg fehlt.
    setStatus(t('Server verbunden. ffmpeg fehlt — ohne das kann nichts umgewandelt oder gerendert werden.'), 'err');
    setup.open();
  } else {
    setStatus(t('Bereit.'), 'ok');
  }

  // --- Projekt pruefen
  try {
    const problems = await validateProject();
    const errors = problems.filter((p) => p.level === 'error');
    const warns = problems.filter((p) => p.level === 'warn');
    if (errors.length) {
      setStatus(t('{n} Fehler im Projekt: {where} — {msg}', {
        n: errors.length, where: errors[0].where, msg: errors[0].msg,
      }), 'err');
    } else if (warns.length) {
      setStatus(t('{n} Hinweis(e): {where} — {msg}', {
        n: warns.length, where: warns[0].where, msg: warns[0].msg,
      }), 'warn');
    }
  } catch (e) {
    console.warn('[tbg] Projektprüfung nicht möglich:', e.message);
  }

  // Gesammelte Startwarnungen zeigen, solange nichts Schlimmeres ansteht.
  if (bootWarnings.length && store.get().ui.statusLevel !== 'err') {
    setStatus(bootWarnings.join(' · '), 'warn');
  }

  // --- Einstiegsassistent
  if (onboarding && typeof onboarding.shouldShow === 'function') {
    let show = false;
    try {
      show = !!onboarding.shouldShow(store.get());
    } catch (e) {
      showError(t('{what} ist fehlgeschlagen', { what: 'onboarding.shouldShow' }), e);
    }
    if (show) safe(() => onboarding.open(), 'onboarding.open');
  }

  requestAnimationFrame(frame);
}

/** Einheitliche Klartextmeldung fuer ein Modul, das sich nicht laden liess. */
function moduleFailureBox(headline, file, err, extra) {
  return h('div.msg.err',
    h('b', headline), h('br'),
    t('{file} konnte nicht geladen werden: ', { file }), h('span.mono', err.message),
    extra ? h('br') : null, extra || null);
}

/**
 * Venue-Editor oeffnen, ohne die Ansicht zu wechseln.
 * open() ist asynchron (es holt die Venue-Liste) — der Fehlerfall muss deshalb
 * ueber catch abgefangen werden, safe() sieht ein abgelehntes Versprechen nicht.
 */
function openVenueEditorNow(venueId) {
  if (!venueEditor || typeof venueEditor.open !== 'function') {
    setStatus(t('Der Venue-Editor ist nicht geladen.'), 'warn');
    return;
  }
  Promise.resolve()
    .then(() => venueEditor.open(venueId))
    .catch((e) => showError(t('{what} ist fehlgeschlagen', { what: 'venueEditor.open' }), e));
}

/**
 * Ansicht auf die Venue-Verwaltung schalten und dort ein Venue oeffnen.
 *
 * Die Kennung wird gemerkt statt sofort benutzt. Grund: setView() schreibt nur
 * in den Store, render() laeuft erst im naechsten Microtask — und ruft dort
 * selbst openVenueEditorNow(). Wuerde hier zusaetzlich direkt geoeffnet, liefen
 * ZWEI Oeffnungsvorgaenge gleichzeitig, und der zweite (ohne Kennung) gewinnt
 * und laedt das erstbeste Venue der Liste. Der Nutzer bearbeitet dann still ein
 * anderes Venue als das angeklickte.
 */
let pendingVenueId = null;

function openVenueEditor(venueId) {
  pendingVenueId = venueId ?? null;
  if (store.get().ui.view === 'venue') {
    // Ansicht steht schon: render() kommt nicht mehr von allein vorbei.
    openVenueEditorNow(pendingVenueId);
    pendingVenueId = null;
  } else {
    setView('venue');
  }
}

async function loadViewports() {
  // 3D-Buehne
  try {
    const mod = await import('./three/stage3d.js');
    // Diagnosezugang: nur mit ?debug=1 in der Adresszeile. Damit laesst sich
    // von der Konsole aus pruefen, was die 3D-Ansicht sieht — ohne dass im
    // Normalbetrieb etwas am globalen Objekt haengt.
    const debugAn = new URLSearchParams(location.search).has('debug');
    stage3d = mod.createStage3D({
      canvas: $('stageCanvas'),
      videoPool: pool,
      onPick: (payload) => {
        if (!payload) return;
        if (!payload.wallId || !payload.slotId) {
          // Klick ins Leere: Auswahl aufheben.
          store.set({ ui: { selectedPanels: [] } });
          return;
        }
        const key = `${payload.wallId}/${payload.slotId}`;
        const st = store.get();
        const bisher = st.ui.selectedPanels || [];
        let neu;

        if (payload.additive) {
          // Strg/Cmd: einzeln dazu oder weg — damit lassen sich beliebige
          // Gruppen bilden, etwa nur die beiden inneren Teile.
          neu = bisher.includes(key) ? bisher.filter((k) => k !== key) : [...bisher, key];
        } else if (payload.range && bisher.length) {
          // Umschalt: alles zwischen dem zuletzt Gewaehlten und hier,
          // aber nur innerhalb derselben Wand.
          const letzte = bisher[bisher.length - 1];
          const [lWall, lSlot] = letzte.split('/');
          const spec = st.venue?.walls?.find((w) => w.id === payload.wallId);
          if (lWall === payload.wallId && spec) {
            const ids = spec.panels.map((p) => p.id);
            const a = ids.indexOf(lSlot);
            const b = ids.indexOf(payload.slotId);
            if (a >= 0 && b >= 0) {
              const spanne = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
                .map((id) => `${payload.wallId}/${id}`);
              neu = [...new Set([...bisher, ...spanne])];
            }
          }
          if (!neu) neu = [key];
        } else {
          neu = [key];
        }

        store.set({
          ui: {
            activeWallId: payload.wallId,
            activeSlotId: payload.slotId,
            selectedPanels: neu,
          },
        });
      },

      /**
       * Panels wurden in der 3D-Ansicht verschoben.
       *
       * Geschrieben wird slot.travelOverrideM — der Fahrweg dieses einen Teils
       * in Metern. Er hat Vorrang vor dem Fahrweg-Regler der Wand, sodass sich
       * geschobene Teile nicht mehr vom Regler mitreissen lassen.
       */
      onPanelMove: (moves) => {
        if (!Array.isArray(moves) || moves.length === 0) return;
        for (const m of moves) {
          updateSlot(m.wallId, m.panelId, { travelOverrideM: m.offsetM });
        }
        const n = moves.length;
        setStatus(
          n === 1
            ? t('{panel} auf {m} gefahren', {
                panel: moves[0].panelId, m: `${moves[0].offsetM >= 0 ? '+' : '−'}${num(Math.abs(moves[0].offsetM), 2)} m`,
              })
            : t('{n} Panels gemeinsam gefahren', { n }),
          'ok'
        );
      },
    });
    if (debugAn) window.__tbgStage3d = stage3d;
    $('stageNote').style.display = 'none';
    safe(() => stage3d.resize(), 'stage3d.resize');
  } catch (e) {
    console.error('[tbg] stage3d nicht ladbar:', e);
    clear($('stageNote')).appendChild(moduleFailureBox(
      t('3D-Ansicht nicht verfügbar.'), 'client/src/three/stage3d.js', e,
      t('Der Rest des Werkzeugs funktioniert weiter.')));
  }

  // Panel-Editor
  try {
    const mod = await import('./editor/panelEditor.js');
    panelEditor = mod.createPanelEditor({
      canvas: $('editorCanvas'),
      videoPool: pool,
      onChange: (layerId, transformPatch) => updateLayer(layerId, { transform: transformPatch }),
      // Zusatzhaken des Editors — optional, aber ohne sie waeren Auswahl und
      // Loeschen im Editor tote Knoepfe.
      onSelect: (layerId) => store.set({ ui: { selectedLayerId: layerId } }),
      onRemove: (layerId) => removeLayer(layerId),
      onStatus: (text) => setStatus(text),
    });
    $('editorNote').style.display = 'none';
    safe(() => panelEditor.resize(), 'panelEditor.resize');
  } catch (e) {
    console.error('[tbg] panelEditor nicht ladbar:', e);
    clear($('editorNote')).appendChild(moduleFailureBox(
      t('Panel-Editor nicht verfügbar.'), 'client/src/editor/panelEditor.js', e,
      t('Der Rest des Werkzeugs funktioniert weiter.')));
  }

  // Venue-Verwaltung
  //
  // Wie 3D-Ansicht und Panel-Editor dynamisch geladen. Ein statischer Import
  // wuerde bei einer fehlenden oder fehlerhaften Datei das GANZE Modul und
  // damit die komplette Oberflaeche mitreissen — genau das darf nicht sein.
  try {
    if (!VIEWS.venue) throw new Error(t('Der Behälter #viewVenue fehlt in index.html'));
    const mod = await import('./ui/venueEditor.js');
    venueEditor = mod.createVenueEditor({
      onStatus: (text, level) => setStatus(text, level),
      onError: (prefix, err) => showError(prefix, err),
      onVenueChanged: refreshVenues,
    });
    if (!venueEditor || !venueEditor.el) {
      throw new Error(t('createVenueEditor() liefert kein Element el'));
    }
    clear(VIEWS.venue).appendChild(venueEditor.el);
    safe(() => venueEditor.update(store.get()), 'venueEditor.update');
  } catch (e) {
    venueEditor = null;
    console.error('[tbg] venueEditor nicht ladbar:', e);
    const box = h('div.pad', moduleFailureBox(
      t('Venue-Verwaltung nicht verfügbar.'), 'client/src/ui/venueEditor.js', e,
      t('Der Rest des Werkzeugs funktioniert weiter.')));
    if (VIEWS.venue) clear(VIEWS.venue).appendChild(box);
    else setStatus(t('Venue-Verwaltung nicht verfügbar.'), 'warn');
  }

  // Einstiegsassistent
  try {
    const mod = await import('./ui/onboarding.js');
    onboarding = mod.createOnboarding({
      root: $('onboardingRoot'),
      onOpenVenueEditor: openVenueEditor,
      onStatus: (text, level) => setStatus(text, level),
      onError: (prefix, err) => showError(prefix, err),
    });
    if (onboarding && typeof onboarding === 'object') {
      // Auch als Eigenschaft setzen — der Assistent darf beides anbieten.
      onboarding.onOpenVenueEditor = openVenueEditor;
      const root = $('onboardingRoot');
      if (onboarding.el && root && !root.contains(onboarding.el)) root.appendChild(onboarding.el);
    }
  } catch (e) {
    onboarding = null;
    console.error('[tbg] onboarding nicht ladbar:', e);
    setStatus(t('Der Einstiegsassistent konnte nicht geladen werden: {msg}', { msg: e.message }), 'warn');
  }
}

/** Venue-Kurzliste neu holen — der Editor meldet damit seine Aenderungen. */
async function refreshVenues() {
  try {
    const venues = await listVenues();
    store.set({ venues: Array.isArray(venues) ? venues : [] });
  } catch (e) {
    console.error('[tbg] Venue-Liste:', e);
    setStatus(t('Die Venue-Liste konnte nicht geladen werden: {msg}', { msg: e.message }), 'err');
  }
}

on(window, 'error', (ev) => {
  showError(t('Unerwarteter Fehler'), ev.error || new Error(ev.message));
});
on(window, 'unhandledrejection', (ev) => {
  showError(t('Unerledigter Fehler'), ev.reason || new Error('unbekannt'));
});

boot().catch((e) => showError(t('Der Start ist fehlgeschlagen'), e));

// Erstes Zeichnen, damit die Oberflaeche nicht leer bleibt, bis Daten da sind.
render(store.get());
