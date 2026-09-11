#!/usr/bin/env node
/**
 * Theater-Bild-Gelöte - Mehrsprachigkeit pruefen.
 *
 * Sucht in client/src/ **\/*.js und client/index.html nach
 *   1. Texten, die ein Mensch liest, aber nicht durch t() bzw. data-i18n gehen
 *   2. t()-Schluesseln, fuer die kein englischer Eintrag angemeldet ist
 *   3. Zahlformatierung von Hand (toFixed(...).replace(...)) statt fmtNum
 *
 * Das ist REINE HEURISTIK. Sie liest den Quelltext, nicht seinen Sinn, und
 * kann daher danebenliegen - in beide Richtungen. Sie muss brauchbar sein,
 * nicht beweisbar. Was sie sicher kann: nach einer Umbenennung des deutschen
 * Textes die verwaiste Uebersetzung finden.
 *
 * Aufruf:  npm run i18n:check
 * Exitcode 1, sobald irgendetwas fehlt.
 *
 * Bekannte Grenzen, damit sich niemand wundert:
 *   - t(variable) laesst sich nicht pruefen und wird uebersprungen.
 *   - In Vorlagenzeichenketten wird nur der feste Teil beurteilt.
 *   - Regulaere Ausdruecke werden heuristisch erkannt; im Zweifel entsteht
 *     ein Fehlalarm, keine Luecke.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const clientDir = path.join(root, 'client');
const srcDir = path.join(clientDir, 'src');
const indexHtml = path.join(clientDir, 'index.html');

/** Dateien, die keine Oberflaechentexte enthalten (duerfen). */
const SKIP_FILES = new Set([path.join(srcDir, 'i18n.js')]);

/* ==========================================================================
 * Was ist ein Text, den ein Mensch liest?
 * ========================================================================== */

const LETTER = 'A-Za-zÄÖÜäöüß';

/** Aufrufe, deren Zeichenketten technisch sind - nie Oberflaeche. */
const TECHNICAL_CALLEES = new Set([
  'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName',
  'createElement', 'createElementNS', 'createTextNode', 'closest', 'matches',
  'setAttribute', 'getAttribute', 'removeAttribute', 'hasAttribute',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'add', 'remove', 'toggle', 'contains', 'replace', 'replaceAll', 'split',
  'join', 'startsWith', 'endsWith', 'includes', 'indexOf', 'lastIndexOf',
  'setItem', 'getItem', 'removeItem', 'parse', 'stringify',
  'fetch', 'open', 'setProperty', 'getPropertyValue',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'import', 'require', 'on', 'off', 'once', 'emit', 'has', 'test', 'exec',
  'log', 'warn', 'error', 'info', 'debug', 'trace', 'assert', 'time', 'timeEnd',
  'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString',
  'localeCompare', 'padStart', 'padEnd', 'normalize', 'trimStart', 'trimEnd',
  'getContext', 'insertAdjacentHTML', 'setRequestHeader', 'append', 'set',
]);

/** Eigenschaften, deren Zuweisung technisch ist. */
const TECHNICAL_PROPS = new Set([
  'className', 'id', 'src', 'href', 'type', 'rel', 'target', 'method',
  'dataset', 'style', 'display', 'visibility', 'position', 'cursor',
  'tagName', 'nodeName', 'accept', 'crossOrigin', 'preload', 'autocomplete',
  'spellcheck', 'contentType', 'font', 'fillStyle', 'strokeStyle',
  'lineCap', 'lineJoin', 'textAlign', 'textBaseline', 'composite',
  'globalCompositeOperation', 'encoding', 'charset', 'lang', 'dir',
]);

/** Woerter, die zwar wie Text aussehen, aber technisch sind. */
const TECHNICAL_WORDS = new Set([
  'GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS',
  'Content-Type', 'application/json', 'text/plain', 'image/jpeg', 'video/mp4',
  'utf8', 'utf-8', 'base64', 'binary', 'blob', 'json', 'text', 'arraybuffer',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'change', 'input', 'click', 'keydown', 'keyup', 'submit', 'scroll', 'resize',
  'mousedown', 'mousemove', 'mouseup', 'wheel', 'dragover', 'drop', 'dragstart',
  'pointerdown', 'pointermove', 'pointerup', 'contextmenu', 'focus', 'blur',
  'loadeddata', 'canplay', 'ended', 'timeupdate', 'error', 'load', 'abort',
  'module', 'stylesheet', 'anonymous', 'auto', 'none', 'block', 'flex', 'grid',
  'hidden', 'visible', 'absolute', 'relative', 'fixed', 'sticky', 'pointer',
  'cover', 'contain', 'stretch', 'native', 'manual', 'normal', 'multiply',
  'screen', 'overlay', 'lighter', 'darken', 'source-over',
  // Tastennamen aus KeyboardEvent.key
  'Escape', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
  'PageUp', 'PageDown', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock',
]);

