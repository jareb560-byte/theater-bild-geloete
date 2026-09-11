/**
 * Theater-Bild-Gelöte — Venue-Editor.
 *
 * Ohne diese Ansicht taugt Theater-Bild-Gelöte nur fuer das eine Haus, fuer das es gebaut
 * wurde. Hier wird eine Spielstaette komplett beschrieben: Waende, ihre
 * Aufloesung, ihre Metermasse, die Panelaufteilung, die Buehnenposition und
 * die Auslieferungsformate.
 *
 * ---------------------------------------------------------------------------
 * AUFBAU
 * ---------------------------------------------------------------------------
 *   links   Liste aller Venues. Vorlagen tragen ein Schloss und lassen sich
 *           nur ueber "Duplizieren" veraendern.
 *   rechts  ganz oben die massstabsgetreue Vorschau (Draufsicht + Frontansicht),
 *           darunter der eigentliche Editor, ganz unten die Live-Pruefung.
 *
 * Die Vorschau ist der schnellste Weg zu sehen, ob die eingegebenen Zahlen
 * Unsinn sind: eine Wand, die 40 m breit im Plan liegt, faellt sofort auf,
 * eine falsche Ziffer in einem Zahlenfeld nicht.
 *
 * ---------------------------------------------------------------------------
 * WAS BEIM TIPPEN PASSIERT
 * ---------------------------------------------------------------------------
 *   1. Der Wert landet im Entwurf (draft). Das DOM wird NICHT neu gebaut,
 *      sonst springt der Schreibcursor.
 *   2. syncLive() zieht alle abgeleiteten Anzeigen nach (Pitch, px/m,
 *      Panelsumme) und zeichnet die Vorschau neu.
 *   3. Die lokale Pruefung laeuft sofort, die Serverpruefung entprellt nach
 *      300 ms. Solange Fehler anstehen, ist Speichern gesperrt.
 *
 * Neu aufgebaut wird nur bei baulichen Aenderungen (Wand/Panel/Preset hinzu
 * oder weg, Venue-Wechsel, Sprachwechsel).
 */

import { h, on, clear, openModal } from '../dom.js';
import { t, tn, register, onLangChange, fmtNum, fmtMeters } from '../i18n.js';
import {
  listVenues, getVenue, createVenue, updateVenue, deleteVenue,
  duplicateVenue, validateVenue, venueTemplate,
} from '../api.js';
import { setStatus, showError } from '../store.js';
import { deliveryName } from '/shared/model.js';

register('en', {
  /* Rahmen und Liste */
  'Venue-Editor': 'Venue editor',
  'Spielstätten': 'Venues',
  'Neu': 'New',
  'Duplizieren': 'Duplicate',
  'Löschen': 'Delete',
  'Als JSON exportieren': 'Export as JSON',
  'JSON importieren': 'Import JSON',
  'Bitte warten …': 'Please wait …',
  'Vorlage — zum Ändern duplizieren': 'Template — duplicate it to make changes',
  'Vorlage': 'Template',
  'in Benutzung': 'in use',
  'Dieses Venue benutzt das offene Projekt.': 'The open project uses this venue.',
  'Noch kein Venue angelegt. "Neu" legt eines an, "JSON importieren" liest eines ein.':
    'No venue yet. "New" creates one, "Import JSON" reads one in.',
  'Die Venue-Liste konnte nicht geladen werden': 'The venue list could not be loaded',
  'Das Venue konnte nicht geladen werden': 'The venue could not be loaded',
  'Kein Venue ausgewählt. Links eines wählen oder "Neu" drücken.':
    'No venue selected. Pick one on the left or press "New".',
  '{n} Wand': '{n} wall',
  '{n} Wände': '{n} walls',

  /* Speichern und ungespeicherte Änderungen */
  'Speichern': 'Save',
  'Verwerfen': 'Discard',
  'Abbrechen': 'Cancel',
  'Ungespeicherte Änderungen': 'Unsaved changes',
  'Das Venue "{name}" hat ungespeicherte Änderungen. Was soll damit geschehen?':
    'The venue "{name}" has unsaved changes. What should happen to them?',
  'Ungespeichert': 'Unsaved',
  'Gespeichert': 'Saved',
  'Venue "{name}" gespeichert.': 'Venue "{name}" saved.',
  'Das Venue konnte nicht gespeichert werden': 'The venue could not be saved',
  'Speichern ist gesperrt, solange Fehler anstehen.': 'Saving is locked while errors are pending.',
  'Vorlagen lassen sich nicht überschreiben. Erst duplizieren.':
    'Templates cannot be overwritten. Duplicate first.',
  'Das offene Projekt benutzt dieses Venue — nach dem Speichern neu laden, damit die Änderung greift.':
    'The open project uses this venue — reload it after saving so the change takes effect.',

  /* Anlegen, Duplizieren, Löschen */
  'Die Vorlage für ein neues Venue konnte nicht geholt werden': 'The template for a new venue could not be fetched',
  'Neues Venue — noch nicht gespeichert.': 'New venue — not saved yet.',
  'Das Venue konnte nicht dupliziert werden': 'The venue could not be duplicated',
  'Kopie von {name}': 'Copy of {name}',
  'Venue wirklich löschen?': 'Really delete this venue?',
  '"{name}" wird endgültig aus der Venue-Sammlung entfernt. Projekte, die darauf verweisen, finden ihr Venue danach nicht mehr.':
    '"{name}" will be removed from the venue collection for good. Projects referring to it will no longer find their venue.',
  'Das Venue konnte nicht gelöscht werden': 'The venue could not be deleted',
  'Venue "{name}" gelöscht.': 'Venue "{name}" deleted.',
  'Kennung schon vergeben': 'ID already taken',
  'Es gibt bereits ein Venue mit der Kennung "{id}". Überschreiben?':
    'A venue with the ID "{id}" already exists. Overwrite it?',
  'Überschreiben': 'Overwrite',

  /* Import / Export */
  'Die Datei ist kein gültiges JSON: {msg}': 'The file is not valid JSON: {msg}',
  'Die Datei enthält kein Venue (id und walls fehlen).': 'The file contains no venue (id and walls are missing).',
  'Der Server hat kein Venue geliefert.': 'The server returned no venue.',
  'Die Datei konnte nicht gelesen werden': 'The file could not be read',
  '"{name}" eingelesen und geprüft.': '"{name}" read in and validated.',
  '"{name}" eingelesen, aber wegen Fehlern nicht gespeichert.':
    '"{name}" read in, but not saved because of errors.',
  'Der Export ist fehlgeschlagen': 'The export failed',

  /* Kopfdaten */
  'Grunddaten': 'Basics',
  'Kennung': 'ID',
  'Kleinbuchstaben, Ziffern und Bindestrich. Sie steht im Projekt und im Dateinamen.':
    'Lower-case letters, digits and hyphens. It appears in the project and in file names.',
  'Name': 'Name',
  'Bildrate': 'Frame rate',
  'Pixelpitch': 'Pixel pitch',
  'Abstand zwischen zwei LED-Mittelpunkten. Bestimmt, wie nah Zuschauer herangehen können.':
    'Distance between two LED centres. It determines how close the audience may come.',
  'Quelle / Notiz': 'Source / note',
  'Woher stammen die Zahlen? Dokument, Version, Ansprechpartner.':
    'Where do the numbers come from? Document, version, contact.',

  /* Wände */
  'Wände': 'Walls',
  'Wand hinzufügen': 'Add wall',
  'Wand entfernen': 'Remove wall',
  'Nach oben': 'Move up',
  'Nach unten': 'Move down',
  'Noch keine Wand. Ohne Wand kann nichts gerendert werden.':
    'No wall yet. Without a wall nothing can be rendered.',
  'Beschriftung': 'Label',
  'Auflösung': 'Resolution',
  'Maße': 'Dimensions',
  'Breite': 'Width',
  'Höhe': 'Height',
  'px pro Meter': 'px per metre',
  'Pitch {mm} mm · {ppm} px/m': 'Pitch {mm} mm · {ppm} px/m',
  'Der Pitch dieser Wand weicht von {ref} mm ab.': 'This wall\'s pitch differs from {ref} mm.',
  'Nicht quadratische Pixel: waagerecht {x} mm, senkrecht {y} mm.':
    'Non-square pixels: {x} mm horizontally, {y} mm vertically.',

  /* Panels */
  'Panelaufteilung': 'Panel layout',
  'gleichmäßig aufteilen': 'Split evenly',
  'Panel hinzufügen': 'Add panel',
  'Panel entfernen': 'Remove panel',
  'Panel': 'Panel',
  'Rest geht auf das letzte Panel.': 'The remainder goes to the last panel.',
  'Noch kein Panel. Mindestens eines ist Pflicht — sonst gibt es keine Einzeldateien.':
    'No panel yet. At least one is required — otherwise there are no individual files.',
  'Summe {sum} px von {want} px — stimmt.': 'Sum {sum} px of {want} px — matches.',
  'Summe {sum} px von {want} px — Differenz {diff} px.': 'Sum {sum} px of {want} px — difference {diff} px.',
  'Die x-Versätze werden aus den Breiten berechnet, lückenlos von links.':
    'The x offsets are computed from the widths, gapless from the left.',

  /* Naht, Sperrzone, Bühne */
  'Mittelnaht': 'Center seam',
  'Vorgabe: halbe Wandbreite': 'Default: half the wall width',
  'Spalte, an der die Wand aufgeht. Vorgabe ist die Wandmitte.':
    'The column where the wall opens. The default is the wall centre.',
  'Sperrzone': 'Safe area',
  'Anteil am Rand, in dem kein wichtiges Motiv liegen darf.':
    'Margin share in which no important content may sit.',
  'Bühnenposition': 'Stage position',
  'Tiefe z': 'Depth z',
  'Abstand zur vordersten Wand, in Metern. Größer heißt weiter hinten.':
    'Distance from the frontmost wall, in metres. Larger means further upstage.',
  'Bodenversatz': 'Floor offset',
  'Unterkante über dem Bühnenboden.': 'Bottom edge above the stage floor.',
  'maximaler Fahrweg': 'Maximum travel',
  'Wie weit ein Wandteil zur Seite fahren kann.': 'How far a wall section can travel sideways.',

  /* Delivery */
  'Delivery-Presets': 'Delivery presets',
  'Preset hinzufügen': 'Add preset',
  'Preset entfernen': 'Remove preset',
  'Standardpresets einfügen': 'Insert standard presets',
  'Fügt HAP, HAP Q, HAP Alpha, ProRes 422, ProRes 4444 Alpha und H.264 ein, sofern noch nicht vorhanden.':
    'Inserts HAP, HAP Q, HAP Alpha, ProRes 422, ProRes 4444 Alpha and H.264 unless already present.',
  '{n} Preset eingefügt.': '{n} preset inserted.',
  '{n} Presets eingefügt.': '{n} presets inserted.',
  'Alle Standardpresets sind schon vorhanden.': 'All standard presets are already present.',
  'Endung': 'Extension',
  'Codec-Kürzel': 'Codec tag',
  'Steht im Dateinamen an der Stelle {CODEC}.': 'Appears in the file name where {CODEC} sits.',
  'Argumente': 'Arguments',
  'ffmpeg-Argumente, durch Leerzeichen getrennt.': 'ffmpeg arguments, separated by spaces.',
  'Bytes pro Pixel': 'Bytes per pixel',
  'Nur für die Abschätzung des Platzbedarfs.': 'Only used to estimate the space required.',
  'mit Alphakanal': 'with alpha channel',
  'Noch kein Preset. Ohne Preset kann nichts ausgeliefert werden.':
    'No preset yet. Without a preset nothing can be delivered.',

  /* Namensschema */
  'Namensschema für Dateinamen': 'File name pattern',
  'Platzhalter: {WALL} {W} {H} {FPS} {CODEC}': 'Placeholders: {WALL} {W} {H} {FPS} {CODEC}',
  'Beispiel': 'Example',
  'Kein Beispiel möglich: {msg}': 'No example possible: {msg}',
  'Standardpreset': 'Default preset',
  '(keines)': '(none)',

  /* Freitext */
  'Annahmen': 'Assumptions',
  'Was ist geraten und noch nicht bestätigt? Eine Zeile je Annahme.':
    'What is guessed and not yet confirmed? One line per assumption.',
  'Offene Fragen': 'Open questions',
  'Was muss vor der Produktion geklärt werden? Eine Zeile je Frage.':
    'What has to be clarified before production? One line per question.',

  /* Vorschau */
  'Vorschau': 'Preview',
  'Draufsicht': 'Plan view',
  'Frontansicht': 'Front view',
  'Draufsicht der Bühne, Wandbreiten und Tiefe in Metern':
    'Plan view of the stage, wall widths and depth in metres',
  'Frontansicht der Wände mit Panelaufteilung und Nähten':
    'Front view of the walls with panel layout and seams',
  'Zuschauer': 'Audience',
  'Bühne': 'Stage',
  'Ohne Metermaße lässt sich nichts maßstabsgetreu zeichnen.':
    'Without metric dimensions nothing can be drawn to scale.',
  'Boden': 'Floor',

  /* Prüfung */
  'Live-Prüfung': 'Live validation',
  'Fehler': 'Error',
  'Warnung': 'Warning',
  'Hinweis': 'Note',
  'Keine Beanstandung.': 'Nothing to report.',
  'Die Serverprüfung ist fehlgeschlagen: {msg}': 'The server validation failed: {msg}',
  'Wird geprüft …': 'Validating …',

  /* Lokale Prüftexte */
  'Die Kennung fehlt.': 'The ID is missing.',
  'Ohne Kennung lässt sich das Venue nicht speichern.': 'Without an ID the venue cannot be saved.',
  'Die Kennung "{id}" enthält Zeichen, die in Dateinamen Ärger machen.':
    'The ID "{id}" contains characters that cause trouble in file names.',
  'Nur Kleinbuchstaben, Ziffern, Bindestrich und Unterstrich benutzen.':
    'Use only lower-case letters, digits, hyphens and underscores.',
  'Der Name fehlt.': 'The name is missing.',
  'Ohne Namen steht in jeder Auswahlliste nur die Kennung.': 'Without a name every list only shows the ID.',
  'Die Bildrate ist keine sinnvolle Zahl.': 'The frame rate is not a sensible number.',
  'Übliche Werte sind 24, 25, 30, 50 und 60.': 'Common values are 24, 25, 30, 50 and 60.',
  'Kein Pixelpitch angegeben.': 'No pixel pitch given.',
  'Ohne Pitch fehlt die Grundlage für Moiré- und Abstandsprüfungen.':
    'Without a pitch there is no basis for moiré and viewing-distance checks.',
  'Das Venue hat keine Wand.': 'The venue has no wall.',
  'Mindestens eine Wand ist Pflicht.': 'At least one wall is required.',
  'Die Wandkennung "{id}" kommt mehrfach vor.': 'The wall ID "{id}" appears more than once.',
  'Jede Wand braucht eine eigene Kennung.': 'Every wall needs its own ID.',
  'Wand ohne Kennung.': 'Wall without an ID.',
  'Die Auflösung ist unvollständig.': 'The resolution is incomplete.',
  'Breite und Höhe in Pixeln müssen größer als 0 sein.': 'Width and height in pixels must be greater than 0.',
  'Die Metermaße fehlen.': 'The metric dimensions are missing.',
  'Ohne Metermaße gibt es keine 3D-Ansicht und keinen Pitch.':
    'Without metric dimensions there is no 3D view and no pitch.',
  'Die Wand hat kein Panel.': 'The wall has no panel.',
  'Ohne Panel entstehen keine Einzeldateien.': 'Without a panel no individual files are produced.',
  'Die Panelbreiten ergeben {sum} px, die Wand ist {want} px breit.':
    'The panel widths add up to {sum} px, the wall is {want} px wide.',
  'Differenz {diff} px. Panelbreiten anpassen oder gleichmäßig aufteilen.':
    'Difference {diff} px. Adjust the panel widths or split evenly.',
  'Die Panelkennung "{id}" kommt in dieser Wand mehrfach vor.':
    'The panel ID "{id}" appears more than once in this wall.',
  'Panelbreite {n} ist keine sinnvolle Zahl.': 'Panel width {n} is not a sensible number.',
  'Die Mittelnaht liegt außerhalb der Wand.': 'The center seam lies outside the wall.',
  'Erlaubt sind 0 bis {max} px.': 'Allowed is 0 to {max} px.',
  'Die Sperrzone ist unrealistisch groß.': 'The safe area is unrealistically large.',
  'Über 40 % Rand lassen kaum Bildfläche übrig.': 'More than 40 % margin leaves hardly any picture area.',
  'Der Fahrweg ist größer als die Wand breit ist.': 'The travel is larger than the wall is wide.',
  'Das ist möglich, aber ungewöhnlich — bitte bestätigen.':
    'That is possible, but unusual — please confirm.',
  'Der Pixelpitch weicht zwischen den Wänden ab ({min} bis {max} mm).':
    'The pixel pitch differs between the walls ({min} to {max} mm).',
  'Gemischte Pitches sind erlaubt, machen aber jede Parallaxenrechnung ungenau.':
    'Mixed pitches are allowed, but they make every parallax calculation inaccurate.',
  'Es gibt kein Delivery-Preset.': 'There is no delivery preset.',
  'Ohne Preset lässt sich nichts ausliefern.': 'Without a preset nothing can be delivered.',
  'Die Preset-Kennung "{id}" kommt mehrfach vor.': 'The preset ID "{id}" appears more than once.',
  'Preset "{id}" hat keine Endung.': 'Preset "{id}" has no extension.',
  'Ohne Endung entsteht ein Dateiname ohne Typ.': 'Without an extension the file name has no type.',
  'Preset "{id}" hat keine ffmpeg-Argumente.': 'Preset "{id}" has no ffmpeg arguments.',
  'Ohne Argumente weiß ffmpeg nicht, womit es kodieren soll.':
    'Without arguments ffmpeg does not know what to encode with.',
  'Das Namensschema enthält kein {WALL}.': 'The file name pattern contains no {WALL}.',
  'Dann heißen alle Wände gleich und überschreiben sich beim Export.':
    'Then all walls have the same name and overwrite each other on export.',
  'Das Standardpreset "{id}" gibt es nicht.': 'The default preset "{id}" does not exist.',
  'Eines der vorhandenen Presets wählen.': 'Pick one of the presets that exist.',
});

