/**
 * Theater-Bild-Gelöte — Render-Ansicht.
 *
 * Zeigt vor dem Rendern, was passieren wird: den vollstaendigen ffmpeg-Aufruf
 * im Klartext, eine Erklaerung des Filtergraphen und die Speicherplatz-
 * Abschaetzung samt freiem Platz. Kein Schritt ist eine Black Box.
 *
 * Ausserdem die drei Zusammenbau-Arbeiten:
 *   - Zusammenfuegen         mehrere Clips zeitlich hintereinander (auf 'master')
 *   - Panels zusammensetzen  mehrere Dateien raeumlich auf X1..Xn
 *   - Master zerschneiden    eine fertige Wanddatei in Panel-Dateien
 *
 * ---------------------------------------------------------------------------
 * AUFBAU UND SPRACHWECHSEL
 * ---------------------------------------------------------------------------
 * `el` ist eine leere Huelle, die main.js genau einmal einhaengt. Alles darin
 * baut mount() auf. Steuerelemente, die Zustand tragen (Eingabefelder, Listen,
 * Ankreuzfelder), werden EINMAL erzeugt und von mount() nur umgehaengt —
 * getippte Pfade und Auswahlen ueberleben damit einen Sprachwechsel. Reine
 * Beschriftungen und Knoepfe baut mount() jedes Mal neu, weil ihr Text die
 * Sprache ist.
 */

import { h, on, clear, copyButton } from '../dom.js';
import { t, tn, register, fmtNum, fmtBytes, onLangChange } from '../i18n.js';
import {
  previewFiltergraph, renderWall, renderPanels, renderAll, renderStill,
} from '../api.js';
import {
  estimateSize, deliveryBytesPerPixel, targetFrameCount, deliveryName, wallLayersInOrder,
  getWallSpec, findMedia,
} from '/shared/model.js';
import { store, setStatus, showError, addLayer, updateLayer } from '../store.js';
import { pickPath } from './library.js';