/** Sieht die Zeichenkette nach einem Satz oder Wort fuer Menschen aus? */
function looksHuman(raw) {
  const full = String(raw).trim();
  if (full.length < 3) return false;

  // Platzhalter herausnehmen: "HTTP {n}" ist kein Satz, "Wand {id} rendern" schon.
  const s = full.replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 3) return false;
  if (TECHNICAL_WORDS.has(s)) return false;

  // Muss ueberhaupt Buchstaben enthalten - und zwar zwei zusammenhaengende.
  if (!new RegExp(`[${LETTER}]{2}`).test(s)) return false;

  const hasSpace = /\s/.test(s);
  const hasUmlaut = /[ÄÖÜäöüß]/.test(s);

  // Pfade, URLs, Dateinamen.
  if (/^[./\\~?#]/.test(s)) return false;
  if (/:\/\//.test(s)) return false;
  if (/\.(js|mjs|json|css|html?|png|jpe?g|webp|svg|ico|mp4|mov|mkv|webm|txt|md)$/i.test(s)) return false;
  if (!hasSpace && /[/=?&<>|]/.test(s)) return false;         // Pfad, Abfrage, Vergleich

  // CSS und Selektoren.
  if (/^[a-z][\w-]*\s*\(/i.test(s) && !hasUmlaut) return false; // rgba(…), blur(…px)
  if (/[[\]]/.test(s)) return false;                          // a[href], [tabindex]
  if (/^[\w-]*(?:[.#:][\w-]+)+$/.test(s)) return false;        // div.msg.err, #id, li:first
  if (/[{};]/.test(s) && /:/.test(s)) return false;            // CSS-Deklaration
  if (/^[a-z][a-z-]*\s*:/.test(s) && !hasUmlaut) return false; // padding:5px 9px
  if (/^-{1,2}[a-z][\w-]*$/i.test(s)) return false;            // CSS-Variable, Schalter
  if (/^\d/.test(s) && !hasSpace) return false;                // "30fps", "2px"
  if (/^[A-Z0-9_+-]+$/.test(s)) return false;                  // Konstanten, HTTP-Verben

  // Ein einzelnes klein geschriebenes Wort ohne Umlaut ist fast immer ein
  // Schluessel, eine Ereignisart oder ein Klassenname.
  if (!hasSpace && !hasUmlaut) {
    if (/^[a-z][\w-]*$/.test(s)) return false;
    if (/^[a-z][A-Za-z0-9]*$/.test(s)) return false;           // camelCase
    if (/^[A-Za-z][\w-]*$/.test(s) && s.length < 4) return false;
  }

  // Reine Zeichensammlungen ("—", "▶", " / ").
  const words = s.match(new RegExp(`[${LETTER}][${LETTER}]+`, 'g')) || [];
  if (words.length === 0) return false;

  // Kein einziges gross geschriebenes Wort, nur kurze Kleinbuchstaben-Tokens,
  // kein Umlaut: das ist eine Klassenliste, ein Shader, ein Schluesselname -
  // deutscher Oberflaechentext hat praktisch immer eine Grossschreibung.
  if (!hasUmlaut && words.every((w) => /^[a-z]/.test(w) && w.length <= 8)) return false;

  return true;
}

/* ==========================================================================
 * Zeichenketten aus JavaScript holen
 * ========================================================================== */

/**
 * Ende einer Zeichenkette, die bei i beginnt (i zeigt auf das Anfuehrungs-
 * zeichen). Vorlagenzeichenketten koennen in ${…} beliebig verschachtelte
 * weitere Zeichenketten enthalten - deshalb die gegenseitige Rekursion.
 */
function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === q) return j + 1;
    if (q === '`' && c === '$' && src[j + 1] === '{') {
      j = skipExpr(src, j + 1);
      continue;
    }
    j += 1;
  }
  return src.length;
}

/** Ende eines { … }-Blocks, der bei i beginnt (i zeigt auf die Klammer). */
function skipExpr(src, i) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') {
      j = skipString(src, j);
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
    j += 1;
  }
  return src.length;
}

/**
 * Zerlegt Quelltext in Zeichenketten und einen kommentarfreien Codeabzug
 * gleicher Laenge (Kommentarzeichen werden zu Leerzeichen). So bleiben alle
 * Positionen erhalten und lassen sich in Zeilennummern umrechnen.
 */
function scanJs(src) {
  const n = src.length;
  const code = new Array(n);
  const strings = [];
  let i = 0;
  let prev = '';

  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) code[k] = src[k] === '\n' ? '\n' : ' ';
  };
  const keep = (from, to) => {
    for (let k = from; k < to; k += 1) code[k] = src[k];
  };

  /** Darf hier ein regulaerer Ausdruck beginnen? */
  const regexAllowed = () => prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev);

  while (i < n) {
    const c = src[i];

    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j += 1;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const start = i;
      const quote = c;
      const end = Math.min(n, skipString(src, i));
      keep(start, end);
      strings.push({ quote, start, end, raw: src.slice(start + 1, Math.max(start + 1, end - 1)) });
      prev = quote;
      i = end;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j += 1;
      }
      const end = Math.min(n, j + 1);
      keep(i, end);
      prev = '/';
      i = end;
      continue;
    }

    code[i] = c;
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }

  return { code: code.join(''), strings };
}