/* ==========================================================================
 * Konstanten
 * ========================================================================== */

/** Presets, die "Standardpresets einfuegen" anlegt. Werte wie im Beispiel-Venue. */
const STANDARD_PRESETS = [
  { id: 'hap', label: 'HAP', ext: 'mov', codecTag: 'HAP', bytesPerPixel: 0.5, alpha: false,
    args: ['-c:v', 'hap', '-format', 'hap', '-chunks', '4', '-an'] },
  { id: 'hap_q', label: 'HAP Q', ext: 'mov', codecTag: 'HAP', bytesPerPixel: 1, alpha: false,
    args: ['-c:v', 'hap', '-format', 'hap_q', '-chunks', '4', '-an'] },
  { id: 'hap_alpha', label: 'HAP Alpha', ext: 'mov', codecTag: 'HAPAlpha', bytesPerPixel: 1.0, alpha: true,
    args: ['-c:v', 'hap', '-format', 'hap_alpha', '-chunks', '4', '-an'] },
  { id: 'prores422', label: 'ProRes 422', ext: 'mov', codecTag: 'ProRes422', bytesPerPixel: 0.62, alpha: false,
    args: ['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-an'] },
  { id: 'prores4444a', label: 'ProRes 4444 Alpha', ext: 'mov', codecTag: 'ProRes4444Alpha', bytesPerPixel: 1.4, alpha: true,
    args: ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '8', '-an'] },
  // Die Beschriftungen sind Fachkuerzel und bleiben in jeder Sprache gleich —
  // sie landen als Daten im Venue, nicht nur auf dem Schirm.
  { id: 'h264_review', label: 'H.264 Review', ext: 'mp4', codecTag: 'h264', bytesPerPixel: 0.02, alpha: false,
    args: ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'] },
];

const SPLIT_COUNTS = [2, 3, 4, 6, 8];

/** Zeichenflaeche der beiden Vorschau-SVGs in Nutzereinheiten. */
const SVG_W = 620;
const SVG_H = 200;
const SVG_PAD = 22;

/* ==========================================================================
 * Kleinkram
 * ========================================================================== */

function clone(v) {
  try {
    return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
  } catch {
    return JSON.parse(JSON.stringify(v));
  }
}

/** Endliche Zahl oder Ersatzwert — NaN kommt aus halb getippten Feldern. */
function fin(n, fallback = 0) {
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Server-Antworten vertragen kleine Formunterschiede: manche Endpunkte
 * liefern das nackte Objekt, manche eine Huelle. Beides wird akzeptiert,
 * damit ein Formatdetail nicht die ganze Ansicht lahmlegt.
 */
function asVenue(x) {
  if (!x || typeof x !== 'object') return null;
  if (Array.isArray(x.walls)) return x;
  if (x.venue && typeof x.venue === 'object') return x.venue;
  return x;
}

function asList(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.venues)) return x.venues;
  if (x && Array.isArray(x.items)) return x.items;
  return [];
}

function asProblems(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.problems)) return x.problems;
  if (x && Array.isArray(x.issues)) return x.issues;
  return [];
}

/**
 * Traegt der Listeneintrag oder das Venue eine Vorlagen-Markierung?
 * Der Server liefert `builtin` in der Kurzliste und `_builtin` im vollen
 * Venue; die uebrigen Namen sind Vorsicht gegen spaetere Umbenennungen.
 */
function isTemplate(v) {
  if (!v || typeof v !== 'object') return false;
  return !!(v.builtin || v._builtin || v.template || v.isTemplate || v.readOnly || v.readonly || v.locked);
}

/**
 * Interne Felder des Servers (_builtin, _path, …) gehoeren weder in eine
 * Exportdatei noch in den Speicherbefehl — sie beschreiben, wo ein Venue
 * liegt, nicht was es ist.
 */
