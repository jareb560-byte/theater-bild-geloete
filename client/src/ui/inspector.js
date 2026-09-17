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
  'Bild einpassen': 'Fit image',
  'Fläche füllen': 'Fill area',
  'Ganzes Bild': 'Entire image',
  'Strecken': 'Stretch',
  'Originalgröße': 'Original size',
  'Frei platzieren': 'Place freely',
  'Füllt die Fläche vollständig. Überstehende Bildränder werden abgeschnitten.': 'Fills the entire area. Image edges outside it are cropped.',
  'Zeigt das ganze Bild. Freie Bereiche bleiben sichtbar.': 'Shows the entire image. Unused areas remain visible.',
  'Passt Breite und Höhe an die Fläche an. Das Bild kann dabei verzerrt werden.': 'Fits both width and height to the area. This may distort the image.',
  'Ein Bildpixel entspricht einem Pixel der LED-Wand.': 'One image pixel equals one LED wall pixel.',
  'Bild im 2D-Editor ziehen oder Position und Größe in Pixeln eingeben.': 'Drag the image in the 2D editor or enter its position and size in pixels.',
  'Position & Größe': 'Position & size',
  'Waagerecht': 'Horizontal',
  'Senkrecht': 'Vertical',
  'Bildgröße': 'Image size',
  'Im 2D-Editor: Bild ziehen zum Verschieben, Griffe ziehen zum Vergrößern.': 'In the 2D editor: drag the image to move it, drag its handles to resize it.',
  'Pixelgenau platzieren': 'Position by pixels',
  'Eine Eingabe wechselt zu „Frei platzieren“. Alle Angaben beziehen sich auf die gewählte Fläche.': 'Entering a value switches to Place freely. All values refer to the selected area.',
  'Bildausschnitt': 'Image crop',
  'Ausschnitt zurücksetzen': 'Reset crop',
  'Farbe & Effekte': 'Color & effects',
  'Weiche Bildränder': 'Soft image edges',
  'Zeit & Wiederholung': 'Timing & repeat',
  'Ebene & Quelldatei': 'Layer & source file',
  'Standard': 'Default',
  'angepasst': 'adjusted',
  'ganze Fläche': 'entire area',
  'Zentrieren': 'Center',
  'Auf Breite einpassen': 'Fit to width',
  'Bildanpassung zurücksetzen': 'Reset image placement',
  'Auf Fläche füllen zurücksetzen; Position, Größe, Drehung und Spiegelung zurücksetzen. Der Bildausschnitt bleibt erhalten.': 'Reset to Fill area; reset position, size, rotation and flips. Keep the image crop.',
  'Bildmischung': 'Blending',
  'Normal': 'Normal',
  'Aufhellen (Neon)': 'Add light (neon)',
  'Negativ multiplizieren': 'Screen',
  'Multiplizieren': 'Multiply',
  'Harter Schnitt': 'Hard cut',
  'Überblenden': 'Crossfade',
  'Über Schwarz': 'Fade through black',
  'Auflösen': 'Dissolve',
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

const FIT_OPTIONS = [
  ['cover', 'Fläche füllen', 'Füllt die Fläche vollständig. Überstehende Bildränder werden abgeschnitten.'],
  ['contain', 'Ganzes Bild', 'Zeigt das ganze Bild. Freie Bereiche bleiben sichtbar.'],
  ['stretch', 'Strecken', 'Passt Breite und Höhe an die Fläche an. Das Bild kann dabei verzerrt werden.'],
  ['native', 'Originalgröße', 'Ein Bildpixel entspricht einem Pixel der LED-Wand.'],
  ['manual', 'Frei platzieren', 'Bild im 2D-Editor ziehen oder Position und Größe in Pixeln eingeben.'],
];

/** The base rectangle before zoom/offset; changing to manual preserves the fit. */
function placementRect(layer, slot, srcW, srcH) {
  const tr = layer.transform || defaultTransform();
  if (tr.fit === 'manual' && tr.dest?.w > 0 && tr.dest?.h > 0) return { ...tr.dest };
  const crop = tr.crop;
  let w = crop?.w > 0 ? Math.min(crop.w, srcW - Math.max(0, crop.x || 0)) : srcW;
  let h = crop?.h > 0 ? Math.min(crop.h, srcH - Math.max(0, crop.y || 0)) : srcH;
  if (!(w > 0 && h > 0)) return { x: 0, y: 0, w: slot.width, h: slot.height };
  if (Math.abs(tr.rotate || 0) % 180 === 90) [w, h] = [h, w];
  if (tr.fit === 'stretch') return { x: 0, y: 0, w: slot.width, h: slot.height };
  const scale = tr.fit === 'native' ? 1 : Math[tr.fit === 'contain' ? 'min' : 'max'](slot.width / w, slot.height / h);
  w *= scale; h *= scale;
  return { x: (slot.width - w) / 2, y: (slot.height - h) / 2, w, h };
}