/** Zeilennummer (1-basiert) zu einer Zeichenposition. */
function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') starts.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Name der Funktion, in deren Argumentliste pos steht - oder null. */
function enclosingCallee(code, pos) {
  let depth = 0;
  for (let i = pos - 1; i >= 0; i -= 1) {
    const c = code[i];
    if (c === ')' || c === ']' || c === '}') depth += 1;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) {
        if (c !== '(') return null;
        let j = i - 1;
        while (j >= 0 && /\s/.test(code[j])) j -= 1;
        let end = j + 1;
        while (j >= 0 && /[\w$]/.test(code[j])) j -= 1;
        const name = code.slice(j + 1, end);
        return name || null;
      }
      depth -= 1;
    }
  }
  return null;
}

/** Text unmittelbar vor pos, ohne Leerraum. */
function before(code, pos, len = 48) {
  return code.slice(Math.max(0, pos - len), pos);
}

/** Klammerpaar ab der oeffnenden Klammer bei "from" - liefert deren Ende. */
function matchBrace(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* ==========================================================================
 * Sammeln
 * ========================================================================== */

const findings = [];
function report(file, line, kind, text, hint) {
  findings.push({ file: path.relative(root, file), line, kind, text, hint });
}

const englishKeys = new Set();
const usedKeys = [];   // { key, file, line }

/** Alle .js-Dateien unterhalb dir. */
function walkJs(dir) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`[i18n] ${dir} nicht lesbar: ${err.message}`);
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJs(full));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Schluessel aus allen register('en', {...})-Bloecken einer Datei. */
function collectEnglish(file, src, code) {
  const ranges = [];
  const re = /register\s*\(\s*(['"])en\1\s*,\s*\{/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const braceAt = m.index + m[0].length - 1;
    const end = matchBrace(code, braceAt);
    if (end < 0) {
      console.error(
        `[i18n] ${path.relative(root, file)}: register('en', { … } ist nicht geschlossen.`
      );
      break;
    }
    ranges.push([m.index, end + 1]);
    const block = src.slice(braceAt, end + 1);
    const keyRe = /(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*:/g;
    let k;
    while ((k = keyRe.exec(block)) !== null) englishKeys.add(unescape(k[2]));
    re.lastIndex = end + 1;
  }
  return ranges;
}

/** \n, \' und Konsorten aufloesen - der Schluessel ist der echte Text. */
function unescape(s) {
  return String(s)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\(['"`\\])/g, '$1');
}

/** Feste Teile einer Vorlagenzeichenkette, ${…} wird zu einem Platzhalter. */
function templateText(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '\\') {
      out += raw.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (raw[i] === '$' && raw[i + 1] === '{') {
      i = skipExpr(raw, i + 1);
      out += '{…}';
      continue;
    }
    out += raw[i];
    i += 1;
  }
  return out;
}

function checkJsFile(file) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`[i18n] ${file} nicht lesbar: ${err.message}`);
    return;
  }
  const { code, strings } = scanJs(src);
  const lineOf = lineIndex(src);
  const exempt = collectEnglish(file, src, code);

  const inExempt = (pos) => exempt.some(([a, b]) => pos >= a && pos < b);

  // --- t() und tn(): Schluessel einsammeln, Spanne als erledigt merken ----
  const covered = [];
  const tRe = /(?<![\w$.])t\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = tRe.exec(code)) !== null) {
    const key = unescape(m[2]);
    usedKeys.push({ key, file, line: lineOf(m.index) });
    covered.push([m.index + m[0].length - m[2].length - 2, m.index + m[0].length]);
  }
  const tnRe =
    /(?<![\w$.])tn\s*\([^,]*,\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g;
  while ((m = tnRe.exec(code)) !== null) {
    for (const key of [unescape(m[2]), unescape(m[4])]) {
      usedKeys.push({ key, file, line: lineOf(m.index) });
    }
    covered.push([m.index, m.index + m[0].length]);
  }
  const isCovered = (s) => covered.some(([a, b]) => s.start >= a - 1 && s.end <= b + 1);

  // --- Zahlformatierung von Hand ----------------------------------------
  const numRe = /toFixed\s*\([^)]*\)\s*\.\s*replace\s*\(/g;
  while ((m = numRe.exec(code)) !== null) {
    report(
      file,
      lineOf(m.index),
      'zahl',
      'toFixed(…).replace(…)',
      'fmtNum/fmtMeters aus i18n.js benutzen — das Dezimalzeichen haengt an der Sprache.'
    );
  }

  // --- Zeichenketten ohne t() -------------------------------------------
  for (const s of strings) {
    if (inExempt(s.start) || isCovered(s)) continue;

    const text = s.quote === '`' ? templateText(s.raw) : unescape(s.raw);
    if (!looksHuman(text)) continue;

    const ctx = before(code, s.start);

    // import/export … from '…'
    if (/\b(?:from|import)\s*\(?\s*$/.test(ctx)) continue;
    // Vergleiche: x === 'stage3d'
    if (/[=!]==?\s*$/.test(ctx)) continue;
    // case 'x':
    if (/\bcase\s+$/.test(ctx)) continue;
    // Objektschluessel: { 'x': … } oder , 'x': …
    if (/[{,]\s*$/.test(ctx) && /^\s*:/.test(code.slice(s.end))) continue;
    // el.className = 'btn'
    const propAssign = /([\w$]+)\s*=\s*$/.exec(ctx);
    if (propAssign && TECHNICAL_PROPS.has(propAssign[1])) continue;
    // …style.display = 'none'
    if (/\.style\.[\w$]+\s*=\s*$/.test(ctx)) continue;

    const callee = enclosingCallee(code, s.start);
    if (callee && TECHNICAL_CALLEES.has(callee)) continue;
    if (callee === 't' || callee === 'tn' || callee === 'register') continue;

    report(
      file,
      lineOf(s.start),
      'ohne-t',
      text.length > 70 ? `${text.slice(0, 67)}…` : text,
      callee ? `Aufruf: ${callee}(…)` : null
    );
  }
}

/* ==========================================================================
 * HTML
 * ========================================================================== */

function checkHtml(file) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`[i18n] ${file} nicht lesbar: ${err.message}`);
    return;
  }
  const lineOf = lineIndex(src);

  // <script>, <style>, Kommentare und <!doctype …> durch Leerraum ersetzen.
  // Zeilenumbrueche bleiben stehen, damit die Zeilennummern stimmen.
  const masked = src.replace(
    /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->|<![a-zA-Z][^>]*>/gi,
    (blockText) => blockText.replace(/[^\n]/g, ' ')
  );

  const VOID = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
  ]);

  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;
  const stack = [{ tag: '(root)', attrs: '' }];
  let last = 0;
  let m;

  const attrValue = (attrs, name) => {
    const r = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
    const hit = r.exec(attrs);
    if (!hit) return null;
    return hit[2] ?? hit[3] ?? '';
  };

  const checkText = (from, to) => {
    const chunk = masked.slice(from, to);
    if (!chunk.trim()) return;
    const top = stack[stack.length - 1];
    // Text direkt im Rumpf oder in Behaeltern ohne eigenen Text ignorieren.
    for (const piece of chunk.split(/\n/)) {
      const textPiece = piece.trim();
      if (!textPiece || !looksHuman(textPiece)) continue;
      if (/\bdata-i18n\b/.test(top.attrs)) return;
      report(
        file,
        lineOf(from + chunk.indexOf(textPiece)),
        'html-text',
        textPiece.length > 70 ? `${textPiece.slice(0, 67)}…` : textPiece,
        `<${top.tag}> braucht data-i18n`
      );
      return;
    }
  };

  while ((m = tagRe.exec(masked)) !== null) {
    checkText(last, m.index);
    last = tagRe.lastIndex;

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClosing = m[4] === '/' || VOID.has(tag);

    if (!closing) {
      for (const [attr, marker] of [
        ['placeholder', 'data-i18n-placeholder'],
        ['title', 'data-i18n-title'],
        ['aria-label', 'data-i18n-aria'],
      ]) {
        const v = attrValue(attrs, attr);
        if (v && looksHuman(v) && !new RegExp(`\\b${marker}\\b`).test(attrs)) {
          report(file, lineOf(m.index), 'html-attr', `${attr}="${v}"`, `<${tag}> braucht ${marker}`);
        }
      }
      if (!selfClosing) stack.push({ tag, attrs });
    } else if (stack.length > 1) {
      // Bis zum passenden Starttag zurueckraeumen - unsauberes HTML soll die
      // Pruefung nicht aus dem Tritt bringen.
      for (let k = stack.length - 1; k >= 1; k -= 1) {
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      }
    }
  }
  checkText(last, masked.length);

  // <html lang="de"> ist der Startwert; i18n.js setzt ihn spaeter selbst um.
  if (!/<html[^>]*\blang\s*=/i.test(src)) {
    report(file, 1, 'html-attr', '<html> ohne lang-Attribut', 'lang="de" setzen.');
  }
}

