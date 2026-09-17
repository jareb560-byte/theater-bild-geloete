/**
 * Theater-Bild-Gelöte — Einstiegsassistent fuer den ersten Start.
 *
 * Wer Theater-Bild-Gelöte zum ersten Mal oeffnet, soll nicht vor einer leeren Oberflaeche
 * stehen und raten muessen. Der Assistent fuehrt in sechs Schritten durch
 * Arbeitsverzeichnis, ffmpeg, Venue und Projekt.
 *
 * ---------------------------------------------------------------------------
 * GRUNDSAETZE
 * ---------------------------------------------------------------------------
 *   - Er aendert NICHTS von allein. Kein Download, kein Anlegen, kein
 *     Ueberschreiben ohne Klick des Nutzers. Gelesen wird (Zustand, Venues,
 *     Projektliste), geschrieben nur auf ausdrueckliche Aktion.
 *   - Er ist jederzeit abbrechbar: Escape, das X oben rechts, "Spaeter".
 *     Danach ist der Zustand derselbe wie vorher.
 *   - Jeder gefangene Fehler wird geloggt UND im Dialog im Klartext gezeigt.
 *     Die Statuszeile liegt hinter dem Overlay und reicht als Meldeweg nicht.
 *
 * ---------------------------------------------------------------------------
 * EINBINDUNG (so macht es main.js)
 * ---------------------------------------------------------------------------
 *   const onboarding = createOnboarding({
 *     root,                 // Behaelter, in den el gehaengt wird (optional)
 *     onOpenVenueEditor,    // (venueId|null) => void
 *     onStatus,             // (text, level) => void   (optional)
 *     onError,              // (prefix, err) => void   (optional)
 *     onClose,              // () => void              (optional)
 *   });
 *   onboarding.onOpenVenueEditor = fn;   // geht auch als Eigenschaft
 *   if (onboarding.shouldShow(store.get())) onboarding.open();
 *
 * `el` ist ein eigenes Overlay (position:fixed, z-index 40) und NICHT der
 * Dialogstapel aus dom.js. Das ist Absicht: der Ordnerwaehler aus library.js
 * benutzt #overlayRoot mit z-index 50 und legt sich damit sauber ueber den
 * Assistenten, statt ihn zu verdraengen.
 *
 * update(state) gibt es laut Vertrag; zusaetzlich haengt sich der Assistent
 * selbst an den Store, damit der Fortschritt des ffmpeg-Downloads auch dann
 * mitlaeuft, wenn niemand update() aufruft.
 */

import { h, on, clear, copyButton } from '../dom.js';
import {
  getHealth, installFfmpeg, listVenues, getVenue, getWorkspace, setWorkspace,
  listProjects, newProject, openProject, putProject,
} from '../api.js';
import { store, setStatus, showError, flushSave, isDirty } from '../store.js';
import { pickPath } from './library.js';
import { ffmpegLevel, ffmpegSummary } from './setup.js';
import {
  t, tn, register, onLangChange, setLang, getLang, LANGUAGES, fmtNum, fmtBytes,
} from '../i18n.js';

