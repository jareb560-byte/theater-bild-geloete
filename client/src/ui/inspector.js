/**
 * Theater-Bild-Gelöte — Layer-Inspektor (rechte Spalte).
 *
 * Alle Felder sind zweiseitig gebunden: Eingabe schreibt sofort per
 * updateLayer() ins Projekt, eine Aenderung von aussen (3D-Ansicht, Editor,
 * Tastatur) schreibt zurueck in die Felder — ausser in das gerade fokussierte.
 *
 * Einheiten: crop in QUELL-Pixeln, dest/offset/feather in SLOT-Pixeln. Jedes
 * Zahlenfeld traegt seine Einheit sichtbar neben dem Eingabefeld, damit ohne
 * Vorwissen klar ist, was einzutragen ist.
 *
 * Mehrsprachig: alle sichtbaren Texte laufen durch t(). Die Zahlen IN den
 * Eingabefeldern bleiben maschinenlesbar (Punkt als Dezimaltrenner), sonst
 * kann <input type="number"> sie nicht mehr lesen.
 */

import { h, on, clear } from '../dom.js';
import { defaultTransform, defaultFilters, defaultTime, findMedia } from '/shared/model.js';
import { store, updateLayer, removeLayer, moveLayer, reorderLayer, layerLocation, setStatus } from '../store.js';
// fmtNum/fmtBytes werden hier bewusst nicht gebraucht: der Inspektor zeigt
// ausserhalb der Eingabefelder nur ganze Pixelmasse. Ein Tausenderpunkt
// ("2.736×1.224 px") waere bei Aufloesungen falsch, und die Werte IN den
// Feldern muessen maschinenlesbar bleiben.
import { t, register, onLangChange } from '../i18n.js';

