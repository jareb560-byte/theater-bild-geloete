/**
 * Theater-Bild-Gelöte - Programmverzeichnis, Arbeitsverzeichnis und Pfadhelfer.
 *
 * ---------------------------------------------------------------------------
 * ZWEI GETRENNTE ORTE
 * ---------------------------------------------------------------------------
 *   PROGRAMM   dort, wo dieser Quelltext liegt. Nach einer Installation per
 *              npm ist das ein Ordner unter node_modules/ - schreibgeschuetzt
 *              und bei jedem Update weg. Dort liegen client/, shared/,
 *              config/venues/ (die mitgelieferten BEISPIEL-Venues) und diese
 *              Datei. Wir schreiben da NICHTS hinein.
 *
 *   WORKSPACE  dort, wo die Daten des Nutzers liegen. Er bestimmt den Ort:
 *                1. --workspace <pfad>
 *                2. Umgebungsvariable TBG_HOME
 *                3. <home>/theater-bild-geloete
 *              Darin: projects/ venues/ cache/ proxies/ thumbs/ out/ bin/
 *
 * ---------------------------------------------------------------------------
 * WARUM initPaths() MUTIERT UND NICHT NEU ZUWEIST
 * ---------------------------------------------------------------------------
 * server/ops/*.js und server/probe.js importieren `paths` als Objekt und lesen
 * daraus paths.out, paths.cache, paths.proxies. Wuerde initPaths() eine neue
 * Objektinstanz an `paths` binden, zeigten alle bereits erledigten Importe
 * stillschweigend weiter auf das alte Objekt. Deshalb bleibt `paths` dieselbe
 * Instanz und initPaths() setzt nur ihre FELDER.
 *
 * Die einzelnen Exporte (binDir, cacheDir, ...) sind `let` - in ESM sind
 * Importe lebende Bindungen, eine Zuweisung hier ist beim Importeur sofort
 * sichtbar, solange er den Wert erst zur Laufzeit in einer Funktion liest.
 *
 * ---------------------------------------------------------------------------
 * SELBSTSTART BEIM IMPORT
 * ---------------------------------------------------------------------------
 * ESM zieht alle Importe hoch: der Rumpf von server/index.js laeuft NACH den
 * Rumpfen aller importierten Module. Ein `initPaths()` in index.js kaeme also
 * zu spaet fuer jedes Modul, das beim Laden schon einen Pfad festhaelt.
 * Darum initialisiert sich dieses Modul beim Import selbst - mit genau
 * derselben Reihenfolge (CLI, Umgebung, Home). Ein spaeteres initPaths() mit
 * demselben Ziel ist ein No-op; mit einem anderen Ziel schaltet es um.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ==========================================================================
 * Programmverzeichnis - fest, nie beschreibbar angenommen
 * ========================================================================== */

/** Programmwurzel = studio/ bzw. das installierte Paket (eine Ebene ueber server/). */
export const root = path.resolve(here, '..');

export const configDir = path.join(root, 'config');
export const clientDir = path.join(root, 'client');
export const sharedDir = path.join(root, 'shared');
export const nodeModulesDir = path.join(root, 'node_modules');

/**
 * Mitgelieferte Beispiel-Venues. VORLAGEN, keine Nutzerdaten - hier wird
 * nur gelesen. Eigene Venues des Nutzers liegen in <workspace>/venues/.
 */
export const builtinVenuesDir = path.join(configDir, 'venues');

/**
 * Alter Name, den server/venues.js importiert. Er zeigt weiterhin auf die
 * mitgelieferten Vorlagen, damit das Laden der Beispiel-Venues unveraendert
 * funktioniert. Die Nutzer-Venues liegen unter userVenuesDir bzw. paths.venues
 * und werden von server/routes/venues.js bedient.
 */
export const venuesDir = builtinVenuesDir;

/** ffmpeg, das frueher im Programmordner lag - siehe adoptLegacyBin(). */
const legacyBinDir = path.join(root, 'bin');

/* ==========================================================================
 * Arbeitsverzeichnis - wird von initPaths() gesetzt
 * ========================================================================== */

