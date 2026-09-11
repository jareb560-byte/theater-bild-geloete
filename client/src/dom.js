/**
 * Theater-Bild-Gelöte — winzige DOM-Helfer.
 *
 * Kein Framework, keine Abhaengigkeit. Nur so viel, dass sich Oberflaeche
 * ohne Zeichenketten-Bastelei bauen laesst.
 *
 * Zahlen laufen ueber fmtNum() aus i18n.js — sie folgen damit der gewaehlten
 * Sprache (Deutsch: Komma, Englisch: Punkt). timecode() bleibt bewusst
 * sprachneutral: mm:ss.hh ist in jeder Sprache dasselbe.
 */

import { t, register, fmtNum } from './i18n.js';

register('en', {
  'Schließen': 'Close',
  'Kopieren': 'Copy',
  'Kopiert ✓': 'Copied ✓',
  'Kopieren fehlgeschlagen': 'Copy failed',
  'Bild konnte nicht geladen werden: {src}': 'Image could not be loaded: {src}',
  'overlayRoot fehlt in index.html': 'overlayRoot is missing from index.html',
  'Die Aktion ist fehlgeschlagen: {msg}': 'The action failed: {msg}',
  'OK': 'OK',
});

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'line', 'text', 'polyline', 'polygon']);

/**
 * h('div.klasse#id', { ...props }, ...children)
 *
 * props:
 *   class / className   Zeichenkette oder Array oder { name: bool }
 *   style               Zeichenkette oder Objekt
 *   dataset             Objekt -> data-*
 *   text                textContent (sicher, kein HTML)
 *   attrs               Objekt -> setAttribute, roh
 *   on                  Objekt { click: fn, input: fn, ... }
 *   onClick / oninput   Funktion -> addEventListener('click'|'input', fn)
 *   alles andere        Eigenschaft am Element, sonst Attribut
 *
 * children: Zeichenketten, Zahlen, Nodes, Arrays; null/false/undefined faellt raus.
 */