register('en', {
  /* --- Ziel --- */
  'Ziel': 'Target',
  'Wand': 'Wall',
  'Wand {id}': 'Wall {id}',
  'zusätzlich Einzelpanels (X1…Xn)': 'also individual panels (X1…Xn)',
  'Zielordner': 'Output folder',
  'Blättern …': 'Browse …',
  'Zeitausschnitt': 'Time range',
  'ab s': 'from s',
  'bis s': 'to s',
  's': 's',
  's — leer = kompletter Loop': 's — empty = the whole loop',
  'Presets': 'Presets',
  'Trockenlauf': 'Dry run',
  'Zeigt nur den Befehl, rendert nichts': 'Shows the command only, renders nothing',
  'Rendern': 'Render',
  'Alle Wände rendern': 'Render all walls',
  'Alle Wände mit allen gewählten Presets': 'All walls with every selected preset',
  'Standbild': 'Still frame',
  'Einzelbild der Wand zum aktuellen Zeitpunkt': 'Single frame of the wall at the current time',
  'Alpha': 'Alpha',

  /* --- Erklaerung zu den Einzelpanels --- */
  'Zusätzlich Einzelpanels: was das kostet':
    'Also individual panels: what that costs',
  'Normalerweise entstehen Wand und Panels in EINEM ffmpeg-Durchlauf: einmal dekodieren, einmal filtern, mehrfach kodieren. Das ist der schnellste Weg — und der mit dem höchsten Speicherbedarf, weil jeder Encoder eigene Puffer hält.':
    'Normally the wall and its panels are produced in ONE ffmpeg pass: decode once, filter once, encode several times. That is the fastest route — and the most memory-hungry one, because every encoder keeps its own buffers.',
  'Reicht der Arbeitsspeicher dafür nicht, schaltet das Werkzeug von selbst um: erst die ganze Wand, dann werden die Panels in einem zweiten Durchlauf aus der fertigen Wanddatei geschnitten. Das dauert länger, braucht aber nur einen Encoder gleichzeitig. Bei HAP und ProRes ist das Ergebnis gleichwertig, bei H.264 kostet es eine Encodergeneration. Die Umschaltung steht im Joblog.':
    'If memory is not enough for that, the tool switches over by itself: first the whole wall, then the panels are cut from the finished wall file in a second pass. That takes longer but needs only one encoder at a time. With HAP and ProRes the result is identical; with H.264 it costs one encoder generation. The switch is written to the job log.',

  /* --- ffmpeg --- */
  'ffmpeg-Befehl': 'ffmpeg command',
  'Aktualisieren': 'Refresh',
  'Befehl kopieren': 'Copy command',
  'Noch nicht abgefragt.': 'Not requested yet.',
  'Wird abgefragt …': 'Requesting …',
  '(kein Befehl geliefert)': '(no command returned)',
  'Was der Graph tut': 'What the graph does',
  'Der Server konnte den Befehl nicht bauen:': 'The server could not build the command:',
  'Filtergraph-Vorschau fehlgeschlagen': 'Filter graph preview failed',
  'Eingänge:': 'Inputs:',
  'Grundfläche: {w}×{h} px in {bg}, {fps} fps.': 'Base surface: {w}×{h} px in {bg}, {fps} fps.',
  'Länge: {sec} s = {frames} Frames (erzwungen per -frames:v {frames}).':
    'Length: {sec} s = {frames} frames (forced with -frames:v {frames}).',
  ' Der doppelte Schlussframe wird weggelassen, damit der Loop nicht stockt.':
    ' The duplicate final frame is dropped so the loop does not stutter.',
  '{n} Layer werden von unten nach oben per overlay auf die Grundfläche gelegt:':
    '{n} layers are composited bottom-up onto the base surface with overlay:',
  'Kein aktiver Layer — die Wand rendert schwarz.': 'No active layer — the wall renders black.',
  'ganze Wand': 'whole wall',
  'FEHLENDE DATEI': 'MISSING FILE',
  'kein crop': 'no crop',
  'ab {sec} s': 'from {sec} s',
  '· Ausgabe ohne Ton (-an), feste Bildrate (-r / -fps_mode cfr).':
    '· Output without audio (-an), constant frame rate (-r / -fps_mode cfr).',

  /* --- Speicherplatz --- */
  'Speicherplatz': 'Disk space',
  'Kein Preset gewählt.': 'No preset selected.',
  'Dateiname': 'File name',
  'Auflösung': 'Resolution',
  'MB/Frame': 'MB/frame',
  'MB/s': 'MB/s',
  'gesamt': 'total',
  'Summe': 'Total',
  'Freier Platz': 'Free space',
  '(gemessen für {path})': '(measured for {path})',
  'unbekannt': 'unknown',
  'Der Server meldet keinen freien Speicherplatz — dieser Wert lässt sich hier nicht prüfen.':
    'The server reports no free disk space — this value cannot be checked here.',
  'Die Schätzung übersteigt den freien Platz um {diff}. So bricht der Render mittendrin ab: erst Platz schaffen, ein sparsameres Preset wählen oder weniger Ziele auf einmal rendern.':
    'The estimate exceeds the free space by {diff}. A render like that aborts halfway through: free up space, choose a leaner preset, or render fewer targets at once.',
  'Es bleiben {rest} übrig — das ist knapp.': '{rest} would be left over — that is tight.',
  'Schätzung aus Byte/Pixel des Presets — keine garantierte Datenrate. Vor dem Vollrender die Plattenkapazität und die Leserate des Mediaservers prüfen.':
    'Estimated from the preset’s bytes per pixel — not a guaranteed data rate. Before a full render, check the disk capacity and the read rate of the media server.',

  /* --- Zusammenfuegen --- */
  'Zusammenfügen — mehrere Clips zeitlich zu einem Video':
    'Join — several clips one after another into a single video',
  'Reihenfolge von oben nach unten. Die Clips werden als Layer mit versetzten Startzeiten auf denselben Slot gelegt; gerendert wird daraus ein durchgehendes Video.':
    'Order runs from top to bottom. The clips are placed on the same slot as layers with staggered start times; the render turns them into one continuous video.',
  'cut — harter Schnitt': 'cut — hard cut',
  'xfade — Überblendung': 'xfade — cross dissolve',
  'fadeblack — über Schwarz': 'fadeblack — through black',
  'dissolve': 'dissolve',
  'Übergang': 'Transition',
  'Slot': 'Slot',
  'master (ganze Wand)': 'master (whole wall)',
  'Als Abfolge anlegen': 'Create as sequence',
  'Keine Medien in der Bibliothek.': 'No media in the library.',
  'Erst Clips ankreuzen.': 'Tick some clips first.',
  '„{name}“ hat keine bekannte Dauer — die Datei erst analysieren lassen.':
    '“{name}” has no known duration — have the file analysed first.',
  '{n} Clips angelegt, Gesamtlänge {sec} s.': '{n} clips created, total length {sec} s.',
  'Achtung: Der Loop ist nur {loop} s lang — der Rest wird abgeschnitten.':
    'Careful: the loop is only {loop} s long — the rest is cut off.',
  '{n} Clips als Abfolge auf {wall}/{slot} gelegt.':
    '{n} clips placed as a sequence on {wall}/{slot}.',

  /* --- Panels --- */
  'Panels zusammensetzen — mehrere Dateien werden eine Wand':
    'Assemble panels — several files become one wall',
  'Auf Panels legen': 'Place on panels',
  '— leer —': '— empty —',
  '{n} Panel belegt.': '{n} panel filled.',
  '{n} Panels belegt.': '{n} panels filled.',
  'Nichts ausgewählt.': 'Nothing selected.',

  /* --- Zerschneiden --- */
  'Master zerschneiden — eine Wand wird zu Einzeldateien':
    'Slice master — one wall becomes individual files',
  'Masterdatei': 'Master file',
  'Fertige Wanddatei': 'Finished wall file',
  'Fertige Wanddatei, z. B. {name}': 'Finished wall file, e.g. {name}',
  'Datei …': 'File …',
  'Preset': 'Preset',
  'In Panel-Dateien schneiden': 'Cut into panel files',
  'Ohne Masterdatei wird direkt aus dem Projekt gerendert und dabei geschnitten.':
    'Without a master file the panels are rendered straight from the project and cut in the same pass.',
  'Bitte ein Preset wählen.': 'Please choose a preset.',
  'Zerschneiden': 'Slicing',

  /* --- Meldungen --- */
  '{what} gestartet (Job {id}) — Fortschritt in der Jobleiste.':
    '{what} started (job {id}) — progress is shown in the job bar.',
  '{what} konnte nicht gestartet werden': '{what} could not be started',
  'Bitte mindestens ein Delivery-Preset ankreuzen.': 'Please tick at least one delivery preset.',
  'Render {wall} → {preset}': 'Render {wall} → {preset}',
  'Render aller Wände': 'Render of all walls',
  'Erst einen Zielordner wählen.': 'Choose an output folder first.',
  'Wandspezifikation fehlt': 'Wall specification is missing',
  'Zielordner für den Render': 'Output folder for the render',
  'Zielordner für die Panel-Dateien': 'Output folder for the panel files',
  'Fertige Wanddatei wählen': 'Choose a finished wall file',
});

