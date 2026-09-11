/**
 * Theater-Bild-Gelöte — Mehrsprachigkeit.
 *
 * ---------------------------------------------------------------------------
 * GRUNDIDEE: der deutsche Text IST der Schluessel.
 * ---------------------------------------------------------------------------
 *
 *   t('Rendern')                     -> 'Rendern' (de) / 'Render' (en)
 *   t('{n} Dateien', { n: 4 })       -> '4 Dateien' / '4 files'
 *
 * Vorteile gegenueber erfundenen Schluesseln wie 'render.button.label':
 *   - Deutsch funktioniert ohne jedes Woerterbuch. Faellt eine Uebersetzung
 *     aus, steht da deutscher Klartext und nicht 'render.button.label'.
 *   - Beim Lesen des Codes sieht man sofort, was auf dem Schirm steht.
 *   - Kein zentrales Woerterbuch, das bei jeder Aenderung angefasst werden muss.
 *
 * Preis: aendert man den deutschen Text, greift die Uebersetzung nicht mehr.
 * Dafuer gibt es `npm run i18n:check` — das listet alle Texte ohne Uebersetzung.
 *
 * ---------------------------------------------------------------------------
 * WOERTERBUECHER LIEGEN BEI DEN MODULEN, NICHT ZENTRAL
 * ---------------------------------------------------------------------------
 * Jedes UI-Modul meldet seine eigenen Uebersetzungen beim Import an:
 *
 *   import { t, register } from '../i18n.js';
 *   register('en', {
 *     'Rendern': 'Render',
 *     'Zielordner': 'Output folder',
 *   });
 *
 * Damit gibt es keine Datei, an der alle gleichzeitig arbeiten muessten, und
 * eine Uebersetzung steht immer neben dem Text, den sie betrifft.
 */

const DICTS = Object.create(null); // { en: { 'deutsch': 'english' } }

/** Sprachen, die die Oberflaeche anbietet. */
export const LANGUAGES = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
];

const STORAGE_KEY = 'tbg.lang';
const listeners = new Set();

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((l) => l.id === saved)) return saved;
  } catch {
    /* localStorage kann in strengen Einstellungen fehlen */
  }
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'de';
  const short = String(nav).slice(0, 2).toLowerCase();
  return LANGUAGES.some((l) => l.id === short) ? short : 'en';
}

let lang = detect();

export function getLang() {
  return lang;
}

export function setLang(next) {
  if (!LANGUAGES.some((l) => l.id === next) || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* nicht schlimm, gilt dann nur fuer diese Sitzung */
  }
  document.documentElement.lang = next;
  applyStatic(document);
  for (const fn of listeners) {
    try {
      fn(next);
    } catch (err) {
      console.error('[tbg] Sprachwechsel-Empfaenger:', err);
    }
  }
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Uebersetzungen anmelden. Mehrfachaufrufe ergaenzen sich; ein bereits
 * vorhandener Eintrag wird NICHT ueberschrieben, damit sich Module nicht
 * gegenseitig die Texte wegnehmen.
 */
export function register(langId, dict) {
  if (!dict || typeof dict !== 'object') return;
  const target = (DICTS[langId] ??= Object.create(null));
  for (const [k, v] of Object.entries(dict)) {
    if (typeof v === 'string' && !(k in target)) target[k] = v;
  }
}

/**
 * Uebersetzen und Platzhalter ersetzen.
 *
 * Platzhalter sind {name} und werden aus `vars` gefuellt. Fehlt ein Wert,
 * bleibt der Platzhalter stehen — das faellt beim Testen auf, ein leerer
 * String nicht.
 */
export function t(text, vars) {
  const s = String(text ?? '');
  const dict = DICTS[lang];
  let out = dict && dict[s] ? dict[s] : s;
  if (vars) {
    out = out.replace(/\{(\w+)\}/g, (m, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m
    );
  }
  return out;
}

/** Ein/Mehrzahl. `t` wird auf beide Formen angewandt. */
export function tn(n, one, many, vars) {
  return t(n === 1 ? one : many, { n, ...(vars || {}) });
}

/**
 * Uebersetzt statisches Markup.
 *
 * Im HTML werden Texte so ausgezeichnet:
 *   <button data-i18n>Rendern</button>
 *   <input data-i18n-placeholder placeholder="Suchen …">
 *   <span data-i18n-title title="Wand in der 3D-Ansicht zeigen">
 *
 * Der deutsche Originaltext bleibt im Markup stehen — er ist ja der Schluessel.
 * Beim ersten Durchlauf wird er in einem data-Attribut gesichert, damit ein
 * spaeterer Sprachwechsel nicht die schon uebersetzte Fassung als Schluessel
 * benutzt.
 */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    if (!el.dataset.i18nSrc) el.dataset.i18nSrc = el.textContent.trim();
    el.textContent = t(el.dataset.i18nSrc);
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    if (!el.dataset.i18nPh) el.dataset.i18nPh = el.getAttribute('placeholder') || '';
    el.setAttribute('placeholder', t(el.dataset.i18nPh));
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    if (!el.dataset.i18nTitle) el.dataset.i18nTitle = el.getAttribute('title') || '';
    el.setAttribute('title', t(el.dataset.i18nTitle));
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    if (!el.dataset.i18nAria) el.dataset.i18nAria = el.getAttribute('aria-label') || '';
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
}

/* ==========================================================================
 * Zahlen, Zeiten, Groessen — sprachabhaengig
 * ========================================================================== */

/** Dezimalzahl in der aktuellen Sprache (Deutsch: Komma). */
export function fmtNum(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${fmtNum(n / 1024 ** i, i === 0 ? 0 : 1)} ${u[i]}`;
}

/** Meterangabe, z.B. "10,40 m" bzw. "10.40 m". */
export function fmtMeters(m) {
  return `${fmtNum(m, 2)} m`;
}

// Sprache am <html> vermerken, damit CSS und Vorlesewerkzeuge sie kennen.
try {
  document.documentElement.lang = lang;
} catch {
  /* kein DOM (Test) */
}