/** Standardname des Arbeitsverzeichnisses unterhalb des Benutzerordners. */
export const WORKSPACE_DIR_NAME = 'theater-bild-geloete';

/** Name der Umgebungsvariable, die das Arbeitsverzeichnis vorgibt. */
export const WORKSPACE_ENV = 'TBG_HOME';

export let workspace = '';
export let projectsDir = '';
export let userVenuesDir = '';
export let binDir = '';
export let cacheDir = '';
export let proxiesDir = '';
export let thumbsDir = '';
export let outDir = '';

/** Autosave-Ziel: <workspace>/projects/project.tbg.json. */
export let projectFile = '';

/** Probe-Cache, siehe server/probe.js. */
export let probeCacheFile = '';

/** Verzeichnisse, die beim Start existieren muessen. */
export let workDirs = [];

/**
 * Alles auf einen Blick.
 *
 * DIESE INSTANZ WIRD NIE ERSETZT. initPaths() schreibt nur ihre Felder neu.
 * Wer `import { paths }` schreibt, behaelt darum immer den aktuellen Stand.
 */
export const paths = {
  // Programm
  root,
  config: configDir,
  client: clientDir,
  shared: sharedDir,
  nodeModules: nodeModulesDir,
  builtinVenues: builtinVenuesDir,
  // Arbeitsverzeichnis - unten von initPaths() gefuellt
  workspace: '',
  projects: '',
  venues: '',
  bin: '',
  cache: '',
  proxies: '',
  thumbs: '',
  out: '',
  projectFile: '',
  probeCache: '',
};

/* ==========================================================================
 * Helfer, die nicht vom Arbeitsverzeichnis abhaengen
 * ========================================================================== */

/**
 * Legt ein Verzeichnis an, falls es fehlt. Idempotent, rekursiv.
 * Gibt den Pfad zurueck, damit man den Aufruf inline benutzen kann.
 */