export function h(tag, props, ...children) {
  let name = tag;
  let id = null;
  const classes = [];

  // Kurzform 'div.a.b#c' zerlegen
  const m = String(tag).match(/^([a-zA-Z0-9-]+)?((?:[.#][^.#]+)*)$/);
  if (m) {
    name = m[1] || 'div';
    const rest = m[2] || '';
    const parts = rest.match(/[.#][^.#]+/g) || [];
    for (const p of parts) {
      if (p[0] === '.') classes.push(p.slice(1));
      else id = p.slice(1);
    }
  }

  const el = SVG_TAGS.has(name)
    ? document.createElementNS(SVG_NS, name)
    : document.createElement(name);

  if (id) el.id = id;
  if (classes.length) el.setAttribute('class', classes.join(' '));

  if (props && typeof props === 'object' && !isChild(props)) {
    applyProps(el, props, classes);
  } else if (props != null) {
    children.unshift(props);
  }

  append(el, children);
  return el;
}

function isChild(v) {
  return v instanceof Node || Array.isArray(v) || typeof v === 'string' || typeof v === 'number';
}

function applyProps(el, props, preClasses) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) {
      if (k === 'disabled' || k === 'checked' || k === 'selected') el[k] = false;
      continue;
    }
    if (k === 'class' || k === 'className') {
      const cls = [...preClasses, ...normClass(v)].filter(Boolean).join(' ');
      el.setAttribute('class', cls);
    } else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else for (const [sk, sv] of Object.entries(v)) el.style.setProperty(kebab(sk), String(sv));
    } else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
    } else if (k === 'attrs') {
      for (const [ak, av] of Object.entries(v)) if (av != null) el.setAttribute(ak, String(av));
    } else if (k === 'text') {
      el.textContent = String(v);
    } else if (k === 'on' && typeof v === 'object') {
      for (const [ev, fn] of Object.entries(v)) if (typeof fn === 'function') el.addEventListener(ev, fn);
    } else if (/^on[A-Z]/.test(k) && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (/^on[a-z]/.test(k) && typeof v === 'function') {
      el.addEventListener(k.slice(2), v);
    } else if (k in el && !(el instanceof SVGElement)) {
      try { el[k] = v; } catch { el.setAttribute(k, String(v)); }
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
}

function normClass(v) {
  if (Array.isArray(v)) return v.flatMap(normClass);
  if (v && typeof v === 'object') return Object.entries(v).filter(([, on]) => on).map(([n]) => n);
  return String(v || '').split(/\s+/);
}

function kebab(s) {
  return s.startsWith('--') ? s : s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true || c === '') continue;
    if (Array.isArray(c)) { append(el, c); continue; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Ereignis anhaengen, gibt eine Funktion zum Abmelden zurueck. */
export function on(el, ev, fn, opts) {
  el.addEventListener(ev, fn, opts);
  return () => el.removeEventListener(ev, fn, opts);
}

/** Alle Kinder entfernen. Gibt das Element zurueck. */
export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** DocumentFragment aus beliebig vielen Kindern. */
export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/* ==========================================================================
 * Kleinkram, den fast jedes Ansichtsmodul braucht.
 * Liegt hier, weil es keine weitere Datei geben soll.
 * ========================================================================== */

/** Zahl in der gewaehlten Sprache. digits = hoechste Zahl an Nachkommastellen. */
export function num(n, digits = 2) {
  if (n == null || !isFinite(n)) return '—';
  return fmtNum(Number(n), digits);
}

/** Sekunden als mm:ss.hh */
export function timecode(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`;
}

/** Text in die Zwischenablage, mit Rueckfallebene ohne Clipboard-API. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;left:-2000px;top:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/* ==========================================================================
 * Dialoge — alle Module benutzen denselben Overlay-Container aus index.html.
 *
 * Es gibt genau EINEN Dialogkern. openModal() ist die alte Form (footer),
 * modal() die neue mit Aktionsbeschreibungen. Beide landen im selben Stapel,
 * damit Escape, Fokusfalle und das Schliessen ueberall gleich funktionieren.
 * ========================================================================== */

const modalStack = [];
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusablesIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
  );
}

/**
 * Escape und Tabulator laufen ueber EINEN Lauscher in der Einfangphase.
 *
 * Einfangphase und stopPropagation sind Absicht: solange ein Dialog offen ist,
 * darf kein anderer Tastenlauscher (z.B. die Kuerzel in main.js) dieselbe
 * Escape-Taste ein zweites Mal auswerten und einen zweiten Dialog schliessen.
 */
let trapInstalled = false;

function installTrap() {
  if (trapInstalled) return;
  trapInstalled = true;
  document.addEventListener('keydown', (ev) => {
    const top = modalStack[modalStack.length - 1];
    if (!top) return;

    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      if (top.closable) top.close();
      return;
    }
    if (ev.key !== 'Tab') return;

    const list = focusablesIn(top.el);
    if (list.length === 0) {
      ev.preventDefault();
      top.el.focus();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const cur = document.activeElement;
    if (!top.el.contains(cur)) {
      ev.preventDefault();
      (ev.shiftKey ? last : first).focus();
    } else if (!ev.shiftKey && cur === last) {
      ev.preventDefault();
      first.focus();
    } else if (ev.shiftKey && cur === first) {
      ev.preventDefault();
      last.focus();
    }
  }, true);
}

/** Fehler aus einer Dialogaktion sichtbar machen, statt sie zu verschlucken. */
function showDialogError(handle, text) {
  const bd = handle.el.querySelector('.bd');
  if (!bd) return;
  let box = bd.querySelector('.dlgErr');
  if (!box) {
    box = h('div.msg.err.dlgErr');
    bd.insertBefore(box, bd.firstChild);
  }
  box.textContent = text;
}

function openDialog(opts = {}) {
  const root = document.getElementById('overlayRoot');
  if (!root) throw new Error(t('overlayRoot fehlt in index.html'));
  installTrap();

  const closable = opts.closable !== false;
  const btnX = h('button.btn.sm.ghost.right', {
    type: 'button', title: t('Schließen'), attrs: { 'aria-label': t('Schließen') },
  }, '✕');
  const titleText = typeof opts.title === 'string' ? t(opts.title) : (opts.title || '');
  const head = h('div.hd', h('span', titleText), closable ? btnX : null);
  const actions = Array.isArray(opts.footer) ? opts.footer.filter(Boolean) : (opts.footer ? [opts.footer] : []);
  const body = h('div.bd',
    opts.body || null,
    actions.length ? h('div.row', { style: 'justify-content:flex-end;gap:6px' }, actions) : null);
  const dlg = h('div.dlg', { attrs: { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' } }, head, body);

  // Der darunterliegende Dialog wird nur versteckt, nicht entfernt — sonst
  // waere ein aus einem Dialog geoeffneter Dialog (z.B. Ordnerwahl) beim
  // Schliessen fuer immer weg und das Overlay bliebe leer stehen.
  const below = modalStack[modalStack.length - 1] || null;
  if (below) below.el.style.display = 'none';

  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;

  const handle = {
    el: dlg,
    closable,
    close() {
      if (closed) return;
      closed = true;
      const i = modalStack.indexOf(handle);
      if (i >= 0) modalStack.splice(i, 1);
      dlg.remove();
      const next = modalStack[modalStack.length - 1] || null;
      if (next) next.el.style.display = '';
      else root.classList.remove('on');
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(); } catch (e) { console.error('[modal] onClose:', e); }
      }
      try { (next ? focusablesIn(next.el)[0] || next.el : returnFocus)?.focus(); } catch { /* Element ist weg */ }
    },
    error(text) { showDialogError(handle, text); },
  };

  on(btnX, 'click', handle.close);
  root.appendChild(dlg);
  root.classList.add('on');
  modalStack.push(handle);

  // Fokus in den Dialog holen, damit Tastatur und Vorlesewerkzeuge dort landen.
  const firstField = focusablesIn(dlg).find((el) => el !== btnX) || focusablesIn(dlg)[0] || dlg;
  try { firstField.focus(); } catch { /* nicht fokussierbar */ }

  return handle;
}

/**
 * Modalen Dialog oeffnen — alte Form.
 * opts: { title, body (Node|Node[]), footer (Node[]), onClose, closable }
 * Rueckgabe: { close(), el, error(text) }
 */
export function openModal(opts = {}) {
  return openDialog(opts);
}

/**
 * Modalen Dialog oeffnen — neue Form mit beschriebenen Aktionen.
 *
 *   modal({
 *     title: 'Venue löschen',
 *     body: h('p', 'Wirklich löschen?'),
 *     actions: [
 *       { label: 'Abbrechen' },
 *       { label: 'Löschen', kind: 'danger', onClick: async () => { await del(); } },
 *     ],
 *   });
 *
 * Eine Aktion ist entweder ein fertiger Knoten oder
 * { label, kind:'primary'|'danger'|'', onClick(handle), close:false, disabled }.
 * Der Dialog schliesst nach onClick, ausser die Aktion sagt close:false oder
 * onClick gibt ausdruecklich false zurueck. Wirft onClick, bleibt der Dialog
 * offen und zeigt den Fehler im Klartext — nichts wird stumm verschluckt.
 */
export function modal(opts = {}) {
  let handle = null;
  const specs = Array.isArray(opts.actions) ? opts.actions : [];
  const nodes = specs.map((a) => {
    if (a instanceof Node) return a;
    if (!a || typeof a !== 'object') return null;
    const cls = `btn${a.kind === 'primary' ? ' acc' : a.kind === 'danger' ? ' danger' : ''}`;
    const b = h('button', { type: 'button', class: cls, disabled: !!a.disabled }, t(a.label || 'OK'));
    on(b, 'click', async () => {
      try {
        b.disabled = true;
        const r = typeof a.onClick === 'function' ? await a.onClick(handle) : undefined;
        if (a.close !== false && r !== false) handle.close();
        else b.disabled = !!a.disabled;
      } catch (e) {
        b.disabled = !!a.disabled;
        console.error('[modal] Aktion:', e);
        handle.error(t('Die Aktion ist fehlgeschlagen: {msg}', { msg: e && e.message ? e.message : String(e) }));
      }
    });
    return b;
  }).filter(Boolean);

  handle = openDialog({ ...opts, footer: nodes });
  return handle;
}

/** Obersten Dialog schliessen (Escape). */
export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top && top.closable) { top.close(); return true; }
  return !!top;
}

/** Bild gross anzeigen. */
export function showImage(src, title = '') {
  const img = h('img.zoom', { src, alt: title });
  img.addEventListener('error', () => {
    img.replaceWith(h('div.msg.err', t('Bild konnte nicht geladen werden: {src}', { src })));
  });
  return openModal({ title, body: img });
}

/** Knopf, der Text kopiert und kurz "Kopiert" meldet. */
export function copyButton(getText, label = 'Kopieren') {
  const b = h('button.btn.sm', { type: 'button' }, t(label));
  on(b, 'click', async () => {
    const ok = await copyText(typeof getText === 'function' ? getText() : String(getText));
    b.textContent = ok ? t('Kopiert ✓') : t('Kopieren fehlgeschlagen');
    setTimeout(() => { b.textContent = t(label); }, 1400);
  });
  return b;
}