register('en', {
  'Projekt konnte nicht gespeichert werden': 'The project could not be saved',
  // ---------------------------------------------------------------- Rahmen
  'Erste Schritte mit Theater-Bild-Gelöte': 'Getting started with Theater-Bild-Gelöte',
  'Schritt {n} von {total}': 'Step {n} of {total}',
  'Assistent schließen': 'Close the assistant',
  'Willkommen': 'Welcome',
  'Arbeitsverzeichnis': 'Working folder',
  'Projekt': 'Project',
  'Fertig': 'Done',
  'Zurück': 'Back',
  'Weiter': 'Next',
  'Später': 'Later',
  'Los geht’s': 'Start working',
  'Der Assistent konnte sich nicht auffrischen': 'The assistant could not refresh itself',
  '{what} ist fehlgeschlagen': '{what} failed',
  'Erneut versuchen': 'Try again',
  'unbekannt': 'unknown',
  'Sprache': 'Language',

  // ---------------------------------------------------------------- Schritt 1
  'Theater-Bild-Gelöte bespielt LED-Wände, die aus mehreren Teilen bestehen: eine Wand je Fläche, ein Slot je Panel, darauf beliebig viele Layer.':
    'Theater-Bild-Gelöte puts content on LED walls built from several parts: one wall per surface, one slot per panel, and as many layers on top as you need.',
  'In der 3D-Ansicht prüfst du vor dem Rendern, wie das Ergebnis vom Zuschauerraum aus wirkt — auch dann, wenn die Wandteile auffahren und die Wand dahinter freigeben.':
    'The 3D view shows you how the result reads from the audience before you render — including the moment the wall sections travel apart and reveal the wall behind them.',
  'Zum Schluss liefert Theater-Bild-Gelöte fertige Dateien im Format des Hauses aus, mit Prüfbericht und im Klartext sichtbarem ffmpeg-Befehl.':
    'Finally Theater-Bild-Gelöte delivers finished files in the venue’s own format, with a QC report and the ffmpeg command visible in plain text.',
  'Schaubild: vier hintereinanderliegende LED-Wände, deren Teile nach außen auffahren.':
    'Diagram: four LED walls one behind the other, their sections travelling outwards.',
  'Zuschauer': 'Audience',
  'Vier Wände hintereinander: A steht vorn an der Rampe, D ganz hinten. Fahren die vorderen Teile nach außen, wird der Blick nach hinten frei.':
    'Four walls one behind the other: A stands downstage at the edge, D right at the back. When the front sections travel outwards they open up the view to the rear.',
  'Der Assistent ändert nichts von allein: Er lädt nichts herunter und legt nichts an, solange du es nicht anstößt.':
    'The assistant changes nothing on its own: it downloads nothing and creates nothing unless you start it.',

  // ---------------------------------------------------------------- Schritt 2
  'Hier legt Theater-Bild-Gelöte seine eigenen Dateien ab: Projektdatei, Proxies, Miniaturbilder, Renderergebnisse und Prüfberichte.':
    'This is where Theater-Bild-Gelöte keeps its own files: project file, proxies, thumbnails, render results and QC reports.',
  'Dein Videomaterial wird NICHT hierher kopiert. Theater-Bild-Gelöte merkt sich nur den Pfad zur Quelldatei und liest sie dort, wo sie liegt.':
    'Your footage is NOT copied here. Theater-Bild-Gelöte only remembers the path to the source file and reads it where it lies.',
  // „Ordner" und „Arbeitsverzeichnis" meldet setup.js schon an; register()
  // ueberschreibt nichts, deshalb steht hier „Pfad" als eindeutige Beschriftung.
  'Pfad': 'Path',
  'Pfad zum Arbeitsverzeichnis': 'Path to the working folder',
  'Blättern …': 'Browse …',
  'Speichern': 'Save',
  'Wird gespeichert …': 'Saving …',
  'Ordner für die Arbeitsdateien': 'Folder for the working files',
  'Freier Platz': 'Free space',
  'Der Server hat den freien Plattenplatz nicht mitgeliefert.':
    'The server did not report the free disk space.',
  'Weniger als {min} frei. Ein einziger HAP-Loop einer großen Wand belegt schnell mehrere Gigabyte — nimm besser ein Laufwerk mit mehr Luft.':
    'Less than {min} free. A single HAP loop for a large wall easily runs to several gigabytes — better pick a drive with more headroom.',
  'Diese Ordner benutzt Theater-Bild-Gelöte darin:': 'These are the folders Theater-Bild-Gelöte uses inside it:',
  'Projekte': 'Projects',
  'Ausgabe': 'Output',
  'Proxies': 'Proxies',
  'Miniaturbilder': 'Thumbnails',
  'Zwischenspeicher': 'Cache',
  'Venues': 'Venues',
  'ffmpeg-Ordner': 'ffmpeg folder',
  'Der Pfad kommt aus dem Aufruf (--workspace). Beim nächsten Start gilt wieder der Wert von dort.':
    'This path comes from the command line (--workspace). On the next start the value from there applies again.',
  'Der Pfad kommt aus einer Umgebungsvariablen. Beim nächsten Start gilt wieder der Wert von dort.':
    'This path comes from an environment variable. On the next start the value from there applies again.',
  'Das Arbeitsverzeichnis konnte nicht gelesen werden': 'The working folder could not be read',
  'Das Arbeitsverzeichnis konnte nicht gespeichert werden': 'The working folder could not be saved',
  'Arbeitsverzeichnis gespeichert: {path}': 'Working folder saved: {path}',
  'Erst einen Ordner angeben.': 'Enter a folder first.',
  'Wird gelesen …': 'Reading …',

  // ---------------------------------------------------------------- Schritt 3
  'ffmpeg ist das Werkzeug, mit dem Theater-Bild-Gelöte analysiert, umwandelt und rendert.':
    'ffmpeg is the tool Theater-Bild-Gelöte uses to probe, convert and render.',
  'ffmpeg …': 'ffmpeg …',
  'ffmpeg fehlt': 'ffmpeg is missing',
  'ffmpeg ohne HAP': 'ffmpeg without HAP',
  'Der Serverzustand ist noch nicht bekannt.': 'The server state is not known yet.',
  'Encoder': 'Encoders',
  'Auslieferung in HAP / HAP Q / HAP Alpha': 'Delivery as HAP / HAP Q / HAP Alpha',
  'Sicherung in ProRes 422 / 4444 Alpha': 'Backup as ProRes 422 / 4444 Alpha',
  'MPEG-2 als Alternative zu HAP': 'MPEG-2 as an alternative to HAP',
  'Proxies und Ansichtsexemplare': 'Proxies and review copies',
  'vorhanden': 'available',
  'fehlt': 'missing',
  'ffmpeg jetzt holen': 'Fetch ffmpeg now',
  'Wird geholt …': 'Fetching …',
  'Erneut prüfen': 'Check again',
  'Der Knopf lädt einen fertigen Build aus dem Netz nach {dir}. Am System selbst wird nichts installiert.':
    'The button downloads a ready-made build from the internet into {dir}. Nothing is installed on the system itself.',
  'ffmpeg wird geholt (Job {id}).': 'Fetching ffmpeg (job {id}).',
  'ffmpeg konnte nicht geholt werden': 'ffmpeg could not be fetched',
  'Der Download ist fehlgeschlagen: {msg}': 'The download failed: {msg}',
  'kein Grund geliefert': 'no reason given',
  'ffmpeg ist geholt. Die Ampel oben zeigt den neuen Stand.':
    'ffmpeg has been fetched. The indicator above shows the new state.',
  'Der Serverzustand konnte nicht gelesen werden': 'The server state could not be read',
  'Von Hand installieren': 'Install by hand',
  'Für HAP muss die zugehörige Ampel grün sein. „ffmpeg jetzt holen“ richtet einen passenden Build ein und prüft die benötigten Encoder.':
    'For HAP, its indicator must be green. “Fetch ffmpeg now” sets up a suitable build and checks the required encoders.',
  'Auf dem Mac „ffmpeg jetzt holen“ wählen. Die passende Version für Apple Silicon oder Intel wird automatisch eingerichtet; Homebrew und Terminal sind dafür nicht nötig.':
    'On Mac, choose “Fetch ffmpeg now”. The appropriate version for Apple Silicon or Intel is set up automatically; Homebrew and Terminal are not required.',
  'Nach einer Installation von Hand hier „Erneut prüfen" drücken.':
    'After installing by hand, press “Check again” here.',
  'Befehl kopieren': 'Copy command',
  'Weiter geht es auch ohne ffmpeg: Die 3D-Ansicht läuft, nur Analysieren, Proxies und Rendern nicht.':
    'You can carry on without ffmpeg: the 3D view works, only probing, proxies and rendering do not.',

  // ---------------------------------------------------------------- Schritt 4
  'Ein Venue beschreibt das Haus: welche Wände es gibt, wie groß sie sind, mit welcher Bildrate gearbeitet wird und in welchem Format ausgeliefert wird.':
    'A venue describes the house: which walls exist, how large they are, which frame rate is used and which delivery format is expected.',
  'Vorlagen werden geladen …': 'Loading templates …',
  'Die Venue-Liste konnte nicht geladen werden': 'The venue list could not be loaded',
  'Keine Vorlage gefunden. Lege eine Venue-Beschreibung in config/venues/ ab oder erstelle hier eine neue.':
    'No template found. Put a venue description into config/venues/ or create a new one here.',
  '{n} Wand': '{n} wall',
  '{n} Wände': '{n} walls',
  'größte Fläche {id}: {w}×{h} px': 'largest surface {id}: {w}×{h} px',
  '{fps} fps': '{fps} fps',
  'Angaben nicht lesbar: {msg}': 'Details unreadable: {msg}',
  'mitgeliefert': 'shipped',
  'eigenes': 'own',
  'Diese Vorlage nehmen': 'Use this template',
  'Vorlage duplizieren und anpassen': 'Duplicate and adjust template',
  'Neues Venue anlegen': 'Create a new venue',
  'Die beiden letzten Wege schließen den Assistenten und öffnen den Venue-Editor.':
    'The last two ways close the assistant and open the venue editor.',
  'Erst eine Vorlage auswählen.': 'Select a template first.',
  'Der Venue-Editor ist nicht angebunden': 'The venue editor is not wired up',
  'main.js hat onOpenVenueEditor nicht gesetzt.': 'main.js did not set onOpenVenueEditor.',
  'Der Venue-Editor konnte nicht geöffnet werden': 'The venue editor could not be opened',

  // ---------------------------------------------------------------- Schritt 5
  'Projektname': 'Project name',
  'z. B. Sommershow 2026': 'e.g. Summer show 2026',
  'Looplänge': 'Loop length',
  'Die Looplänge bestimmt, wie lang der fertige Loop wird. Sie lässt sich später jederzeit ändern.':
    'The loop length decides how long the finished loop runs. You can change it at any time later.',
  'Venue: {name}': 'Venue: {name}',
  'Noch kein Venue gewählt.': 'No venue chosen yet.',
  'Zu Schritt 4': 'Go to step 4',
  'Ein Projekt ist bereits geöffnet: {name}. Es wird vorher gespeichert und dann durch das neue ersetzt.':
    'A project is already open: {name}. It will be saved first and then replaced by the new one.',
  'Projekt anlegen': 'Create project',
  'Wird angelegt …': 'Creating …',
  'Projekt {name} angelegt.': 'Project {name} created.',
  'Das Projekt konnte nicht angelegt werden': 'The project could not be created',
  'Die Looplänge konnte nicht gespeichert werden': 'The loop length could not be saved',
  'Vorhandene Projekte': 'Existing projects',
  'Projekte werden geladen …': 'Loading projects …',
  'Die Projektliste konnte nicht geladen werden': 'The project list could not be loaded',
  'Es wurde noch kein Projekt gefunden.': 'No project found yet.',
  'Öffnen': 'Open',
  'Wird geöffnet …': 'Opening …',
  'Projekt {name} geöffnet.': 'Project {name} opened.',
  'Das Projekt konnte nicht geöffnet werden': 'The project could not be opened',
  'Die Venue-Beschreibung konnte nicht geladen werden': 'The venue description could not be loaded',
  'Zuletzt geändert': 'Last changed',
  'Unbenannt': 'Untitled',
  'Neues Projekt': 'New project',

  // ---------------------------------------------------------------- Schritt 6
  'Material einlesen': 'Read in your footage',
  'In der Bibliothek einen Ordner wählen und einlesen — Theater-Bild-Gelöte prüft dabei Auflösung, Bildrate und Codec jeder Datei.':
    'Pick a folder in the library and scan it — Theater-Bild-Gelöte checks resolution, frame rate and codec of every file.',
  'Auf Slots legen': 'Put it on slots',
  'Ein Clip auf „master" bespielt die ganze Wand; je ein Clip pro Panel setzt sie aus mehreren Quellen zusammen.':
    'One clip on “master” fills the whole wall; one clip per panel assembles it from several sources.',
  'In der 3D-Ansicht prüfen': 'Check it in the 3D view',
  'Den Fahrweg aufziehen und ansehen, was der Zuschauer sieht, wenn die Wandteile auseinanderfahren.':
    'Pull up the travel and watch what the audience sees when the wall sections move apart.',
  'Diesen Assistenten nicht mehr anzeigen': 'Do not show this assistant again',
  'Ohne dieses Häkchen begrüßt dich der Assistent beim nächsten Start wieder.':
    'Without this tick the assistant will greet you again on the next start.',
  'Die Einstellung konnte nicht gespeichert werden — dieser Browser erlaubt keinen lokalen Speicher: {msg}':
    'The setting could not be stored — this browser does not allow local storage: {msg}',
});