function cleanVenue(v) {
  const out = clone(v);
  for (const key of Object.keys(out)) {
    if (key.startsWith('_') || key === 'sourceFile' || key === 'inheritsFrom') delete out[key];
  }
  return out;
}

function levelLabel(level) {
  if (level === 'error') return t('Fehler');
  if (level === 'warn') return t('Warnung');
  return t('Hinweis');
}

function levelClass(level) {
  if (level === 'error') return 'err';
  if (level === 'warn') return 'warn';
  return '';
}

/** Waagerechter Pitch einer Wand in mm, oder NaN. */
function wallPitchMm(wall) {
  const px = fin(wall.width, 0);
  const m = fin(wall.widthM, 0);
  if (px <= 0 || m <= 0) return NaN;
  return (m * 1000) / px;
}

function wallPitchMmY(wall) {
  const px = fin(wall.height, 0);
  const m = fin(wall.heightM, 0);
  if (px <= 0 || m <= 0) return NaN;
  return (m * 1000) / px;
}

function pxPerMeter(wall) {
  const px = fin(wall.width, 0);
  const m = fin(wall.widthM, 0);
  if (px <= 0 || m <= 0) return NaN;
  return px / m;
}

function panelSum(wall) {
  return (wall.panels || []).reduce((a, p) => a + fin(p.width, 0), 0);
}

/** x-Versaetze lueckenlos aus den Breiten neu rechnen. */
function recalcPanelX(wall) {
  let x = 0;
  for (const p of wall.panels || []) {
    p.x = x;
    x += fin(p.width, 0);
  }
}

/** Panel-Metermass mitziehen, aber nur wenn es schon eines gab. */
function recalcPanelMeters(wall) {
  const wpx = fin(wall.width, 0);
  const wm = fin(wall.widthM, 0);
  for (const p of wall.panels || []) {
    if (!('widthM' in p)) continue;
    p.widthM = wpx > 0 && wm > 0 ? Number(((fin(p.width, 0) / wpx) * wm).toFixed(4)) : 0;
  }
}

function nextWallId(venue) {
  const used = new Set((venue.walls || []).map((w) => String(w.id || '')));
  for (let i = 0; i < 26; i += 1) {
    const id = String.fromCharCode(65 + i);
    if (!used.has(id)) return id;
  }
  return `W${(venue.walls || []).length + 1}`;
}

function makeWall(venue) {
  const id = nextWallId(venue);
  return {
    id,
    label: id,
    width: 1920,
    height: 1080,
    widthM: 7.68,
    heightM: 4.32,
    panels: [{ id: `${id}1`, x: 0, width: 1920 }],
    centerSeamX: 960,
    safeAreaPct: 0.1,
    stage: { z: 0, floorOffsetM: 0, travelMaxM: 0, verified: false },
  };
}

/* ==========================================================================
 * Lokale Pruefung
 *
 * Laeuft ohne Server und sofort. Sie ersetzt die Serverpruefung nicht, sorgt
 * aber dafuer, dass grobe Fehler auch dann sichtbar sind, wenn der Server
 * gerade nicht antwortet — und dass Speichern sofort sperrt statt erst nach
 * der Entprellung.
 * ========================================================================== */

function localProblems(v) {
  const out = [];
  const add = (level, where, msg, hint) => out.push({ level, where, msg, hint });
  if (!v) return out;

  const id = String(v.id || '').trim();
  if (!id) {
    add('error', t('Grunddaten'), t('Die Kennung fehlt.'), t('Ohne Kennung lässt sich das Venue nicht speichern.'));
  } else if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    add('error', t('Grunddaten'), t('Die Kennung "{id}" enthält Zeichen, die in Dateinamen Ärger machen.', { id }),
      t('Nur Kleinbuchstaben, Ziffern, Bindestrich und Unterstrich benutzen.'));
  }
  if (!String(v.name || '').trim()) {
    add('warn', t('Grunddaten'), t('Der Name fehlt.'), t('Ohne Namen steht in jeder Auswahlliste nur die Kennung.'));
  }
  if (!Number.isFinite(v.fps) || v.fps <= 0 || v.fps > 240) {
    add('error', t('Grunddaten'), t('Die Bildrate ist keine sinnvolle Zahl.'), t('Übliche Werte sind 24, 25, 30, 50 und 60.'));
  }
  if (!Number.isFinite(v.pixelPitchMm) || v.pixelPitchMm <= 0) {
    add('warn', t('Grunddaten'), t('Kein Pixelpitch angegeben.'),
      t('Ohne Pitch fehlt die Grundlage für Moiré- und Abstandsprüfungen.'));
  }

  const walls = Array.isArray(v.walls) ? v.walls : [];
  if (walls.length === 0) {
    add('error', t('Wände'), t('Das Venue hat keine Wand.'), t('Mindestens eine Wand ist Pflicht.'));
  }

  const seenWall = new Set();
  const pitches = [];
  for (const w of walls) {
    const where = `${t('Wände')} / ${w.id || '?'}`;
    const wid = String(w.id || '').trim();
    if (!wid) add('error', where, t('Wand ohne Kennung.'), t('Jede Wand braucht eine eigene Kennung.'));
    else if (seenWall.has(wid)) add('error', where, t('Die Wandkennung "{id}" kommt mehrfach vor.', { id: wid }), t('Jede Wand braucht eine eigene Kennung.'));
    else seenWall.add(wid);

    if (!Number.isFinite(w.width) || w.width <= 0 || !Number.isFinite(w.height) || w.height <= 0) {
      add('error', where, t('Die Auflösung ist unvollständig.'), t('Breite und Höhe in Pixeln müssen größer als 0 sein.'));
    }
    if (!Number.isFinite(w.widthM) || w.widthM <= 0 || !Number.isFinite(w.heightM) || w.heightM <= 0) {
      add('error', where, t('Die Metermaße fehlen.'), t('Ohne Metermaße gibt es keine 3D-Ansicht und keinen Pitch.'));
    }

    const panels = Array.isArray(w.panels) ? w.panels : [];
    if (panels.length === 0) {
      add('error', where, t('Die Wand hat kein Panel.'), t('Ohne Panel entstehen keine Einzeldateien.'));
    } else {
      const sum = panelSum(w);
      if (Number.isFinite(w.width) && w.width > 0 && sum !== w.width) {
        add('error', where, t('Die Panelbreiten ergeben {sum} px, die Wand ist {want} px breit.',
          { sum: fmtNum(sum, 0), want: fmtNum(w.width, 0) }),
        t('Differenz {diff} px. Panelbreiten anpassen oder gleichmäßig aufteilen.',
          { diff: fmtNum(w.width - sum, 0) }));
      }
      const seenPanel = new Set();
      panels.forEach((p, i) => {
        const pid = String(p.id || '').trim();
        if (pid && seenPanel.has(pid)) {
          add('error', where, t('Die Panelkennung "{id}" kommt in dieser Wand mehrfach vor.', { id: pid }),
            t('Jede Wand braucht eine eigene Kennung.'));
        }
        if (pid) seenPanel.add(pid);
        if (!Number.isFinite(p.width) || p.width <= 0) {
          add('error', where, t('Panelbreite {n} ist keine sinnvolle Zahl.', { n: i + 1 }),
            t('Breite und Höhe in Pixeln müssen größer als 0 sein.'));
        }
      });
    }

    if (Number.isFinite(w.width) && w.width > 0
      && (!Number.isFinite(w.centerSeamX) || w.centerSeamX < 0 || w.centerSeamX > w.width)) {
      add('warn', where, t('Die Mittelnaht liegt außerhalb der Wand.'),
        t('Erlaubt sind 0 bis {max} px.', { max: fmtNum(w.width, 0) }));
    }
    if (Number.isFinite(w.safeAreaPct) && w.safeAreaPct > 0.4) {
      add('warn', where, t('Die Sperrzone ist unrealistisch groß.'), t('Über 40 % Rand lassen kaum Bildfläche übrig.'));
    }
    const travel = fin(w.stage?.travelMaxM, 0);
    if (Number.isFinite(w.widthM) && w.widthM > 0 && travel > w.widthM) {
      add('warn', where, t('Der Fahrweg ist größer als die Wand breit ist.'), t('Das ist möglich, aber ungewöhnlich — bitte bestätigen.'));
    }

    const p = wallPitchMm(w);
    if (Number.isFinite(p)) pitches.push(p);
    const py = wallPitchMmY(w);
    if (Number.isFinite(p) && Number.isFinite(py) && Math.abs(p - py) > 0.05) {
      add('info', where, t('Nicht quadratische Pixel: waagerecht {x} mm, senkrecht {y} mm.',
        { x: fmtNum(p, 2), y: fmtNum(py, 2) }),
      t('Gemischte Pitches sind erlaubt, machen aber jede Parallaxenrechnung ungenau.'));
    }
  }

  if (pitches.length > 1) {
    const min = Math.min(...pitches);
    const max = Math.max(...pitches);
    if (max - min > 0.05) {
      add('warn', t('Wände'), t('Der Pixelpitch weicht zwischen den Wänden ab ({min} bis {max} mm).',
        { min: fmtNum(min, 2), max: fmtNum(max, 2) }),
      t('Gemischte Pitches sind erlaubt, machen aber jede Parallaxenrechnung ungenau.'));
    }
  }

  const presets = Array.isArray(v.delivery?.presets) ? v.delivery.presets : [];
  if (presets.length === 0) {
    add('warn', t('Delivery-Presets'), t('Es gibt kein Delivery-Preset.'), t('Ohne Preset lässt sich nichts ausliefern.'));
  }
  const seenPreset = new Set();
  for (const p of presets) {
    const pid = String(p.id || '').trim();
    if (pid && seenPreset.has(pid)) {
      add('error', t('Delivery-Presets'), t('Die Preset-Kennung "{id}" kommt mehrfach vor.', { id: pid }),
        t('Eines der vorhandenen Presets wählen.'));
    }
    if (pid) seenPreset.add(pid);
    if (!String(p.ext || '').trim()) {
      add('warn', t('Delivery-Presets'), t('Preset "{id}" hat keine Endung.', { id: pid || '?' }),
        t('Ohne Endung entsteht ein Dateiname ohne Typ.'));
    }
    if (!Array.isArray(p.args) || p.args.length === 0) {
      add('warn', t('Delivery-Presets'), t('Preset "{id}" hat keine ffmpeg-Argumente.', { id: pid || '?' }),
        t('Ohne Argumente weiß ffmpeg nicht, womit es kodieren soll.'));
    }
  }

  const pattern = String(v.delivery?.namePattern || '');
  if (pattern && !pattern.includes('{WALL}')) {
    add('warn', t('Namensschema für Dateinamen'), t('Das Namensschema enthält kein {WALL}.'),
      t('Dann heißen alle Wände gleich und überschreiben sich beim Export.'));
  }
  const def = String(v.delivery?.defaultPreset || '');
  if (def && !presets.some((p) => p.id === def)) {
    add('warn', t('Delivery-Presets'), t('Das Standardpreset "{id}" gibt es nicht.', { id: def }),
      t('Eines der vorhandenen Presets wählen.'));
  }

  return out;
}