register('en', {
  /* --- Kopf --- */
  'Inspektor': 'Inspector',
  'Kein Layer ausgewählt. Links einen Layer anklicken oder in der Bibliothek Material auf einen Slot legen.':
    'No layer selected. Click a layer on the left, or place footage on a slot in the library.',
  'Layer': 'Layer',
  'aktiv': 'active',
  'Layer stummschalten, ohne ihn zu löschen': 'Mute the layer without deleting it',
  'Eine Stufe nach oben': 'One step up',
  'Eine Stufe nach unten': 'One step down',
  'Löschen': 'Delete',
  'Name': 'Name',
  'Bezeichnung': 'Label',
  'Slot': 'Slot',
  '{name} · {w}×{h} px': '{name} · {w}×{h} px',
  'Quelldatei fehlt!': 'Source file missing!',
  'Slot {id}: {w}×{h} px, x={x}': 'Slot {id}: {w}×{h} px, x={x}',
  'Der Layer verweist auf eine Datei, die nicht mehr in der Bibliothek ist.':
    'This layer points to a file that is no longer in the library.',
  'Blend': 'Blend',
  'add — Neon/Holo': 'add — neon/holo',
  'add hellt auf, ohne Schwarz zu tragen — richtig für Neon und Holo-Elemente':
    'add brightens without carrying black — the right choice for neon and holo elements',

  /* --- Einpassen --- */
  'Einpassen': 'Fit',
  'Auf Slot zentrieren': 'Center in slot',
  'Zielrechteck im Slot zentrieren (setzt fit auf manual)':
    'Center the destination rectangle in the slot (sets fit to manual)',
  'Auf Panelbreite einpassen': 'Fit to panel width',
  'Auf Slotbreite skalieren, Seitenverhältnis der Quelle behalten':
    'Scale to slot width, keeping the source aspect ratio',
  'cover füllt und schneidet, contain lässt Rand, native nimmt Originalpixel, manual benutzt das Zielrechteck unverändert.':
    'cover fills and crops, contain leaves a border, native uses the original pixels, manual uses the destination rectangle unchanged.',
  'Die Quellauflösung ist unbekannt — erst analysieren lassen.':
    'The source resolution is unknown — have the file analysed first.',
  'Die Quellauflösung ist unbekannt.': 'The source resolution is unknown.',

  /* --- Crop und Position --- */
  'Crop — Quellpixel': 'Crop — source pixels',
  'Position — Slotpixel': 'Position — slot pixels',
  'b': 'w',
  'h': 'h',
  'Breite': 'Width',
  'Höhe': 'Height',
  'Crop zurücksetzen': 'Reset crop',
  'Ganze Quelle': 'Entire source',
  'Crop auf die volle Quelle setzen, damit die Felder benutzbar sind':
    'Set the crop to the full source so the fields become usable',
  'Ausschnitt in Quellpixeln von {w}×{h}': 'Crop in source pixels out of {w}×{h}',
  'kein Ausschnitt — es wird die ganze Quelle benutzt ({w}×{h})':
    'no crop — the entire source is used ({w}×{h})',
  'Feinversatz, wird auf das Zielrechteck addiert': 'Fine offset, added to the destination rectangle',
  'Zoom': 'Zoom',
  'Zusätzlicher Zoom um die Mitte des Zielrechtecks': 'Additional zoom around the centre of the destination rectangle',
  'Drehung': 'Rotation',
  'Nur rechte Winkel — alles andere kostet eine zusätzliche Filterstufe':
    'Right angles only — anything else costs an extra filter stage',
  'horizontal spiegeln': 'flip horizontally',
  'vertikal': 'vertically',

  /* --- Farbe --- */
  'Farbe': 'Color',
  'Deckkraft': 'Opacity',
  'Helligkeit': 'Brightness',
  'Kontrast': 'Contrast',
  'Sättigung': 'Saturation',
  'Gamma': 'Gamma',
  'Farbton': 'Hue',
  'Weichzeichnen': 'Blur',
  'Schwarzwert': 'Black level',
  'Hebt oder senkt Schwarz — LED-Panels heben Schwarz oft von selbst an':
    'Raises or lowers black — LED panels often lift black on their own',
  'Dithering': 'Dithering',
  'Gegen Banding in dunklen Gradienten': 'Against banding in dark gradients',
  'Farbe zurücksetzen': 'Reset color',
  'Grad': 'degrees',
  '0,1–3': '0.1–3',
  '±0,1': '±0.1',

  /* --- Weiche Kante --- */
  'Weiche Kante (Feather) — Slotpixel': 'Feather — slot pixels',
  'links': 'left',
  'rechts': 'right',
  'oben': 'top',
  'unten': 'bottom',
  'alle gleich': 'all the same',
  'Für Übergänge über eine Panelnaht: die Kante des oberen Layers weich auslaufen lassen.':
    'For transitions across a panel seam: let the edge of the upper layer fade out softly.',

  /* --- Zeit --- */
  'Zeit': 'Time',
  'Start': 'Start',
  'Startzeit im Loop': 'Start time within the loop',
  'Tempo': 'Speed',
  'Zeitdehnung, 1 = original': 'Time stretch, 1 = original',
  'In': 'In',
  'Einstiegspunkt in der Quelle': 'In point within the source',
  'Out': 'Out',
  'Ausstiegspunkt in der Quelle, leer = bis Ende': 'Out point within the source, empty = to the end',
  'wiederholen bis Loopende': 'repeat until the end of the loop',
  'Übergang': 'Transition',
  'cut — harter Schnitt': 'cut — hard cut',
  'xfade — Überblendung': 'xfade — crossfade',
  'fadeblack — über Schwarz': 'fadeblack — through black',
  'Übergang zum vorherigen Layer im selben Slot': 'Transition to the previous layer in the same slot',
  'Dauer': 'Duration',
  'Zeit zurücksetzen': 'Reset time',
});

/* ---------------------------------------------------------------- Pfade */

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function patchPath(path, value) {
  const keys = path.split('.');
  const out = {};
  let cur = out;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else { cur[k] = {}; cur = cur[k]; }
  });
  return out;
}

