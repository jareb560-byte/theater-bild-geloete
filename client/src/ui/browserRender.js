import { h } from '../dom.js';
import { t, register, fmtNum, fmtBytes, onLangChange } from '../i18n.js';
import { store } from '../store.js';

register('en', {
  'MP4 im Browser': 'MP4 in your browser',
  'Deine Wand als Video': 'Your wall as a video',
  'Wähle eine Wand und lade das fertige Video herunter. Alles wird auf deinem Rechner verarbeitet; deine Medien werden nicht hochgeladen.':
    'Choose a wall and download the finished video. Everything is processed on your computer; your media are not uploaded.',
  'MP4 · H.264 · ohne Ton': 'MP4 · H.264 · no audio',
  'Medien und MP4-Unterstützung prüfen': 'Checking media and MP4 support',
  'Wand als MP4 rendern': 'Creating your wall video',
  'MP4 fertigstellen': 'Finalising MP4',
  'MP4 bereit zum Herunterladen': 'MP4 ready to download',
  'Bis 256 MB pro Video. Bildfilter und weiche Übergänge brauchen die lokale Fassung; im Browser harte Schnitte verwenden.':
    'Up to 256 MB per video. Image filters and soft transitions need the local edition; use hard cuts in the browser.',
  'Desktop herunterladen': 'Download desktop',
  'Wand für den Export': 'Wall to export',
  'Zeitbereich': 'Time range',
  'Ganzer Loop': 'Whole loop',
  'Ausschnitt': 'Section',
  'Von (Sekunden)': 'From (seconds)',
  'Bis (Sekunden)': 'To (seconds)',
  'MP4 erstellen': 'Create MP4',
  'Export abbrechen': 'Cancel export',
  'MP4 herunterladen': 'Download MP4',
  'Letzter fertiger Export': 'Last completed export',
  'Ein kurzer Ausschnitt ist ein guter erster Test. Lass diesen Tab bis zum Abschluss geöffnet. Große Wände und lange Loops brauchen mehr Zeit und Arbeitsspeicher.':
    'A short section makes a good first test. Keep this tab open until the export finishes. Large walls and long loops need more time and memory.',
  'Exportiert wird die flache Wandfläche in ihrer Pixelauflösung, mit den aktiven Layern. Die 3D-Bühne, Fahrwege und Hilfslinien sind nicht Teil des Videos.':
    'The export is the flat wall at its pixel resolution, with its active layers. The 3D stage, panel travel and guides are not part of the video.',
  'Für das Haus': 'For venue delivery',
  'HAP, ProRes, MPEG-2, separate Paneldateien und technische Qualitätskontrolle gibt es in der lokalen Fassung. Ob MP4 als Lieferformat passt, mit dem Haus abstimmen.':
    'HAP, ProRes, MPEG-2, separate panel files and technical quality control are available in the local edition. Confirm with the venue whether MP4 is an accepted delivery format.',
  'Dieser Browser kann hier kein MP4 erzeugen. Öffne die Website in einer aktuellen Version von Chrome oder Edge. Falls die Wandauflösung dort nicht unterstützt wird, nutze die lokale Fassung.':
    'This browser cannot create MP4 here. Open the website in a current version of Chrome or Edge. If the wall resolution is not supported there, use the local edition.',
  'Erst ein Projekt mit einer Wand öffnen.': 'First open a project containing a wall.',
  'leer': 'empty',
  '{n} Inhalte': '{n} media layers',
  'Diese Wand ist noch leer. Lege in der Bibliothek Material auf die Wand oder wähle eine bereits belegte Wand.':
    'This wall is empty. Place media on it in the library or choose a wall that already has content.',
  'Der Zeitbereich muss innerhalb des Loops liegen: Anfang mindestens 0, Ende nach dem Anfang.':
    'The time range must be within the loop: start at least 0, end after the start.',
  'Vorbereitung …': 'Preparing …',
  'Abbruch wird ausgeführt …': 'Cancelling …',
  'Export abgebrochen. Du kannst erneut starten.': 'Export cancelled. You can start again.',
  'Fertig. Das Video steht zum Herunterladen bereit.': 'Done. Your video is ready to download.',
  'Export fehlgeschlagen': 'Export failed',
  '{w} × {h} px · {fps} fps · {seconds} s': '{w} × {h} px · {fps} fps · {seconds} s',
  '{frames} Bilder · {size}': '{frames} frames · {size}',
  '{percent} % · {phase}': '{percent}% · {phase}',
});

