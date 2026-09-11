/**
 * Theater-Bild-Gelöte — Jobleiste unten.
 *
 * Zeigt laufende Jobs mit Fortschritt, Laufzeit, Abbrechen-Knopf und
 * ausklappbarem Log. Fertige Jobs verschwinden 60 s nach dem Ende, fehlerhafte
 * bleiben stehen, bis der Nutzer sie schliesst. Nichts wird still weggeworfen.
 *
 * Mehrsprachig: alle sichtbaren Texte laufen durch t(). Beim Sprachwechsel
 * werden die aufgebauten Jobknoten verworfen und neu gezeichnet — sonst bleibt
 * die alte Sprache in den Knoefen stehen, die schon einmal gebaut wurden.
 */

import { h, on, clear, copyButton } from '../dom.js';
import { cancelJob } from '../api.js';
import { setStatus, showError } from '../store.js';
import { t, tn, register, fmtNum, onLangChange } from '../i18n.js';

register('en', {
  'Jobs': 'Jobs',
  'Erledigte ausblenden': 'Hide finished',
  'Keine Jobs.': 'No jobs.',
  '{n} aktiv': '{n} active',
  '{n} Eintrag': '{n} entry',
  '{n} Einträge': '{n} entries',

  /* --- Zustaende --- */
  'wartet': 'queued',
  'läuft': 'running',
  'fertig': 'done',
  'Fehler': 'error',
  'abgebrochen': 'cancelled',

  /* --- Bedienung --- */
  'Log': 'Log',
  'Log ein-/ausklappen': 'Show/hide the log',
  'Log kopieren': 'Copy log',
  'Abbrechen': 'Cancel',
  'Job abbrechen': 'Cancel this job',
  'Eintrag schliessen': 'Close this entry',
  'Job "{label}" wird abgebrochen …': 'Cancelling job "{label}" …',
  'Job konnte nicht abgebrochen werden': 'The job could not be cancelled',

  /* --- Fortschritt und Laufzeit --- */
  '{p} %': '{p}%',
  'Fortschritt {p} %': 'Progress {p}%',
  'Laufzeit': 'Runtime',
  'Laufzeit {time}': 'Runtime {time}',
  '{s} s': '{s} s',
  '{m}:{s} min': '{m}:{s} min',
  '{h}:{m}:{s} h': '{h}:{m}:{s} h',
  'FEHLER: {msg}': 'ERROR: {msg}',
});

const KEEP_DONE_MS = 60_000;

const STATUS_TEXT = {
  queued: 'wartet',
  running: 'läuft',
  done: 'fertig',
  error: 'Fehler',
  cancelled: 'abgebrochen',
};

const STATUS_CLASS = {
  queued: 'info',
  running: 'acc',
  done: 'ok',
  error: 'err',
  cancelled: 'warn',
};