export function ensureDir(p) {
  if (!p) throw new Error('ensureDir wurde ohne Pfad aufgerufen');
  const abs = path.resolve(p);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

/**
 * Liegt p innerhalb von base (oder ist base selbst)?
 * Auf Windows case-unempfindlich, weil das Dateisystem es auch ist.
 */
export function isInside(base, p) {
  if (!base || !p) return false;
  let a = path.resolve(base);
  let b = path.resolve(p);
  if (process.platform === 'win32') {
    a = a.toLowerCase();
    b = b.toLowerCase();
  }
  const rel = path.relative(a, b);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Haengt einen relativen Pfad an base an und stellt sicher, dass das Ergebnis
 * base nicht verlaesst. Wirft sonst - so kommt kein "../../" aus einer
 * HTTP-Anfrage an Dateien, die niemanden etwas angehen.
 */
export function safeJoin(base, rel) {
  const b = path.resolve(base);
  const clean = String(rel ?? '')
    .replace(/^[\\/]+/, '')
    .replace(/\0/g, '');
  if (path.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) {
    throw new Error(`Absoluter Pfad ist hier nicht erlaubt: ${rel}`);
  }
  const joined = path.resolve(b, clean);
  if (!isInside(b, joined)) {
    throw new Error(`Pfad verlaesst das erlaubte Verzeichnis: ${rel}`);
  }
  return joined;
}

/* ==========================================================================
 * Arbeitsverzeichnis bestimmen
 * ========================================================================== */

/** "~" bzw. "~/unterordner" auf den Benutzerordner aufloesen. */
function expandHome(p) {
  const s = String(p).trim();
  if (s === '~') return os.homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(os.homedir(), s.slice(2));
  return s;
}

/**
 * Liest --workspace aus einer Argumentliste.
 * Erlaubt sind "--workspace <pfad>", "--workspace=<pfad>" und "-w <pfad>".
 */
export function workspaceFromArgv(argv = process.argv) {
  for (let i = 2; i < argv.length; i += 1) {
    const a = String(argv[i]);
    if (a === '--workspace' || a === '-w') {
      const next = argv[i + 1];
      if (next && !String(next).startsWith('-')) return String(next);
      return null;
    }
    if (a.startsWith('--workspace=')) {
      const v = a.slice('--workspace='.length);
      return v || null;
    }
  }
  return null;
}

/**
 * Erster Treffer aus: ausdruecklicher Wert, CLI-Schalter, Umgebungsvariable,
 * <home>/theater-bild-geloete. Das Ergebnis ist immer ein absoluter Pfad.
 */
export function resolveWorkspace(explicit) {
  const candidates = [
    explicit,
    workspaceFromArgv(),
    process.env[WORKSPACE_ENV],
    path.join(os.homedir() || root, WORKSPACE_DIR_NAME),
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const s = expandHome(c);
    if (s === '') continue;
    return path.resolve(s);
  }
  // Kann eigentlich nicht passieren - os.homedir() liefert notfalls root.
  return path.resolve(root, WORKSPACE_DIR_NAME);
}

/**
 * Quelle des aktuellen Arbeitsverzeichnisses, im Klartext fuer Doctor und UI.
 */
export function workspaceSource() {
  if (workspaceFromArgv()) return 'cli';
  if (process.env[WORKSPACE_ENV]) return 'env';
  return 'home';
}

/* ==========================================================================
 * Initialisierung
 * ========================================================================== */

let legacyBinAdopted = false;

/**
 * Pfad des alten ffmpeg im Programmordner, sofern es dort liegt und in den
 * PATH aufgenommen wurde - sonst null. server/index.js und doctor.js melden
 * das beim Start. Hier wird bewusst NICHT geloggt: `Theater-Bild-Gelöte --version` soll
 * nicht mit Pfadmeldungen anfangen.
 */
export let legacyBin = null;

/**
 * Frueher lag ffmpeg im Programmordner unter bin/. Jetzt gehoert es ins
 * Arbeitsverzeichnis. Damit eine bestehende Installation nicht ploetzlich
 * ohne ffmpeg dasteht, wird der alte Ordner vorn an den PATH gehaengt -
 * server/ffmpeg.js findet ihn dann als Quelle "path".
 */
function adoptLegacyBin() {
  if (legacyBinAdopted) return;
  const exe = process.platform === 'win32' ? '.exe' : '';
  let hasFfmpeg = false;
  try {
    hasFfmpeg = fs.statSync(path.join(legacyBinDir, `ffmpeg${exe}`)).isFile();
  } catch {
    hasFfmpeg = false;
  }
  legacyBinAdopted = true;
  if (!hasFfmpeg) return;

  const current = process.env.PATH || process.env.Path || '';
  const parts = current.split(path.delimiter);
  const already = parts.some((d) => d && isInside(legacyBinDir, d) && isInside(d, legacyBinDir));
  if (!already) {
    process.env.PATH = [legacyBinDir, current].filter(Boolean).join(path.delimiter);
  }
  legacyBin = legacyBinDir;
}

/**
 * Legt alle Arbeitsverzeichnisse an. Idempotent.
 * Liefert die Liste der Ordner, die neu entstanden sind.
 * Fehler werden geloggt UND als Liste gemeldet - nichts scheitert still.
 */
export function ensureAllDirs() {
  const created = [];
  const failed = [];
  for (const d of workDirs) {
    if (!d) continue;
    try {
      if (!fs.existsSync(d)) created.push(d);
      ensureDir(d);
    } catch (err) {
      failed.push({ dir: d, message: err.message });
      console.error(
        `[paths] Verzeichnis konnte nicht angelegt werden: ${d}\n        ${err.message}`
      );
    }
  }
  if (failed.length > 0) {
    console.error(
      `[paths] ${failed.length} Arbeitsverzeichnis(se) fehlen. Theater-Bild-Gelöte kann so nicht ` +
        'schreiben. Anderes Arbeitsverzeichnis waehlen: --workspace <pfad> oder ' +
        `${WORKSPACE_ENV}=<pfad>.`
    );
  }
  created.failed = failed;
  return created;
}

let initialized = false;

/**
 * Arbeitsverzeichnis festlegen und alle Ordner anlegen.
 *
 * opts:
 *   workspace   ausdruecklicher Pfad; sonst CLI/Umgebung/Home
 *   create      Ordner anlegen (Standard true)
 *
 * Wird beim Import dieses Moduls automatisch einmal gerufen. Ein weiterer
 * Aufruf mit demselben Ziel aendert nichts; mit einem anderen Ziel schaltet
 * er zur Laufzeit um (POST /api/workspace).
 */
export function initPaths({ workspace: wanted, create = true } = {}) {
  const target = resolveWorkspace(wanted);

  if (initialized && target === workspace) {
    if (create) ensureAllDirs();
    return paths;
  }

  workspace = target;
  projectsDir = path.join(workspace, 'projects');
  userVenuesDir = path.join(workspace, 'venues');
  cacheDir = path.join(workspace, 'cache');
  proxiesDir = path.join(workspace, 'proxies');
  thumbsDir = path.join(workspace, 'thumbs');
  outDir = path.join(workspace, 'out');
  binDir = path.join(workspace, 'bin');

  projectFile = path.join(projectsDir, 'project.tbg.json');
  probeCacheFile = path.join(cacheDir, 'probe.json');

  workDirs = [projectsDir, userVenuesDir, cacheDir, proxiesDir, thumbsDir, outDir, binDir];

  // NUR Felder setzen - die Objektinstanz bleibt dieselbe, sonst zeigen alle
  // bereits erledigten Importe auf einen alten Stand.
  paths.workspace = workspace;
  paths.projects = projectsDir;
  paths.venues = userVenuesDir;
  paths.bin = binDir;
  paths.cache = cacheDir;
  paths.proxies = proxiesDir;
  paths.thumbs = thumbsDir;
  paths.out = outDir;
  paths.projectFile = projectFile;
  paths.probeCache = probeCacheFile;

  if (create) ensureAllDirs();
  adoptLegacyBin();

  initialized = true;
  return paths;
}

/**
 * Aktueller Stand. Gibt bewusst die LEBENDE Instanz zurueck, damit ein
 * spaeterer Wechsel des Arbeitsverzeichnisses ueberall ankommt.
 */
export function getPaths() {
  if (!initialized) initPaths();
  return paths;
}

/** Wurde initPaths() schon gerufen? */
export function isInitialized() {
  return initialized;
}

/* ==========================================================================
 * Plattenplatz
 * ========================================================================== */

/**
 * Freier Platz in Bytes auf dem Dateisystem von p, oder null.
 * fs.statfsSync gibt es erst ab Node 18.15 - darum die Notwege pro Plattform.
 */
export function freeBytes(p) {
  const target = path.resolve(p || workspace || root);

  if (typeof fs.statfsSync === 'function') {
    try {
      const s = fs.statfsSync(target);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      /* faellt unten auf die Plattformwege zurueck */
    }
  }

  if (process.platform === 'win32') {
    const letter = path.parse(target).root.replace(/[:\\/]/g, '');
    if (!letter) return null;
    try {
      const res = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-PSDrive -Name ${letter} -ErrorAction Stop).Free`,
        ],
        { encoding: 'utf8', windowsHide: true }
      );
      if (res.status === 0) {
        const n = Number.parseInt(String(res.stdout).trim(), 10);
        if (Number.isFinite(n)) return n;
      }
    } catch {
      /* PowerShell nicht vorhanden - dann eben null */
    }
    return null;
  }

  // macOS und Linux: df liefert 1-KiB-Bloecke in der vierten Spalte.
  try {
    const res = spawnSync('df', ['-Pk', target], { encoding: 'utf8' });
    if (res.status === 0) {
      const line = String(res.stdout).trim().split(/\r?\n/).pop() || '';
      const cols = line.split(/\s+/);
      const avail = Number.parseInt(cols[3], 10);
      if (Number.isFinite(avail)) return avail * 1024;
    }
  } catch {
    /* kein df - dann eben null */
  }
  return null;
}

/* ==========================================================================
 * Selbststart
 * ========================================================================== */

try {
  initPaths();
} catch (err) {
  console.error(
    `[paths] Arbeitsverzeichnis konnte nicht eingerichtet werden: ${err.message}\n` +
      `        Abhilfe: --workspace <pfad> oder ${WORKSPACE_ENV}=<pfad> setzen.`
  );
  throw err;
}

export default paths;