/* ==========================================================================
 * Pfade — ohne node:path, ohne Annahme ueber die Plattform
 * ========================================================================== */

/**
 * Ordner und Dateiname verbinden. Im Browser gibt es node:path nicht, also
 * wird das Trennzeichen aus dem Ordner selbst abgeleitet: enthaelt er einen
 * Backslash und keinen Schraegstrich, ist es ein Windows-Pfad. Damit
 * funktioniert das unter Windows, macOS und Linux, und ein Laufwerksbuchstabe
 * wird nirgends vorausgesetzt.
 */
function joinPath(dir, name) {
  const d = String(dir || '').replace(/[\\/]+$/, '');
  if (!d) return String(name);
  if (/^[A-Za-z]:$/.test(d)) return `${d}\\${name}`; // "D:" ohne Trenner
  const sep = d.includes('\\') && !d.includes('/') ? '\\' : '/';
  return `${d}${sep}${name}`;
}

/**
 * Vorbelegung des Zielordners aus dem Arbeitsverzeichnis.
 * Vertrag: das Arbeitsverzeichnis liefert workspace.out; solange nur
 * /api/health antwortet, kommt derselbe Wert aus health.paths.out.
 */
function defaultOutDir(state) {
  return (state && state.workspace && state.workspace.out)
    || (state && state.health && state.health.paths && state.health.paths.out)
    || '';
}

/**
 * Freier Platz auf dem Zieldatentraeger in Bytes, oder null.
 * Der Wert ist optional. Meldet ihn niemand, steht "unbekannt" in der
 * Tabelle — geraten wird nichts.
 */
function freeBytesOf(state) {
  const ws = (state && state.workspace) || {};
  const hd = (state && state.health) || {};
  const candidates = [
    ws.freeBytes, ws.disk && ws.disk.freeBytes,
    hd.disk && hd.disk.freeBytes, hd.freeBytes,
    hd.paths && hd.paths.freeBytes,
  ];
  for (const v of candidates) if (Number.isFinite(v) && v > 0) return v;
  return null;
}

