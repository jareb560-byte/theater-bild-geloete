/**
 * Theater-Bild-Gelöte — Qualitaetskontrolle.
 *
 * Prueft eine Wand aus dem Projekt oder eine fertige Datei. Ergebnis ist eine
 * Liste mit Ampelfarbe, Klartextmeldung und den Artefaktbildern (Loopnaht,
 * Differenzbild, Histogramm, Kontaktbogen) als anklickbare Vorschau.
 *
 * Jede Pruefung traegt zwei Saetze: WAS sie misst und WARUM es sie gibt. Ohne
 * den zweiten Satz ist "seamContent" fuer jemanden, der das Haus nicht kennt,
 * bedeutungslos — und eine Pruefung, deren Bedeutung niemand kennt, wird
 * weggeklickt.
 *
 * Sprachwechsel: `el` ist eine leere Huelle, die main.js einmal einhaengt.
 * mount() baut den Inhalt neu auf; Steuerelemente mit Zustand bleiben dabei
 * dieselben Knoten.
 */

import { h, on, clear, showImage, copyText } from '../dom.js';
import { t, tn, register, fmtNum, onLangChange } from '../i18n.js';
import { deliveryName, getWallSpec } from '/shared/model.js';
import { runQc } from '../api.js';
import { store, setStatus, showError } from '../store.js';
import { pickPath } from './library.js';