export function createInspector() {
  const body = h('div.col.inspector', { style: 'gap:0' });
  const el = body;

  let builtFor = null;   // 'wand/slot/layerId', fuer den die Felder gebaut sind
  let fields = [];       // { path, apply(layer) }
  let currentLayerId = null;
  const openSections = new Map();

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
      const value = opts.int ? Math.round(v) : v;
      if (opts.onCommit) opts.onCommit(value);
      else commit(path, value);
    });
    fields.push({
      path,
      apply(layer) {
        if (document.activeElement === input) return;
        const v = opts.read ? opts.read(layer) : getPath(layer, path);
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
    on(box, 'input', () => { if (!box.value.trim()) return; const v = Number(box.value); if (isFinite(v)) { range.value = String(v); push(v); } });
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

  function advancedSection(key, title, changed, ...content) {
    const summary = h('summary.hd', t(title));
    const badge = h('span.inspector-section-meta');
    if (changed) summary.appendChild(badge);
    const details = h('details.sec.inspector-fold', { open: openSections.get(key) === true }, summary, h('div.bd', ...content));
    on(details, 'toggle', () => openSections.set(key, details.open));
    if (changed) fields.push({ path: key, apply(layer) { badge.textContent = t(changed(layer) ? 'angepasst' : 'Standard'); } });
    return details;
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
    fields.push({ path: 'label', apply(l) { if (document.activeElement !== nameField) nameField.value = l.label || media?.name || ''; } });

    const slotSel = h('select', { 'aria-label': t('Slot') });
    for (const [wid, w] of Object.entries(state.project.walls)) {
      for (const sid of Object.keys(w.slots)) {
        slotSel.appendChild(h('option', { value: `${wid}/${sid}` }, `${wid} · ${sid === 'master' ? t('ganze Fläche') : sid}`));
      }
    }
    slotSel.value = `${loc.wallId}/${loc.slotId}`;
    on(slotSel, 'change', () => {
      const [wallId, slotId] = slotSel.value.split('/');
      moveLayer(layer.id, slotId, wallId);
    });

    const btnUp = h('button.btn.sm', { type: 'button', title: t('Eine Stufe nach oben'), 'aria-label': t('Eine Stufe nach oben') }, '▲');
    const btnDown = h('button.btn.sm', { type: 'button', title: t('Eine Stufe nach unten'), 'aria-label': t('Eine Stufe nach unten') }, '▼');
    const btnDel = h('button.btn.sm.danger', { type: 'button' }, t('Löschen'));
    on(btnUp, 'click', () => reorderLayer(layer.id, 1));
    on(btnDown, 'click', () => reorderLayer(layer.id, -1));
    on(btnDel, 'click', () => removeLayer(layer.id));

    const metadataSection = advancedSection('metadata', 'Ebene & Quelldatei', null,
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
    );

    /* --- Fit -------------------------------------------------------- */
    const fitButtons = h('div.inspector-fit-options', { role: 'group', 'aria-label': t('Bild einpassen') },
      ...FIT_OPTIONS.map(([f, label, hint]) => {
        const b = h('button.btn.fit-option', { type: 'button', dataset: { fit: f }, title: t(hint), 'aria-pressed': 'false' }, t(label));
        on(b, 'click', () => {
          if (f === 'manual') {
            const current = layerLocation(store.get(), layer.id)?.layer;
            if (current) updateLayer(layer.id, { transform: { fit: f, dest: placementRect(current, slot, srcW, srcH) } });
          } else commit('transform.fit', f);
        });
        return b;
      }));
    const fitHelp = h('div.inspector-help');
    fields.push({
      path: 'transform.fit',
      apply(l) {
        const fit = l.transform?.fit || 'cover';
        for (const b of fitButtons.children) {
          const selected = b.dataset.fit === fit;
          b.classList.toggle('on', selected);
          b.setAttribute('aria-pressed', String(selected));
        }
        fitHelp.textContent = t((FIT_OPTIONS.find(([id]) => id === fit) || FIT_OPTIONS[0])[2]);
      },
    });

    const btnCenter = h('button.btn.sm', {
      type: 'button', title: t('Zielrechteck im Slot zentrieren (setzt fit auf manual)'),
    }, t('Zentrieren'));
    on(btnCenter, 'click', () => {
      const current = layerLocation(store.get(), layer.id)?.layer;
      if (!current) return;
      const rect = placementRect(current, slot, srcW, srcH);
      const w = rect.w, hh = rect.h;
      updateLayer(layer.id, {
        transform: { fit: 'manual', dest: { x: Math.round((slot.width - w) / 2), y: Math.round((slot.height - hh) / 2), w, h: hh }, offset: { x: 0, y: 0 } },
      });
    });

    const btnFitWidth = h('button.btn.sm', {
      type: 'button', title: t('Auf Slotbreite skalieren, Seitenverhältnis der Quelle behalten'),
    }, t('Auf Breite einpassen'));
    on(btnFitWidth, 'click', () => {
      const l = layerLocation(store.get(), layer.id)?.layer;
      const tr = l?.transform || defaultTransform();
      let cw = tr.crop?.w || srcW;
      let ch = tr.crop?.h || srcH;
      if (!cw || !ch) { setStatus(t('Die Quellauflösung ist unbekannt — erst analysieren lassen.'), 'warn'); return; }
      if (Math.abs(tr.rotate || 0) % 180 === 90) [cw, ch] = [ch, cw];
      const newH = Math.round((slot.width * ch) / cw);
      updateLayer(layer.id, {
        transform: {
          fit: 'manual',
          dest: { x: 0, y: Math.round((slot.height - newH) / 2), w: slot.width, h: newH },
          offset: { x: 0, y: 0 }, zoom: 1,
        },
      });
    });

    const sourceLabel = h('div.inspector-source', { title: media?.name || '' });
    fields.push({ path: 'label', apply(l) { sourceLabel.textContent = l.label || media?.name || t('Quelldatei fehlt!'); } });
    const fittingSection = section('Bild einpassen',
      sourceLabel,
      fitButtons,
      h('div.row.wrap', btnCenter, btnFitWidth),
      fitHelp);
    fittingSection.classList.add('inspector-primary');
    body.appendChild(fittingSection);

    /* --- Crop ------------------------------------------------------- */
    const btnCropReset = h('button.btn.sm', { type: 'button' }, t('Ausschnitt zurücksetzen'));
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

    const cropSection = advancedSection('crop', 'Bildausschnitt', (l) => Boolean(l.transform?.crop),
      h('div.grid4', cropX.wrap, cropY.wrap, cropW.wrap, cropH.wrap),
      cropNote,
      h('div.row', btnCropFull, btnCropReset));

    /* --- Position --------------------------------------------------- */
    const exactFields = [['x', 'x'], ['y', 'y'], ['w', 'Breite'], ['h', 'Höhe']].map(([key, label]) => fNum(label, `transform.dest.${key}`, {
      int: true, narrow: true, unit: 'px', min: key === 'w' || key === 'h' ? 1 : undefined,
      read: (l) => Math.round(placementRect(l, slot, srcW, srcH)[key]),
      onCommit(value) {
        if ((key === 'w' || key === 'h') && value <= 0) return;
        const current = layerLocation(store.get(), layer.id)?.layer;
        if (current) updateLayer(layer.id, { transform: { fit: 'manual', dest: { ...placementRect(current, slot, srcW, srcH), [key]: value } } });
      },
    }).wrap);
    const exactPlacement = advancedSection('placement', 'Pixelgenau platzieren', (l) => l.transform?.fit === 'manual',
      h('div.inspector-help', t('Eine Eingabe wechselt zu „Frei platzieren“. Alle Angaben beziehen sich auf die gewählte Fläche.')),
      h('div.grid2', ...exactFields),
      fSelect('Drehung', 'transform.rotate', [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']],
        'Nur rechte Winkel — alles andere kostet eine zusätzliche Filterstufe'),
      h('div.row.wrap', fCheck('horizontal spiegeln', 'transform.flipH'), fCheck('vertikal', 'transform.flipV')));

    body.appendChild(section('Position & Größe',
      fSlider('Bildgröße', 'transform.zoom', { min: 0.1, max: 4, step: 0.01, unit: '×', title: 'Zusätzlicher Zoom um die Mitte des Zielrechtecks' }),
      h('div.grid2',
        fNum('Waagerecht', 'transform.offset.x', { int: true, narrow: true, unit: 'px', title: 'Feinversatz, wird auf das Zielrechteck addiert' }).wrap,
        fNum('Senkrecht', 'transform.offset.y', { int: true, narrow: true, unit: 'px', title: 'Feinversatz, wird auf das Zielrechteck addiert' }).wrap),
      h('div.inspector-help', t('Im 2D-Editor: Bild ziehen zum Verschieben, Griffe ziehen zum Vergrößern.')),
      h('button.btn.sm', { type: 'button', title: t('Auf Fläche füllen zurücksetzen; Position, Größe, Drehung und Spiegelung zurücksetzen. Der Bildausschnitt bleibt erhalten.'),
        onClick: () => {
          const current = layerLocation(store.get(), layer.id)?.layer;
          if (current) updateLayer(layer.id, { transform: { ...defaultTransform(), crop: current.transform?.crop || null } });
        },
      }, t('Bildanpassung zurücksetzen'))));
    body.appendChild(exactPlacement);
    body.appendChild(cropSection);

    /* --- Farbe ------------------------------------------------------ */
    body.appendChild(advancedSection('color', 'Farbe & Effekte', (l) => {
      const defaults = defaultFilters();
      return (l.blend && l.blend !== 'normal') || Object.entries(l.filters || {}).some(([key, value]) => key !== 'feather' && value !== defaults[key]);
    },
      fSelect('Bildmischung', 'blend', [['normal', 'Normal'], ['add', 'Aufhellen (Neon)'], ['screen', 'Negativ multiplizieren'], ['multiply', 'Multiplizieren']],
        'add hellt auf, ohne Schwarz zu tragen — richtig für Neon und Holo-Elemente'),
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
          onClick: () => updateLayer(layer.id, { filters: { ...defaultFilters(), feather: layerLocation(store.get(), layer.id)?.layer.filters?.feather || { l: 0, r: 0, t: 0, b: 0 } } }),
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
    body.appendChild(advancedSection('feather', 'Weiche Bildränder', (l) => Object.values(l.filters?.feather || {}).some((value) => value !== 0),
      h('div.grid2', featherFields.l.wrap, featherFields.r.wrap, featherFields.t.wrap, featherFields.b.wrap),
      h('label.row', chkLink, h('span', t('alle gleich'))),
      h('span.dim', { style: 'font-size:11px' },
        t('Für Übergänge über eine Panelnaht: die Kante des oberen Layers weich auslaufen lassen.'))));

    /* --- Zeit ------------------------------------------------------- */
    body.appendChild(advancedSection('timing', 'Zeit & Wiederholung', (l) => {
      const time = l.time || {};
      return Boolean(time.startSec || time.inSec || time.outSec != null || time.loop || (time.speed != null && time.speed !== 1) || time.transition?.durSec || (time.transition?.type && time.transition.type !== 'cut'));
    },
      h('div.grid2',
        fNum('Start', 'time.startSec', { step: 0.01, unit: 's', narrow: true, title: 'Startzeit im Loop' }).wrap,
        fNum('Tempo', 'time.speed', { step: 0.01, min: 0.05, unit: '×', narrow: true, title: 'Zeitdehnung, 1 = original' }).wrap,
        fNum('In', 'time.inSec', { step: 0.01, unit: 's', narrow: true, title: 'Einstiegspunkt in der Quelle' }).wrap,
        fNum('Out', 'time.outSec', { step: 0.01, unit: 's', narrow: true, nullable: true, title: 'Ausstiegspunkt in der Quelle, leer = bis Ende' }).wrap),
      fCheck('wiederholen bis Loopende', 'time.loop'),
      fSelect('Übergang', 'time.transition.type',
        [['cut', 'Harter Schnitt'], ['xfade', 'Überblenden'], ['fadeblack', 'Über Schwarz'], ['dissolve', 'Auflösen']],
        'Übergang zum vorherigen Layer im selben Slot'),
      fNum('Dauer', 'time.transition.durSec', { step: 0.05, min: 0, unit: 's' }).wrap,
      h('button.btn.sm', {
        type: 'button',
        onClick: () => updateLayer(layer.id, { time: defaultTime() }),
      }, t('Zeit zurücksetzen'))));
    body.appendChild(metadataSection);

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