/** Browser export is separate from the local FFmpeg workflow. Inputs are mounted once. */
export function createBrowserRenderView() {
  let state = null;
  let wallKey = null;
  let projectKey = null;
  let manuallySelected = false;
  let controller = null;
  let disposed = false;
  let result = null;
  let resultUrl = null;
  let messageKey = '';
  let errorMessage = '';
  let progressValue = 0;
  let progressPhase = '';
  let lastProgressKey = '';
  const supported = typeof window.VideoEncoder === 'function'
    && typeof window.VideoDecoder === 'function'
    && typeof window.VideoFrame === 'function' && window.isSecureContext;

  const el = h('div.browser-render.pad');
  const wallSelect = h('select', { id: 'browserRenderWall' });
  const rangeSelect = h('select', { id: 'browserRenderRange' });
  const fromInput = h('input', { id: 'browserRenderFrom', type: 'number', min: 0, step: 'any', value: '0', required: true });
  const toInput = h('input', { id: 'browserRenderTo', type: 'number', min: 0, step: 'any', value: '1', required: true });
  const summary = h('p.browser-render-spec');
  const capabilityNote = h('p.msg.warn', { hidden: supported });
  const emptyNote = h('p.msg.warn', { hidden: true });
  const status = h('p.browser-render-status', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const error = h('p.msg.err', { role: 'alert', hidden: true });
  const progress = h('progress', { max: 1, value: 0, hidden: true });
  const startButton = h('button.btn.acc', { type: 'submit' });
  const cancelButton = h('button.btn', { type: 'button', hidden: true, onClick: cancel });
  const download = h('a.btn.acc', { download: '' });
  const resultHeading = h('h3');
  const resultName = h('p.browser-render-filename');
  const resultInfo = h('p.dim');
  const resultBox = h('section.browser-render-result', { hidden: true }, resultHeading, resultName, resultInfo, download);
  const rangeFields = h('div.browser-render-range');
  const fields = h('fieldset.browser-render-fields');
  const form = h('form.browser-render-form', { onSubmit: start });

  function field(label, id, input) {
    return h('div.browser-render-field', h('label', { htmlFor: id }, t(label)), input);
  }

  function mount() {
    const selectedRange = rangeSelect.value || 'whole';
    rangeSelect.replaceChildren(
      h('option', { value: 'whole' }, t('Ganzer Loop')),
      h('option', { value: 'section' }, t('Ausschnitt')));
    rangeSelect.value = selectedRange;
    rangeFields.replaceChildren(
      field('Von (Sekunden)', fromInput.id, fromInput),
      field('Bis (Sekunden)', toInput.id, toInput));
    fields.replaceChildren(
      field('Wand für den Export', wallSelect.id, wallSelect),
      field('Zeitbereich', rangeSelect.id, rangeSelect), rangeFields);
    form.replaceChildren(fields, summary, emptyNote,
      h('div.browser-render-actions', startButton, cancelButton), progress, status, error,
      h('p.browser-render-hint', t('Ein kurzer Ausschnitt ist ein guter erster Test. Lass diesen Tab bis zum Abschluss geöffnet. Große Wände und lange Loops brauchen mehr Zeit und Arbeitsspeicher.')));
    capabilityNote.textContent = t('Dieser Browser kann hier kein MP4 erzeugen. Öffne die Website in einer aktuellen Version von Chrome oder Edge. Falls die Wandauflösung dort nicht unterstützt wird, nutze die lokale Fassung.');
    startButton.textContent = t('MP4 erstellen');
    cancelButton.textContent = t('Export abbrechen');
    download.textContent = t('MP4 herunterladen');
    resultHeading.textContent = t('Letzter fertiger Export');
    progress.setAttribute('aria-label', t('MP4 erstellen'));
    el.replaceChildren(
      h('header.browser-render-heading', h('span.eyebrow', t('MP4 im Browser')),
        h('h2', t('Deine Wand als Video')),
        h('p', t('Wähle eine Wand und lade das fertige Video herunter. Alles wird auf deinem Rechner verarbeitet; deine Medien werden nicht hochgeladen.')),
        h('span.tag', t('MP4 · H.264 · ohne Ton'))),
      capabilityNote, form, resultBox,
      h('aside.browser-render-notes',
        h('p', t('Exportiert wird die flache Wandfläche in ihrer Pixelauflösung, mit den aktiven Layern. Die 3D-Bühne, Fahrwege und Hilfslinien sind nicht Teil des Videos.')),
        h('p', t('Bis 256 MB pro Video. Bildfilter und weiche Übergänge brauchen die lokale Fassung; im Browser harte Schnitte verwenden.')),
        h('h3', t('Für das Haus')),
        h('p', t('HAP, ProRes, MPEG-2, separate Paneldateien und technische Qualitätskontrolle gibt es in der lokalen Fassung. Ob MP4 als Lieferformat passt, mit dem Haus abstimmen.')),
        h('a.browser-desktop-link', { href: 'https://github.com/jareb560-byte/theater-bild-geloete/releases/latest', target: '_blank', rel: 'noopener noreferrer' }, t('Desktop herunterladen'))));
    wallKey = null;
    update(state);
  }

  function selectedWall() {
    return state?.venue?.walls?.find((wall) => wall.id === wallSelect.value);
  }

  function contentCount(id) {
    return Object.values(state?.project?.walls?.[id]?.slots || {}).reduce((count, slot) =>
      count + (slot.enabled === false ? 0 : (slot.layers || []).filter((layer) => layer.enabled !== false).length), 0);
  }

  function selectedRange() {
    if (rangeSelect.value !== 'section') return null;
    const from = fromInput.valueAsNumber;
    const to = toInput.valueAsNumber;
    const loop = Number(state?.project?.loopSeconds);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > loop) {
      throw new Error(t('Der Zeitbereich muss innerhalb des Loops liegen: Anfang mindestens 0, Ende nach dem Anfang.'));
    }
    return [from, to];
  }

  function refresh() {
    const busy = !!controller;
    const section = rangeSelect.value === 'section';
    const wall = selectedWall();
    fields.disabled = busy;
    fromInput.disabled = toInput.disabled = !section;
    rangeFields.hidden = !section;
    const empty = !!wall && !contentCount(wall.id);
    startButton.disabled = busy || !supported || !wall || !state?.project || empty || disposed;
    emptyNote.hidden = !empty;
    emptyNote.textContent = t('Diese Wand ist noch leer. Lege in der Bibliothek Material auf die Wand oder wähle eine bereits belegte Wand.');
    cancelButton.hidden = !busy;
    cancelButton.disabled = !!controller?.signal.aborted;
    progress.hidden = !busy;
    progress.value = progressValue;
    form.setAttribute('aria-busy', String(busy));
    error.hidden = !errorMessage;
    error.textContent = errorMessage;
    let seconds = Number(state?.project?.loopSeconds) || 0;
    if (section && Number.isFinite(fromInput.valueAsNumber) && Number.isFinite(toInput.valueAsNumber)) {
      seconds = Math.max(0, toInput.valueAsNumber - fromInput.valueAsNumber);
    }
    summary.textContent = wall ? t('{w} × {h} px · {fps} fps · {seconds} s', {
      w: wall.width, h: wall.height, fps: fmtNum(state.project.fps, 3), seconds: fmtNum(seconds, 3),
    }) : t('Erst ein Projekt mit einer Wand öffnen.');
    status.textContent = busy && !controller.signal.aborted
      ? t('{percent} % · {phase}', { percent: Math.round(progressValue * 100), phase: t(progressPhase || 'Vorbereitung …') })
      : (messageKey ? t(messageKey) : '');
    if (result) {
      resultInfo.textContent = `${t('{w} × {h} px · {fps} fps · {seconds} s', {
        w: result.width, h: result.height, fps: fmtNum(result.fps, 3), seconds: fmtNum(result.duration, 3),
      })} · ${t('{frames} Bilder · {size}', { frames: fmtNum(result.frameCount), size: fmtBytes(result.blob.size) })}`;
    }
  }

  function cancel() {
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    messageKey = 'Abbruch wird ausgeführt …';
    refresh();
  }

  async function start(event) {
    event.preventDefault();
    if (controller || disposed || !supported) return;
    errorMessage = '';
    try {
      if (!state?.project || !selectedWall()) throw new Error(t('Erst ein Projekt mit einer Wand öffnen.'));
      if (!contentCount(wallSelect.value)) throw new Error(t('Diese Wand ist noch leer. Lege in der Bibliothek Material auf die Wand oder wähle eine bereits belegte Wand.'));
      const rangeSec = selectedRange();
      // Capture on click, before the lazy import or a later editor change.
      const project = structuredClone(state.project);
      const venue = structuredClone(state.venue);
      const wallId = wallSelect.value;
      const operation = new AbortController();
      controller = operation;
      progressValue = 0;
      progressPhase = 'Vorbereitung …';
      lastProgressKey = '';
      messageKey = '';
      store.set({ ui: { transport: { playing: false } } });
      refresh();
      const { renderBrowserMp4 } = await import('../export/browserMp4.js');
      const rendered = await renderBrowserMp4({ project, venue, wallId, rangeSec, signal: operation.signal,
        onProgress: ({ progress: value, phase }) => {
          if (disposed || operation.signal.aborted) return;
          progressValue = Math.max(0, Math.min(1, Number(value) || 0));
          progressPhase = phase || 'Vorbereitung …';
          const key = `${Math.round(progressValue * 100)}|${progressPhase}`;
          if (key !== lastProgressKey) { lastProgressKey = key; refresh(); }
        },
      });
      if (disposed || operation.signal.aborted) {
        messageKey = 'Export abgebrochen. Du kannst erneut starten.';
        return;
      }
      const previousUrl = resultUrl;
      resultUrl = URL.createObjectURL(rendered.blob);
      result = rendered;
      download.href = resultUrl;
      download.download = rendered.fileName;
      resultName.textContent = rendered.fileName;
      resultBox.hidden = false;
      messageKey = 'Fertig. Das Video steht zum Herunterladen bereit.';
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      if (el.closest('.view')?.classList.contains('on')) {
        resultBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        download.focus({ preventScroll: true });
      }
    } catch (err) {
      if (disposed) return;
      if (controller?.signal.aborted || err?.name === 'AbortError') {
        messageKey = 'Export abgebrochen. Du kannst erneut starten.';
      } else {
        messageKey = '';
        errorMessage = `${t('Export fehlgeschlagen')}: ${err?.message || String(err)}`;
      }
    } finally {
      controller = null;
      if (!disposed) refresh();
    }
  }

  function update(nextState) {
    if (disposed) return;
    state = nextState;
    const walls = (state?.venue?.walls || []).filter((wall) => state?.project?.walls?.[wall.id]);
    const nextProjectKey = state?.project ? `${state.project.createdAt}|${state.project.venueId}` : null;
    if (projectKey !== nextProjectKey) {
      projectKey = nextProjectKey;
      manuallySelected = false;
      wallKey = null;
      fromInput.value = '0';
      delete toInput.dataset.edited;
    }
    const key = JSON.stringify(walls.map(({ id, label, width, height }) => [id, label, width, height, contentCount(id)]));
    if (key !== wallKey) {
      const activeId = state?.ui?.activeWallId;
      const previous = manuallySelected ? wallSelect.value
        : (contentCount(activeId) ? activeId : walls.find((wall) => contentCount(wall.id))?.id || activeId);
      wallSelect.replaceChildren(...walls.map((wall) => h('option', { value: wall.id },
        `${wall.id} · ${contentCount(wall.id) ? t('{n} Inhalte', { n: contentCount(wall.id) }) : t('leer')}`)));
      if (walls.some((wall) => wall.id === previous)) wallSelect.value = previous;
      wallKey = key;
    }
    const loop = Number(state?.project?.loopSeconds) || 0;
    fromInput.max = toInput.max = String(loop);
    if (!toInput.dataset.edited) toInput.value = String(Math.min(loop, 5));
    refresh();
  }

  wallSelect.addEventListener('change', () => { manuallySelected = true; refresh(); });
  rangeSelect.addEventListener('change', refresh);
  fromInput.addEventListener('input', refresh);
  toInput.addEventListener('input', () => { toInput.dataset.edited = 'true'; refresh(); });
  const offLanguage = onLangChange(mount);
  mount();
  return {
    el, update, cancel,
    resetProject() { projectKey = null; manuallySelected = false; wallKey = null; },
    get busy() { return !!controller; },
    dispose() {
      disposed = true;
      controller?.abort();
      offLanguage();
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    },
  };
}