/* ==========================================================================
 * Feste Werte
 * ========================================================================== */

/** Merker dafuer, dass der Nutzer schon einmal da war. */
const SEEN_KEY = 'tbg.seenIntro';

/** Unter dieser Menge freiem Platz wird gewarnt. 20 GiB. */
const MIN_FREE_BYTES = 20 * 1024 ** 3;

/** Manuelle Installation je Plattform — zum Kopieren. */
const MANUAL_INSTALL = [
  { id: 'win', label: 'Windows', cmd: 'winget install BtbN.FFmpeg.GPL' },
  { id: 'mac', label: 'macOS', cmd: null },
  { id: 'linux', label: 'Linux', cmd: 'sudo apt install ffmpeg' },
];

const ENCODERS = [
  ['hap', 'Auslieferung in HAP / HAP Q / HAP Alpha'],
  ['prores_ks', 'Sicherung in ProRes 422 / 4444 Alpha'],
  ['mpeg2video', 'MPEG-2 als Alternative zu HAP'],
  ['libx264', 'Proxies und Ansichtsexemplare'],
];

const OVERLAY_STYLE = [
  'position:fixed', 'inset:0', 'z-index:40',
  'align-items:center', 'justify-content:center',
  'padding:24px', 'overflow:auto',
  'background:#04060ad9', 'backdrop-filter:blur(2px)',
].join(';');

/* ==========================================================================
 * Kleinkram
 * ========================================================================== */

/** Wurde der Assistent schon einmal weggeklickt? Kein Speicher = nein. */
function seenIntro() {
  try {
    return !!localStorage.getItem(SEEN_KEY);
  } catch (err) {
    console.warn('[tbg] onboarding: localStorage nicht lesbar:', err);
    return false;
  }
}

/** Merker setzen oder loeschen. Rueckgabe: Fehler oder null. */
function writeSeenIntro(value) {
  try {
    if (value) localStorage.setItem(SEEN_KEY, new Date().toISOString());
    else localStorage.removeItem(SEEN_KEY);
    return null;
  } catch (err) {
    console.error('[tbg] onboarding: localStorage nicht schreibbar:', err);
    return err;
  }
}

/** Plattform des Browsers raten — nur fuer die Vorauswahl des Befehls. */
function guessPlatform(health) {
  const os = health && health.platform && health.platform.os;
  if (os === 'win32') return 'win';
  if (os === 'darwin') return 'mac';
  if (os === 'linux') return 'linux';
  const nav = String(
    (navigator.userAgentData && navigator.userAgentData.platform)
    || navigator.platform || navigator.userAgent || ''
  ).toLowerCase();
  if (nav.includes('win')) return 'win';
  if (nav.includes('mac') || nav.includes('iphone') || nav.includes('ipad')) return 'mac';
  return 'linux';
}

/** Erster brauchbarer Text aus mehreren Feldern. */
function firstText(...vals) {
  for (const v of vals) if (typeof v === 'string' && v.trim() !== '') return v;
  return null;
}

/** Erste endliche Zahl aus mehreren Feldern. */
function firstNum(...vals) {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/**
 * Antwort von /api/workspace lesen.
 *
 * Der Server nennt den Pfad "workspace", die Kurzbeschreibung in api.js nennt
 * ihn "path". Beides wird akzeptiert, damit der Assistent nicht an einem
 * Feldnamen zerbricht.
 */
function readWorkspace(data) {
  const d = (data && typeof data === 'object') ? data : {};
  return {
    path: firstText(d.workspace, d.path, d.dir, d.root),
    source: firstText(d.source),
    free: firstNum(d.freeBytes, d.free, d.freeSpaceBytes),
    folders: [
      ['Projekte', firstText(d.projects)],
      ['Ausgabe', firstText(d.out)],
      ['Proxies', firstText(d.proxies)],
      ['Miniaturbilder', firstText(d.thumbs)],
      ['Zwischenspeicher', firstText(d.cache)],
      ['Venues', firstText(d.venues)],
      ['ffmpeg-Ordner', firstText(d.bin)],
    ].filter(([, v]) => !!v),
  };
}

/** Dateiname aus einem Pfad, ohne node:path — der Client kennt beide Trenner. */
function baseName(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
}

/** Datum in der Sprache der Oberflaeche. */
function fmtWhen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-US');
  } catch {
    return d.toISOString();
  }
}

/* ==========================================================================
 * Schaubild — vier Waende hintereinander, Panels fahren auf
 * ========================================================================== */

function stageDiagram() {
  const cx = 280;
  // Von hinten nach vorn. Weiter vorn = groesser und weiter aufgefahren.
  const walls = [
    { id: 'D', half: 88, height: 54, bottom: 118, travel: 0, fill: 'var(--acc)', op: '0.8' },
    { id: 'C', half: 112, height: 64, bottom: 140, travel: 14, fill: '#26313f', op: '1' },
    { id: 'B', half: 140, height: 74, bottom: 162, travel: 28, fill: '#232d3a', op: '1' },
    { id: 'A', half: 176, height: 86, bottom: 186, travel: 46, fill: '#1f2836', op: '1' },
  ];

  const kids = [h('line', {
    x1: 24, y1: 194, x2: 536, y2: 194, stroke: 'var(--ln)', 'stroke-width': 1,
  })];

  for (const w of walls) {
    const p = w.half / 2;              // Panelbreite: vier Panels je Wand
    const top = w.bottom - w.height;
    const xs = [
      cx - 2 * p - w.travel,
      cx - p - w.travel,
      cx + w.travel,
      cx + p + w.travel,
    ];
    const g = h('g');
    for (const x of xs) {
      g.appendChild(h('rect', {
        x, y: top, width: p - 2, height: w.height, rx: 2,
        fill: w.fill, 'fill-opacity': w.op, stroke: 'var(--ln)', 'stroke-width': 1,
      }));
    }
    g.appendChild(h('text', {
      x: cx + 2 * p + w.travel + 7, y: top + w.height / 2 + 4,
      fill: 'var(--dim)', 'font-size': 11,
    }, w.id));
    kids.push(g);
  }

  // Fahrtrichtung der vordersten Wand
  const front = walls[walls.length - 1];
  const ay = front.bottom - front.height / 2;
  const leftEdge = cx - front.half - front.travel;
  const rightEdge = cx + front.half + front.travel;
  kids.push(arrow(leftEdge - 6, ay, -1), arrow(rightEdge + 6, ay, 1));

  // Blickpunkt des Zuschauers
  kids.push(h('circle', { cx, cy: 208, r: 5, fill: 'var(--dim)' }));
  kids.push(h('text', { x: cx + 12, y: 212, fill: 'var(--dim)', 'font-size': 11 }, t('Zuschauer')));

  return h('svg', {
    viewBox: '0 0 560 224',
    style: 'width:100%;height:auto;display:block;border:1px solid var(--ln);border-radius:3px;background:#0b0f16',
    role: 'img',
    'aria-label': t('Schaubild: vier hintereinanderliegende LED-Wände, deren Teile nach außen auffahren.'),
  }, kids);
}

