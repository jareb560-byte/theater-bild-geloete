#!/usr/bin/env node
/**
 * Theater-Bild-Gelöte — Bauskript fuer die statische Browser-Fassung.
 * ===========================================================================
 *
 * Ergebnis ist ein Ordner, den man unveraendert auf GitHub Pages legen kann.
 * Kein Node, kein Server, kein Bundler — die Dateien werden kopiert und an
 * genau drei Stellen gezielt veraendert:
 *
 *   1. client/src/api.js wird durch client/src/api-browser.js ersetzt.
 *      Der Dateiname bleibt api.js, damit alle Importe weiter stimmen.
 *   2. Absolute Importe ('/shared/model.js') werden relativ gemacht.
 *      GitHub Pages liefert unter https://name.github.io/repo/ aus — ein
 *      Pfad, der mit / beginnt, zeigt dort ins Leere.
 *   3. index.html bekommt die relative import map, data-mode="browser",
 *      den Modus-Schalter, das Hinweisband und das dazugehoerige CSS.
 *
 * Aufruf:
 *   node tools/build-web.js
 *   node tools/build-web.js --out dist-web --base /repo/
 *   node tools/build-web.js --repo https://github.com/name/repo
 *
 * Ohne Fremdabhaengigkeit, nur die Node-Standardbibliothek. Alle Pfade laufen
 * ueber node:path — der Projektpfad enthaelt Leerzeichen und einen Punkt.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * So viele absolute Importe hat die Desktop-Fassung. Weicht die gezaehlte
 * Zahl davon ab, hat jemand eine Stelle hinzugefuegt oder entfernt — das
 * gehoert ins Protokoll, weil es auf Pages still bricht.
 */
// Stellen mit  from '/shared/model.js'  im Client: 8 in den urspruenglichen
// Modulen plus 1 in api-browser.js. Der Import von '/server/ops/filtergraph.js'
// wird getrennt gezaehlt, weil es ein anderer Pfad ist.
const EXPECTED_ABS_IMPORTS = 9;

// Nur gepruefte Vorlagen und ausdruecklich freigegebene statische Assets
// veroeffentlichen. Produktionsmaterial und eigene Venues bleiben lokal.
const PUBLIC_VENUES = ['mein-schiff-theater.json', 'weitere-venues.json'];
const PUBLIC_ASSETS = [];

/* ==========================================================================
 * Protokoll
 * ========================================================================== */

const warnings = [];

const say = (line = '') => console.log(line);
const note = (line) => console.log(`  ${line}`);

function warn(line) {
  warnings.push(line);
  console.log(`  ! ${line}`);
}

function fail(msg, hint) {
  console.error(`\nAbbruch: ${msg}`);
  if (hint) console.error(`         ${hint}`);
  process.exit(1);
}

/* ==========================================================================
 * Aufrufparameter
 * ========================================================================== */

function parseArgs(argv) {
  const out = { out: 'dist-web', base: null, repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--base') out.base = argv[++i];
    // --strict: Warnungen sind Fehler. Fuer die Automatik gedacht, damit eine
    // kaputte Seite nicht kommentarlos veroeffentlicht wird.
    else if (a === '--strict') out.strict = true;
    else if (a === '--repo') out.repo = argv[++i];
    else if (a.startsWith('--out=')) out.out = a.slice(6);
    else if (a.startsWith('--base=')) out.base = a.slice(7);
    else if (a.startsWith('--repo=')) out.repo = a.slice(7);
    else fail(`Unbekannter Parameter: ${a}`, 'node tools/build-web.js --help');
  }
  if (!out.out) fail('--out braucht einen Ordnernamen.');
  return out;
}