export function createInspector() {
  const body = h('div.col', { style: 'gap:0' });
  const el = body;

  let builtFor = null;   // 'wand/slot/layerId', fuer den die Felder gebaut sind
  let fields = [];       // { path, apply(layer) }
  let currentLayerId = null;

  /* ------------------------------------------------------------ Bausteine */

  function commit(path, value) {
    if (!currentLayerId) return;
    updateLayer(currentLayerId, patchPath(path, value));
  }

  function fNum(label, path, opts = {}) {
    const input = h('input', {
      type: 'number',
      step: opts.step != null ? String(opts.step) : '1',
      min: opts.min != null ? String(opts.min) : null,
      max: opts.max != null ? String(opts.max) : null,
      style: opts.width ? `width:${opts.width}px` : null,
      title: opts.title ? t(opts.title) : '',
      'aria-label': opts.aria ? t(opts.aria) : (label != null ? t(label) : null),
    });
    on(input, 'input', () => {
      const raw = input.value.trim();
      if (raw === '') { if (opts.nullable) commit(path, null); return; }
      const v = Number(raw);
      if (!isFinite(v)) return;
      commit(path, opts.int ? Math.round(v) : v);
    });
    fields.push({
      path,
      apply(layer) {
        if (document.activeElement === input) return;
        const v = getPath(layer, path);
        // Bewusst NICHT sprachabhaengig formatiert: <input type="number">
        // versteht nur den Punkt als Dezimaltrenner.
        input.value = v == null ? '' : String(Number(v.toFixed ? Number(v.toFixed(4)) : v));
      },
    });
    const wrap = h('div.fld',
      label != null ? h('span.lbl', { class: opts.narrow ? 'lbl w54' : 'lbl' }, t(label)) : null,
      input,
      opts.unit ? h('span.unit', t(opts.unit)) : null);
    return { wrap, input };
  }

  function fSlider(label, path, opts = {}) {
    const min = opts.min ?? 0, max = opts.max ?? 1, step = opts.step ?? 0.01;
    const range = h('input', {
      type: 'range', min: String(min), max: String(max), step: String(step), class: 'grow',
      'aria-label': t(label),
    });
    const box = h('input', {
      type: 'number', min: String(min), max: String(max), step: String(step), style: 'width:60px',
      'aria-label': t(label),
    });
    const push = (v) => commit(path, Number(v));
    on(range, 'input', () => { box.value = range.value; push(range.value); });
    on(box, 'input', () => { const v = Number(box.value); if (isFinite(v)) { range.value = String(v); push(v); } });
    fields.push({
      path,
      apply(layer) {
        const v = Number(getPath(layer, path) ?? min);
        if (document.activeElement !== range) range.value = String(v);
        // Auch hier maschinenlesbar, siehe fNum().
        if (document.activeElement !== box) box.value = String(Number(v.toFixed(4)));
      },
    });
    return h('div.fld',
      h('span.lbl', { title: opts.title ? t(opts.title) : '' }, t(label)),
      range, box,
      opts.unit ? h('span.unit', t(opts.unit)) : null);
  }

  function fCheck(label, path, title) {
    const input = h('input', { type: 'checkbox' });
    on(input, 'change', () => commit(path, input.checked));
    fields.push({ path, apply(layer) { input.checked = !!getPath(layer, path); } });
    return h('label.row', { title: title ? t(title) : '' }, input, h('span', t(label)));
  }

  function fSelect(label, path, options, title) {
    const sel = h('select', ...options.map(([v, txt]) => h('option', { value: String(v) }, t(txt))));
    on(sel, 'change', () => {
      const raw = sel.value;
      const opt = options.find(([v]) => String(v) === raw);
      commit(path, typeof opt[0] === 'number' ? Number(raw) : raw);
    });
    fields.push({
      path,
      apply(layer) {
        if (document.activeElement === sel) return;
        sel.value = String(getPath(layer, path) ?? options[0][0]);
      },
    });
    sel.setAttribute('aria-label', t(label));
    return h('div.fld', h('span.lbl', { title: title ? t(title) : '' }, t(label)), sel);
  }

  function section(title, ...content) {
    return h('div.sec', h('div.hd', t(title)), h('div.bd', ...content));
  }

  /* ------------------------------------------------------------ Aufbau */

  function build(state, loc) {
    fields = [];
    clear(body);
    const layer = loc.layer;
    const slot = loc.slot;
    const media = findMedia(state.project, layer.mediaId);
    const srcW = media?.probe?.width || 0;
    const srcH = media?.probe?.height || 0;

    /* --- Kopf ------------------------------------------------------- */
    const nameField = h('input', {
      type: 'text', class: 'grow', value: layer.label || media?.name || '',
      placeholder: t('Bezeichnung'), 'aria-label': t('Name'),
    });
    on(nameField, 'input', () => commit('label', nameField.value));
    fields.push({ path: 'label', apply(l) { if (document.activeElement !== nameField) nameField.value = l.label || ''; } });

    const slotSel = h('select', { 'aria-label': t('Slot') });
    for (const [wid, w] of Object.entries(state.project.walls)) {
      for (const sid of Object.keys(w.slots)) {
        slotSel.appendChild(h('option', { value: `${wid}/${sid}` }, `${wid} · ${sid === 'master' ? 'master' : sid}`));
      }
    }
    slotSel.value = `${loc.wallId}/${loc.slotId}`;
    on(slotSel, 'change', () => moveLayer(layer.id, slotSel.value.split('/')[1]));

    const btnUp = h('button.btn.sm', { type: 'button', title: t('Eine Stufe nach oben'), 'aria-label': t('Eine Stufe nach oben') }, '▲');
    const btnDown = h('button.btn.sm', { type: 'button', title: t('Eine Stufe nach unten'), 'aria-label': t('Eine Stufe nach unten') }, '▼');
    const btnDel = h('button.btn.sm.danger', { type: 'button' }, t('Löschen'));
    on(btnUp, 'click', () => reorderLayer(layer.id, 1));
    on(btnDown, 'click', () => reorderLayer(layer.id, -1));
    on(btnDel, 'click', () => removeLayer(layer.id));

    body.appendChild(section('Layer',
      h('div.row', fCheck('aktiv', 'enabled', 'Layer stummschalten, ohne ihn zu löschen'), h('span.right'), btnUp, btnDown, btnDel),
      h('div.fld', h('span.lbl', t('Name')), nameField),
      h('div.fld', h('span.lbl', t('Slot')), slotSel),
      h('div.dim', { style: 'font-size:11.5px', title: media?.absPath || '' },
        media
          ? t('{name} · {w}×{h} px', { name: media.name, w: srcW, h: srcH })
          : t('Quelldatei fehlt!')),
      h('div.dim', { style: 'font-size:11.5px' },
        t('Slot {id}: {w}×{h} px, x={x}', {
          id: slot.id, w: slot.width, h: slot.height, x: slot.x,
        })),
      media ? null : h('div.msg.err', t('Der Layer verweist auf eine Datei, die nicht mehr in der Bibliothek ist.')),
      fSelect('Blend', 'blend', [['normal', 'normal'], ['add', 'add — Neon/Holo'], ['screen', 'screen'], ['multiply', 'multiply']],
        'add hellt auf, ohne Schwarz zu tragen — richtig für Neon und Holo-Elemente'),
    ));

    /* --- Fit -------------------------------------------------------- */
    const fitButtons = h('div.seg',
      ...['cover', 'contain', 'stretch', 'native', 'manual'].map((f) => {
        // Die fit-Namen sind Fachbegriffe der Pipeline und bleiben unuebersetzt.
        const b = h('button.btn.sm', { type: 'button', dataset: { fit: f } }, f);
        on(b, 'click', () => commit('transform.fit', f));
        return b;
      }));
    fields.push({
      path: 'transform.fit',
      apply(l) {
        for (const b of fitButtons.children) b.classList.toggle('on', b.dataset.fit === (l.transform?.fit || 'cover'));
      },
    });

    const btnCenter = h('button.btn.sm', {
      type: 'button', title: t('Zielrechteck im Slot zentrieren (setzt fit auf manual)'),
    }, t('Auf Slot zentrieren'));
    on(btnCenter, 'click', () => {
      const tr = store.get() && layerLocation(store.get(), layer.id)?.layer?.transform;
      const w = tr?.dest?.w || slot.width;
      const hh = tr?.dest?.h || slot.height;
      updateLayer(layer.id, {
        transform: { fit: 'manual', dest: { x: Math.round((slot.width - w) / 2), y: Math.round((slot.height - hh) / 2) }, offset: { x: 0, y: 0 } },
      });
    });

    const btnFitWidth = h('button.btn.sm', {
      type: 'button', title: t('Auf Slotbreite skalieren, Seitenverhältnis der Quelle behalten'),
    }, t('Auf Panelbreite einpassen'));
    on(btnFitWidth, 'click', () => {
      const l = layerLocation(store.get(), layer.id)?.layer;
      const tr = l?.transform || defaultTransform();
      const cw = tr.crop?.w || srcW;
      const ch = tr.crop?.h || srcH;
      if (!cw || !ch) { setStatus(t('Die Quellauflösung ist unbekannt — erst analysieren lassen.'), 'warn'); return; }
      const newH = Math.round((slot.width * ch) / cw);
      updateLayer(layer.id, {
        transform: {
          fit: 'manual',
          dest: { x: 0, y: Math.round((slot.height - newH) / 2), w: slot.width, h: newH },
        },
      });
    });

    body.appendChild(section('Einpassen',
      fitButtons,
      h('div.row.wrap', btnCenter, btnFitWidth),
      h('span.dim', { style: 'font-size:11px' },
        t('cover füllt und schneidet, contain lässt Rand, native nimmt Originalpixel, manual benutzt das Zielrechteck unverändert.'))));

    /* --- Crop ------------------------------------------------------- */
    const btnCropReset = h('button.btn.sm', { type: 'button' }, t('Crop zurücksetzen'));
    on(btnCropReset, 'click', () => updateLayer(layer.id, { transform: { crop: null } }));
    const btnCropFull = h('button.btn.sm', {
      type: 'button', title: t('Crop auf die volle Quelle setzen, damit die Felder benutzbar sind'),
    }, t('Ganze Quelle'));
    on(btnCropFull, 'click', () => {
      if (!srcW || !srcH) { setStatus(t('Die Quellauflösung ist unbekannt.'), 'warn'); return; }
      updateLayer(layer.id, { transform: { crop: { x: 0, y: 0, w: srcW, h: srcH } } });
    });

    const cropX = fNum('x', 'transform.crop.x', { int: true, narrow: true, unit: 'px' });
    const cropY = fNum('y', 'transform.crop.y', { int: true, narrow: true, unit: 'px' });
    const cropW = fNum('b', 'transform.crop.w', { int: true, narrow: true, unit: 'px', aria: 'Breite' });
    const cropH = fNum('h', 'transform.crop.h', { int: true, narrow: true, unit: 'px', aria: 'Höhe' });
    const cropNote = h('span.dim', { style: 'font-size:11px' });
    fields.push({
      path: 'transform.crop',
      apply(l) {
        const c = l.transform?.crop;
        const vars = { w: srcW, h: srcH };
        cropNote.textContent = c
          ? t('Ausschnitt in Quellpixeln von {w}×{h}', vars)
          : t('kein Ausschnitt — es wird die ganze Quelle benutzt ({w}×{h})', vars);
        for (const f of [cropX, cropY, cropW, cropH]) f.input.disabled = !c;
      },
    });

    body.appendChild(section('Crop — Quellpixel',
      h('div.grid4', cropX.wrap, cropY.wrap, cropW.wrap, cropH.wrap),
      cropNote,
      h('div.row', btnCropFull, btnCropReset)));

    /* --- Position --------------------------------------------------- */
    body.appendChild(section('Position — Slotpixel',
      h('div.grid4',
        fNum('x', 'transform.dest.x', { int: true, narrow: true, unit: 'px' }).wrap,
        fNum('y', 'transform.dest.y', { int: true, narrow: true, unit: 'px' }).wrap,
        fNum('b', 'transform.dest.w', { int: true, narrow: true, unit: 'px', aria: 'Breite' }).wrap,
        fNum('h', 'transform.dest.h', { int: true, narrow: true, unit: 'px', aria: 'Höhe' }).wrap),
      h('div.grid2',
        fNum('Δx', 'transform.offset.x', { int: true, narrow: true, unit: 'px', title: 'Feinversatz, wird auf das Zielrechteck addiert' }).wrap,
        fNum('Δy', 'transform.offset.y', { int: true, narrow: true, unit: 'px' }).wrap),
      fSlider('Zoom', 'transform.zoom', { min: 0.1, max: 4, step: 0.01, unit: '×', title: 'Zusätzlicher Zoom um die Mitte des Zielrechtecks' }),
      fSelect('Drehung', 'transform.rotate', [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']],
        'Nur rechte Winkel — alles andere kostet eine zusätzliche Filterstufe'),
      h('div.row', fCheck('horizontal spiegeln', 'transform.flipH'), fCheck('vertikal', 'transform.flipV'))));

    /* --- Farbe ------------------------------------------------------ */
    body.appendChild(section('Farbe',
      fSlider('Deckkraft', 'filters.opacity', { min: 0, max: 1, step: 0.01, unit: '0–1' }),
      fSlider('Helligkeit', 'filters.brightness', { min: -1, max: 1, step: 0.01, unit: '−1…1' }),
      fSlider('Kontrast', 'filters.contrast', { min: 0, max: 3, step: 0.01, unit: '0–3' }),
      fSlider('Sättigung', 'filters.saturation', { min: 0, max: 3, step: 0.01, unit: '0–3' }),
      fSlider('Gamma', 'filters.gamma', { min: 0.1, max: 3, step: 0.01, unit: '0,1–3' }),
      fSlider('Farbton', 'filters.hueDeg', { min: -180, max: 180, step: 1, unit: '°', title: 'Grad' }),
      fSlider('Weichzeichnen', 'filters.blurPx', { min: 0, max: 40, step: 0.5, unit: 'px' }),
      fSlider('Schwarzwert', 'filters.blackLift', { min: -0.1, max: 0.1, step: 0.001, unit: '±0,1', title: 'Hebt oder senkt Schwarz — LED-Panels heben Schwarz oft von selbst an' }),
      h('div.row', fCheck('Dithering', 'filters.dither', 'Gegen Banding in dunklen Gradienten'),
        h('button.btn.sm.right', {
          type: 'button',
          onClick: () => updateLayer(layer.id, { filters: { ...defaultFilters(), feather: layer.filters?.feather || { l: 0, r: 0, t: 0, b: 0 } } }),
        }, t('Farbe zurücksetzen')))));

    /* --- Feather ---------------------------------------------------- */
    let featherLinked = true;
    const chkLink = h('input', { type: 'checkbox', checked: true });
    on(chkLink, 'change', () => { featherLinked = chkLink.checked; });
    const featherFields = {};
    for (const side of ['l', 'r', 't', 'b']) {
      const f = fNum({ l: 'links', r: 'rechts', t: 'oben', b: 'unten' }[side], `filters.feather.${side}`,
        { int: true, min: 0, narrow: true, unit: 'px' });
      on(f.input, 'input', () => {
        if (!featherLinked) return;
        const v = Math.round(Number(f.input.value) || 0);
        updateLayer(layer.id, { filters: { feather: { l: v, r: v, t: v, b: v } } });
      });
      featherFields[side] = f;
    }
    body.appendChild(section('Weiche Kante (Feather) — Slotpixel',
      h('div.grid2', featherFields.l.wrap, featherFields.r.wrap, featherFields.t.wrap, featherFields.b.wrap),
      h('label.row', chkLink, h('span', t('alle gleich'))),
      h('span.dim', { style: 'font-size:11px' },
        t('Für Übergänge über eine Panelnaht: die Kante des oberen Layers weich auslaufen lassen.'))));

    /* --- Zeit ------------------------------------------------------- */
    body.appendChild(section('Zeit',
      h('div.grid2',
        fNum('Start', 'time.startSec', { step: 0.01, unit: 's', narrow: true, title: 'Startzeit im Loop' }).wrap,
        fNum('Tempo', 'time.speed', { step: 0.01, min: 0.05, unit: '×', narrow: true, title: 'Zeitdehnung, 1 = original' }).wrap,
        fNum('In', 'time.inSec', { step: 0.01, unit: 's', narrow: true, title: 'Einstiegspunkt in der Quelle' }).wrap,
        fNum('Out', 'time.outSec', { step: 0.01, unit: 's', narrow: true, nullable: true, title: 'Ausstiegspunkt in der Quelle, leer = bis Ende' }).wrap),
      fCheck('wiederholen bis Loopende', 'time.loop'),
      fSelect('Übergang', 'time.transition.type',
        [['cut', 'cut — harter Schnitt'], ['xfade', 'xfade — Überblendung'], ['fadeblack', 'fadeblack — über Schwarz'], ['dissolve', 'dissolve']],
        'Übergang zum vorherigen Layer im selben Slot'),
      fNum('Dauer', 'time.transition.durSec', { step: 0.05, min: 0, unit: 's' }).wrap,
      h('button.btn.sm', {
        type: 'button',
        onClick: () => updateLayer(layer.id, { time: defaultTime() }),
      }, t('Zeit zurücksetzen'))));

    builtFor = `${loc.wallId}/${loc.slotId}/${layer.id}`;
  }

  /* ------------------------------------------------------------ update */

  function update(state) {
    const loc = layerLocation(state, state.ui.selectedLayerId);
    if (!loc) {
      builtFor = null;
      currentLayerId = null;
      fields = [];
      clear(body);
      body.appendChild(h('div.sec', h('div.hd', t('Inspektor')),
        h('div.bd', h('span.dim',
          t('Kein Layer ausgewählt. Links einen Layer anklicken oder in der Bibliothek Material auf einen Slot legen.')))));
      return;
    }
    currentLayerId = loc.layer.id;
    if (builtFor !== `${loc.wallId}/${loc.slotId}/${loc.layer.id}`) build(state, loc);
    for (const f of fields) {
      try { f.apply(loc.layer); } catch (e) { console.error('[inspector] Feld', f.path, e); }
    }
  }

  // Sprachwechsel: der Zwischenspeicher builtFor muss weg, sonst haelt der
  // Inspektor die alte Sprache fest und baut die Felder nie neu.
  onLangChange(() => {
    builtFor = null;
    try {
      update(store.get());
    } catch (e) {
      console.error('[inspector] Neuaufbau nach Sprachwechsel:', e);
      setStatus(`Inspektor konnte nicht neu aufgebaut werden: ${e.message}`, 'err');
    }
  });

  return { el, update };
}