function arrow(x, y, dir) {
  const x2 = x + dir * 20;
  return h('g',
    h('line', { x1: x, y1: y, x2, y2: y, stroke: 'var(--acc)', 'stroke-width': 1.5 }),
    h('polyline', {
      points: `${x2 - dir * 5},${y - 4} ${x2},${y} ${x2 - dir * 5},${y + 4}`,
      fill: 'none', stroke: 'var(--acc)', 'stroke-width': 1.5,
    }));
}

/* ==========================================================================
 * Der Assistent
 * ========================================================================== */

export function createOnboarding(opts = {}) {
  const STEPS = [
    { title: 'Willkommen', build: buildWelcome },
    { title: 'Arbeitsverzeichnis', build: buildWorkspace },
    { title: 'ffmpeg', build: buildFfmpeg },
    { title: 'Venue', build: buildVenue },
    { title: 'Projekt', build: buildProject },
    { title: 'Fertig', build: buildDone },
  ];

  const el = h('div.onboarding', { style: `${OVERLAY_STYLE};display:none` });

  let opened = false;
  let step = 0;
  let stepSync = null;        // lebende Teile des aktuellen Schrittes
  let syncBroken = null;      // Meldung, die schon einmal berichtet wurde
  let lastState = store.get();

  // Vom Nutzer eingetippte Werte ueberleben jeden Neuaufbau des Dialogs.
  let wsPath = null;
  let venueChoice = null;
  let projectName = '';
  let loopSeconds = 20;
  let manualPlatform = guessPlatform(lastState.health);
  let installJobId = null;

  const loaded = {
    workspace: { status: 'idle', data: null, error: null },
    venues: { status: 'idle', data: null, error: null },
    projects: { status: 'idle', data: null, error: null },
  };

  const handle = {
    el,
    open,
    close,
    update,
    shouldShow,
    onOpenVenueEditor: typeof opts.onOpenVenueEditor === 'function' ? opts.onOpenVenueEditor : null,
    get isOpen() { return opened; },
    get step() { return step; },
  };

  /* ---------------------------------------------------------------- Melden */

  function status(text, level) {
    if (typeof opts.onStatus === 'function') {
      try { opts.onStatus(text, level); return; } catch (e) { console.error('[tbg] onboarding onStatus:', e); }
    }
    setStatus(text, level);
  }

  function fail(prefix, err) {
    if (typeof opts.onError === 'function') {
      console.error('[tbg] onboarding:', prefix, err);
      try { opts.onError(prefix, err); return; } catch (e) { console.error('[tbg] onboarding onError:', e); }
    }
    showError(prefix, err);
  }

  /** Fehlerkasten im Dialog — die Statuszeile liegt hinter dem Overlay. */
  function errBox(prefix, message, retry) {
    const box = h('div.msg.err', `${prefix}: ${message}`);
    if (typeof retry === 'function') {
      const b = h('button.btn.sm', { type: 'button', style: 'margin-top:6px' }, t('Erneut versuchen'));
      on(b, 'click', retry);
      box.appendChild(h('div', b));
    }
    return box;
  }

  /* ---------------------------------------------------------------- Laden */

  async function ensureWorkspace(force = false) {
    const slot = loaded.workspace;
    if (!force && slot.status === 'loading') return;
    if (!force && slot.status === 'ok') return;

    // Der Rahmen hat den Arbeitsordner beim Start schon geholt — den nehmen,
    // statt dieselbe Abfrage ein zweites Mal zu stellen.
    if (!force && lastState.workspace) {
      slot.data = readWorkspace(lastState.workspace);
      slot.status = 'ok';
      slot.error = null;
      redrawIfAt(1);
      return;
    }

    slot.status = 'loading';
    slot.error = null;
    redrawIfAt(1);
    try {
      const data = await getWorkspace();
      store.set({ workspace: data });
      slot.data = readWorkspace(data);
      slot.status = 'ok';
    } catch (e) {
      slot.status = 'error';
      slot.error = e.message;
      console.error('[tbg] onboarding: /api/workspace:', e);
    }
    redrawIfAt(1);
  }

  async function ensureVenues(force = false) {
    const slot = loaded.venues;
    if (!force && (slot.status === 'loading' || slot.status === 'ok')) return;
    slot.status = 'loading';
    slot.error = null;
    redrawIfAt(3);
    try {
      const raw = await listVenues();
      const list = Array.isArray(raw) ? raw : [];
      // Fuer die Kurzbeschreibung braucht es das volle Venue: Wandzahl,
      // groesste Flaeche, Bildrate. Ein Ausfall betrifft nur diese eine Zeile.
      slot.data = await Promise.all(list.map(async (v) => {
        try {
          return { ...v, detail: await getVenue(v.id), detailError: null };
        } catch (e) {
          console.warn(`[tbg] onboarding: Venue ${v.id} nicht lesbar:`, e);
          return { ...v, detail: null, detailError: e.message };
        }
      }));
      slot.status = 'ok';
      store.set({ venues: list });
    } catch (e) {
      slot.status = 'error';
      slot.error = e.message;
      console.error('[tbg] onboarding: /api/venues:', e);
    }
    redrawIfAt(3);
  }

  async function ensureProjects(force = false) {
    const slot = loaded.projects;
    if (!force && (slot.status === 'loading' || slot.status === 'ok')) return;
    slot.status = 'loading';
    slot.error = null;
    redrawIfAt(4);
    try {
      const raw = await listProjects();
      slot.data = Array.isArray(raw) ? raw : [];
      slot.status = 'ok';
    } catch (e) {
      slot.status = 'error';
      slot.error = e.message;
      console.error('[tbg] onboarding: /api/projects:', e);
    }
    redrawIfAt(4);
  }

  function ensureForStep(n) {
    if (n === 1) ensureWorkspace();
    if (n === 3) ensureVenues();
    if (n === 4) { ensureVenues(); ensureProjects(); }
  }

  function redrawIfAt(n) {
    if (opened && step === n) draw(false);
  }

  /* ---------------------------------------------------------------- Rahmen */

  function draw(focus) {
    if (!opened) return;
    clear(el);
    stepSync = null;
    syncBroken = null;

    const spec = STEPS[step];
    let built;
    try {
      built = spec.build();
    } catch (e) {
      fail(t('{what} ist fehlgeschlagen', { what: `onboarding.${spec.title}` }), e);
      built = { node: errBox(t('{what} ist fehlgeschlagen', { what: spec.title }), e.message) };
    }

    const dlg = h('div.dlg', {
      style: 'width:min(760px,94vw)',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Erste Schritte mit Theater-Bild-Gelöte'), tabindex: '-1' },
    }, buildHead(), h('div.bd', buildProgress(), built.node, buildFooter()));

    el.appendChild(dlg);
    stepSync = typeof built.sync === 'function' ? built.sync : null;
    runSync();
    if (focus) {
      try { dlg.focus(); } catch { /* nicht fokussierbar, dann eben nicht */ }
    }
  }

  function buildHead() {
    const btnX = h('button.btn.sm.ghost', {
      type: 'button',
      title: t('Assistent schließen'),
      attrs: { 'aria-label': t('Assistent schließen') },
    }, '✕');
    on(btnX, 'click', () => close());

    const langs = h('div.seg', { attrs: { role: 'group', 'aria-label': t('Sprache') } });
    for (const l of LANGUAGES) {
      const b = h('button.btn.sm', { type: 'button', class: l.id === getLang() ? 'on' : '' }, l.label);
      on(b, 'click', () => setLang(l.id));
      langs.appendChild(b);
    }

    return h('div.hd',
      h('span', t('Erste Schritte mit Theater-Bild-Gelöte')),
      h('span.dim', { style: 'font-size:11.5px;font-weight:400' },
        t('Schritt {n} von {total}', { n: step + 1, total: STEPS.length })),
      h('span.right'),
      langs,
      btnX);
  }

  function buildProgress() {
    const chips = h('div.row.wrap', { style: 'gap:4px' });
    STEPS.forEach((s, i) => {
      const b = h('button.btn.sm', {
        type: 'button',
        class: i === step ? 'on' : '',
        title: t(s.title),
      }, `${i + 1} · ${t(s.title)}`);
      on(b, 'click', () => goTo(i));
      chips.appendChild(b);
    });
    const pct = Math.round(((step + 1) / STEPS.length) * 100);
    return h('div.col', { style: 'gap:6px' }, chips, h('div.bar', h('i', { style: `width:${pct}%` })));
  }

  function buildFooter() {
    const later = h('button.btn.ghost', { type: 'button' }, t('Später'));
    on(later, 'click', () => close());

    const back = h('button.btn', { type: 'button', disabled: step === 0 }, t('Zurück'));
    on(back, 'click', () => goTo(step - 1));

    const last = step === STEPS.length - 1;
    const next = h('button.btn.acc', { type: 'button' }, last ? t('Los geht’s') : t('Weiter'));
    on(next, 'click', () => (last ? close() : goTo(step + 1)));

    return h('div.row', { style: 'margin-top:4px' }, later, h('span.right'), back, next);
  }

  function goTo(n) {
    const next = Math.max(0, Math.min(STEPS.length - 1, n));
    if (next === step && opened) { draw(true); return; }
    step = next;
    ensureForStep(step);
    draw(true);
  }

  /* ---------------------------------------------------------------- Schritt 1 */

  function buildWelcome() {
    return {
      node: h('div.col',
        h('p', t('Theater-Bild-Gelöte bespielt LED-Wände, die aus mehreren Teilen bestehen: eine Wand je Fläche, ein Slot je Panel, darauf beliebig viele Layer.')),
        h('p', t('In der 3D-Ansicht prüfst du vor dem Rendern, wie das Ergebnis vom Zuschauerraum aus wirkt — auch dann, wenn die Wandteile auffahren und die Wand dahinter freigeben.')),
        h('p', t('Zum Schluss liefert Theater-Bild-Gelöte fertige Dateien im Format des Hauses aus, mit Prüfbericht und im Klartext sichtbarem ffmpeg-Befehl.')),
        stageDiagram(),
        h('p.dim', { style: 'font-size:11.5px' },
          t('Vier Wände hintereinander: A steht vorn an der Rampe, D ganz hinten. Fahren die vorderen Teile nach außen, wird der Blick nach hinten frei.')),
        h('div.msg.info', t('Der Assistent ändert nichts von allein: Er lädt nichts herunter und legt nichts an, solange du es nicht anstößt.'))),
    };
  }

  /* ---------------------------------------------------------------- Schritt 2 */

  function buildWorkspace() {
    const slot = loaded.workspace;
    const info = slot.data || { path: null, source: null, free: null, folders: [] };
    if (wsPath == null && info.path) wsPath = info.path;

    const box = h('div.col');
    // Platz fuer vergaengliche Meldungen. Ohne den wuerde jeder Klick eine
    // weitere Zeile anhaengen, bis der Dialog voll ist.
    const msgs = h('div.col');
    box.appendChild(h('p', t('Hier legt Theater-Bild-Gelöte seine eigenen Dateien ab: Projektdatei, Proxies, Miniaturbilder, Renderergebnisse und Prüfberichte.')));
    box.appendChild(h('div.msg.info', t('Dein Videomaterial wird NICHT hierher kopiert. Theater-Bild-Gelöte merkt sich nur den Pfad zur Quelldatei und liest sie dort, wo sie liegt.')));

    if (slot.status === 'loading' || slot.status === 'idle') {
      box.appendChild(h('div.dim', t('Wird gelesen …')));
    }
    if (slot.status === 'error') {
      box.appendChild(errBox(t('Das Arbeitsverzeichnis konnte nicht gelesen werden'), slot.error,
        () => ensureWorkspace(true)));
    }

    const input = h('input', {
      type: 'text', class: 'grow', value: wsPath || '',
      placeholder: t('Pfad zum Arbeitsverzeichnis'),
      attrs: { spellcheck: 'false' },
    });
    on(input, 'input', () => { wsPath = input.value; });

    const btnBrowse = h('button.btn', { type: 'button' }, t('Blättern …'));
    on(btnBrowse, 'click', async () => {
      // Der Waehler benutzt #overlayRoot (z-index 50) und legt sich damit
      // ueber dieses Overlay — nichts muss versteckt oder neu gebaut werden.
      try {
        const p = await pickPath({ title: t('Ordner für die Arbeitsdateien'), mode: 'dir', start: input.value.trim() });
        if (p) { wsPath = p; input.value = p; }
      } catch (e) {
        fail(t('Das Arbeitsverzeichnis konnte nicht gelesen werden'), e);
        clear(msgs).appendChild(errBox(t('Das Arbeitsverzeichnis konnte nicht gelesen werden'), e.message));
      }
    });

    const btnSave = h('button.btn.acc', { type: 'button' }, t('Speichern'));
    on(btnSave, 'click', async () => {
      const p = (input.value || '').trim();
      if (!p) {
        clear(msgs).appendChild(h('div.msg.warn', t('Erst einen Ordner angeben.')));
        return;
      }
      clear(msgs);
      btnSave.disabled = true;
      btnSave.textContent = t('Wird gespeichert …');
      try {
        const data = await setWorkspace(p);
        store.set({ workspace: data });
        loaded.workspace.data = readWorkspace(data);
        loaded.workspace.status = 'ok';
        loaded.workspace.error = null;
        wsPath = loaded.workspace.data.path || p;
        status(t('Arbeitsverzeichnis gespeichert: {path}', { path: wsPath }), 'ok');
        // Ordner und ffmpeg-Fund haengen am Arbeitsverzeichnis — beides neu lesen.
        try {
          store.set({ health: await getHealth() });
        } catch (e) {
          fail(t('Der Serverzustand konnte nicht gelesen werden'), e);
        }
        // Projektliste und Venues stehen jetzt woanders.
        loaded.projects.status = 'idle';
        loaded.venues.status = 'idle';
        draw(false);
      } catch (e) {
        fail(t('Das Arbeitsverzeichnis konnte nicht gespeichert werden'), e);
        btnSave.disabled = false;
        btnSave.textContent = t('Speichern');
        clear(msgs).appendChild(errBox(t('Das Arbeitsverzeichnis konnte nicht gespeichert werden'), e.message));
      }
    });

    box.appendChild(h('div.row',
      h('span.dim', { style: 'min-width:96px' }, t('Pfad')),
      input, btnBrowse, btnSave));
    box.appendChild(msgs);

    if (info.source === 'cli') {
      box.appendChild(h('div.msg.warn', t('Der Pfad kommt aus dem Aufruf (--workspace). Beim nächsten Start gilt wieder der Wert von dort.')));
    } else if (info.source === 'env') {
      box.appendChild(h('div.msg.warn', t('Der Pfad kommt aus einer Umgebungsvariablen. Beim nächsten Start gilt wieder der Wert von dort.')));
    }

    const low = Number.isFinite(info.free) && info.free < MIN_FREE_BYTES;
    box.appendChild(h('div.row',
      h('span.dim', { style: 'min-width:96px' }, t('Freier Platz')),
      Number.isFinite(info.free)
        ? h('span.tag', { class: low ? 'warn' : 'ok' }, fmtBytes(info.free))
        : h('span.dim', t('unbekannt'))));

    if (low) {
      box.appendChild(h('div.msg.warn',
        t('Weniger als {min} frei. Ein einziger HAP-Loop einer großen Wand belegt schnell mehrere Gigabyte — nimm besser ein Laufwerk mit mehr Luft.',
          { min: fmtBytes(MIN_FREE_BYTES) })));
    } else if (slot.status === 'ok' && !Number.isFinite(info.free)) {
      box.appendChild(h('div.dim', { style: 'font-size:11.5px' }, t('Der Server hat den freien Plattenplatz nicht mitgeliefert.')));
    }

    if (info.folders.length) {
      box.appendChild(h('h3', t('Diese Ordner benutzt Theater-Bild-Gelöte darin:')));
      box.appendChild(h('table.tbl', h('tbody', info.folders.map(([label, value]) =>
        h('tr',
          h('td', { style: 'width:120px' }, t(label)),
          h('td.mono.nowrap', { title: value }, value))))));
    }

    return { node: box };
  }

  /* ---------------------------------------------------------------- Schritt 3 */

  function buildFfmpeg() {
    const dot = h('span.amp');
    const summary = h('b');
    const encoderBox = h('div.col');
    const jobBox = h('div.col');

    const btnInstall = h('button.btn.acc', { type: 'button' }, t('ffmpeg jetzt holen'));
    on(btnInstall, 'click', async () => {
      btnInstall.disabled = true;
      btnInstall.textContent = t('Wird geholt …');
      try {
        const res = await installFfmpeg();
        installJobId = res && res.jobId ? res.jobId : null;
        status(t('ffmpeg wird geholt (Job {id}).', { id: installJobId || '—' }));
      } catch (e) {
        fail(t('ffmpeg konnte nicht geholt werden'), e);
        clear(jobBox).appendChild(errBox(t('ffmpeg konnte nicht geholt werden'), e.message));
      } finally {
        btnInstall.disabled = false;
        btnInstall.textContent = t('ffmpeg jetzt holen');
      }
    });

    const btnCheck = h('button.btn', { type: 'button' }, t('Erneut prüfen'));
    on(btnCheck, 'click', async () => {
      btnCheck.disabled = true;
      try {
        const health = await getHealth();
        store.set({ health });
        runSync();
      } catch (e) {
        fail(t('Der Serverzustand konnte nicht gelesen werden'), e);
        clear(jobBox).appendChild(errBox(t('Der Serverzustand konnte nicht gelesen werden'), e.message));
      } finally {
        btnCheck.disabled = false;
      }
    });

    const binDir = (lastState.health && lastState.health.paths && lastState.health.paths.bin) || 'bin/';

    // Manuelle Alternative je Plattform
    const cmdBox = h('div.cmdbox.grow');
    const copy = copyButton(() => cmdBox.textContent, t('Befehl kopieren'));
    const platSeg = h('div.seg');
    const setPlatform = (id) => {
      manualPlatform = id;
      const entry = MANUAL_INSTALL.find((m) => m.id === id) || MANUAL_INSTALL[0];
      cmdBox.textContent = entry.cmd || t('Auf dem Mac „ffmpeg jetzt holen“ wählen. Die passende Version für Apple Silicon oder Intel wird automatisch eingerichtet; Homebrew und Terminal sind dafür nicht nötig.');
      cmdBox.className = entry.cmd ? 'cmdbox grow' : 'dim grow';
      copy.hidden = !entry.cmd;
      for (const b of platSeg.children) b.classList.toggle('on', b.dataset.plat === id);
    };
    for (const m of MANUAL_INSTALL) {
      const b = h('button.btn.sm', { type: 'button', dataset: { plat: m.id } }, m.label);
      on(b, 'click', () => setPlatform(m.id));
      platSeg.appendChild(b);
    }
    setPlatform(manualPlatform);

    // Der Hinweis steht immer da, faellt aber nur dann rot aus, wenn hap
    // wirklich fehlt — sonst waere die Warnung Gewoehnung statt Warnung.
    const hapNote = h('div.msg.info',
      t('Für HAP muss die zugehörige Ampel grün sein. „ffmpeg jetzt holen“ richtet einen passenden Build ein und prüft die benötigten Encoder.'));

    const node = h('div.col',
      h('p', t('ffmpeg ist das Werkzeug, mit dem Theater-Bild-Gelöte analysiert, umwandelt und rendert.')),
      h('div.row', dot, summary),
      h('h3', t('Encoder')),
      encoderBox,
      hapNote,
      h('div.row', btnInstall, btnCheck),
      h('p.dim', t('Der Knopf lädt einen fertigen Build aus dem Netz nach {dir}. Am System selbst wird nichts installiert.', { dir: binDir })),
      jobBox,
      h('details.setup-manual', h('summary', t('Von Hand installieren')),
        platSeg,
        h('div.row', cmdBox, copy),
        h('p.dim', t('Nach einer Installation von Hand hier „Erneut prüfen" drücken.'))),
      h('div.msg.info', t('Weiter geht es auch ohne ffmpeg: Die 3D-Ansicht läuft, nur Analysieren, Proxies und Rendern nicht.')));

    function sync(state) {
      const health = state.health;
      const level = ffmpegLevel(health);
      dot.className = `amp ${level}`;
      // ffmpegSummary() aus setup.js liefert deutschen Klartext — als
      // Schluessel durch t() geschickt, damit auch das englisch erscheint.
      summary.textContent = health ? t(ffmpegSummary(health)) : t('Der Serverzustand ist noch nicht bekannt.');

      const enc = (health && health.ffmpeg && health.ffmpeg.encoders) || {};
      hapNote.className = enc.hap ? 'msg info' : 'msg err';
      clear(encoderBox);
      for (const [id, label] of ENCODERS) {
        const ok = !!enc[id];
        encoderBox.appendChild(h('div.row',
          h('span.amp', { class: ok ? 'ok' : 'err' }),
          h('b', { style: 'min-width:104px' }, id),
          h('span.dim', t(label)),
          h('span.tag.right', { class: ok ? 'ok' : 'err' }, ok ? t('vorhanden') : t('fehlt'))));
      }

      const job = installJobId ? (state.jobs || []).find((j) => j.id === installJobId) : null;
      clear(jobBox);
      if (job) {
        const pct = Math.round((Number(job.progress) || 0) * 100);
        const cls = job.status === 'error' ? 'err' : job.status === 'done' ? 'ok' : '';
        jobBox.appendChild(h('div.row',
          h('span.dim.grow.nowrap', job.label || job.type || ''),
          h('span.mono', `${pct} %`)));
        jobBox.appendChild(h('div.bar', { class: cls }, h('i', { style: `width:${pct}%` })));
        const line = (job.log || [])[job.log ? job.log.length - 1 : 0];
        if (line && (job.status === 'running' || job.status === 'queued')) {
          jobBox.appendChild(h('div.mono.dim.nowrap', { style: 'font-size:11px' }, String(line)));
        }
        if (job.status === 'error') {
          jobBox.appendChild(h('div.msg.err',
            t('Der Download ist fehlgeschlagen: {msg}', { msg: job.error || t('kein Grund geliefert') })));
        }
        if (job.status === 'done') {
          jobBox.appendChild(h('div.msg.ok', t('ffmpeg ist geholt. Die Ampel oben zeigt den neuen Stand.')));
        }
        btnInstall.disabled = job.status === 'running' || job.status === 'queued';
      }
    }

    return { node, sync };
  }

  /* ---------------------------------------------------------------- Schritt 4 */

  function venueSummary(v) {
    const parts = [];
    const d = v.detail;
    const walls = (d && Array.isArray(d.walls)) ? d.walls : null;
    const count = walls ? walls.length : (Number.isFinite(v.wallCount) ? v.wallCount : null);
    if (count != null) parts.push(tn(count, '{n} Wand', '{n} Wände'));

    if (walls && walls.length) {
      let biggest = null;
      for (const w of walls) {
        const area = (Number(w.width) || 0) * (Number(w.height) || 0);
        if (!biggest || area > (Number(biggest.width) || 0) * (Number(biggest.height) || 0)) biggest = w;
      }
      if (biggest) {
        parts.push(t('größte Fläche {id}: {w}×{h} px',
          { id: biggest.id, w: biggest.width, h: biggest.height }));
      }
    }
    if (d && Number.isFinite(Number(d.fps))) parts.push(t('{fps} fps', { fps: fmtNum(Number(d.fps), 3) }));
    if (!d && v.detailError) parts.push(t('Angaben nicht lesbar: {msg}', { msg: v.detailError }));
    return parts.join(' · ');
  }

  function buildVenue() {
    const slot = loaded.venues;
    const box = h('div.col');
    const msgs = h('div.col');
    box.appendChild(h('p', t('Ein Venue beschreibt das Haus: welche Wände es gibt, wie groß sie sind, mit welcher Bildrate gearbeitet wird und in welchem Format ausgeliefert wird.')));

    const btnUse = h('button.btn.acc', { type: 'button', disabled: true }, t('Diese Vorlage nehmen'));
    const btnDup = h('button.btn', { type: 'button', disabled: true }, t('Vorlage duplizieren und anpassen'));
    const btnNew = h('button.btn', { type: 'button' }, t('Neues Venue anlegen'));

    if (venueChoice == null) {
      const known = (slot.data || []).map((v) => v.id);
      const fromProject = lastState.project && lastState.project.venueId;
      if (fromProject && known.includes(fromProject)) venueChoice = fromProject;
    }

    const refreshButtons = () => {
      btnUse.disabled = !venueChoice;
      btnDup.disabled = !venueChoice;
    };

    if (slot.status === 'idle' || slot.status === 'loading') {
      box.appendChild(h('div.dim', t('Vorlagen werden geladen …')));
    } else if (slot.status === 'error') {
      box.appendChild(errBox(t('Die Venue-Liste konnte nicht geladen werden'), slot.error, () => ensureVenues(true)));
    } else if (!slot.data || slot.data.length === 0) {
      box.appendChild(h('div.msg.warn', t('Keine Vorlage gefunden. Lege eine Venue-Beschreibung in config/venues/ ab oder erstelle hier eine neue.')));
    } else {
      const list = h('div.col');
      for (const v of slot.data) {
        const radio = h('input', {
          type: 'radio', name: 'tbgOnboardingVenue', checked: v.id === venueChoice,
          attrs: { 'aria-label': v.name || v.id },
        });
        const row = h('div.row', {
          style: 'align-items:flex-start;gap:8px;padding:6px 8px;border:1px solid var(--ln);border-radius:3px;background:#11151c;cursor:pointer',
        },
          radio,
          h('div.col.grow', { style: 'gap:2px' },
            h('div.row',
              h('b', v.name || v.id),
              h('span.tag', { class: v.builtin ? 'info' : '' }, v.builtin ? t('mitgeliefert') : t('eigenes'))),
            h('span.dim', { style: 'font-size:11.5px' }, venueSummary(v)),
            h('span.dim.mono.nowrap', { style: 'font-size:11px', title: v.path || v.id }, v.id)));

        const select = () => { venueChoice = v.id; refreshButtons(); };
        on(radio, 'change', select);
        on(row, 'click', (ev) => {
          if (ev.target === radio) return;
          radio.checked = true;
          select();
        });
        list.appendChild(row);
      }
      box.appendChild(list);
    }

    on(btnUse, 'click', () => {
      if (!venueChoice) { clear(msgs).appendChild(h('div.msg.warn', t('Erst eine Vorlage auswählen.'))); return; }
      goTo(4);
    });
    on(btnDup, 'click', () => {
      if (!venueChoice) { clear(msgs).appendChild(h('div.msg.warn', t('Erst eine Vorlage auswählen.'))); return; }
      toVenueEditor(venueChoice);
    });
    on(btnNew, 'click', () => toVenueEditor(null));

    refreshButtons();
    box.appendChild(h('div.row.wrap', btnUse, btnDup, btnNew));
    box.appendChild(msgs);
    box.appendChild(h('p.dim', t('Die beiden letzten Wege schließen den Assistenten und öffnen den Venue-Editor.')));
    return { node: box };
  }

  function toVenueEditor(venueId) {
    const fn = typeof handle.onOpenVenueEditor === 'function'
      ? handle.onOpenVenueEditor
      : (typeof opts.onOpenVenueEditor === 'function' ? opts.onOpenVenueEditor : null);
    if (!fn) {
      fail(t('Der Venue-Editor ist nicht angebunden'), new Error(t('main.js hat onOpenVenueEditor nicht gesetzt.')));
      return;
    }
    close();
    try {
      fn(venueId || null);
    } catch (e) {
      fail(t('Der Venue-Editor konnte nicht geöffnet werden'), e);
    }
  }

  /* ---------------------------------------------------------------- Schritt 5 */

  function currentVenueId() {
    if (venueChoice) return venueChoice;
    if (lastState.project && lastState.project.venueId) return lastState.project.venueId;
    const list = loaded.venues.data || lastState.venues || [];
    return list.length ? list[0].id : null;
  }

  function venueLabel(id) {
    const list = loaded.venues.data || lastState.venues || [];
    const found = list.find((v) => v.id === id);
    return found ? (found.name || found.id) : id;
  }

  function buildProject() {
    const box = h('div.col');
    const msgs = h('div.col');
    const venueId = currentVenueId();

    if (venueId) {
      box.appendChild(h('div.msg.info', t('Venue: {name}', { name: venueLabel(venueId) })));
    } else {
      const jump = h('button.btn.sm', { type: 'button' }, t('Zu Schritt 4'));
      on(jump, 'click', () => goTo(3));
      box.appendChild(h('div.msg.warn', t('Noch kein Venue gewählt.'), h('div', { style: 'margin-top:6px' }, jump)));
    }

    if (lastState.project && lastState.project.name) {
      box.appendChild(h('div.msg.warn',
        t('Ein Projekt ist bereits geöffnet: {name}. Es wird vorher gespeichert und dann durch das neue ersetzt.',
          { name: lastState.project.name })));
    }

    const nameIn = h('input', {
      type: 'text', class: 'grow', value: projectName,
      placeholder: t('z. B. Sommershow 2026'), attrs: { spellcheck: 'false' },
    });
    on(nameIn, 'input', () => { projectName = nameIn.value; });

    const loopIn = h('input', { type: 'number', min: '1', max: '3600', step: '1', value: String(loopSeconds) });
    on(loopIn, 'input', () => { loopSeconds = Math.max(1, Number(loopIn.value) || 20); });

    const btnCreate = h('button.btn.acc', { type: 'button', disabled: !venueId }, t('Projekt anlegen'));
    on(btnCreate, 'click', async () => {
      const vid = currentVenueId();
      if (!vid) { goTo(3); return; }
      const name = (nameIn.value || '').trim() || t('Neues Projekt');
      const loop = Math.max(1, Number(loopIn.value) || 20);
      clear(msgs);
      btnCreate.disabled = true;
      btnCreate.textContent = t('Wird angelegt …');
      try {
        // Offene Aenderungen zuerst sichern — der Server ersetzt gleich das
        // aktuelle Projekt, und nichts davon darf still verlorengehen.
        if (isDirty() && !(await flushSave())) throw new Error(t('Projekt konnte nicht gespeichert werden'));
        let project = await newProject(vid, name);
        if (project && Math.abs((Number(project.loopSeconds) || 0) - loop) > 1e-9) {
          project = { ...project, loopSeconds: loop };
          try {
            const res = await putProject(project);
            if (res && res.modifiedAt) project.modifiedAt = res.modifiedAt;
          } catch (e) {
            fail(t('Die Looplänge konnte nicht gespeichert werden'), e);
          }
        }
        await adoptProject(project);
        status(t('Projekt {name} angelegt.', { name }), 'ok');
        loaded.projects.status = 'idle';
        goTo(5);
      } catch (e) {
        fail(t('Das Projekt konnte nicht angelegt werden'), e);
        clear(msgs).appendChild(errBox(t('Das Projekt konnte nicht angelegt werden'), e.message));
        btnCreate.disabled = false;
        btnCreate.textContent = t('Projekt anlegen');
      }
    });

    box.appendChild(h('div.row', h('span.dim', { style: 'min-width:96px' }, t('Projektname')), nameIn));
    box.appendChild(h('div.row',
      h('span.dim', { style: 'min-width:96px' }, t('Looplänge')), loopIn, h('span.dim', 's'),
      h('span.right'), btnCreate));
    box.appendChild(h('p.dim', t('Die Looplänge bestimmt, wie lang der fertige Loop wird. Sie lässt sich später jederzeit ändern.')));
    box.appendChild(msgs);

    // ------------------------------------------------ vorhandene Projekte
    box.appendChild(h('h3', t('Vorhandene Projekte')));
    const slot = loaded.projects;
    if (slot.status === 'idle' || slot.status === 'loading') {
      box.appendChild(h('div.dim', t('Projekte werden geladen …')));
    } else if (slot.status === 'error') {
      box.appendChild(errBox(t('Die Projektliste konnte nicht geladen werden'), slot.error, () => ensureProjects(true)));
    } else if (!slot.data || slot.data.length === 0) {
      box.appendChild(h('div.dim', t('Es wurde noch kein Projekt gefunden.')));
    } else {
      const rows = slot.data.map((p) => {
        const label = firstText(p.projectName, p.name, baseName(p.path)) || t('Unbenannt');
        const when = fmtWhen(p.modifiedAt || p.mtime);
        const btnOpen = h('button.btn.sm', { type: 'button' }, t('Öffnen'));
        on(btnOpen, 'click', async () => {
          btnOpen.disabled = true;
          btnOpen.textContent = t('Wird geöffnet …');
          try {
            if (isDirty() && !(await flushSave())) throw new Error(t('Projekt konnte nicht gespeichert werden'));
            const project = await openProject(p.path);
            await adoptProject(project);
            status(t('Projekt {name} geöffnet.', { name: label }), 'ok');
            goTo(5);
          } catch (e) {
            fail(t('Das Projekt konnte nicht geöffnet werden'), e);
            clear(msgs).appendChild(errBox(t('Das Projekt konnte nicht geöffnet werden'), e.message));
            btnOpen.disabled = false;
            btnOpen.textContent = t('Öffnen');
          }
        });
        return h('tr',
          h('td', h('div.nowrap', { style: 'max-width:220px', title: p.path || '' }, label),
            h('div.dim.mono.nowrap', { style: 'max-width:220px;font-size:11px', title: p.path || '' }, p.path || '')),
          h('td.dim', { style: 'font-size:11.5px' }, p.venueId || ''),
          h('td.dim.nowrap', { style: 'font-size:11.5px', title: t('Zuletzt geändert') }, when || ''),
          h('td', btnOpen));
      });
      box.appendChild(h('table.tbl', h('tbody', rows)));
    }

    return { node: box };
  }

  /**
   * Frisch angelegtes oder geoeffnetes Projekt in den Zustand uebernehmen —
   * samt Venue, sonst zeigt die Oberflaeche Waende, die es nicht mehr gibt.
   */
  async function adoptProject(project) {
    if (!project) return;
    store.set({
      project,
      media: project.media || [],
      ui: { transport: { loopSec: project.loopSeconds || 20, timeSec: 0 } },
    });
    try {
      const venue = await getVenue(project.venueId);
      const walls = (venue.walls || []).map((w) => w.id);
      const active = store.get().ui.activeWallId;
      store.set({
        venue,
        ui: { activeWallId: walls.includes(active) ? active : walls[walls.length - 1], activeSlotId: 'master' },
      });
    } catch (e) {
      fail(t('Die Venue-Beschreibung konnte nicht geladen werden'), e);
    }
  }

  /* ---------------------------------------------------------------- Schritt 6 */

  function buildDone() {
    const box = h('div.col');
    const steps = [
      ['Material einlesen', 'In der Bibliothek einen Ordner wählen und einlesen — Theater-Bild-Gelöte prüft dabei Auflösung, Bildrate und Codec jeder Datei.'],
      ['Auf Slots legen', 'Ein Clip auf „master" bespielt die ganze Wand; je ein Clip pro Panel setzt sie aus mehreren Quellen zusammen.'],
      ['In der 3D-Ansicht prüfen', 'Den Fahrweg aufziehen und ansehen, was der Zuschauer sieht, wenn die Wandteile auseinanderfahren.'],
    ];
    steps.forEach(([title, text], i) => {
      box.appendChild(h('div.row', { style: 'align-items:flex-start;gap:8px' },
        h('span.tag.acc', String(i + 1)),
        h('div.col', { style: 'gap:2px' }, h('b', t(title)), h('span', { style: 'font-size:12.5px' }, t(text)))));
    });

    const note = h('div.dim', { style: 'font-size:11.5px' },
      t('Ohne dieses Häkchen begrüßt dich der Assistent beim nächsten Start wieder.'));
    const chk = h('input', { type: 'checkbox', checked: seenIntro() });
    on(chk, 'change', () => {
      const err = writeSeenIntro(chk.checked);
      if (err) {
        chk.checked = false;
        const msg = t('Die Einstellung konnte nicht gespeichert werden — dieser Browser erlaubt keinen lokalen Speicher: {msg}', { msg: err.message });
        note.textContent = msg;
        note.className = 'msg err';
        status(msg, 'warn');
      }
    });

    box.appendChild(h('div', { style: 'margin-top:6px;padding:8px;border:1px solid var(--ln);border-radius:3px;background:#11151c' },
      h('label.row', chk, h('span', t('Diesen Assistenten nicht mehr anzeigen'))),
      note));
    return { node: box };
  }

  /* ---------------------------------------------------------------- Leben */

  function runSync() {
    if (!opened || !stepSync) return;
    try {
      stepSync(lastState);
    } catch (e) {
      // Nur einmal melden und dann abschalten: setStatus loest eine neue
      // Zustandsaenderung aus, und die riefe sofort wieder hierher.
      const msg = e && e.message ? e.message : String(e);
      stepSync = null;
      if (syncBroken !== msg) {
        syncBroken = msg;
        fail(t('Der Assistent konnte sich nicht auffrischen'), e);
      } else {
        console.error('[tbg] onboarding sync erneut:', msg);
      }
    }
  }

  /** Vertragsgemaess: main.js darf den Zustand hereinreichen. */
  function update(state) {
    lastState = state || store.get();
    runSync();
  }

  /**
   * Zeigen, wenn: kein Projekt, kein Venue, ffmpeg fehlt oder der Nutzer war
   * noch nie da. Ein noch unbekannter Serverzustand (health === null) zaehlt
   * NICHT als fehlendes ffmpeg — sonst ginge der Assistent auf, bevor
   * ueberhaupt jemand gefragt hat.
   */
  function shouldShow(state) {
    const st = state || store.get();
    if (!seenIntro()) return true;
    if (!st || !st.project) return true;
    if (!st.venue || !st.project.venueId) return true;
    const health = st.health;
    if (health && !(health.ffmpeg && health.ffmpeg.found)) return true;
    return false;
  }

  function open() {
    lastState = store.get();
    if (opened) { draw(true); return; }
    opened = true;
    if (!el.isConnected) {
      const root = (opts.root instanceof Node) ? opts.root : document.body;
      root.appendChild(el);
    }
    el.style.display = 'flex';
    manualPlatform = guessPlatform(lastState.health);
    ensureForStep(step);
    draw(true);
  }

  function close() {
    if (!opened) return;
    opened = false;
    writeSeenIntro(true);
    stepSync = null;
    el.style.display = 'none';
    clear(el);
    if (typeof opts.onClose === 'function') {
      try { opts.onClose(); } catch (e) { console.error('[tbg] onboarding onClose:', e); }
    }
  }

  // Zustandsaenderungen selbst mitlesen: der Rahmen ruft update() nicht
  // zwingend auf, der Fortschritt des ffmpeg-Downloads soll aber laufen.
  store.subscribe((state) => {
    lastState = state;
    runSync();
  });

  // Sprachwechsel: alles neu aufbauen, damit auch das Schaubild uebersetzt ist.
  onLangChange(() => { if (opened) draw(false); });

  // Escape. In der Capture-Phase, damit die Entscheidung VOR dem
  // Fenster-Empfaenger von main.js faellt: liegt ein Dialog aus dom.js
  // darueber (z.B. die Ordnerwahl), gehoert Escape ihm — sonst wuerden beide
  // auf einen Tastendruck schliessen.
  on(window, 'keydown', (ev) => {
    if (!opened || ev.key !== 'Escape') return;
    const overlay = document.getElementById('overlayRoot');
    if (overlay && overlay.classList.contains('on')) return;
    ev.preventDefault();
    close();
  }, true);

  return handle;
}