function usage() {
  say('node tools/build-web.js [--out dist-web] [--base /repo/] [--repo https://github.com/name/repo]');
  say('');
  say('  --out   Zielordner, relativ zur Projektwurzel (Standard: dist-web)');
  say('  --base  Unterpfad auf GitHub Pages. Wird nur fuer 404.html gebraucht,');
  say('          alles andere ist relativ verlinkt.');
  say('  --repo  Repo-Adresse zur Ableitung des Pages-Unterpfads.');
  say('          Standard: package.json → repository.url');
}

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

/** Alle Dateien unterhalb von dir, absolut, in stabiler Reihenfolge. */
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * Ordner kopieren. skip bekommt den Dateinamen (ohne Pfad) und darf true
 * sagen; damit bleibt api-browser.js aussen vor.
 */
function copyTree(src, dst, skip) {
  let n = 0;
  if (!fs.existsSync(src)) return n;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (skip && skip(entry.name, from)) continue;
    if (entry.isDirectory()) n += copyTree(from, to, skip);
    else { fs.copyFileSync(from, to); n += 1; }
  }
  return n;
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

/** Absoluter Pfad im Zielordner → relativer Pfad ab der Datei, die ihn nutzt. */
function relativeSpecifier(fromFile, outRoot, absSpecifier) {
  const target = path.join(outRoot, absSpecifier);
  let rel = path.relative(path.dirname(fromFile), target);
  rel = rel.split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} kB`;
  return `${bytes} B`;
}

/** git+https://…/repo.git → https://…/repo */
function repoWebUrl(pkg, override) {
  if (override) return override.replace(/\/+$/, '');
  const raw = pkg?.repository?.url || pkg?.repository || pkg?.homepage || '';
  const url = String(raw)
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/#.*$/, '')
    .replace(/^git@github\.com:/, 'https://github.com/');
  return url ? url.replace(/\/+$/, '') : '';
}

/** '/repo' oder 'repo/' → '/repo/' */
function normalizeBase(base) {
  let b = String(base || '').trim();
  if (!b) return '';
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Private Kontakt- und Pfadangaben gehoeren nicht in oeffentliche Vorlagen. */
function publicVenueData(value) {
  if (Array.isArray(value)) return value.map(publicVenueData);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:contacts?|contactPerson|contactName|contactEmail|ansprechpartner|kontakt|kontakte|email|e-mail|phone|telephone|telefon|mobile|author|createdBy|modifiedBy|owner|absPath|localPath|filePath)$/i.test(key)) continue;
      result[key] = publicVenueData(child);
    }
    return result;
  }
  if (typeof value === 'string' && (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) ||
    /(?:^|[\s(])(?:[A-Z]:[\\/]|file:\/\/|\/(?:Users|home)\/)/i.test(value)
  )) return '[Private Kontakt- oder Pfadangabe entfernt]';
  return value;
}

/* ==========================================================================
 * Bauen
 * ========================================================================== */

const args = parseArgs(process.argv.slice(2));

const pkgPath = path.join(ROOT, 'package.json');
if (!fs.existsSync(pkgPath)) fail(`package.json nicht gefunden unter ${pkgPath}`);
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const OUT = path.isAbsolute(args.out) ? path.resolve(args.out) : path.resolve(ROOT, args.out);

// Schutz vor einem versehentlichen rm -rf auf die Projektwurzel.
if (OUT === ROOT || ROOT.startsWith(OUT + path.sep)) {
  fail(`Der Zielordner ${OUT} enthaelt das Projekt selbst.`, 'Bitte einen eigenen Ordner angeben, etwa --out dist-web');
}
for (const protectedName of ['client', 'server', 'shared', 'config', 'tools', 'docs', 'node_modules', '.git', '.github', 'bin']) {
  const protectedPath = path.join(ROOT, protectedName).toLowerCase();
  const target = OUT.toLowerCase();
  if (target === protectedPath || target.startsWith(protectedPath + path.sep)) {
    fail(`Der Zielordner liegt in einem Quell-/Programmordner: ${OUT}`, 'Bitte --out dist-web oder einen separaten Ausgabeordner verwenden.');
  }
}

const REPO = repoWebUrl(pkg, args.repo);
// Ohne --base der Repo-Name aus der Repo-Adresse; sonst die Wurzel.
const BASE = normalizeBase(args.base || (REPO ? `/${REPO.split('/').pop()}/` : '/'));

say(`Theater-Bild-Gelöte — Browser-Fassung bauen`);
say(`  Projekt : ${ROOT}`);
say(`  Ziel    : ${OUT}`);
say(`  Base    : ${BASE}   (nur fuer 404.html)`);
say(`  Repo    : ${REPO || '— keines gefunden, der Hinweis bekommt keinen Link —'}`);
say('');

/* --- 1. Zielordner leeren --------------------------------------------- */

say('1. Zielordner vorbereiten');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
note('geleert und neu angelegt');

/* --- 2. Dateien einsammeln --------------------------------------------- */

say('2. Dateien einsammeln');

const srcIndex = path.join(ROOT, 'client', 'index.html');
const srcClientSrc = path.join(ROOT, 'client', 'src');
const srcAssets = path.join(ROOT, 'client', 'assets');
const srcModel = path.join(ROOT, 'shared', 'model.js');
const srcVenues = path.join(ROOT, 'config', 'venues');
const srcApiBrowser = path.join(srcClientSrc, 'api-browser.js');

if (!fs.existsSync(srcIndex)) fail(`client/index.html fehlt (${srcIndex})`);
if (!fs.existsSync(srcClientSrc)) fail(`client/src fehlt (${srcClientSrc})`);
if (!fs.existsSync(srcModel)) fail(`shared/model.js fehlt (${srcModel})`);

copyFile(srcIndex, path.join(OUT, 'index.html'));
note('client/index.html → index.html');

// api-browser.js NICHT mitkopieren — es wandert gleich als api.js hinein.
const nSrc = copyTree(srcClientSrc, path.join(OUT, 'src'), (name, from) =>
  name === 'api-browser.js' || name.startsWith('.') || (fs.statSync(from).isFile() && !/\.(?:js|css)$/i.test(name)));
note(`client/src → src/  (${nSrc} Dateien)`);

if (fs.existsSync(srcAssets)) {
  for (const asset of PUBLIC_ASSETS) copyFile(path.join(srcAssets, asset), path.join(OUT, 'assets', asset));
  note(`client/assets → assets/  (${PUBLIC_ASSETS.length} ausdruecklich freigegebene Dateien; sonstige Assets bleiben lokal)`);
} else {
  note('client/assets gibt es nicht — uebersprungen');
}

copyFile(srcModel, path.join(OUT, 'shared', 'model.js'));
note('shared/model.js → shared/model.js');

const venueFiles = PUBLIC_VENUES.filter((file) => fs.existsSync(path.join(srcVenues, file)));
if (!venueFiles.length) warn('In config/venues liegt keine .json — die Browser-Fassung startet ohne Venue.');
for (const file of venueFiles) {
  const target = path.join(OUT, 'config', 'venues', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const source = JSON.parse(fs.readFileSync(path.join(srcVenues, file), 'utf8'));
  fs.writeFileSync(target, `${JSON.stringify(publicVenueData(source), null, 2)}\n`, 'utf8');
}
note(`config/venues → config/venues/  (${venueFiles.length} Dateien)`);

/* three — nur die zwei gebrauchten Teile. Das Paket selbst ist 260 MB. */

const threeModule = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
const threeControls = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'controls');

if (!fs.existsSync(threeModule)) {
  fail(
    `three ist nicht installiert — ${threeModule} fehlt.`,
    'Bitte im Projektordner "npm install" ausfuehren und das Bauskript erneut starten.'
  );
}
copyFile(threeModule, path.join(OUT, 'vendor', 'three.module.js'));
note('three/build/three.module.js → vendor/three.module.js');

if (!fs.existsSync(threeControls)) {
  fail(
    `three-Controls fehlen — ${threeControls} nicht gefunden.`,
    'Die Installation von three ist unvollstaendig. Bitte "npm install" wiederholen.'
  );
}
// Nur die tatsaechlich importierten Steuerungen mitnehmen. Der controls-Ordner
// enthaelt ein gutes Dutzend Varianten (Arcball, Trackball, Fly, ...), von denen
// stage3d.js genau eine benutzt. Der Rest waere totes Gewicht auf einer Seite,
// die jemand ueber eine Mobilverbindung aufruft.
const CONTROLS_GEBRAUCHT = ['OrbitControls.js'];
const controlsZiel = path.join(OUT, 'vendor', 'three', 'addons', 'controls');
fs.mkdirSync(controlsZiel, { recursive: true });
let nControls = 0;
for (const name of CONTROLS_GEBRAUCHT) {
  const von = path.join(threeControls, name);
  if (!fs.existsSync(von)) {
    warn(`three-Steuerung ${name} nicht gefunden — die 3D-Ansicht wird nicht laufen.`);
    continue;
  }
  fs.copyFileSync(von, path.join(controlsZiel, name));
  nControls += 1;
}
note(`three/examples/jsm/controls → vendor/three/addons/controls/  (${nControls} Datei(en): ${CONTROLS_GEBRAUCHT.join(', ')})`);

/* server/ops/filtergraph.js — nur wenn es ohne node:-Importe auskommt.
   Es haengt allein an shared/model.js und ist damit browsertauglich; die
   Render-Ansicht zeigt den Filtergraph im Klartext, ohne ffmpeg zu starten. */

const srcFiltergraph = path.join(ROOT, 'server', 'ops', 'filtergraph.js');
if (fs.existsSync(srcFiltergraph)) {
  const code = fs.readFileSync(srcFiltergraph, 'utf8');
  const nodeImports = code.match(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]node:[^'"]+['"]/g) || [];
  if (nodeImports.length) {
    warn(`server/ops/filtergraph.js uebersprungen — es importiert ${nodeImports.length}× node: (${nodeImports.join(', ')})`);
  } else {
    // Ordnertiefe beibehalten: die Datei importiert ../../shared/model.js,
    // und genau dort liegt das Modell im Zielordner auch.
    copyFile(srcFiltergraph, path.join(OUT, 'server', 'ops', 'filtergraph.js'));
    note('server/ops/filtergraph.js → server/ops/filtergraph.js  (keine node:-Importe)');
  }
} else {
  note('server/ops/filtergraph.js gibt es nicht — uebersprungen');
}

/* --- 3. api.js durch api-browser.js ersetzen --------------------------- */

say('3. api.js durch die Browser-Fassung ersetzen');
if (!fs.existsSync(srcApiBrowser)) {
  fail(
    `client/src/api-browser.js fehlt (${srcApiBrowser}).`,
    'Ohne diese Datei hat die Browser-Fassung keinen Ersatz fuer die HTTP-Anbindung.'
  );
}
fs.copyFileSync(srcApiBrowser, path.join(OUT, 'src', 'api.js'));
note('client/src/api-browser.js → src/api.js  (Name bleibt api.js, alle Importe stimmen weiter)');

/* --- 4. Absolute Importe relativ machen -------------------------------- */

say('4. Absolute Importe relativ machen');

// Trifft  from '/shared/model.js'  und  import('/…') , aber nicht '//host/…'.
const ABS_IMPORT = /(from\s*|import\s*\(\s*)(['"])\/(?!\/)([^'"]*)\2/g;

let hitsShared = 0;
let hitsOther = 0;
const touchedFiles = [];

for (const file of walk(OUT)) {
  if (!file.toLowerCase().endsWith('.js')) continue;
  const before = fs.readFileSync(file, 'utf8');
  let count = 0;
  const after = before.replace(ABS_IMPORT, (whole, head, quote, spec) => {
    count += 1;
    if (spec === 'shared/model.js') hitsShared += 1; else hitsOther += 1;
    return `${head}${quote}${relativeSpecifier(file, OUT, spec)}${quote}`;
  });
  if (count) {
    fs.writeFileSync(file, after, 'utf8');
    touchedFiles.push([path.relative(OUT, file).split(path.sep).join('/'), count]);
  }
}

for (const [rel, n] of touchedFiles) note(`${rel}  (${n})`);
note(`ersetzt: ${hitsShared}× '/shared/model.js', ${hitsOther}× andere absolute Importe`);
if (hitsShared !== EXPECTED_ABS_IMPORTS) {
  warn(`Erwartet waren ${EXPECTED_ABS_IMPORTS} Stellen mit '/shared/model.js', gefunden wurden ${hitsShared}. `
    + 'Entweder hat sich der Quelltext geaendert, oder es ist eine Stelle durchgerutscht — bitte pruefen.');
}
if (hitsOther) {
  note('Die anderen absoluten Importe wurden mitgezogen; sie waeren auf Pages ebenfalls ins Leere gelaufen.');
}

/* --- 5. index.html anpassen -------------------------------------------- */

say('5. index.html anpassen');

const outIndex = path.join(OUT, 'index.html');
let html = fs.readFileSync(outIndex, 'utf8');

/* a) import map und der Einstiegspunkt: absolute Pfade → relative Pfade */

const beforeMap = html;
html = html.replace(/(["'])\/vendor\//g, '$1./vendor/');
if (html === beforeMap) warn('In index.html wurde kein "/vendor/…" gefunden — stimmt die import map noch?');
else note('import map: "three" → ./vendor/three.module.js, "three/addons/" → ./vendor/three/addons/');

// Das Modul-Skript selbst ist ebenfalls absolut verlinkt (src="/src/main.js")
// und wuerde unter einem Unterpfad nicht laden.
const beforeEntry = html;
html = html.replace(/(<script\b[^>]*\bsrc=["'])\/(?!\/)/g, '$1./');
if (html !== beforeEntry) note('Einstiegsskript: src="/src/main.js" → src="./src/main.js"');

// Restliche absolute Verweise im Markup (href/src) einsammeln, falls spaeter
// welche dazukommen.
const restAbs = html.match(/\b(?:href|src)=["']\/(?!\/)/g) || [];
if (restAbs.length) warn(`${restAbs.length} weitere absolute href/src in index.html — die brechen auf GitHub Pages.`);

/* b) data-mode="browser" am <html>-Element */

if (/<html\b[^>]*\bdata-mode=/i.test(html)) {
  note('data-mode war schon gesetzt');
} else if (/<html\b/i.test(html)) {
  html = html.replace(/<html\b/i, '<html data-mode="browser"');
  note('<html data-mode="browser"> gesetzt');
} else {
  warn('Kein <html>-Element gefunden — data-mode konnte nicht gesetzt werden.');
}

/* c) window.__TBG_MODE vor dem ersten Modul-Skript */

const modeBlock = [
  '<!-- Betriebsart. Wird vom Bauskript gesetzt; die Desktop-Fassung hat das nicht. -->',
  '<script>window.__TBG_MODE = \'browser\';</script>',
  '',
].join('\n');

const firstModule = html.search(/<script\b[^>]*\btype=["']module["']/i);
if (firstModule >= 0) {
  html = html.slice(0, firstModule) + modeBlock + html.slice(firstModule);
  note("window.__TBG_MODE = 'browser' vor dem ersten Modul-Skript eingesetzt");
} else {
  warn('Kein Modul-Skript gefunden — window.__TBG_MODE wurde nicht gesetzt.');
}

/* d) Hinweisband ueber der Kopfzeile */

const linkMarkup = '<span class="tbgHintLink dim">Export: Desktop-Fassung auf dem eigenen Rechner</span>';

const hintMarkup = `
  <!-- ====================================================== Hinweisband -->
  <!-- Vom Bauskript eingesetzt (tools/build-web.js). Sagt einmal ruhig, was
       diese Fassung kann und was nicht, und laesst sich dauerhaft wegklicken. -->
  <div id="tbgHint" role="note">
    <span class="tbgHintTxt">Browser-Fassung — zum Planen und Zeigen.
      Rendern und Ausliefern brauchen ffmpeg auf dem eigenen Rechner.
      Raumgeometrie und Fahrwege der Vorlagen enthalten Annahmen; kein bestätigtes Hausaufmaß.</span>
    ${linkMarkup}
    <button id="tbgHintClose" class="tbgHintClose" type="button"
            title="Hinweis ausblenden" aria-label="Hinweis ausblenden">✕</button>
  </div>
  <script>
  (function () {
    // Die Entscheidung des Nutzers ueberlebt das Neuladen. Ist localStorage
    // gesperrt (privater Modus, strenge Einstellungen), bleibt das Band eben
    // stehen — das ist harmlos und besser als ein Fehler beim Start.
    var KEY = 'tbg.hint.browser.hidden';
    var root = document.documentElement;
    try { if (localStorage.getItem(KEY) === '1') root.classList.add('tbg-hint-off'); } catch (e) {}
    var btn = document.getElementById('tbgHintClose');
    if (btn) btn.addEventListener('click', function () {
      root.classList.add('tbg-hint-off');
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
      window.dispatchEvent(new Event('resize'));
    });
  })();
  </script>