export function createRenderView() {
  let wallId = null;
  const chosenPresets = new Set();
  const seqChecked = new Map(); // mediaId -> Reihenfolge-Zahl
  let seqCounter = 0;

  /* ------------------------------------------------- zustandstragende Teile */
  const wallSel = h('select');
  const presetBox = h('div.col', { style: 'gap:3px' });
  const outField = h('input', { type: 'text', class: 'grow' });
  const chkPanels = h('input', { type: 'checkbox' });
  const rangeFrom = h('input', { type: 'number', step: '0.1', style: 'width:70px' });
  const rangeTo = h('input', { type: 'number', step: '0.1', style: 'width:70px' });

  const cmdBox = h('div.cmdbox');
  const graphExplain = h('div.col', { style: 'gap:3px' });
  const inputsBox = h('div.mono.dim', { style: 'font-size:11px;white-space:pre-wrap' });
  const sizeBox = h('div');

  const seqList = h('div.col', { style: 'gap:2px' });
  const seqMode = h('select');
  const seqDur = h('input', { type: 'number', step: '0.1', value: '1', style: 'width:64px' });
  const seqSlot = h('select');
  const seqInfo = h('div.dim', { style: 'font-size:11.5px' });

  const panelRows = h('div.col', { style: 'gap:3px' });

  const cutFile = h('input', { type: 'text', class: 'grow' });
  const cutPreset = h('select');
  const cutOut = h('input', { type: 'text', class: 'grow' });

  /** Stabile Huelle — main.js haengt genau dieses Element einmal ein. */
  const el = h('div.viewbody');

  /* Aufbau-Schluessel. Bei Sprachwechsel entwertet, sonst bleiben deutsche
   * Optionen und Tabellen stehen. */
  let lastVenue = null;
  let lastMedia = null;
  let lastProject = null;
  let lastWorkspace = null;
  let lastHealth = null;
  let wallOptKey = null;
  let presetOptKey = null;
  let slotOptKey = null;
  let cmdShown = null; // null = "noch nicht abgefragt", sonst der Befehlstext

  /* ================================================================ Aufbau */

  /** Texte an den bleibenden Steuerelementen. Laeuft bei jedem mount(). */
  function labelControls() {
    outField.placeholder = t('Zielordner');
    cutOut.placeholder = t('Zielordner');
    rangeFrom.placeholder = t('ab s');
    rangeTo.placeholder = t('bis s');
    cutFile.placeholder = cutFilePlaceholder(store.get());
    cmdBox.textContent = cmdShown == null ? t('Noch nicht abgefragt.') : cmdShown;

    // Uebergangsliste traegt uebersetzte Beschriftungen bei gleichem Wert.
    const keep = seqMode.value || 'cut';
    clear(seqMode);
    seqMode.appendChild(h('option', { value: 'cut' }, t('cut — harter Schnitt')));
    seqMode.appendChild(h('option', { value: 'xfade' }, t('xfade — Überblendung')));
    seqMode.appendChild(h('option', { value: 'fadeblack' }, t('fadeblack — über Schwarz')));
    seqMode.appendChild(h('option', { value: 'dissolve' }, t('dissolve')));
    seqMode.value = keep;
  }

  /**
   * Beispieldateiname fuer das Feld "Masterdatei" — aus dem geladenen Venue,
   * damit dort nicht der Dateiname eines fremden Hauses steht.
   */
  function cutFilePlaceholder(state) {
    const spec = wallSpec(state);
    const venue = state && state.venue;
    if (spec && venue && venue.delivery) {
      const presetId = cutPreset.value || venue.delivery.defaultPreset
        || (venue.delivery.presets && venue.delivery.presets[0] && venue.delivery.presets[0].id);
      try {
        const name = deliveryName(venue, spec.id, spec.width, spec.height, presetId);
        return t('Fertige Wanddatei, z. B. {name}', { name });
      } catch {
        /* Preset unbekannt — dann eben ohne Beispiel */
      }
    }
    return t('Fertige Wanddatei');
  }

  function mount() {
    labelControls();
    clear(el);

    const btnOut = h('button.btn.sm', { type: 'button' }, t('Blättern …'));
    const btnStill = h('button.btn.sm',
      { type: 'button', title: t('Einzelbild der Wand zum aktuellen Zeitpunkt') }, t('Standbild'));
    const btnDry = h('button.btn',
      { type: 'button', title: t('Zeigt nur den Befehl, rendert nichts') }, t('Trockenlauf'));
    const btnRender = h('button.btn.acc', { type: 'button' }, t('Rendern'));
    const btnAll = h('button.btn',
      { type: 'button', title: t('Alle Wände mit allen gewählten Presets') }, t('Alle Wände rendern'));
    const btnPreview = h('button.btn.sm', { type: 'button' }, t('Aktualisieren'));
    const cmdCopy = copyButton(() => cmdBox.textContent, t('Befehl kopieren'));
    const btnSeq = h('button.btn.acc.sm', { type: 'button' }, t('Als Abfolge anlegen'));
    const btnPanelsPlace = h('button.btn.acc.sm', { type: 'button' }, t('Auf Panels legen'));
    const btnCutBrowse = h('button.btn.sm', { type: 'button' }, t('Datei …'));
    const btnCutOut = h('button.btn.sm', { type: 'button' }, t('Blättern …'));
    const btnCut = h('button.btn.acc.sm', { type: 'button' }, t('In Panel-Dateien schneiden'));

    on(btnOut, 'click', async () => {
      const p = await pickPath({
        title: t('Zielordner für den Render'), mode: 'dir', start: outField.value.trim(),
      });
      if (p) outField.value = p;
    });
    on(btnCutOut, 'click', async () => {
      const p = await pickPath({
        title: t('Zielordner für die Panel-Dateien'), mode: 'dir', start: cutOut.value.trim(),
      });
      if (p) cutOut.value = p;
    });
    on(btnCutBrowse, 'click', async () => {
      const p = await pickPath({
        title: t('Fertige Wanddatei wählen'), mode: 'file', start: cutOut.value.trim(),
      });
      if (p) cutFile.value = p;
    });
    on(btnPreview, 'click', () => loadPreview());
    on(btnDry, 'click', onDryRun);
    on(btnRender, 'click', onRender);
    on(btnAll, 'click', onRenderAll);
    on(btnStill, 'click', onStill);
    on(btnSeq, 'click', onSequence);
    on(btnPanelsPlace, 'click', onPlacePanels);
    on(btnCut, 'click', onCut);

    // Beschriftung links einer Zeile. Der Text kommt fertig uebersetzt herein.
    const lbl = (text, width = '96px') => h('span.lbl', { style: `width:${width}` }, text);

    el.appendChild(h('div.pad',
      // ------------------------------------------------ Ziel
      h('div.sec',
        h('div.hd', t('Ziel')),
        h('div.bd',
          h('div.row', lbl(t('Wand')), wallSel,
            h('label.row', { style: 'margin-left:12px' }, chkPanels,
              h('span', t('zusätzlich Einzelpanels (X1…Xn)'))),
            h('span.right'), btnStill),
          h('div.row', lbl(t('Zielordner')), outField, btnOut),
          h('div.row', lbl(t('Zeitausschnitt')), rangeFrom, h('span.dim', '–'), rangeTo,
            h('span.dim', t('s — leer = kompletter Loop'))),
          h('div.row', lbl(t('Presets')), h('div.grow', presetBox)),
          h('div.row', btnDry, btnRender, btnAll),
          h('div.msg.info', { style: 'font-size:11.5px' },
            h('b', t('Zusätzlich Einzelpanels: was das kostet')), h('br'),
            t('Normalerweise entstehen Wand und Panels in EINEM ffmpeg-Durchlauf: einmal dekodieren, einmal filtern, mehrfach kodieren. Das ist der schnellste Weg — und der mit dem höchsten Speicherbedarf, weil jeder Encoder eigene Puffer hält.'),
            h('br'),
            t('Reicht der Arbeitsspeicher dafür nicht, schaltet das Werkzeug von selbst um: erst die ganze Wand, dann werden die Panels in einem zweiten Durchlauf aus der fertigen Wanddatei geschnitten. Das dauert länger, braucht aber nur einen Encoder gleichzeitig. Bei HAP und ProRes ist das Ergebnis gleichwertig, bei H.264 kostet es eine Encodergeneration. Die Umschaltung steht im Joblog.')))),

      // ------------------------------------------------ ffmpeg
      h('div.sec',
        h('div.hd', t('ffmpeg-Befehl'), h('span.right'), btnPreview, cmdCopy),
        h('div.bd', cmdBox,
          h('h3.dim', { style: 'font-size:11px;text-transform:uppercase;letter-spacing:.6px' },
            t('Was der Graph tut')),
          graphExplain, inputsBox)),

      // ------------------------------------------------ Speicherplatz
      h('div.sec', h('div.hd', t('Speicherplatz')), h('div.bd', sizeBox)),

      // ------------------------------------------------ Zusammenfuegen
      h('div.sec',
        h('div.hd', t('Zusammenfügen — mehrere Clips zeitlich zu einem Video')),
        h('div.bd',
          h('span.dim', { style: 'font-size:11.5px' },
            t('Reihenfolge von oben nach unten. Die Clips werden als Layer mit versetzten Startzeiten auf denselben Slot gelegt; gerendert wird daraus ein durchgehendes Video.')),
          seqList,
          h('div.row', lbl(t('Übergang')), seqMode, seqDur, h('span.dim', t('s')),
            lbl(t('Slot'), '44px'), seqSlot, btnSeq),
          seqInfo)),

      // ------------------------------------------------ Panels
      h('div.sec',
        h('div.hd', t('Panels zusammensetzen — mehrere Dateien werden eine Wand')),
        h('div.bd', panelRows, h('div.row', btnPanelsPlace))),

      // ------------------------------------------------ Zerschneiden
      h('div.sec',
        h('div.hd', t('Master zerschneiden — eine Wand wird zu Einzeldateien')),
        h('div.bd',
          h('div.row', lbl(t('Masterdatei')), cutFile, btnCutBrowse),
          h('div.row', lbl(t('Preset')), cutPreset),
          h('div.row', lbl(t('Zielordner')), cutOut, btnCutOut),
          h('div.row', btnCut),
          h('span.dim', { style: 'font-size:11.5px' },
            t('Ohne Masterdatei wird direkt aus dem Projekt gerendert und dabei geschnitten.'))))));
  }

  /* ================================================================ Aktionen */

  on(wallSel, 'change', () => { wallId = wallSel.value; refreshAll(store.get()); });
  on(chkPanels, 'change', () => renderSizes(store.get()));
  on(cutPreset, 'change', () => { cutFile.placeholder = cutFilePlaceholder(store.get()); });

  function body(extra = {}) {
    const from = rangeFrom.value === '' ? null : Number(rangeFrom.value);
    const to = rangeTo.value === '' ? null : Number(rangeTo.value);
    return {
      wallId: wallSel.value,
      outDir: outField.value.trim() || null,
      outName: null,
      rangeSec: from == null && to == null ? null : [from ?? 0, to ?? (store.get().project?.loopSeconds || 0)],
      alsoPanels: chkPanels.checked,
      ...extra,
    };
  }

  function presetIds() {
    return [...chosenPresets];
  }

  async function start(fn, payload, what) {
    try {
      const res = await fn(payload);
      setStatus(t('{what} gestartet (Job {id}) — Fortschritt in der Jobleiste.',
        { what, id: res.jobId }), 'ok');
    } catch (e) {
      showError(t('{what} konnte nicht gestartet werden', { what }), e);
    }
  }

  function needPreset() {
    if (chosenPresets.size === 0) {
      setStatus(t('Bitte mindestens ein Delivery-Preset ankreuzen.'), 'warn');
      return false;
    }
    return true;
  }

  function onDryRun() {
    if (!needPreset()) return;
    start(renderWall, body({ presetId: presetIds()[0], dryRun: true }), t('Trockenlauf'));
  }

  function onRender() {
    if (!needPreset()) return;
    for (const presetId of presetIds()) {
      start(renderWall, body({ presetId, dryRun: false }),
        t('Render {wall} → {preset}', { wall: wallSel.value, preset: presetId }));
    }
  }

  function onRenderAll() {
    if (!needPreset()) return;
    const walls = Object.keys(store.get().project?.walls || {});
    start(renderAll, {
      presetIds: presetIds(),
      outDir: outField.value.trim() || null,
      walls,
      alsoPanels: chkPanels.checked,
    }, t('Render aller Wände'));
  }

  function onStill() {
    const st = store.get();
    const dir = outField.value.trim();
    if (!dir) { setStatus(t('Erst einen Zielordner wählen.'), 'warn'); return; }
    const sec = st.ui.transport.timeSec || 0;
    // Zeitstempel im Dateinamen: bewusst NICHT ueber fmtNum, sondern in
    // Hundertsteln mit Bindestrich. Ein Dateiname darf nicht davon abhaengen,
    // welche Sprache die Oberflaeche gerade spricht.
    const hundredths = Math.max(0, Math.round(sec * 100));
    const stamp = `${Math.floor(hundredths / 100)}-${String(hundredths % 100).padStart(2, '0')}`;
    const name = `Standbild_${wallSel.value}_${stamp}s.png`;
    start(renderStill, {
      wallId: wallSel.value, atSec: sec, outPath: joinPath(dir, name), scale: 1,
    }, t('Standbild'));
  }

  function onCut() {
    const preset = cutPreset.value;
    if (!preset) { setStatus(t('Bitte ein Preset wählen.'), 'warn'); return; }
    start(renderPanels, {
      wallId: wallSel.value,
      presetId: preset,
      outDir: cutOut.value.trim() || outField.value.trim() || null,
      fromMaster: cutFile.value.trim() || null,
    }, t('Zerschneiden'));
  }

  /* ------------------------------------------------------- Zusammenfuegen */

  function onSequence() {
    const st = store.get();
    const chosen = [...seqChecked.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    if (chosen.length === 0) { setStatus(t('Erst Clips ankreuzen.'), 'warn'); return; }
    const mode = seqMode.value;
    const dur = Math.max(0, Number(seqDur.value) || 0);
    const slotId = seqSlot.value || 'master';
    let cursor = 0;
    let placed = 0;
    for (let i = 0; i < chosen.length; i++) {
      const media = findMedia(st.project, chosen[i]);
      const len = media?.probe?.durationSec || 0;
      if (!len) {
        setStatus(t('„{name}“ hat keine bekannte Dauer — die Datei erst analysieren lassen.',
          { name: media?.name || chosen[i] }), 'warn');
        continue;
      }
      const layer = addLayer(wallSel.value, slotId, chosen[i]);
      if (!layer) continue;
      updateLayer(layer.id, {
        time: {
          startSec: Number(cursor.toFixed(3)),
          inSec: 0,
          outSec: null,
          loop: false,
          speed: 1,
          transition: { type: i === 0 ? 'cut' : mode, durSec: i === 0 ? 0 : dur },
        },
      });
      // Bei Blenden ueberlappen die Clips um die Blenddauer.
      cursor += len - (i < chosen.length - 1 && mode !== 'cut' ? dur : 0);
      placed++;
    }
    const total = cursor;
    const loopSec = st.project.loopSeconds || 0;
    seqInfo.textContent = `${t('{n} Clips angelegt, Gesamtlänge {sec} s.',
      { n: placed, sec: fmtNum(total, 2) })} `
      + (total > loopSec
        ? t('Achtung: Der Loop ist nur {loop} s lang — der Rest wird abgeschnitten.',
          { loop: fmtNum(loopSec, 2) })
        : '');
    setStatus(t('{n} Clips als Abfolge auf {wall}/{slot} gelegt.',
      { n: placed, wall: wallSel.value, slot: slotId }), 'ok');
  }

  function onPlacePanels() {
    const st = store.get();
    const spec = wallSpec(st);
    if (!spec) return;
    let n = 0;
    for (const p of spec.panels) {
      const sel = panelRows.querySelector(`select[data-panel="${p.id}"]`);
      if (sel && sel.value) { addLayer(wallSel.value, p.id, sel.value); n++; }
    }
    setStatus(n ? tn(n, '{n} Panel belegt.', '{n} Panels belegt.') : t('Nichts ausgewählt.'),
      n ? 'ok' : 'warn');
  }

  /* ================================================================ Zeichnen */

  function wallSpec(state) {
    if (!state || !state.venue || !wallSel.value) return null;
    try { return getWallSpec(state.venue, wallSel.value); }
    catch (e) { showError(t('Wandspezifikation fehlt'), e); return null; }
  }

  function fillWalls(state) {
    const walls = Object.keys(state.project?.walls || {});
    if (!wallId || !walls.includes(wallId)) wallId = state.ui.activeWallId || walls[0];
    const key = walls.join('|');
    if (key !== wallOptKey) {
      wallOptKey = key;
      clear(wallSel);
      for (const w of walls) wallSel.appendChild(h('option', { value: w }, t('Wand {id}', { id: w })));
    }
    wallSel.value = wallId || '';
  }

  function fillPresets(state) {
    const presets = state.venue?.delivery?.presets || [];
    const key = presets.map((p) => p.id).join('|');
    if (key === presetOptKey) return;
    presetOptKey = key;
    // Auswahl MERKEN, bevor geleert wird — ein geleertes select liefert immer ''.
    // Sonst faellt die Auswahl bei jedem Neuaufbau (auch beim Sprachwechsel)
    // stumm auf das Standardpreset zurueck, und der Panelschnitt liefe im
    // falschen Codec.
    const cutKeep = cutPreset.value;
    clear(presetBox);
    clear(cutPreset);
    // Beim ersten Aufbau das Standard-Preset ankreuzen; bei einem spaeteren
    // Neuaufbau (Sprachwechsel) bleibt die Auswahl des Nutzers stehen.
    const preselect = chosenPresets.size === 0;
    for (const p of presets) {
      if (preselect && p.id === state.venue.delivery.defaultPreset) chosenPresets.add(p.id);
      const chk = h('input', { type: 'checkbox', checked: chosenPresets.has(p.id) });
      on(chk, 'change', () => {
        if (chk.checked) chosenPresets.add(p.id); else chosenPresets.delete(p.id);
        renderSizes(store.get());
      });
      presetBox.appendChild(h('label.row', chk, h('span', p.label),
        p.alpha ? h('span.tag.info', t('Alpha')) : null,
        p.note ? h('span.dim', { style: 'font-size:11px' }, `— ${p.note}`) : null));
      cutPreset.appendChild(h('option', { value: p.id }, p.label));
    }
    cutPreset.value = cutKeep && presets.some((p) => p.id === cutKeep)
      ? cutKeep
      : (state.venue.delivery.defaultPreset || presets[0]?.id || '');
    cutFile.placeholder = cutFilePlaceholder(state);
  }

  function fillSlots(state) {
    const wall = state.project?.walls?.[wallSel.value];
    const slots = wall ? Object.keys(wall.slots) : [];
    const key = `${wallSel.value}:${slots.join('|')}`;
    if (key === slotOptKey) return;
    slotOptKey = key;
    const cur = seqSlot.value;
    clear(seqSlot);
    for (const s of slots) {
      seqSlot.appendChild(h('option', { value: s }, s === 'master' ? t('master (ganze Wand)') : s));
    }
    if (slots.includes(cur)) seqSlot.value = cur;
  }

  function fillSeq(state) {
    const media = state.media || [];
    clear(seqList);
    if (media.length === 0) {
      seqList.appendChild(h('span.dim', { style: 'font-size:11.5px' }, t('Keine Medien in der Bibliothek.')));
      return;
    }
    for (const m of media) {
      const chk = h('input', { type: 'checkbox', checked: seqChecked.has(m.id) });
      const order = h('span.dim.mono', { style: 'width:22px;text-align:right' },
        seqChecked.has(m.id) ? String(seqChecked.get(m.id)) : '');
      on(chk, 'change', () => {
        if (chk.checked) { seqChecked.set(m.id, ++seqCounter); order.textContent = String(seqCounter); }
        else { seqChecked.delete(m.id); order.textContent = ''; }
      });
      seqList.appendChild(h('label.row', chk, order, h('span.grow.nowrap', m.name),
        h('span.dim.mono', { style: 'font-size:11px' },
          m.probe ? `${fmtNum(m.probe.durationSec, 2)} ${t('s')}` : t('unbekannt'))));
    }
  }

  function fillPanels(state) {
    const spec = wallSpec(state);
    clear(panelRows);
    if (!spec) return;
    for (const p of spec.panels) {
      const sel = h('select', { dataset: { panel: p.id }, style: 'min-width:220px' },
        h('option', { value: '' }, t('— leer —')),
        ...(state.media || []).map((m) => h('option', { value: m.id }, m.name)));
      panelRows.appendChild(h('div.row',
        h('span.lbl', { style: 'width:96px' }, `${p.id} · ${p.width}×${spec.height}`), sel));
    }
  }

  /* ------------------------------------------------------------ Vorschau */

  async function loadPreview() {
    if (!wallSel.value) return;
    cmdShown = t('Wird abgefragt …');
    cmdBox.textContent = cmdShown;
    try {
      const res = await previewFiltergraph(wallSel.value);
      cmdShown = res.command || t('(kein Befehl geliefert)');
      cmdBox.textContent = cmdShown;
      clear(inputsBox);
      if (Array.isArray(res.inputs) && res.inputs.length) {
        inputsBox.textContent = `${t('Eingänge:')}\n${res.inputs.map((i, n) => `  [${n}] ${typeof i === 'string' ? i : (i.path || JSON.stringify(i))}`).join('\n')}`
          + (res.filterComplex ? `\n\nfilter_complex:\n${res.filterComplex}` : '')
          + (res.map ? `\n\nmap: ${res.map}` : '');
      }
      explainGraph(store.get());
    } catch (e) {
      cmdShown = `${t('Der Server konnte den Befehl nicht bauen:')}\n${e.message}`;
      cmdBox.textContent = cmdShown;
      showError(t('Filtergraph-Vorschau fehlgeschlagen'), e);
    }
  }

  function explainGraph(state) {
    clear(graphExplain);
    const project = state.project;
    const spec = wallSpec(state);
    if (!project || !spec) return;
    const wall = project.walls[wallSel.value];
    const used = wallLayersInOrder(wall, spec);
    const frames = targetFrameCount(project);

    const lines = [
      t('Grundfläche: {w}×{h} px in {bg}, {fps} fps.',
        { w: spec.width, h: spec.height, bg: project.background, fps: fmtNum(project.fps, 3) }),
      t('Länge: {sec} s = {frames} Frames (erzwungen per -frames:v {frames}).',
        { sec: fmtNum(project.loopSeconds, 3), frames })
        + (project.dropDuplicateEndFrame
          ? t(' Der doppelte Schlussframe wird weggelassen, damit der Loop nicht stockt.') : ''),
      used.length
        ? t('{n} Layer werden von unten nach oben per overlay auf die Grundfläche gelegt:',
          { n: used.length })
        : t('Kein aktiver Layer — die Wand rendert schwarz.'),
    ];
    for (const l of lines) graphExplain.appendChild(h('div', { style: 'font-size:12px' }, l));

    for (const { slot, layer } of used) {
      const media = findMedia(project, layer.mediaId);
      const tf = layer.transform || {};
      const parts = [
        slot.id === 'master' ? t('ganze Wand') : `${slot.id} (x=${slot.x}, ${slot.width}×${slot.height})`,
        media ? media.name : t('FEHLENDE DATEI'),
        `fit=${tf.fit}`,
        tf.crop ? `crop=${tf.crop.w}:${tf.crop.h}:${tf.crop.x}:${tf.crop.y}` : t('kein crop'),
        t('ab {sec} s', { sec: fmtNum(layer.time?.startSec || 0, 2) }),
        layer.blend !== 'normal' ? `blend=${layer.blend}` : null,
      ].filter(Boolean);
      graphExplain.appendChild(h('div.dim', { style: 'font-size:11.5px' }, `· ${parts.join(' · ')}`));
    }
    graphExplain.appendChild(h('div.dim', { style: 'font-size:11.5px' },
      t('· Ausgabe ohne Ton (-an), feste Bildrate (-r / -fps_mode cfr).')));
  }

  /* --------------------------------------------------------- Speicherplatz */

  function renderSizes(state) {
    clear(sizeBox);
    const project = state.project;
    const spec = wallSpec(state);
    if (!project || !spec) return;
    const presets = (state.venue?.delivery?.presets || []).filter((p) => chosenPresets.has(p.id));
    if (presets.length === 0) {
      sizeBox.appendChild(h('span.dim', t('Kein Preset gewählt.')));
      return;
    }

    const targets = [{ id: spec.id, w: spec.width, h: spec.height }];
    if (chkPanels.checked) for (const p of spec.panels) targets.push({ id: p.id, w: p.width, h: spec.height });

    const rows = [];
    let total = 0;
    for (const preset of presets) {
      for (const tgt of targets) {
        const est = estimateSize(tgt.w, tgt.h, project.fps, project.loopSeconds, deliveryBytesPerPixel(preset));
        total += est.totalBytes;
        let name = '—';
        try { name = deliveryName(state.venue, tgt.id, tgt.w, tgt.h, preset.id); }
        catch { /* Preset unbekannt — Name bleibt leer */ }
        rows.push(h('tr',
          h('td', preset.label),
          h('td.mono', { style: 'font-size:11px' }, name),
          h('td.num', `${tgt.w}×${tgt.h}`),
          h('td.num', fmtNum(est.bytesPerFrame / 1e6, 2)),
          h('td.num', fmtNum(est.mbPerSec, 1)),
          h('td.num', fmtBytes(est.totalBytes))));
      }
    }

    const free = freeBytesOf(state);
    const tooBig = free != null && total > free;

    sizeBox.appendChild(h('table.tbl',
      h('thead', h('tr', h('th', t('Preset')), h('th', t('Dateiname')), h('th.num', t('Auflösung')),
        h('th.num', t('MB/Frame')), h('th.num', t('MB/s')), h('th.num', t('gesamt')))),
      h('tbody', rows,
        h('tr', h('td', { colspan: 5 }, h('b', t('Summe'))),
          h('td.num', { style: tooBig ? 'color:var(--err)' : null }, h('b', fmtBytes(total)))))));

    // Freier Platz — die Schaetzung ohne Bezugsgroesse hilft niemandem.
    const refPath = defaultOutDir(state);
    sizeBox.appendChild(h('div.row', { style: 'font-size:11.5px' },
      h('span.dim', `${t('Freier Platz')}:`),
      h('span.mono', { style: tooBig ? 'color:var(--err)' : null },
        free == null ? t('unbekannt') : fmtBytes(free)),
      free != null && refPath
        ? h('span.dim.nowrap', { style: 'font-size:11px', title: refPath },
          t('(gemessen für {path})', { path: refPath }))
        : null));

    if (free == null) {
      sizeBox.appendChild(h('span.dim', { style: 'font-size:11px' },
        t('Der Server meldet keinen freien Speicherplatz — dieser Wert lässt sich hier nicht prüfen.')));
    } else if (tooBig) {
      sizeBox.appendChild(h('div.msg.err',
        t('Die Schätzung übersteigt den freien Platz um {diff}. So bricht der Render mittendrin ab: erst Platz schaffen, ein sparsameres Preset wählen oder weniger Ziele auf einmal rendern.',
          { diff: fmtBytes(total - free) })));
    } else if (total > free * 0.8) {
      sizeBox.appendChild(h('div.msg.warn',
        t('Es bleiben {rest} übrig — das ist knapp.', { rest: fmtBytes(free - total) })));
    }

    sizeBox.appendChild(h('span.dim', { style: 'font-size:11px' },
      t('Schätzung aus Byte/Pixel des Presets — keine garantierte Datenrate. Vor dem Vollrender die Plattenkapazität und die Leserate des Mediaservers prüfen.')));
  }

  /* ------------------------------------------------------------- update */

  function refreshAll(state) {
    fillSlots(state);
    fillPanels(state);
    renderSizes(state);
    explainGraph(state);
  }

  function update(state) {
    if (!state.project) return;
    fillWalls(state);
    if (state.venue !== lastVenue) {
      lastVenue = state.venue;
      fillPresets(state);
      refreshAll(state);
    }
    if (state.media !== lastMedia) {
      lastMedia = state.media;
      fillSeq(state);
      fillPanels(state);
    }
    if (state.project !== lastProject) {
      lastProject = state.project;
      fillSlots(state);
      renderSizes(state);
      explainGraph(state);
    }
    // Zielordner aus dem Arbeitsverzeichnis vorbelegen, solange der Nutzer
    // nichts Eigenes eingetragen hat.
    if (!outField.value) {
      const dir = defaultOutDir(state);
      if (dir) outField.value = dir;
    }
    // Arbeitsverzeichnis und freier Platz koennen nach dem ersten Zeichnen
    // eintreffen — dann muss die Schaetzung neu gerechnet werden.
    if (state.workspace !== lastWorkspace || state.health !== lastHealth) {
      lastWorkspace = state.workspace;
      lastHealth = state.health;
      renderSizes(state);
    }
  }

  /* Sprachwechsel: Beschriftungen neu bauen UND alle Aufbau-Schluessel
   * entwerten, sonst bleiben Optionen und Tabellen in der alten Sprache. */
  onLangChange(() => {
    lastVenue = null;
    lastMedia = null;
    lastProject = null;
    lastWorkspace = null;
    lastHealth = null;
    wallOptKey = null;
    presetOptKey = null;
    slotOptKey = null;
    mount();
    const st = store.get();
    if (st.project) update(st);
  });

  mount();

  return { el, update, loadPreview };
}