/* ==========================================================================
 * Der Editor
 * ========================================================================== */

/**
 * opts (alle freiwillig — ohne sie meldet der Editor direkt an den Store):
 *   onStatus(text, level)        Statuszeile
 *   onError(prefix, err)         Fehler melden
 *   onVenueChanged()             ein Venue wurde angelegt, geaendert, kopiert
 *                                oder geloescht — der Rahmen muss seine
 *                                Venue-Liste neu holen
 */
export function createVenueEditor(opts = {}) {
  /* --------------------------------------------------- Meldungen nach aussen */

  function emitStatus(text, level = '') {
    if (typeof opts.onStatus === 'function') {
      try { opts.onStatus(text, level); return; } catch (e) { console.error('[tbg] onStatus:', e); }
    }
    setStatus(text, level);
  }

  function emitError(prefix, err) {
    if (typeof opts.onError === 'function') {
      try { opts.onError(prefix, err); return; } catch (e) { console.error('[tbg] onError:', e); }
    }
    showError(prefix, err);
  }

  /** Der Rahmen haelt eine eigene Venue-Liste — die muss nachziehen. */
  function emitVenueChanged() {
    if (typeof opts.onVenueChanged !== 'function') return;
    try {
      opts.onVenueChanged();
    } catch (e) {
      console.error('[tbg] onVenueChanged:', e);
      emitError(t('Die Venue-Liste konnte nicht geladen werden'), e);
    }
  }

  /* ------------------------------------------------------------ Zustand */
  let venues = [];          // Kurzliste vom Server
  let listError = null;     // Klartext, falls die Liste nicht kam
  let loadedId = null;      // Kennung, unter der das Venue auf dem Server liegt
  let loadedTemplate = false;
  let draft = null;         // bearbeitete Kopie, wird an Ort und Stelle veraendert
  let dirty = false;
  let serverProblems = [];
  let serverError = null;
  let validating = false;
  let validateTimer = null;
  let validateToken = 0;
  let projectVenueId = null;
  let busy = false;
  const expanded = new Set();  // aufgeklappte Waende
  let liveSyncs = [];          // Nachziehen abgeleiteter Anzeigen ohne Neuaufbau

  /* ------------------------------------------------------------ Geruest */
  const elList = h('div.col', { style: 'gap:0' });
  const elListButtons = h('div.row.wrap', { style: 'gap:4px;padding:6px 0' });
  const elPreview = h('div.col');
  const elEditor = h('div.col');
  const elProblems = h('div.col');
  const elSaveRow = h('div.row', { style: 'gap:6px' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });

  // Ueberschriften der festen Kaesten. Sie werden nicht neu gebaut, deshalb
  // wird ihr Text beim Sprachwechsel von Hand nachgezogen.
  const hdList = h('div.hd', t('Spielstätten'));
  const hdPreview = h('div.hd', t('Vorschau'));
  const hdCheck = h('div.hd', t('Live-Prüfung'));

  const left = h('div.sec', { style: 'border:1px solid var(--ln);border-radius:3px' },
    hdList,
    h('div.bd', { style: 'padding:0 6px 6px' }, elListButtons, elList));

  const right = h('div.col',
    h('div.sec', { style: 'border:1px solid var(--ln);border-radius:3px' },
      hdPreview,
      h('div.bd', elPreview)),
    elEditor,
    h('div.sec', { style: 'border:1px solid var(--ln);border-radius:3px' },
      hdCheck,
      h('div.bd', elProblems, elSaveRow)));

  const grid = h('div', { style: 'display:grid;grid-template-columns:250px minmax(0,1fr);gap:9px;align-items:start' },
    left, right);

  const el = h('div.viewbody', h('div.pad', grid, fileInput));

  /* ------------------------------------------------------------ Server */

  async function refreshList() {
    try {
      venues = asList(await listVenues()).filter((v) => v && v.id);
      listError = null;
    } catch (e) {
      venues = [];
      listError = e && e.message ? e.message : String(e);
      emitError(t('Die Venue-Liste konnte nicht geladen werden'), e);
    }
  }

  async function loadVenue(id) {
    const v = asVenue(await getVenue(id));
    if (!v) throw new Error(t('Der Server hat kein Venue geliefert.'));
    draft = clone(v);
    if (!draft.delivery || typeof draft.delivery !== 'object') draft.delivery = { presets: [] };
    if (!Array.isArray(draft.delivery.presets)) draft.delivery.presets = [];
    if (!Array.isArray(draft.walls)) draft.walls = [];
    loadedId = id;
    loadedTemplate = isTemplate(v) || isTemplate(venues.find((x) => x.id === id));
    dirty = false;
    serverProblems = [];
    serverError = null;
    expanded.clear();
    if (draft.walls[0]) expanded.add(String(draft.walls[0].id));
  }

  /** Venue-Wechsel mit Rueckfrage bei ungespeicherten Aenderungen. */
  async function select(id) {
    if (id === loadedId && draft) return true;
    if (dirty && draft) {
      const answer = await askUnsaved();
      if (answer === 'cancel') return false;
      if (answer === 'save') {
        const ok = await save();
        if (!ok) return false;
      }
    }
    try {
      busy = true;
      renderAll();
      await loadVenue(id);
      scheduleValidate();
      return true;
    } catch (e) {
      emitError(t('Das Venue konnte nicht geladen werden'), e);
      draft = null;
      loadedId = null;
      return false;
    } finally {
      busy = false;
      renderAll();
    }
  }

  async function save() {
    if (!draft) return false;
    if (loadedTemplate) {
      emitStatus(t('Vorlagen lassen sich nicht überschreiben. Erst duplizieren.'), 'warn');
      return false;
    }
    if (localProblems(draft).some((p) => p.level === 'error')) {
      emitStatus(t('Speichern ist gesperrt, solange Fehler anstehen.'), 'warn');
      return false;
    }
    const payload = cleanVenue(draft);
    try {
      busy = true;
      renderAll();
      if (loadedId) {
        await updateVenue(loadedId, payload);
      } else {
        const collision = venues.some((v) => v.id === payload.id);
        if (collision) {
          const ok = await askOverwrite(payload.id);
          if (!ok) return false;
          await updateVenue(payload.id, payload);
        } else {
          await createVenue(payload);
        }
      }
      loadedId = payload.id;
      dirty = false;
      await refreshList();
      emitVenueChanged();
      const saved = t('Venue "{name}" gespeichert.', { name: payload.name || payload.id });
      if (projectVenueId && projectVenueId === loadedId) {
        emitStatus(`${saved} ${t('Das offene Projekt benutzt dieses Venue — nach dem Speichern neu laden, damit die Änderung greift.')}`, 'warn');
      } else {
        emitStatus(saved, 'ok');
      }
      return true;
    } catch (e) {
      emitError(t('Das Venue konnte nicht gespeichert werden'), e);
      return false;
    } finally {
      busy = false;
      renderAll();
    }
  }

  async function createNew() {
    if (dirty && draft) {
      const answer = await askUnsaved();
      if (answer === 'cancel') return;
      if (answer === 'save' && !(await save())) return;
    }
    try {
      busy = true;
      renderAll();
      const v = asVenue(await venueTemplate());
      if (!v) throw new Error(t('Der Server hat kein Venue geliefert.'));
      draft = clone(v);
      if (!draft.delivery || typeof draft.delivery !== 'object') draft.delivery = { presets: [] };
      if (!Array.isArray(draft.delivery.presets)) draft.delivery.presets = [];
      if (!Array.isArray(draft.walls)) draft.walls = [];
      loadedId = null;
      loadedTemplate = false;
      dirty = true;
      serverProblems = [];
      serverError = null;
      expanded.clear();
      if (draft.walls[0]) expanded.add(String(draft.walls[0].id));
      emitStatus(t('Neues Venue — noch nicht gespeichert.'));
      scheduleValidate();
    } catch (e) {
      emitError(t('Die Vorlage für ein neues Venue konnte nicht geholt werden'), e);
    } finally {
      busy = false;
      renderAll();
    }
  }

  async function duplicateCurrent() {
    if (!loadedId) return;
    const src = venues.find((v) => v.id === loadedId) || draft || {};
    const newId = freeId(`${loadedId}-kopie`);
    const newName = t('Kopie von {name}', { name: src.name || loadedId });
    try {
      busy = true;
      renderAll();
      // Vertrag: duplicateVenue(quelle, { id, name }). Kommt ein Venue zurueck,
      // wird dessen Kennung benutzt — der Server darf eine eigene vergeben.
      const res = asVenue(await duplicateVenue(loadedId, { id: newId, name: newName }));
      await refreshList();
      emitVenueChanged();
      const targetId = (res && res.id) || newId;
      dirty = false;
      loadedId = null;
      draft = null;
      await select(targetId);
    } catch (e) {
      emitError(t('Das Venue konnte nicht dupliziert werden'), e);
      busy = false;
      renderAll();
    } finally {
      busy = false;
    }
  }

  async function removeCurrent() {
    if (!loadedId) return;
    const name = draft?.name || loadedId;
    const ok = await askDelete(name);
    if (!ok) return;
    try {
      busy = true;
      renderAll();
      await deleteVenue(loadedId);
      emitStatus(t('Venue "{name}" gelöscht.', { name }), 'ok');
      draft = null;
      loadedId = null;
      dirty = false;
      await refreshList();
      emitVenueChanged();
      if (venues[0]) await select(venues[0].id);
    } catch (e) {
      emitError(t('Das Venue konnte nicht gelöscht werden'), e);
    } finally {
      busy = false;
      renderAll();
    }
  }

  function freeId(base) {
    const used = new Set(venues.map((v) => String(v.id)));
    let id = base;
    let n = 2;
    while (used.has(id)) { id = `${base}-${n}`; n += 1; }
    return id;
  }

  /* ------------------------------------------------------- Import / Export */

  function exportJson() {
    if (!draft) return;
    try {
      const text = JSON.stringify(cleanVenue(draft), null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `${draft.id || 'venue'}.json` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      emitError(t('Der Export ist fehlgeschlagen'), e);
    }
  }

  on(fileInput, 'change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (dirty && draft) {
      const answer = await askUnsaved();
      if (answer === 'cancel') return;
      if (answer === 'save' && !(await save())) return;
    }
    let parsed = null;
    try {
      const text = await file.text();
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        emitError(t('Die Datei konnte nicht gelesen werden'), new Error(t('Die Datei ist kein gültiges JSON: {msg}', { msg: e.message })));
        return;
      }
    } catch (e) {
      emitError(t('Die Datei konnte nicht gelesen werden'), e);
      return;
    }
    const v = asVenue(parsed);
    if (!v || !v.id || !Array.isArray(v.walls)) {
      emitError(t('Die Datei konnte nicht gelesen werden'), new Error(t('Die Datei enthält kein Venue (id und walls fehlen).')));
      return;
    }
    draft = clone(v);
    if (!draft.delivery || typeof draft.delivery !== 'object') draft.delivery = { presets: [] };
    if (!Array.isArray(draft.delivery.presets)) draft.delivery.presets = [];
    loadedId = null;
    loadedTemplate = false;
    dirty = true;
    serverProblems = [];
    serverError = null;
    expanded.clear();
    if (draft.walls[0]) expanded.add(String(draft.walls[0].id));
    renderAll();

    // Erst pruefen, dann speichern — fehlerhafte Dateien landen nicht im Ordner.
    await runValidate();
    const bad = localProblems(draft).some((p) => p.level === 'error')
      || serverProblems.some((p) => p.level === 'error');
    if (bad) {
      emitStatus(t('"{name}" eingelesen, aber wegen Fehlern nicht gespeichert.', { name: draft.name || draft.id }), 'warn');
      renderAll();
      return;
    }
    const ok = await save();
    if (ok) emitStatus(t('"{name}" eingelesen und geprüft.', { name: draft.name || draft.id }), 'ok');
  });

  /* -------------------------------------------------------------- Dialoge */

  function askUnsaved() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (answer) => {
        if (done) return;
        done = true;
        handle.close();
        resolve(answer);
      };
      const btnSave = h('button.btn.acc', { type: 'button' }, t('Speichern'));
      const btnDrop = h('button.btn.danger', { type: 'button' }, t('Verwerfen'));
      const btnCancel = h('button.btn', { type: 'button' }, t('Abbrechen'));
      on(btnSave, 'click', () => finish('save'));
      on(btnDrop, 'click', () => finish('discard'));
      on(btnCancel, 'click', () => finish('cancel'));
      const handle = openModal({
        title: t('Ungespeicherte Änderungen'),
        body: h('p', t('Das Venue "{name}" hat ungespeicherte Änderungen. Was soll damit geschehen?',
          { name: draft?.name || draft?.id || '—' })),
        footer: [btnCancel, btnDrop, btnSave],
        onClose: () => { if (!done) { done = true; resolve('cancel'); } },
      });
    });
  }

  function askDelete(name) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (answer) => {
        if (done) return;
        done = true;
        handle.close();
        resolve(answer);
      };
      const btnDel = h('button.btn.danger', { type: 'button' }, t('Löschen'));
      const btnCancel = h('button.btn', { type: 'button' }, t('Abbrechen'));
      on(btnDel, 'click', () => finish(true));
      on(btnCancel, 'click', () => finish(false));
      const handle = openModal({
        title: t('Venue wirklich löschen?'),
        body: h('p', t('"{name}" wird endgültig aus der Venue-Sammlung entfernt. Projekte, die darauf verweisen, finden ihr Venue danach nicht mehr.', { name })),
        footer: [btnCancel, btnDel],
        onClose: () => { if (!done) { done = true; resolve(false); } },
      });
    });
  }

  function askOverwrite(id) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (answer) => {
        if (done) return;
        done = true;
        handle.close();
        resolve(answer);
      };
      const btnOk = h('button.btn.danger', { type: 'button' }, t('Überschreiben'));
      const btnCancel = h('button.btn', { type: 'button' }, t('Abbrechen'));
      on(btnOk, 'click', () => finish(true));
      on(btnCancel, 'click', () => finish(false));
      const handle = openModal({
        title: t('Kennung schon vergeben'),
        body: h('p', t('Es gibt bereits ein Venue mit der Kennung "{id}". Überschreiben?', { id })),
        footer: [btnCancel, btnOk],
        onClose: () => { if (!done) { done = true; resolve(false); } },
      });
    });
  }

  /* -------------------------------------------------------------- Pruefung */

  function scheduleValidate() {
    if (validateTimer) clearTimeout(validateTimer);
    validating = true;
    validateTimer = setTimeout(() => { validateTimer = null; runValidate(); }, 300);
  }

  async function runValidate() {
    if (validateTimer) { clearTimeout(validateTimer); validateTimer = null; }
    if (!draft) { validating = false; renderProblems(); return; }
    validateToken += 1;
    const token = validateToken;
    validating = true;
    let result = [];
    let error = null;
    try {
      result = asProblems(await validateVenue(cleanVenue(draft)));
    } catch (e) {
      error = e && e.message ? e.message : String(e);
      console.error('[tbg] Venue-Pruefung:', e);
    }
    if (token !== validateToken) return; // eine neuere Pruefung laeuft schon
    serverProblems = result;
    serverError = error;
    validating = false;
    renderProblems();
  }

  /** Nach jeder Eingabe: dreckig markieren, Anzeigen nachziehen, pruefen. */
  function touch() {
    dirty = true;
    syncLive();
    renderProblems();
    scheduleValidate();
  }

  function syncLive() {
    for (const fn of liveSyncs) {
      try {
        fn();
      } catch (e) {
        console.error('[tbg] Venue-Editor, Live-Anzeige:', e);
      }
    }
    renderPreview();
  }

  /* ==========================================================================
   * Bausteine fuer Felder
   * ========================================================================== */

  /**
   * Beschriftetes Feld. label, unit und title sind FERTIGER Text — die
   * Uebersetzung passiert an der Aufrufstelle mit t(), damit sie dort steht,
   * wo man sie liest, und `npm run i18n:check` sie findet.
   */
  function labelled(label, control, unit, title) {
    return h('label.fld', { title: title || null },
      h('span.lbl', label), control, unit ? h('span.unit', unit) : null);
  }

  function textInput(value, onVal, opts = {}) {
    const inp = h('input', {
      type: 'text',
      value: value == null ? '' : String(value),
      class: opts.grow ? 'grow' : null,
      spellcheck: false,
      placeholder: opts.placeholder || null,
      style: opts.width ? `width:${opts.width}px` : null,
      title: opts.title || null,
    });
    on(inp, 'input', () => { onVal(inp.value); touch(); });
    return inp;
  }

  function numInput(value, onVal, opts = {}) {
    const inp = h('input', {
      type: 'number',
      value: Number.isFinite(value) ? String(value) : '',
      min: opts.min != null ? String(opts.min) : null,
      max: opts.max != null ? String(opts.max) : null,
      step: opts.step != null ? String(opts.step) : 'any',
      style: `width:${opts.width || 78}px`,
      title: opts.title || null,
    });
    on(inp, 'input', () => { onVal(inp.value === '' ? NaN : Number(inp.value)); touch(); });
    return inp;
  }

  function areaInput(lines, onVal, rows = 4) {
    const ta = h('textarea', { rows: String(rows), spellcheck: false });
    ta.value = (Array.isArray(lines) ? lines : []).join('\n');
    on(ta, 'input', () => {
      onVal(ta.value.split('\n').map((s) => s.trim()).filter(Boolean));
      touch();
    });
    return ta;
  }

  function btn(label, onClick, cls = 'btn sm') {
    const b = h('button', { type: 'button', class: cls }, label);
    on(b, 'click', onClick);
    return b;
  }

  /** Knopf mit Symbol. Der Klartext steckt in title und aria-label. */
  function iconBtn(symbol, title, onClick, cls = 'btn sm') {
    const b = h('button', {
      type: 'button', class: cls, title, 'aria-label': title,
    }, symbol);
    on(b, 'click', onClick);
    return b;
  }

  /* ==========================================================================
   * Liste links
   * ========================================================================== */

  function renderList() {
    clear(elListButtons);
    const bNew = btn(t('Neu'), () => createNew(), 'btn sm acc');
    const bDup = btn(t('Duplizieren'), () => duplicateCurrent());
    const bDel = btn(t('Löschen'), () => removeCurrent(), 'btn sm danger');
    const bExp = btn(t('Als JSON exportieren'), () => exportJson());
    const bImp = btn(t('JSON importieren'), () => fileInput.click());
    bNew.disabled = busy;
    bDup.disabled = busy || !loadedId;
    bDel.disabled = busy || !loadedId || loadedTemplate;
    bExp.disabled = !draft;
    bImp.disabled = busy;
    elListButtons.appendChild(bNew);
    elListButtons.appendChild(bDup);
    elListButtons.appendChild(bDel);
    elListButtons.appendChild(bExp);
    elListButtons.appendChild(bImp);

    clear(elList);
    if (listError) {
      elList.appendChild(h('div.msg.err', `${t('Die Venue-Liste konnte nicht geladen werden')}: ${listError}`));
      return;
    }
    if (venues.length === 0) {
      elList.appendChild(h('div.msg.info',
        t('Noch kein Venue angelegt. "Neu" legt eines an, "JSON importieren" liest eines ein.')));
      return;
    }

    for (const v of venues) {
      const tpl = isTemplate(v);
      const active = v.id === loadedId;
      const inUse = projectVenueId && projectVenueId === v.id;
      const wallCount = Number.isFinite(v.wallCount) ? v.wallCount : null;

      const row = h('div', { class: active ? 'slot active' : 'slot' },
        h('div.sh',
          h('span', { style: 'font-size:11px', title: tpl ? t('Vorlage — zum Ändern duplizieren') : null }, tpl ? '🔒' : '·'),
          h('span.grow.nowrap', { title: v.id }, v.name || v.id),
          inUse ? h('span', { class: 'tag acc', title: t('Dieses Venue benutzt das offene Projekt.') }, t('in Benutzung')) : null,
          active && dirty ? h('span', { class: 'tag warn' }, t('Ungespeichert')) : null),
        h('div.row', { style: 'padding:0 9px 4px 24px;gap:6px' },
          h('span.dim.mono', { style: 'font-size:10.5px' }, v.id),
          wallCount != null
            ? h('span.dim', { style: 'font-size:10.5px' }, tn(wallCount, '{n} Wand', '{n} Wände'))
            : null));

      if (tpl) row.title = t('Vorlage — zum Ändern duplizieren');
      on(row, 'click', () => { select(v.id); });
      elList.appendChild(row);
    }
  }

  /* ==========================================================================
   * Vorschau — Draufsicht und Frontansicht, massstabsgetreu
   * ========================================================================== */

  function usableWalls() {
    if (!draft || !Array.isArray(draft.walls)) return [];
    return draft.walls.filter((w) => fin(w.widthM, 0) > 0 && fin(w.heightM, 0) > 0);
  }

  function svgRoot(aria, children) {
    return h('svg', {
      viewBox: `0 0 ${SVG_W} ${SVG_H}`,
      width: '100%',
      height: 'auto',
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': aria,
      style: { display: 'block', background: '#07090d', border: '1px solid var(--ln)', borderRadius: '3px' },
    }, children);
  }

  function svgText(x, y, text, opts = {}) {
    return h('text', {
      x: String(x), y: String(y),
      'text-anchor': opts.anchor || 'start',
      style: {
        fill: opts.color || 'var(--dim)',
        fontSize: `${opts.size || 10}px`,
        fontFamily: 'Segoe UI, system-ui, sans-serif',
      },
    }, text);
  }

  function svgLine(x1, y1, x2, y2, style) {
    return h('line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), style });
  }

  /** Draufsicht: Wandbreiten waagerecht, Tiefe z senkrecht, Zuschauer unten. */
  function planSvg(walls) {
    const maxW = Math.max(...walls.map((w) => fin(w.widthM, 0)), 1);
    const zs = walls.map((w) => fin(w.stage?.z, 0));
    const zMin = Math.min(...zs, 0);
    const zMax = Math.max(...zs, 0);
    const audienceZ = zMin - Math.max(2.5, (zMax - zMin) * 0.5);
    const spanX = maxW * 1.12;
    const spanZ = Math.max(1, zMax - audienceZ) * 1.1;
    const scale = Math.min((SVG_W - 2 * SVG_PAD) / spanX, (SVG_H - 2 * SVG_PAD) / spanZ);
    const mx = (m) => SVG_W / 2 + m * scale;
    const my = (z) => SVG_H - SVG_PAD - (z - audienceZ) * scale;

    const kids = [];
    kids.push(svgLine(SVG_W / 2, SVG_PAD * 0.4, SVG_W / 2, SVG_H - SVG_PAD * 0.4,
      { stroke: 'var(--ln)', strokeWidth: '1', strokeDasharray: '3 4' }));

    // Zuschauer
    kids.push(h('circle', { cx: String(SVG_W / 2), cy: String(my(audienceZ)), r: '3.5', style: { fill: 'var(--dim)' } }));
    kids.push(svgText(SVG_W / 2 + 7, my(audienceZ) + 3.5, t('Zuschauer')));

    // Waende, hinten zuerst
    const sorted = [...walls].sort((a, b) => fin(b.stage?.z, 0) - fin(a.stage?.z, 0));
    for (const w of sorted) {
      const wm = fin(w.widthM, 0);
      const y = my(fin(w.stage?.z, 0));
      const x1 = mx(-wm / 2);
      const x2 = mx(wm / 2);
      kids.push(svgLine(x1, y, x2, y, { stroke: 'var(--acc)', strokeWidth: '4', strokeLinecap: 'butt' }));

      // Panelgrenzen als kurze Striche quer zur Wand
      const total = panelSum(w) || fin(w.width, 0);
      let acc = 0;
      for (const p of w.panels || []) {
        acc += fin(p.width, 0);
        if (acc <= 0 || acc >= total) continue;
        const px = mx(-wm / 2 + (acc / total) * wm);
        kids.push(svgLine(px, y - 5, px, y + 5, { stroke: '#07090d', strokeWidth: '1.5' }));
      }
      kids.push(svgText(x2 + 5, y + 3.5, String(w.id || ''), { color: 'var(--fg)', size: 10 }));
      kids.push(svgText(x1 - 5, y + 3.5, fmtMeters(wm), { anchor: 'end', size: 9 }));
    }

    kids.push(svgText(SVG_PAD * 0.4, SVG_H - 6, `${t('Bühne')} · z ${fmtNum(zMin, 1)} – ${fmtNum(zMax, 1)} m`, { size: 9 }));
    return svgRoot(t('Draufsicht der Bühne, Wandbreiten und Tiefe in Metern'), kids);
  }

  /** Frontansicht: Wandrechtecke mit Panelnaehten, Mittelnaht und Sperrzone. */
  function frontSvg(walls) {
    const maxW = Math.max(...walls.map((w) => fin(w.widthM, 0)), 1);
    const maxTop = Math.max(...walls.map((w) => fin(w.stage?.floorOffsetM, 0) + fin(w.heightM, 0)), 1);
    const spanX = maxW * 1.08;
    const spanY = maxTop * 1.18;
    const scale = Math.min((SVG_W - 2 * SVG_PAD) / spanX, (SVG_H - 2 * SVG_PAD) / spanY);
    const mx = (m) => SVG_W / 2 + m * scale;
    const my = (m) => SVG_H - SVG_PAD - m * scale;

    const kids = [];
    kids.push(svgLine(SVG_PAD * 0.4, my(0), SVG_W - SVG_PAD * 0.4, my(0),
      { stroke: 'var(--ln)', strokeWidth: '1' }));
    kids.push(svgText(SVG_PAD * 0.4, my(0) + 11, t('Boden'), { size: 9 }));

    const sorted = [...walls].sort((a, b) => fin(b.stage?.z, 0) - fin(a.stage?.z, 0));
    sorted.forEach((w, i) => {
      const wm = fin(w.widthM, 0);
      const hm = fin(w.heightM, 0);
      const base = fin(w.stage?.floorOffsetM, 0);
      const x = mx(-wm / 2);
      const y = my(base + hm);
      const wpx = (wm * scale);
      const hpx = (hm * scale);
      const dim = 0.45 + (0.55 * (i + 1)) / sorted.length;

      kids.push(h('rect', {
        x: String(x), y: String(y), width: String(wpx), height: String(hpx),
        style: { fill: '#0f141c', fillOpacity: String(dim * 0.9), stroke: 'var(--acc)', strokeWidth: '1.2' },
      }));

      // Panelnaehte
      const total = panelSum(w) || fin(w.width, 0);
      let acc = 0;
      for (const p of w.panels || []) {
        acc += fin(p.width, 0);
        if (acc <= 0 || acc >= total || total <= 0) continue;
        const sx = x + (acc / total) * wpx;
        kids.push(svgLine(sx, y, sx, y + hpx, { stroke: 'var(--ln)', strokeWidth: '1' }));
      }

      // Mittelnaht
      const seam = fin(w.centerSeamX, NaN);
      const wallPx = fin(w.width, 0);
      if (Number.isFinite(seam) && wallPx > 0) {
        const sx = x + (seam / wallPx) * wpx;
        kids.push(svgLine(sx, y - 4, sx, y + hpx + 4, { stroke: 'var(--acc)', strokeWidth: '1.6', strokeDasharray: '5 3' }));
      }

      // Sperrzone
      const safe = fin(w.safeAreaPct, 0);
      if (safe > 0 && safe < 0.5) {
        kids.push(h('rect', {
          x: String(x + wpx * safe), y: String(y + hpx * safe),
          width: String(wpx * (1 - 2 * safe)), height: String(hpx * (1 - 2 * safe)),
          style: { fill: 'none', stroke: 'var(--warn)', strokeWidth: '0.8', strokeDasharray: '4 4' },
        }));
      }

      kids.push(svgText(x + 4, y + 12, String(w.id || ''), { color: 'var(--fg)', size: 11 }));
      kids.push(svgText(x + wpx - 4, y + 12, `${fmtMeters(wm)} × ${fmtMeters(hm)}`, { anchor: 'end', size: 9 }));
    });

    return svgRoot(t('Frontansicht der Wände mit Panelaufteilung und Nähten'), kids);
  }

  function renderPreview() {
    clear(elPreview);
    if (!draft) {
      elPreview.appendChild(h('div.dim', { style: 'font-size:12px' },
        t('Kein Venue ausgewählt. Links eines wählen oder "Neu" drücken.')));
      return;
    }
    const walls = usableWalls();
    if (walls.length === 0) {
      elPreview.appendChild(h('div.msg.warn', t('Ohne Metermaße lässt sich nichts maßstabsgetreu zeichnen.')));
      return;
    }
    try {
      elPreview.appendChild(h('div.col', { style: 'gap:3px' },
        h('span.dim', { style: 'font-size:11px' }, t('Draufsicht')), planSvg(walls)));
      elPreview.appendChild(h('div.col', { style: 'gap:3px' },
        h('span.dim', { style: 'font-size:11px' }, t('Frontansicht')), frontSvg(walls)));
    } catch (e) {
      console.error('[tbg] Venue-Vorschau:', e);
      elPreview.appendChild(h('div.msg.err', `${t('Vorschau')}: ${e.message}`));
    }
  }

  /* ==========================================================================
   * Editor rechts
   * ========================================================================== */

  function section(title, bodyChildren, headExtra) {
    return h('div.sec', { style: 'border:1px solid var(--ln);border-radius:3px' },
      h('div.hd', title, headExtra ? h('span.right') : null, headExtra),
      h('div.bd', bodyChildren));
  }

  function buildHead() {
    const v = draft;
    return section(t('Grunddaten'), h('div.col',
      h('div.row.wrap',
        labelled(t('Kennung'), textInput(v.id, (s) => { v.id = s.trim(); }, { width: 190 }), null,
          t('Kleinbuchstaben, Ziffern und Bindestrich. Sie steht im Projekt und im Dateinamen.')),
        labelled(t('Name'), textInput(v.name, (s) => { v.name = s; }, { grow: true }))),
      h('div.row.wrap',
        labelled(t('Bildrate'), numInput(v.fps, (n) => { v.fps = n; }, { min: 1, max: 240, step: 1, width: 70 }), 'fps'),
        labelled(t('Pixelpitch'), numInput(v.pixelPitchMm, (n) => { v.pixelPitchMm = n; }, { min: 0, step: 0.1, width: 70 }), 'mm',
          t('Abstand zwischen zwei LED-Mittelpunkten. Bestimmt, wie nah Zuschauer herangehen können.'))),
      labelled(t('Quelle / Notiz'), textInput(v.source, (s) => { v.source = s; }, {
        grow: true, title: t('Woher stammen die Zahlen? Dokument, Version, Ansprechpartner.'),
      }))));
  }

  function buildWalls() {
    const v = draft;
    const body = h('div.col');
    if (!v.walls.length) {
      body.appendChild(h('div.msg.warn', t('Noch keine Wand. Ohne Wand kann nichts gerendert werden.')));
    }
    v.walls.forEach((w, i) => body.appendChild(buildWall(w, i)));
    return section(t('Wände'), body, btn(t('Wand hinzufügen'), () => {
      v.walls.push(makeWall(v));
      expanded.add(String(v.walls[v.walls.length - 1].id));
      dirty = true;
      renderEditor();
      syncLive();
      renderProblems();
      scheduleValidate();
    }));
  }

  function buildWall(w, index) {
    const v = draft;
    const wid = String(w.id || `#${index + 1}`);
    const open = expanded.has(wid);

    const pitchTag = h('span', { class: 'tag' }, '—');
    const head = h('div.hd.click',
      h('span', { style: 'font-size:10px' }, open ? '▾' : '▸'),
      h('b', wid),
      h('span.dim.nowrap', { style: 'font-weight:400;letter-spacing:0;text-transform:none;font-size:11px' }, w.label || ''),
      h('span.right'),
      pitchTag,
      iconBtn('▲', t('Nach oben'), (ev) => { ev.stopPropagation(); moveWall(index, -1); }),
      iconBtn('▼', t('Nach unten'), (ev) => { ev.stopPropagation(); moveWall(index, 1); }),
      iconBtn('✕', t('Wand entfernen'), (ev) => { ev.stopPropagation(); removeWall(index); }, 'btn sm danger'));
    on(head, 'click', () => {
      if (open) expanded.delete(wid); else expanded.add(wid);
      renderEditor();
    });

    // ------------------------------------------------------------ Kopfzeilen
    const sizeRow = h('div.row.wrap',
      labelled(t('Auflösung'), numInput(w.width, (n) => {
        const before = fin(w.width, 0);
        w.width = n;
        // Mittelnaht mitziehen, solange sie auf der Wandmitte lag.
        if (Number.isFinite(n) && before > 0 && fin(w.centerSeamX, -1) === before / 2) w.centerSeamX = n / 2;
        recalcPanelMeters(w);
      }, { min: 1, step: 1 }), 'px'),
      h('span.dim', '×'),
      numInput(w.height, (n) => { w.height = n; }, { min: 1, step: 1 }),
      h('span.unit', 'px'));

    const meterRow = h('div.row.wrap',
      labelled(t('Maße'), numInput(w.widthM, (n) => { w.widthM = n; recalcPanelMeters(w); }, { min: 0, step: 0.01 }), 'm'),
      h('span.dim', '×'),
      numInput(w.heightM, (n) => { w.heightM = n; }, { min: 0, step: 0.01 }),
      h('span.unit', 'm'));

    const derived = h('div.row.wrap', { style: 'gap:8px' });
    const derivedTag = h('span.tag', '—');
    const derivedHint = h('span.dim', { style: 'font-size:11px' }, '');
    derived.appendChild(derivedTag);
    derived.appendChild(derivedHint);

    // ------------------------------------------------------------ Panels
    const panelBody = h('div.col');
    const sumLine = h('div', { style: 'font-size:12px' });

    const splitRow = h('div.row.wrap', { style: 'gap:4px' },
      h('span.dim', { style: 'font-size:11px' }, t('gleichmäßig aufteilen')),
      h('div.seg', ...SPLIT_COUNTS.map((n) => {
        const b = h('button.btn.sm', { type: 'button', title: t('Rest geht auf das letzte Panel.') }, String(n));
        on(b, 'click', () => { splitEvenly(w, n); dirty = true; renderEditor(); syncLive(); renderProblems(); scheduleValidate(); });
        return b;
      })),
      btn(t('Panel hinzufügen'), () => {
        (w.panels ||= []).push({ id: `${wid}${w.panels.length + 1}`, x: 0, width: 0 });
        recalcPanelX(w);
        dirty = true; renderEditor(); syncLive(); renderProblems(); scheduleValidate();
      }));

    const table = h('table.tbl',
      h('thead', h('tr',
        h('th', t('Panel')),
        h('th', t('Kennung')),
        h('th.num', `${t('Breite')} (px)`),
        h('th.num', 'x (px)'),
        h('th.num', `${t('Breite')} (m)`),
        h('th', ''))));
    const tbody = h('tbody');
    table.appendChild(tbody);

    const panels = Array.isArray(w.panels) ? w.panels : (w.panels = []);
    if (panels.length === 0) {
      panelBody.appendChild(h('div.msg.warn',
        t('Noch kein Panel. Mindestens eines ist Pflicht — sonst gibt es keine Einzeldateien.')));
    }

    const xCells = [];
    const mCells = [];
    panels.forEach((p, pi) => {
      const xCell = h('td.num.mono', '—');
      const mCell = h('td.num.mono', '—');
      xCells.push([xCell, p]);
      mCells.push([mCell, p]);
      tbody.appendChild(h('tr',
        h('td.dim', String(pi + 1)),
        h('td', textInput(p.id, (s) => { p.id = s.trim(); }, { width: 90 })),
        h('td.num', numInput(p.width, (n) => { p.width = n; recalcPanelX(w); recalcPanelMeters(w); }, { min: 0, step: 1 })),
        xCell,
        mCell,
        h('td', iconBtn('✕', t('Panel entfernen'), () => {
          panels.splice(pi, 1);
          recalcPanelX(w);
          dirty = true; renderEditor(); syncLive(); renderProblems(); scheduleValidate();
        }, 'btn sm danger'))));
    });

    panelBody.appendChild(splitRow);
    if (panels.length) panelBody.appendChild(table);
    panelBody.appendChild(sumLine);
    panelBody.appendChild(h('span.dim', { style: 'font-size:11px' },
      t('Die x-Versätze werden aus den Breiten berechnet, lückenlos von links.')));

    // ------------------------------------------------------- Naht / Sperrzone
    const seamInput = numInput(w.centerSeamX, (n) => { w.centerSeamX = n; }, { min: 0, step: 1 });
    const seamRow = h('div.row.wrap',
      labelled(t('Mittelnaht'), seamInput, 'px', t('Spalte, an der die Wand aufgeht. Vorgabe ist die Wandmitte.')),
      btn(t('Vorgabe: halbe Wandbreite'), () => {
        w.centerSeamX = Math.round(fin(w.width, 0) / 2);
        seamInput.value = String(w.centerSeamX);
        touch();
      }),
      labelled(t('Sperrzone'), numInput(Number.isFinite(w.safeAreaPct) ? Math.round(w.safeAreaPct * 1000) / 10 : NaN,
        (n) => { w.safeAreaPct = Number.isFinite(n) ? n / 100 : NaN; }, { min: 0, max: 49, step: 0.5, width: 66 }), '%',
      t('Anteil am Rand, in dem kein wichtiges Motiv liegen darf.')));

    // ------------------------------------------------------- Buehnenposition
    if (!w.stage || typeof w.stage !== 'object') w.stage = { z: 0, floorOffsetM: 0, travelMaxM: 0 };
    const stageRow = h('div.row.wrap',
      labelled(t('Tiefe z'), numInput(w.stage.z, (n) => { w.stage.z = n; }, { step: 0.1, width: 70 }), 'm',
        t('Abstand zur vordersten Wand, in Metern. Größer heißt weiter hinten.')),
      labelled(t('Bodenversatz'), numInput(w.stage.floorOffsetM, (n) => { w.stage.floorOffsetM = n; }, { step: 0.1, width: 70 }), 'm',
        t('Unterkante über dem Bühnenboden.')),
      labelled(t('maximaler Fahrweg'), numInput(w.stage.travelMaxM, (n) => { w.stage.travelMaxM = n; }, { min: 0, step: 0.1, width: 70 }), 'm',
        t('Wie weit ein Wandteil zur Seite fahren kann.')));

    const body = h('div.bd',
      h('div.row.wrap',
        labelled(t('Kennung'), textInput(w.id, (s) => {
          const old = String(w.id || '');
          w.id = s.trim();
          if (expanded.has(old)) { expanded.delete(old); expanded.add(w.id); }
        }, { width: 90 })),
        labelled(t('Beschriftung'), textInput(w.label, (s) => { w.label = s; }, { grow: true }))),
      sizeRow, meterRow, derived,
      h('div.col', { style: 'gap:4px;margin-top:4px' },
        h('span.dim', { style: 'font-size:11px;text-transform:uppercase;letter-spacing:.6px' }, t('Panelaufteilung')),
        panelBody),
      seamRow,
      h('div.col', { style: 'gap:4px' },
        h('span.dim', { style: 'font-size:11px;text-transform:uppercase;letter-spacing:.6px' }, t('Bühnenposition')),
        stageRow));

    const sec = h('div', { class: open ? 'sec' : 'sec collapsed', style: 'border:1px solid var(--ln);border-radius:3px' },
      head, body);

    // ------------------------------------------------------- Live-Anzeigen
    liveSyncs.push(() => {
      const pitch = wallPitchMm(w);
      const ppm = pxPerMeter(w);
      const label = Number.isFinite(pitch) && Number.isFinite(ppm)
        ? t('Pitch {mm} mm · {ppm} px/m', { mm: fmtNum(pitch, 2), ppm: fmtNum(ppm, 1) })
        : '—';
      derivedTag.textContent = label;
      pitchTag.textContent = label;

      // Abweichung zwischen den Waenden deutlich markieren.
      const others = (v.walls || []).map(wallPitchMm).filter(Number.isFinite);
      const ref = Number.isFinite(v.pixelPitchMm) && v.pixelPitchMm > 0
        ? v.pixelPitchMm
        : (others.length ? others[0] : NaN);
      let cls = 'tag';
      let hint = '';
      if (Number.isFinite(pitch) && Number.isFinite(ref) && Math.abs(pitch - ref) > 0.05) {
        cls = 'tag warn';
        hint = t('Der Pitch dieser Wand weicht von {ref} mm ab.', { ref: fmtNum(ref, 2) });
      }
      const py = wallPitchMmY(w);
      if (!hint && Number.isFinite(pitch) && Number.isFinite(py) && Math.abs(pitch - py) > 0.05) {
        cls = 'tag warn';
        hint = t('Nicht quadratische Pixel: waagerecht {x} mm, senkrecht {y} mm.',
          { x: fmtNum(pitch, 2), y: fmtNum(py, 2) });
      }
      derivedTag.className = cls;
      pitchTag.className = cls;
      derivedHint.textContent = hint;
      derivedHint.style.color = hint ? 'var(--warn)' : '';

      for (const [cell, p] of xCells) cell.textContent = fmtNum(fin(p.x, 0), 0);
      for (const [cell, p] of mCells) {
        const wm = fin(w.widthM, 0);
        const wpx = fin(w.width, 0);
        cell.textContent = wpx > 0 && wm > 0 ? fmtNum((fin(p.width, 0) / wpx) * wm, 2) : '—';
      }

      const sum = panelSum(w);
      const want = fin(w.width, 0);
      const diff = want - sum;
      clear(sumLine);
      if (panels.length === 0) {
        sumLine.appendChild(h('span.dim', '—'));
      } else if (diff === 0 && want > 0) {
        sumLine.appendChild(h('span', { style: 'color:var(--ok)' },
          t('Summe {sum} px von {want} px — stimmt.', { sum: fmtNum(sum, 0), want: fmtNum(want, 0) })));
      } else {
        sumLine.appendChild(h('span', { style: 'color:var(--err)' },
          t('Summe {sum} px von {want} px — Differenz {diff} px.',
            { sum: fmtNum(sum, 0), want: fmtNum(want, 0), diff: fmtNum(diff, 0) })));
      }
    });

    return sec;
  }

  function moveWall(index, delta) {
    const to = index + delta;
    const walls = draft.walls;
    if (to < 0 || to >= walls.length) return;
    const [w] = walls.splice(index, 1);
    walls.splice(to, 0, w);
    dirty = true;
    renderEditor();
    syncLive();
    renderProblems();
    scheduleValidate();
  }

  function removeWall(index) {
    const w = draft.walls[index];
    if (!w) return;
    expanded.delete(String(w.id));
    draft.walls.splice(index, 1);
    dirty = true;
    renderEditor();
    syncLive();
    renderProblems();
    scheduleValidate();
  }

  /** Wandbreite auf n Panels verteilen, Rest auf das letzte. */
  function splitEvenly(w, n) {
    const total = Math.round(fin(w.width, 0));
    if (total <= 0 || n <= 0) return;
    const each = Math.floor(total / n);
    const wid = String(w.id || 'W');
    const panels = [];
    for (let i = 0; i < n; i += 1) {
      const width = i === n - 1 ? total - each * (n - 1) : each;
      const old = (w.panels || [])[i] || {};
      panels.push({ ...old, id: old.id || `${wid}${i + 1}`, x: 0, width });
    }
    w.panels = panels;
    recalcPanelX(w);
    recalcPanelMeters(w);
  }

  /* ----------------------------------------------------------- Delivery */

  function buildDelivery() {
    const v = draft;
    const d = v.delivery;
    const body = h('div.col');

    if (!d.presets.length) {
      body.appendChild(h('div.msg.warn', t('Noch kein Preset. Ohne Preset kann nichts ausgeliefert werden.')));
    }

    d.presets.forEach((p, i) => {
      const argsInput = textInput((p.args || []).join(' '), (s) => {
        p.args = s.split(/\s+/).filter(Boolean);
      }, { grow: true, title: t('ffmpeg-Argumente, durch Leerzeichen getrennt.') });

      const alphaChk = h('input', { type: 'checkbox', checked: !!p.alpha });
      on(alphaChk, 'change', () => { p.alpha = alphaChk.checked; touch(); });

      body.appendChild(h('div.col', { style: 'gap:4px;border:1px solid var(--ln);border-radius:3px;padding:6px' },
        h('div.row.wrap',
          labelled(t('Kennung'), textInput(p.id, (s) => { p.id = s.trim(); }, { width: 120 })),
          labelled(t('Beschriftung'), textInput(p.label, (s) => { p.label = s; }, { grow: true })),
          iconBtn('✕', t('Preset entfernen'), () => {
            d.presets.splice(i, 1);
            dirty = true; renderEditor(); syncLive(); renderProblems(); scheduleValidate();
          }, 'btn sm danger')),
        h('div.row.wrap',
          labelled(t('Endung'), textInput(p.ext, (s) => { p.ext = s.trim().replace(/^\./, ''); }, { width: 60 })),
          labelled(t('Codec-Kürzel'), textInput(p.codecTag, (s) => { p.codecTag = s.trim(); }, {
            width: 130, title: t('Steht im Dateinamen an der Stelle {CODEC}.'),
          })),
          labelled(t('Bytes pro Pixel'), numInput(p.bytesPerPixel, (n) => { p.bytesPerPixel = n; }, {
            min: 0, step: 0.01, width: 70, title: t('Nur für die Abschätzung des Platzbedarfs.'),
          })),
          h('label.row', { style: 'gap:4px' }, alphaChk, h('span', { style: 'font-size:12px' }, t('mit Alphakanal')))),
        labelled(t('Argumente'), argsInput)));
    });

    const defSel = h('select', { style: 'max-width:220px' },
      h('option', { value: '' }, t('(keines)')),
      ...d.presets.map((p) => h('option', { value: p.id }, p.label || p.id)));
    defSel.value = d.defaultPreset || '';
    on(defSel, 'change', () => { d.defaultPreset = defSel.value || null; touch(); });
    body.appendChild(h('div.row', labelled(t('Standardpreset'), defSel)));

    const headExtra = h('div.row', { style: 'gap:4px' },
      btn(t('Standardpresets einfügen'), () => insertStandardPresets(), 'btn sm'),
      btn(t('Preset hinzufügen'), () => {
        d.presets.push({ id: `preset${d.presets.length + 1}`, label: '', ext: 'mov', codecTag: '', args: [], bytesPerPixel: 0.5, alpha: false });
        dirty = true; renderEditor(); syncLive(); renderProblems(); scheduleValidate();
      }));
    headExtra.title = t('Fügt HAP, HAP Q, HAP Alpha, ProRes 422, ProRes 4444 Alpha und H.264 ein, sofern noch nicht vorhanden.');

    return section(t('Delivery-Presets'), body, headExtra);
  }

  function insertStandardPresets() {
    const d = draft.delivery;
    const have = new Set(d.presets.map((p) => String(p.id)));
    let added = 0;
    for (const p of STANDARD_PRESETS) {
      if (have.has(p.id)) continue;
      d.presets.push(clone(p));
      added += 1;
    }
    if (!d.defaultPreset && d.presets.length) d.defaultPreset = d.presets[0].id;
    emitStatus(added === 0
      ? t('Alle Standardpresets sind schon vorhanden.')
      : tn(added, '{n} Preset eingefügt.', '{n} Presets eingefügt.'));
    if (added) {
      dirty = true;
      renderEditor();
      syncLive();
      renderProblems();
      scheduleValidate();
    }
  }

  /* ---------------------------------------------------------- Namensschema */

  function buildNaming() {
    const v = draft;
    const example = h('span.mono', { style: 'font-size:12px' }, '—');
    const input = textInput(v.delivery.namePattern, (s) => { v.delivery.namePattern = s; }, {
      grow: true, title: t('Platzhalter: {WALL} {W} {H} {FPS} {CODEC}'),
    });

    liveSyncs.push(() => {
      const wall = (v.walls || [])[0];
      const preset = (v.delivery.presets || []).find((p) => p.id === v.delivery.defaultPreset)
        || (v.delivery.presets || [])[0];
      if (!wall || !preset) { example.textContent = '—'; example.style.color = ''; return; }
      try {
        example.textContent = deliveryName(v, wall.id, fin(wall.width, 0), fin(wall.height, 0), preset.id);
        example.style.color = '';
      } catch (e) {
        example.textContent = t('Kein Beispiel möglich: {msg}', { msg: e.message });
        example.style.color = 'var(--err)';
      }
    });

    return section(t('Namensschema für Dateinamen'), h('div.col',
      h('div.row', input),
      h('span.dim', { style: 'font-size:11px' }, t('Platzhalter: {WALL} {W} {H} {FPS} {CODEC}')),
      h('div.row', h('span.dim', { style: 'font-size:11px' }, `${t('Beispiel')}:`), example)));
  }

  /* --------------------------------------------------------------- Freitext */

  function buildNotes() {
    const v = draft;
    return h('div.col',
      section(t('Annahmen'), h('div.col',
        h('span.dim', { style: 'font-size:11px' }, t('Was ist geraten und noch nicht bestätigt? Eine Zeile je Annahme.')),
        areaInput(v.assumptions, (lines) => { v.assumptions = lines; }, 4))),
      section(t('Offene Fragen'), h('div.col',
        h('span.dim', { style: 'font-size:11px' }, t('Was muss vor der Produktion geklärt werden? Eine Zeile je Frage.')),
        areaInput(v.openQuestions, (lines) => { v.openQuestions = lines; }, 4))));
  }

  /* ------------------------------------------------------------- Zeichnen */

  function renderEditor() {
    liveSyncs = [];
    clear(elEditor);

    if (busy) {
      elEditor.appendChild(h('div.msg.info', t('Bitte warten …')));
    }
    if (!draft) {
      elEditor.appendChild(h('div.msg.info', t('Kein Venue ausgewählt. Links eines wählen oder "Neu" drücken.')));
      return;
    }
    if (loadedTemplate) {
      elEditor.appendChild(h('div.msg.warn', `🔒 ${t('Vorlage — zum Ändern duplizieren')}`));
    }
    if (projectVenueId && projectVenueId === loadedId) {
      elEditor.appendChild(h('div.msg.info', t('Dieses Venue benutzt das offene Projekt.')));
    }

    elEditor.appendChild(buildHead());
    elEditor.appendChild(buildWalls());
    elEditor.appendChild(buildDelivery());
    elEditor.appendChild(buildNaming());
    elEditor.appendChild(buildNotes());
  }

  function renderProblems() {
    const local = draft ? localProblems(draft) : [];
    const seen = new Set(local.map((p) => `${p.level}|${p.where}|${p.msg}`));
    const merged = [...local];
    for (const p of serverProblems) {
      const key = `${p.level}|${p.where}|${p.msg}`;
      if (!seen.has(key)) { seen.add(key); merged.push(p); }
    }
    const errors = merged.filter((p) => p.level === 'error');

    clear(elProblems);
    if (serverError) {
      elProblems.appendChild(h('div.msg.err', t('Die Serverprüfung ist fehlgeschlagen: {msg}', { msg: serverError })));
    }
    if (!draft) {
      elProblems.appendChild(h('span.dim', { style: 'font-size:12px' },
        t('Kein Venue ausgewählt. Links eines wählen oder "Neu" drücken.')));
    } else if (merged.length === 0) {
      elProblems.appendChild(h('div.msg.ok', validating ? t('Wird geprüft …') : t('Keine Beanstandung.')));
    } else {
      const order = { error: 0, warn: 1, info: 2 };
      merged.sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3));
      for (const p of merged) {
        const cls = levelClass(p.level);
        elProblems.appendChild(h('div.row', { style: 'align-items:flex-start;gap:6px' },
          h('span', { class: `amp ${cls}`, style: 'margin-top:5px' }),
          h('div.grow',
            h('div', { style: 'font-size:12.5px' },
              h('span', { class: `tag ${cls}` }, levelLabel(p.level)), ' ',
              p.where ? h('b', `${p.where}: `) : null,
              p.msg || ''),
            p.hint ? h('div.dim', { style: 'font-size:11.5px' }, p.hint) : null)));
      }
    }

    // -------------------------------------------------------- Speicherzeile
    clear(elSaveRow);
    const blocked = !draft || busy || loadedTemplate || errors.length > 0;
    const save1 = h('button.btn.acc', { type: 'button', disabled: blocked }, t('Speichern'));
    on(save1, 'click', () => save());
    elSaveRow.appendChild(save1);
    elSaveRow.appendChild(h('span.dim', { style: 'font-size:11.5px' },
      loadedTemplate ? t('Vorlagen lassen sich nicht überschreiben. Erst duplizieren.')
        : errors.length ? t('Speichern ist gesperrt, solange Fehler anstehen.')
          : dirty ? t('Ungespeichert') : t('Gespeichert')));
  }

  function renderAll() {
    hdList.textContent = t('Spielstätten');
    hdPreview.textContent = t('Vorschau');
    hdCheck.textContent = t('Live-Prüfung');
    renderList();
    renderEditor();
    syncLive();   // zieht die abgeleiteten Anzeigen nach UND zeichnet die Vorschau
    renderProblems();
  }

  /* ------------------------------------------------------------ Sprachwechsel */
  onLangChange(() => renderAll());

  // Ein ungespeicherter Venue-Entwurf haengt nicht am Projekt — der Warnhaken
  // des Rahmens (isDirty()) sieht ihn nicht. Also selbst nachfragen, sonst ist
  // beim Neuladen der Seite alles Eingetippte still weg.
  on(window, 'beforeunload', (ev) => {
    if (!dirty || !draft) return;
    ev.preventDefault();
    ev.returnValue = '';
  });

  /* ------------------------------------------------------------ Schnittstelle */

  async function open(venueId) {
    await refreshList();
    const target = venueId || loadedId || (venues[0] && venues[0].id) || null;
    if (target && (!draft || target !== loadedId)) {
      await select(target);
    } else {
      renderAll();
    }
  }

  function close() {
    // Der Entwurf bleibt im Speicher: wer die Ansicht wechselt und
    // zurueckkommt, findet seine Eingaben wieder. Verloren geht nichts.
    if (validateTimer) { clearTimeout(validateTimer); validateTimer = null; }
  }

  function update(state) {
    const vid = state?.project?.venueId || null;
    if (vid !== projectVenueId) {
      projectVenueId = vid;
      renderList();
      renderEditor();
      syncLive();
      renderProblems();
    }
  }

  renderAll();

  return { el, update, open, close };
}