/** Laufzeit in Millisekunden, oder null wenn der Job noch nicht gestartet ist. */
function runtimeMs(job, now) {
  const start = job.startedAt ? Date.parse(job.startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  const end = job.endedAt ? Date.parse(job.endedAt) : now;
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

/**
 * Laufzeit sprachgerecht: unter anderthalb Minuten sekundengenau mit
 * Dezimaltrenner der jeweiligen Sprache, darueber m:ss bzw. h:mm:ss.
 */
function fmtRuntime(ms) {
  const sec = Math.max(0, ms / 1000);
  if (sec < 90) return t('{s} s', { s: fmtNum(sec, 1) });
  const total = Math.round(sec);
  const pad = (n) => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return t('{h}:{m}:{s} h', { h: hours, m: pad(mins), s: pad(secs) });
  return t('{m}:{s} min', { m: mins, s: pad(secs) });
}

export function createJobsBar() {
  const list = h('div#jobsList');
  const count = h('span.right.dim');
  const btnClear = h('button.btn.sm.ghost', { type: 'button' }, t('Erledigte ausblenden'));
  const title = h('span', t('Jobs'));
  const header = h('div.hd.click', title, count, btnClear);
  const sec = h('div.sec', header, list);

  // Zustand pro Job, den der Server nicht kennt: Log offen? vom Nutzer geschlossen?
  const view = new Map(); // jobId -> { open, dismissed }
  const nodes = new Map(); // jobId -> { root, refs }
  let collapsed = false;
  let lastJobs = [];

  on(header, 'click', (ev) => {
    if (ev.target === btnClear) return;
    collapsed = !collapsed;
    list.style.display = collapsed ? 'none' : '';
  });

  on(btnClear, 'click', (ev) => {
    ev.stopPropagation();
    for (const j of lastJobs) {
      if (j.status !== 'running' && j.status !== 'queued') viewOf(j.id).dismissed = true;
    }
    render(lastJobs);
  });

  function viewOf(id) {
    if (!view.has(id)) view.set(id, { open: false, dismissed: false });
    return view.get(id);
  }

  function visible(job, now) {
    const v = viewOf(job.id);
    if (v.dismissed) return false;
    if (job.status === 'running' || job.status === 'queued') return true;
    if (job.status === 'error') return true; // bleibt, bis der Nutzer schliesst
    const ended = job.endedAt ? Date.parse(job.endedAt) : now;
    return now - ended < KEEP_DONE_MS;
  }

  function buildNode(job) {
    const label = h('span.lbl2');
    const status = h('span.tag');
    const time = h('span.dim', { style: 'font:11px var(--mono);white-space:nowrap' });
    const pct = h('span.pct');
    const barFill = h('i');
    const bar = h('div.bar', barFill);
    const btnLog = h('button.btn.sm.ghost', { type: 'button', title: t('Log ein-/ausklappen') }, t('Log'));
    const btnCancel = h('button.btn.sm.danger', { type: 'button', title: t('Job abbrechen') }, t('Abbrechen'));
    const btnClose = h('button.btn.sm.ghost', {
      type: 'button', title: t('Eintrag schliessen'), 'aria-label': t('Eintrag schliessen'),
    }, '✕');
    const logBox = h('div.joblog', { style: 'display:none' });
    const btnCopy = copyButton(() => logBox.textContent, t('Log kopieren'));
    const logTools = h('div.row', { style: 'display:none;margin-top:3px' }, btnCopy);

    const root = h('div.job',
      h('div.top', status, label, time, pct, btnLog, btnCancel, btnClose),
      bar, logBox, logTools);

    on(btnLog, 'click', () => {
      const v = viewOf(job.id);
      v.open = !v.open;
      logBox.style.display = v.open ? '' : 'none';
      logTools.style.display = v.open ? '' : 'none';
      btnLog.classList.toggle('on', v.open);
    });

    on(btnClose, 'click', () => {
      viewOf(job.id).dismissed = true;
      render(lastJobs);
    });

    on(btnCancel, 'click', async () => {
      btnCancel.disabled = true;
      try {
        await cancelJob(job.id);
        setStatus(t('Job "{label}" wird abgebrochen …', { label: t(job.label || job.type || job.id) }));
      } catch (e) {
        btnCancel.disabled = false;
        showError(t('Job konnte nicht abgebrochen werden'), e);
      }
    });

    return { root, label, status, time, pct, bar, barFill, btnLog, btnCancel, btnClose, logBox, logTools };
  }

  function fillNode(n, job, now) {
    const v = viewOf(job.id);
    // Jobbezeichnungen kommen vom Server. t() laesst sie stehen, solange
    // niemand eine Uebersetzung dafuer angemeldet hat.
    n.label.textContent = t(job.label || job.type || job.id);
    n.label.title = `${job.type || ''} · ${job.id}`;
    n.status.textContent = t(STATUS_TEXT[job.status] || job.status);
    n.status.className = `tag ${STATUS_CLASS[job.status] || ''}`;

    const p = Math.max(0, Math.min(1, Number(job.progress) || 0));
    const running = job.status === 'running' || job.status === 'queued';
    n.pct.textContent = running ? t('{p} %', { p: fmtNum(p * 100, 0) }) : '';
    n.pct.title = running ? t('Fortschritt {p} %', { p: fmtNum(p * 100, 0) }) : '';
    n.barFill.style.width = `${(job.status === 'done' ? 1 : p) * 100}%`;
    n.bar.className = `bar${job.status === 'done' ? ' ok' : job.status === 'error' ? ' err' : ''}`;
    n.bar.style.display = running || job.status === 'done' ? '' : 'none';

    const ms = runtimeMs(job, now);
    const runtime = ms == null ? '' : fmtRuntime(ms);
    n.time.textContent = runtime;
    n.time.title = runtime ? t('Laufzeit {time}', { time: runtime }) : t('Laufzeit');

    n.btnCancel.style.display = running ? '' : 'none';
    n.btnClose.style.display = running ? 'none' : '';

    const lines = [];
    if (job.command) lines.push(`$ ${job.command}`, '');
    if (Array.isArray(job.log)) lines.push(...job.log);
    if (job.error) lines.push('', t('FEHLER: {msg}', { msg: job.error }));
    const text = lines.join('\n');
    if (n.logBox.textContent !== text) {
      const atBottom = n.logBox.scrollTop + n.logBox.clientHeight >= n.logBox.scrollHeight - 24;
      n.logBox.textContent = text;
      if (atBottom) n.logBox.scrollTop = n.logBox.scrollHeight;
    }

    // Fehler klappen sich von selbst auf — der Nutzer soll sie nicht suchen muessen.
    if (job.status === 'error' && !v.seenError) {
      v.seenError = true;
      v.open = true;
    }
    n.logBox.style.display = v.open ? '' : 'none';
    n.logTools.style.display = v.open ? '' : 'none';
    n.btnLog.classList.toggle('on', !!v.open);
    n.root.classList.toggle('err', job.status === 'error');
  }

  function render(jobs) {
    const now = Date.now();
    const shown = jobs.filter((j) => visible(j, now));
    const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
    count.textContent = running
      ? t('{n} aktiv', { n: fmtNum(running, 0) })
      : shown.length ? tn(shown.length, '{n} Eintrag', '{n} Einträge') : '';

    // Nicht mehr sichtbare Knoten entfernen
    for (const [id, n] of [...nodes]) {
      if (!shown.some((j) => j.id === id)) { n.root.remove(); nodes.delete(id); }
    }
    if (shown.length === 0) {
      if (!list.querySelector('.empty')) {
        clear(list);
        list.appendChild(h('div.empty.dim', { style: 'padding:5px 9px;font-size:12px' }, t('Keine Jobs.')));
      }
      return;
    }
    const empty = list.querySelector('.empty');
    if (empty) empty.remove();

    let prev = null;
    for (const job of shown) {
      let n = nodes.get(job.id);
      if (!n) { n = buildNode(job); nodes.set(job.id, n); }
      fillNode(n, job, now);
      // Reihenfolge herstellen
      const after = prev ? prev.root.nextSibling : list.firstChild;
      if (after !== n.root) list.insertBefore(n.root, after);
      prev = n;
    }
  }

  function update(state) {
    lastJobs = Array.isArray(state.jobs) ? state.jobs : [];
    render(lastJobs);
  }

  // Fertige Jobs sollen auch ohne State-Aenderung nach 60 s verschwinden.
  // Der Takt haelt zugleich die Laufzeit laufender Jobs aktuell.
  setInterval(() => render(lastJobs), 5000);

  // Sprachwechsel: Kopfzeile neu beschriften und alle Jobknoten wegwerfen.
  // Die einmal gebauten Knoepfe traegen sonst weiter die alte Sprache.
  onLangChange(() => {
    title.textContent = t('Jobs');
    btnClear.textContent = t('Erledigte ausblenden');
    for (const n of nodes.values()) n.root.remove();
    nodes.clear();
    clear(list);
    render(lastJobs);
  });

  return { el: sec, update };
}