`;

if (/<header\b[^>]*\bid=["']topbar["']/i.test(html)) {
  html = html.replace(/(\n?[ \t]*)(<!--[^>]*-->\s*)?(<header\b[^>]*\bid=["']topbar["'])/i,
    (whole, indent, comment, header) => `${hintMarkup}\n${indent || '\n  '}${comment || ''}${header}`);
  note('Hinweisband mit Desktop- und Annahmen-Hinweis eingesetzt; kein Link auf private Releases');
} else {
  warn('Kopfzeile #topbar nicht gefunden — das Hinweisband wurde nicht eingesetzt.');
}

/* e) CSS: Band gestalten, Render- und QC-Knopf ausblenden.
      Die Ansichten selbst bleiben im HTML — so bleibt eine Datei fuer beide
      Betriebsarten, und die Desktop-Fassung sieht davon nichts, weil alle
      Regeln an data-mode="browser" haengen. */

const extraCss = `
/* ============================================ Browser-Fassung (build-web.js)
   Alles hier haengt an html[data-mode="browser"]. Ohne das Attribut — also in
   der Desktop-Fassung — ist dieser Block wirkungslos. */

/* Das Band ist eine zusaetzliche Rasterzeile ueber der Kopfzeile. Wird es
   weggeklickt, faellt die Zeile wieder weg; display:none allein reicht nicht,
   weil ein ausgeblendetes Kind kein Rasterelement mehr ist und die uebrigen
   Kinder dann in die falschen Zeilen rutschen. */