register('en', {
  /* --- Oberflaeche --- */
  'Prüfgegenstand': 'What gets checked',
  'Wand aus dem Projekt': 'Wall from the project',
  'fertige Datei': 'finished file',
  'Wand {id}': 'Wall {id}',
  'Fertige Datei': 'Finished file',
  'Fertige Datei, z. B. {name}': 'Finished file, e.g. {name}',
  'Datei …': 'File …',
  'Zu prüfende Datei': 'File to be checked',
  'Prüfungen': 'Checks',
  'alle': 'all',
  'keine': 'none',
  'Prüfung starten': 'Start check',
  'Ergebnis': 'Result',
  'Job {id}': 'Job {id}',
  'Pfad kopieren': 'Copy path',
  'Datei': 'File',
  'Noch nichts geprüft. Geprüft wird die fertige Datei, nicht die Vorschau.':
    'Nothing checked yet. The check runs on the finished file, not on the preview.',

  /* --- Ampeltexte --- */
  'in Ordnung': 'passed',
  'Warnung': 'warning',
  'Fehler': 'failed',
  'übersprungen': 'skipped',

  /* --- Meldungen --- */
  'Es ist keine Prüfung angekreuzt.': 'No check is ticked.',
  'Bitte erst eine Datei wählen.': 'Please choose a file first.',
  'Prüfung läuft …': 'Check is running …',
  'Prüfung läuft … {p} %': 'Check is running … {p} %',
  'Prüfung gestartet (Job {id}) …': 'Check started (job {id}) …',
  'Prüfung konnte nicht gestartet werden: {msg}': 'The check could not be started: {msg}',
  'QC konnte nicht gestartet werden': 'The quality check could not be started',
  'Die Prüfung ist fehlgeschlagen: {msg}': 'The check failed: {msg}',
  'kein Grund geliefert': 'no reason given',
  'Die Prüfung wurde abgebrochen.': 'The check was cancelled.',
  'Der Job ist fertig, hat aber kein Prüfergebnis geliefert.':
    'The job finished but returned no check result.',
  '{n} Prüfung durchgefallen': '{n} check failed',
  '{n} Prüfungen durchgefallen': '{n} checks failed',
  '{n} Warnung': '{n} warning',
  '{n} Warnungen': '{n} warnings',
  '{fail}, {warn}.': '{fail}, {warn}.',
  'Keine Fehler, aber {warn}.': 'No failures, but {warn}.',
  'Alle Prüfungen bestanden.': 'All checks passed.',

  /* --- Framezahl --- */
  'Framezahl': 'Frame count',
  'Zählt die Frames der fertigen Datei gegen Looplänge × Bildrate.':
    'Counts the frames of the finished file against loop length × frame rate.',
  'Die Datei läuft gegen eine feste Zeit — Licht, Ton und die anderen Wände hängen daran. Ein Frame zu viel oder zu wenig, und alles driftet mit jedem Loop weiter auseinander.':
    'The file runs against a fixed time — lighting, sound and the other walls depend on it. One frame too many or too few, and everything drifts further apart with every loop.',

  /* --- Loop-Naht --- */
  'Loop-Naht': 'Loop seam',
  'Vergleicht den ersten mit dem letzten Frame (SSIM).':
    'Compares the first frame against the last one (SSIM).',
  'Am Loopende springt das Bild auf den ersten Frame zurück. Sind erster und letzter Frame fast gleich, steht es dort doppelt so lange: ein sichtbares Stocken, immer an derselben Stelle.':
    'At the end of the loop the picture jumps back to the first frame. If first and last frame are nearly identical, it stands still there twice as long: a visible stutter, always in the same place.',

  /* --- Naht --- */
  'Motiv über der Panelnaht': 'Content across the panel seam',
  'Misst die Detailenergie in den Bildspalten links und rechts jeder Panelnaht.':
    'Measures detail energy in the pixel columns left and right of every panel seam.',
  'Die Wand besteht aus Teilen, die im Betrieb auseinanderfahren. Ein Gesicht oder eine Schrift genau über einer Naht zerreißt, sobald die Teile fahren — und schon im geschlossenen Zustand fällt der Spalt dort am stärksten auf.':
    'The wall is made of parts that travel apart during the show. A face or a piece of type sitting right across a seam tears the moment the parts move — and even while closed, the gap is most visible exactly there.',

  /* --- Sperrzonen --- */
  'Sperrzonen': 'Safe areas',
  'Prüft, wie stark die äußere Randzone der Wand belegt ist.':
    'Checks how heavily the outer border zone of the wall is used.',
  'Die Ränder sind je nach Sitzplatz und Aufbau verdeckt oder stark verzerrt. Was dort liegt, ist für einen Teil des Publikums nicht vorhanden — Logos und Schrift gehören in die Mitte.':
    'Depending on seat and rig, the edges are hidden or heavily distorted. Whatever sits there does not exist for part of the audience — logos and type belong in the middle.',

  /* --- Schwarzwert --- */
  'Schwarzwert': 'Black level',
  'Misst dunkelsten und hellsten Bildwert samt Histogramm.':
    'Measures the darkest and brightest image value, with histogram.',
  'Eine LED-Wand hebt Schwarz an und leuchtet um ein Vielfaches heller als ein Schnittmonitor. Zu dunkles Material wird grau und flau, zu helles blendet und überstrahlt die Darsteller davor.':
    'An LED wall lifts black and is many times brighter than an edit monitor. Material that is too dark turns grey and flat; material that is too bright blinds and outshines the performers in front of it.',

  /* --- Banding --- */
  'Banding': 'Banding',
  'Sucht sichtbare Stufen in Farbverläufen dunkler Flächen.':
    'Looks for visible steps in gradients within dark areas.',
  'Verläufe wie Himmel oder Lichtkegel zeigen auf der Wand Stufen, die auf dem Monitor unsichtbar sind. Gegenmittel: Dithering, ein höherwertiges Preset oder ein leichtes Korn in der Quelle.':
    'Gradients such as skies or light cones show steps on the wall that are invisible on a monitor. Remedies: dithering, a higher-grade preset, or a little grain in the source.',

  /* --- Moire --- */
  'Moiré': 'Moiré',
  'Sucht hochfrequente Muster nahe der Auflösungsgrenze des Pixelrasters.':
    'Looks for high-frequency patterns near the resolution limit of the pixel grid.',
  'Feine Streifen und dünne Schrift liegen nahe an der Größe eines Wandpixels und erzeugen wandernde Muster — vor der Kamera noch deutlicher als für das Auge. Betroffenes muss größer oder weicher werden.':
    'Fine stripes and thin type sit close to the size of a single wall pixel and create drifting patterns — even more visible on camera than to the eye. Whatever is affected has to become larger or softer.',

  /* --- Flackern --- */
  'Flackern': 'Flicker',
  'Analysiert die Frequenz der mittleren Bildhelligkeit über die Zeit.':
    'Analyses the frequency of the average image brightness over time.',
  'Schnelle Helligkeitswechsel auf großer, heller Fläche sind für das Publikum unangenehm und schlagen mit dem Kamerashutter zusammen: Streifen im Mitschnitt. Kritisch ist der Bereich weniger Hertz.':
    'Rapid brightness changes on a large, bright surface are unpleasant for the audience and beat against the camera shutter: bands in the recording. The critical range is a few hertz.',

  /* --- Spec --- */
  'Spec-Konformität': 'Spec compliance',
  'Vergleicht Auflösung, Bildrate, Codec und Pixelformat mit der Venue-Spec.':
    'Compares resolution, frame rate, codec and pixel format against the venue spec.',
  'Die Wiedergabe im Haus nimmt genau ein Format an. Weicht die Datei ab, spielt der Mediaserver sie falsch oder gar nicht — und das fällt erst beim Aufbau auf. Letzter Halt vor der Auslieferung.':
    'Playback in the venue accepts exactly one format. If the file deviates, the media server plays it wrongly or not at all — and that only surfaces during the fit-up. Last stop before delivery.',
});