/* ==========================================================================
 * Hauptlauf
 * ========================================================================== */

function main() {
  const files = walkJs(srcDir).filter((f) => !SKIP_FILES.has(f));
  if (files.length === 0) {
    console.error(`[i18n] Keine Quelldateien unter ${srcDir} gefunden.`);
    process.exit(1);
  }

  for (const f of files) checkJsFile(f);
  if (fs.existsSync(indexHtml)) checkHtml(indexHtml);
  else console.error(`[i18n] ${indexHtml} fehlt.`);

  // Erst jetzt pruefen: register() aus IRGENDEINEM Modul zaehlt, die
  // Woerterbuecher landen zur Laufzeit alle im selben Speicher.
  const missing = new Map();
  for (const u of usedKeys) {
    if (englishKeys.has(u.key)) continue;
    if (!missing.has(u.key)) missing.set(u.key, u);
  }
  for (const [key, u] of missing) {
    report(
      u.file,
      u.line,
      'ohne-en',
      key.length > 70 ? `${key.slice(0, 67)}…` : key,
      "register('en', { … }) im eigenen Modul ergaenzen."
    );
  }

  const byKind = {
    'ohne-t': 'Text ohne t() bzw. data-i18n',
    'ohne-en': 'kein englischer Eintrag',
    'html-text': 'HTML-Text ohne data-i18n',
    'html-attr': 'HTML-Attribut ohne data-i18n-*',
    zahl: 'Zahl von Hand formatiert',
  };

  console.log('');
  console.log('Theater-Bild-Gelöte — i18n-Pruefung');
  console.log('=========================');
  console.log(`  Dateien: ${files.length} JS + index.html`);
  console.log(`  Englische Eintraege angemeldet: ${englishKeys.size}`);
  console.log(`  t()-Schluessel im Code: ${new Set(usedKeys.map((u) => u.key)).size}`);
  console.log('');

  if (findings.length === 0) {
    console.log('  Nichts zu beanstanden.');
    console.log('');
    process.exit(0);
  }

  findings.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || a.line - b.line
  );

  let lastKind = '';
  for (const f of findings) {
    if (f.kind !== lastKind) {
      lastKind = f.kind;
      console.log(`  ── ${byKind[f.kind] || f.kind} ──`);
    }
    const where = `${f.file}:${f.line}`;
    console.log(`  ${where.padEnd(38)} ${f.text}${f.hint ? `   (${f.hint})` : ''}`);
  }

  const counts = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] || 0) + 1;
  console.log('');
  console.log(
    `  ${findings.length} Punkt(e): ` +
      Object.entries(counts)
        .map(([k, v]) => `${v}× ${byKind[k] || k}`)
        .join(', ')
  );
  console.log('');
  process.exit(1);
}

main();