html[data-mode="browser"] #app{grid-template-rows:auto auto 1fr auto}
html[data-mode="browser"].tbg-hint-off #app{grid-template-rows:auto 1fr auto}
html[data-mode="browser"].tbg-hint-off #tbgHint{display:none}

#tbgHint{
  display:flex;align-items:center;gap:10px;padding:5px 10px;
  background:#141a24;border-bottom:1px solid var(--ln);
  color:var(--fg);font-size:12px;line-height:1.4;
}
#tbgHint .tbgHintTxt{flex:1 1 auto;min-width:0}
#tbgHint .tbgHintLink{color:var(--acc);white-space:nowrap}
#tbgHint .tbgHintLink:hover{text-decoration:underline}
#tbgHint .tbgHintClose{
  flex:0 0 auto;background:transparent;border:1px solid transparent;color:var(--dim);
  border-radius:3px;cursor:pointer;font:13px "Segoe UI",system-ui;padding:1px 7px;
}
#tbgHint .tbgHintClose:hover{color:var(--fg);border-color:var(--ln)}

/* Render und QC brauchen ffmpeg. Die Ansichten bleiben im HTML stehen, nur
   ihre Knoepfe verschwinden — so gibt es keine toten Wege in der Oberflaeche. */
html[data-mode="browser"] #viewSwitch [data-view="render"],
html[data-mode="browser"] #viewSwitch [data-view="qc"]{display:none}
`;

const styleEnd = html.lastIndexOf('</style>');
if (styleEnd >= 0) {
  html = html.slice(0, styleEnd) + extraCss + html.slice(styleEnd);
  note('CSS ergaenzt: Hinweisband, Render- und QC-Knopf ausgeblendet');
} else {
  warn('Kein </style> in index.html gefunden — das CSS der Browser-Fassung fehlt.');
}

fs.writeFileSync(outIndex, html, 'utf8');

/* --- 6. Statische Beiwerke --------------------------------------------- */

say('6. Statische Beiwerke schreiben');

// Ohne .nojekyll ignoriert GitHub Pages jeden Ordner, der mit _ beginnt.
fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');
note('.nojekyll');

const venueIndex = { venues: venueFiles };
fs.writeFileSync(
  path.join(OUT, 'config', 'venues', 'index.json'),
  `${JSON.stringify(venueIndex, null, 2)}\n`,
  'utf8'
);
note(`config/venues/index.json  (${venueFiles.length} Einträge)`);

const html404 = `<!doctype html>
<html lang="de" data-mode="browser">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nicht gefunden — Theater-Bild-Gelöte</title>
<style>
html,body{height:100%;margin:0}
body{
  background:#0b0d12;color:#c9d3e0;
  font:14px/1.55 "Segoe UI",system-ui,-apple-system,sans-serif;
  display:flex;align-items:center;justify-content:center;padding:24px;
}
.box{max-width:520px}
h1{font-size:19px;margin:0 0 10px;color:#ff2e88}
p{margin:0 0 10px;color:#c9d3e0}
a{color:#ff2e88}
code{font:12px "Cascadia Mono","Consolas",ui-monospace,monospace;color:#6b7787}
</style>
</head>
<body>
<div class="box">
  <h1>Diese Seite gibt es hier nicht</h1>
  <p>Die Browser-Fassung von Theater-Bild-Gelöte besteht aus einer einzigen Seite.
     Wahrscheinlich ist die Adresse verschrieben oder ein alter Link.</p>
  <p><a href="${escapeHtml(BASE)}">Zurück zur Startseite</a></p>
  <p><code>${escapeHtml(BASE)}</code></p>
</div>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, '404.html'), html404, 'utf8');
note('404.html');

const liesmich = `Theater-Bild-Gelöte — Browser-Fassung
=====================================

Das hier ist die statische Fassung des Werkzeugs. Sie läuft vollständig im
Browser: Adresse aufrufen, arbeiten. Kein Node, kein Server, keine
Installation. Es rechnet der Rechner, der die Seite geöffnet hat — es werden
keine Daten irgendwohin geschickt.

Gebaut am ${new Date().toISOString().slice(0, 10)} aus Version ${pkg.version} mit tools/build-web.js.


WAS HIER GEHT
-------------
  * 3D-Bühne mit Wänden, Panels und Fahrweg
  * Panel-Editor
  * Venue-Verwaltung (Häuser, Wände, Panels anlegen und ändern)
  * Projektplanung
  * Naht- und Sperrzonenprüfung, Sichtgrenzen
  * Panels von Hand fahren
  * Vorschau von Videos, die der Browser selbst abspielen kann
    (H.264/MP4, WebM). HAP, ProRes und MPEG-2 kann er nicht.


WAS HIER NICHT GEHT
-------------------
Rendern, Conform, Proxies, technische QC und das Erzeugen einzelner
Paneldateien sind in dieser Fassung nicht enthalten. Diese Funktionen
benutzen ffmpeg in der lokalen Anwendung; auf GitHub Pages gibt es
keinen Renderdienst.

Die Browser-Fassung ist zum PLANEN und ZEIGEN da. Fuer das Ausliefern muss
die Desktop-Fassung mit ffmpeg auf dem eigenen Rechner vorhanden sein.
Diese oeffentliche Seite bietet keinen Desktop-Download an.

Die Venue-Vorlagen enthalten Annahmen zu Raumgeometrie und Fahrwegen.
Sie sind kein bestaetigtes Hausaufmass. Produktionsbilder und Original-PDFs
werden nicht mit dieser Browser-Fassung veroeffentlicht.


BROWSER
-------
Chrome und Edge, aktuelle Fassung. Beide können die File System Access API,
mit der Projekte und Venues direkt in einen Ordner auf der Platte geschrieben
werden.

Firefox und Safari können das nicht. Die Oberfläche sagt das beim Start —
sie scheitert nicht still.


VERÖFFENTLICHEN
---------------
Den gesamten Inhalt dieses Ordners unverändert in den Zweig gh-pages legen
(oder in /docs auf dem Hauptzweig) und GitHub Pages darauf zeigen lassen.

Die Datei .nojekyll muss mit. Ohne sie ignoriert GitHub Pages jeden Ordner,
dessen Name mit einem Unterstrich beginnt.

Alle Pfade in dieser Fassung sind relativ. Der Ordner funktioniert deshalb
unter jedem Unterpfad — auch unter https://name.github.io/repo/.


ORDNER
------
  index.html            die Anwendung, eine einzige Seite
  src/                  der Programmcode (api.js ist hier die Browser-Fassung)
  shared/model.js       das gemeinsame Datenmodell
  config/venues/        mitgelieferte Häuser, dazu index.json als Verzeichnis
  vendor/               three.js und OrbitControls
  404.html              Rückweg zur Startseite
  .nojekyll             siehe oben
`;
fs.writeFileSync(path.join(OUT, 'LIESMICH.txt'), liesmich, 'utf8');
note('LIESMICH.txt');

/* --- 7. Uebersicht ------------------------------------------------------ */

const files = walk(OUT).map((f) => ({
  rel: path.relative(OUT, f).split(path.sep).join('/'),
  size: fs.statSync(f).size,
}));
const total = files.reduce((n, f) => n + f.size, 0);
const biggest = [...files].sort((a, b) => b.size - a.size).slice(0, 5);

say('');
say('Übersicht');
say(`  Dateien           : ${files.length}`);
say(`  Gesamtgröße       : ${formatSize(total)}`);
say(`  Ersetzte absolute Importe: ${hitsShared + hitsOther}  `
  + `(davon '/shared/model.js': ${hitsShared} von erwarteten ${EXPECTED_ABS_IMPORTS})`);
say('  Die fünf größten Dateien:');
for (const f of biggest) say(`    ${formatSize(f.size).padStart(9)}  ${f.rel}`);

if (warnings.length) {
  say('');
  say(`Warnungen (${warnings.length}):`);
  for (const w of warnings) say(`  ! ${w}`);
}

say('');
if (warnings.length && args.strict) {
  say(`ABBRUCH: ${warnings.length} Warnung(en) und --strict ist gesetzt.`);
  say('Die Seite wurde gebaut, gilt aber als nicht veröffentlichungsreif.');
  process.exit(1);
}
say(`Fertig. Der Ordner ${OUT} kann unverändert auf GitHub Pages.`);