/** Reihenfolge der Pruefungen. Die Ids sind exakt die aus shared/API.md. */
const CHECK_IDS = [
  'frameCount', 'loopSeam', 'seamContent', 'safeArea', 'blackLevel',
  'banding', 'moire', 'flicker', 'specCompliance',
];

/**
 * Klartext einer Pruefung: Name, WAS gemessen wird, WARUM es die Pruefung gibt.
 * Wird bei jedem Zeichnen neu geholt, damit ein Sprachwechsel greift.
 */
function checkInfo(id) {
  switch (id) {
    case 'frameCount':
      return {
        label: t('Framezahl'),
        what: t('Zählt die Frames der fertigen Datei gegen Looplänge × Bildrate.'),
        why: t('Die Datei läuft gegen eine feste Zeit — Licht, Ton und die anderen Wände hängen daran. Ein Frame zu viel oder zu wenig, und alles driftet mit jedem Loop weiter auseinander.'),
      };
    case 'loopSeam':
      return {
        label: t('Loop-Naht'),
        what: t('Vergleicht den ersten mit dem letzten Frame (SSIM).'),
        why: t('Am Loopende springt das Bild auf den ersten Frame zurück. Sind erster und letzter Frame fast gleich, steht es dort doppelt so lange: ein sichtbares Stocken, immer an derselben Stelle.'),
      };
    case 'seamContent':
      return {
        label: t('Motiv über der Panelnaht'),
        what: t('Misst die Detailenergie in den Bildspalten links und rechts jeder Panelnaht.'),
        why: t('Die Wand besteht aus Teilen, die im Betrieb auseinanderfahren. Ein Gesicht oder eine Schrift genau über einer Naht zerreißt, sobald die Teile fahren — und schon im geschlossenen Zustand fällt der Spalt dort am stärksten auf.'),
      };
    case 'safeArea':
      return {
        label: t('Sperrzonen'),
        what: t('Prüft, wie stark die äußere Randzone der Wand belegt ist.'),
        why: t('Die Ränder sind je nach Sitzplatz und Aufbau verdeckt oder stark verzerrt. Was dort liegt, ist für einen Teil des Publikums nicht vorhanden — Logos und Schrift gehören in die Mitte.'),
      };
    case 'blackLevel':
      return {
        label: t('Schwarzwert'),
        what: t('Misst dunkelsten und hellsten Bildwert samt Histogramm.'),
        why: t('Eine LED-Wand hebt Schwarz an und leuchtet um ein Vielfaches heller als ein Schnittmonitor. Zu dunkles Material wird grau und flau, zu helles blendet und überstrahlt die Darsteller davor.'),
      };
    case 'banding':
      return {
        label: t('Banding'),
        what: t('Sucht sichtbare Stufen in Farbverläufen dunkler Flächen.'),
        why: t('Verläufe wie Himmel oder Lichtkegel zeigen auf der Wand Stufen, die auf dem Monitor unsichtbar sind. Gegenmittel: Dithering, ein höherwertiges Preset oder ein leichtes Korn in der Quelle.'),
      };
    case 'moire':
      return {
        label: t('Moiré'),
        what: t('Sucht hochfrequente Muster nahe der Auflösungsgrenze des Pixelrasters.'),
        why: t('Feine Streifen und dünne Schrift liegen nahe an der Größe eines Wandpixels und erzeugen wandernde Muster — vor der Kamera noch deutlicher als für das Auge. Betroffenes muss größer oder weicher werden.'),
      };
    case 'flicker':
      return {
        label: t('Flackern'),
        what: t('Analysiert die Frequenz der mittleren Bildhelligkeit über die Zeit.'),
        why: t('Schnelle Helligkeitswechsel auf großer, heller Fläche sind für das Publikum unangenehm und schlagen mit dem Kamerashutter zusammen: Streifen im Mitschnitt. Kritisch ist der Bereich weniger Hertz.'),
      };
    case 'specCompliance':
      return {
        label: t('Spec-Konformität'),
        what: t('Vergleicht Auflösung, Bildrate, Codec und Pixelformat mit der Venue-Spec.'),
        why: t('Die Wiedergabe im Haus nimmt genau ein Format an. Weicht die Datei ab, spielt der Mediaserver sie falsch oder gar nicht — und das fällt erst beim Aufbau auf. Letzter Halt vor der Auslieferung.'),
      };
    default:
      // Der Server darf mehr Pruefungen liefern, als diese Ansicht kennt.
      return null;
  }
}

const STATUS_CLASS = { pass: 'ok', warn: 'warn', fail: 'err', skip: '' };

/** Ampeltext zu einem Status. Unbekannte Status kommen unveraendert durch. */
function statusText(status) {
  if (status === 'pass') return t('in Ordnung');
  if (status === 'warn') return t('Warnung');
  if (status === 'fail') return t('Fehler');
  if (status === 'skip') return t('übersprungen');
  return String(status ?? '');
}

/**
 * Artefaktbilder liegen als absolute Pfade im Jobresultat. shared/API.md
 * definiert keine Route, die solche Dateien ausliefert — wir versuchen es
 * ueber /api/qc/artifact und zeigen sonst den Pfad zum Kopieren.
 */
function artifactUrl(path) {
  return `/api/qc/artifact?path=${encodeURIComponent(path)}`;
}

export function createQcView() {
  let mode = 'wall';
  let jobId = null;
  let lastRendered = null;   // zuletzt gezeichnetes Job-Objekt
  let shownJob = null;       // dasselbe, fuer den Neuaufbau bei Sprachwechsel
  const checked = new Set(CHECK_IDS);

  /* ------------------------------------------------- zustandstragende Teile */
  const wallSel = h('select');
  const fileField = h('input', { type: 'text', class: 'grow' });
  const radioWall = h('input', { type: 'radio', name: 'qcmode', checked: true });
  const radioFile = h('input', { type: 'radio', name: 'qcmode' });
  const checkBox = h('div.col', { style: 'gap:2px' });
  const results = h('div.col');
  const jobNote = h('div.dim', { style: 'font-size:12px' });

  /** Stabile Huelle — main.js haengt genau dieses Element einmal ein. */
  const el = h('div.viewbody');

  let wallOptKey = null;

  /* ================================================================= Aufbau */

  /**
   * Beispieldateiname fuer das Dateifeld — aus dem geladenen Venue, damit dort
   * nicht der Dateiname eines fremden Hauses steht.
   */
  function filePlaceholder(state) {
    const venue = state && state.venue;
    const wallId = wallSel.value || (state && state.ui && state.ui.activeWallId);
    if (venue && wallId && venue.delivery) {
      try {
        const spec = getWallSpec(venue, wallId);
        const presets = venue.delivery.presets || [];
        const presetId = venue.delivery.defaultPreset || (presets[0] && presets[0].id);
        const name = deliveryName(venue, spec.id, spec.width, spec.height, presetId);
        return t('Fertige Datei, z. B. {name}', { name });
      } catch {
        /* Wand oder Preset unbekannt — dann eben ohne Beispiel */
      }
    }
    return t('Fertige Datei');
  }

  function buildChecks() {
    clear(checkBox);
    for (const id of CHECK_IDS) {
      const info = checkInfo(id);
      const chk = h('input', {
        type: 'checkbox', checked: checked.has(id), dataset: { check: id },
      });
      on(chk, 'change', () => { if (chk.checked) checked.add(id); else checked.delete(id); });
      checkBox.appendChild(h('label.row', { style: 'align-items:flex-start' }, chk,
        h('div.col', { style: 'gap:1px' },
          h('div.row',
            h('b', { style: 'min-width:190px' }, info.label),
            h('span.dim', { style: 'font-size:11.5px' }, info.what)),
          h('span.dim', { style: 'font-size:11.5px' }, info.why))));
    }
  }

  function mount() {
    fileField.placeholder = filePlaceholder(store.get());
    buildChecks();
    clear(el);

    const btnFile = h('button.btn.sm', { type: 'button' }, t('Datei …'));
    const btnStart = h('button.btn.acc', { type: 'button' }, t('Prüfung starten'));
    const btnAll = h('button.btn.sm', { type: 'button' }, t('alle'));
    const btnNone = h('button.btn.sm', { type: 'button' }, t('keine'));

    on(btnFile, 'click', async () => {
      const p = await pickPath({
        title: t('Zu prüfende Datei'), mode: 'file', start: fileField.value.trim(),
      });
      if (p) { fileField.value = p; radioFile.checked = true; mode = 'file'; }
    });
    on(btnAll, 'click', () => {
      for (const c of checkBox.querySelectorAll('input')) { c.checked = true; checked.add(c.dataset.check); }
    });
    on(btnNone, 'click', () => {
      for (const c of checkBox.querySelectorAll('input')) { c.checked = false; }
      checked.clear();
    });
    on(btnStart, 'click', () => startCheck(btnStart));

    el.appendChild(h('div.pad',
      h('div.sec',
        h('div.hd', t('Prüfgegenstand')),
        h('div.bd',
          h('label.row', radioWall, h('span', t('Wand aus dem Projekt')), wallSel),
          h('label.row', radioFile, h('span', t('fertige Datei')), fileField, btnFile))),
      h('div.sec',
        h('div.hd', t('Prüfungen'), h('span.right'), btnAll, btnNone),
        h('div.bd', checkBox, h('div.row', btnStart, jobNote))),
      h('div.sec',
        h('div.hd', t('Ergebnis')),
        h('div.bd', results))));
  }

  /* ================================================================ Aktionen */

  on(radioWall, 'change', () => { mode = 'wall'; });
  on(radioFile, 'change', () => { mode = 'file'; });
  on(fileField, 'focus', () => { radioFile.checked = true; mode = 'file'; });
  on(wallSel, 'change', () => {
    if (!fileField.value) fileField.placeholder = filePlaceholder(store.get());
  });

  async function startCheck(btnStart) {
    if (checked.size === 0) { setStatus(t('Es ist keine Prüfung angekreuzt.'), 'warn'); return; }
    const payload = { checks: [...checked] };
    if (mode === 'file') {
      const p = fileField.value.trim();
      if (!p) { setStatus(t('Bitte erst eine Datei wählen.'), 'warn'); return; }
      payload.path = p;
      payload.wallId = wallSel.value || null;
    } else {
      payload.wallId = wallSel.value;
      payload.path = null;
    }
    btnStart.disabled = true;
    shownJob = null;
    clear(results);
    results.appendChild(h('span.dim', t('Prüfung läuft …')));
    try {
      const res = await runQc(payload);
      jobId = res.jobId;
      lastRendered = null;
      jobNote.textContent = t('Job {id}', { id: jobId });
      setStatus(t('Prüfung gestartet (Job {id}) …', { id: jobId }));
    } catch (e) {
      clear(results);
      results.appendChild(h('div.msg.err',
        t('Prüfung konnte nicht gestartet werden: {msg}', { msg: e.message })));
      showError(t('QC konnte nicht gestartet werden'), e);
    } finally {
      btnStart.disabled = false;
    }
  }

  /* ------------------------------------------------------------- Ergebnis */

  function renderResult(job) {
    clear(results);
    shownJob = job || null;
    if (!job) {
      results.appendChild(h('span.dim', { style: 'font-size:12px' },
        t('Noch nichts geprüft. Geprüft wird die fertige Datei, nicht die Vorschau.')));
      return;
    }

    if (job.status === 'running' || job.status === 'queued') {
      results.appendChild(h('span.dim',
        t('Prüfung läuft … {p} %', { p: fmtNum((job.progress || 0) * 100, 0) })));
      return;
    }
    if (job.status === 'error') {
      results.appendChild(h('div.msg.err',
        t('Die Prüfung ist fehlgeschlagen: {msg}', { msg: job.error || t('kein Grund geliefert') })));
      return;
    }
    if (job.status === 'cancelled') {
      results.appendChild(h('div.msg.warn', t('Die Prüfung wurde abgebrochen.')));
      return;
    }

    const checks = job.result?.checks;
    if (!Array.isArray(checks) || checks.length === 0) {
      results.appendChild(h('div.msg.warn', t('Der Job ist fertig, hat aber kein Prüfergebnis geliefert.')));
      return;
    }

    const bad = checks.filter((c) => c.status === 'fail').length;
    const warn = checks.filter((c) => c.status === 'warn').length;
    const warnTxt = tn(warn, '{n} Warnung', '{n} Warnungen');
    const failTxt = tn(bad, '{n} Prüfung durchgefallen', '{n} Prüfungen durchgefallen');
    results.appendChild(h('div', { class: bad ? 'msg err' : warn ? 'msg warn' : 'msg ok' },
      bad
        ? t('{fail}, {warn}.', { fail: failTxt, warn: warnTxt })
        : warn
          ? t('Keine Fehler, aber {warn}.', { warn: warnTxt })
          : t('Alle Prüfungen bestanden.')));

    for (const c of checks) {
      const info = checkInfo(c.id);
      const arts = h('div.qcArts');
      for (const a of c.artifacts || []) {
        if (a.type === 'image' && a.path) {
          const img = h('img', { src: artifactUrl(a.path), alt: a.path, title: a.path, loading: 'lazy' });
          on(img, 'click', () => showImage(artifactUrl(a.path), a.path));
          img.addEventListener('error', () => {
            const box = h('div.row',
              h('span.dim.mono', { style: 'font-size:11px' }, a.path),
              h('button.btn.sm', { type: 'button', onClick: () => copyText(a.path) }, t('Pfad kopieren')));
            img.replaceWith(box);
          });
          arts.appendChild(img);
        } else if (a.path) {
          arts.appendChild(h('div.row',
            h('span.dim.mono', { style: 'font-size:11px' }, `${a.type || t('Datei')}: ${a.path}`),
            h('button.btn.sm', { type: 'button', onClick: () => copyText(a.path) }, t('Pfad kopieren'))));
        }
      }

      const detail = c.detail && Object.keys(c.detail).length
        ? h('div.dim.mono', { style: 'font-size:11px;white-space:pre-wrap' }, JSON.stringify(c.detail, null, 1))
        : null;

      // Die Meldung des Servers ist bereits Klartext und bleibt, wie sie kommt.
      // Eingeordnet wird sie durch den Warum-Satz darunter.
      results.appendChild(h('div.qcItem',
        h('span.amp', { class: `amp ${STATUS_CLASS[c.status] || ''}` }),
        h('div.grow',
          h('div.row', h('b', info ? info.label : (c.label || c.id)),
            h('span.tag', { class: `tag ${STATUS_CLASS[c.status] || ''}` }, statusText(c.status))),
          h('div', { style: 'font-size:12.5px' }, c.message || ''),
          info ? h('div.dim', { style: 'font-size:11px' }, info.why) : null,
          detail,
          arts.children.length ? arts : null)));
    }
  }

  /* --------------------------------------------------------------- update */

  let lastProject = null;
  function update(state) {
    if (!state.project) return;
    if (state.project !== lastProject) {
      lastProject = state.project;
      const walls = Object.keys(state.project.walls || {});
      const key = walls.join('|');
      if (key !== wallOptKey) {
        wallOptKey = key;
        clear(wallSel);
        for (const w of walls) wallSel.appendChild(h('option', { value: w }, t('Wand {id}', { id: w })));
      }
      if (!wallSel.value) wallSel.value = state.ui.activeWallId || walls[0] || '';
      if (!fileField.value) fileField.placeholder = filePlaceholder(state);
    }
    if (jobId) {
      const job = (state.jobs || []).find((j) => j.id === jobId);
      if (job && job !== lastRendered) { lastRendered = job; renderResult(job); }
    }
  }

  /* Sprachwechsel: Beschriftungen, Pruefliste und Ergebnis neu zeichnen und die
   * Aufbau-Schluessel entwerten, sonst bleibt die alte Sprache stehen. */
  onLangChange(() => {
    lastProject = null;
    wallOptKey = null;
    const job = shownJob;
    mount();
    renderResult(job);
    const st = store.get();
    if (st.project) update(st);
  });

  mount();
  renderResult(null);

  return { el, update };
}
