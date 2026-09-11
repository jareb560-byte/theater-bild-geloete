/**
 * Theater-Bild-Gelöte - Selbstpruefung.
 *
 * "Theater-Bild-Gelöte doctor" beantwortet die Frage: kann dieser Rechner heute rendern?
 * Geprueft werden Plattform und Node, das Arbeitsverzeichnis samt Schreibrecht,
 * ffmpeg/ffprobe, die Encoder-Ampel, die Venue-Dateien und der freie
 * Plattenplatz im Arbeitsverzeichnis.
 *
 * Exitcode 1, wenn etwas Kritisches fehlt - damit laesst sich der Aufruf in
 * ein Startskript haengen.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { estimateSize, formatBytes } from '../../shared/model.js';
import * as pathsMod from '../paths.js';
import {
  paths,
  workDirs,
  ensureDir,
  freeBytes,
  initPaths,
  workspaceSource,
  WORKSPACE_ENV,
} from '../paths.js';
import * as ffmpeg from '../ffmpeg.js';
import * as venues from '../venues.js';
import { installHint } from '../ffmpeg.js';

const lines = [];
let criticalMissing = 0;
let warnCount = 0;

function ok(label, detail = '') {
  lines.push(`  [ OK   ] ${label}${detail ? ` — ${detail}` : ''}`);
}
function warn(label, detail = '') {
  warnCount += 1;
  lines.push(`  [ WARN ] ${label}${detail ? ` — ${detail}` : ''}`);
}
function missing(label, detail = '') {
  criticalMissing += 1;
  lines.push(`  [ FEHLT] ${label}${detail ? ` — ${detail}` : ''}`);
}
function head(title) {
  lines.push('');
  lines.push(`${title}`);
}

/* ==========================================================================
 * Platzbedarf
 * ========================================================================== */

/** Grober Platzbedarf fuer einen kompletten Durchlauf aller Waende. */
function estimateProjectBytes(venue, seconds) {
  const preset =
    (venue.delivery?.presets || []).find((x) => x.id === venue.delivery?.defaultPreset) ||
    (venue.delivery?.presets || [])[0];
  const bpp = preset?.bytesPerPixel ?? 0.5;
  let total = 0;
  for (const w of venue.walls || []) {
    total += estimateSize(w.width, w.height, venue.fps || 30, seconds, bpp).totalBytes;
  }
  if (venue.holo) {
    total += estimateSize(venue.holo.width, venue.holo.height, venue.fps || 30, seconds, 1.0)
      .totalBytes;
  }
  return total;
}

/* ==========================================================================
 * Pruefungen
 * ========================================================================== */

function checkPlatform() {
  head('Plattform und Laufzeit');

  const nice = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform];
  ok(nice || process.platform, `${os.release()} · ${process.arch}`);

  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 18) ok(`Node ${process.versions.node}`);
  else missing(`Node ${process.versions.node}`, 'benoetigt wird Node 18 oder neuer');

  ok('Programmverzeichnis', paths.root);
}

function checkWorkspace() {
  head('Arbeitsverzeichnis');

  const quelle = {
    cli: 'per --workspace gesetzt',
    env: `aus ${WORKSPACE_ENV}`,
    home: 'Standard: <home>/theater-bild-geloete',
  }[workspaceSource()];
  ok('Ort', `${paths.workspace} (${quelle})`);

  if (paths.workspace === paths.root) {
    warn(
      'Ort',
      'Arbeitsverzeichnis und Programmverzeichnis sind identisch. Bei einer ' +
        'Installation per npm gehen die Daten beim naechsten Update verloren.'
    );
  }

  for (const d of workDirs) {
    try {
      ensureDir(d);
      const probe = path.join(d, `.schreibtest-${process.pid}`);
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      ok(path.basename(d) + path.sep, d);
    } catch (err) {
      missing(path.basename(d) + path.sep, `nicht beschreibbar: ${err.message}`);
    }
  }
}

async function checkFfmpeg() {
  head('ffmpeg');
  const loc = ffmpeg.locate();

  if (loc.ffmpeg.found) {
    const v = await ffmpeg.version();
    const src =
      loc.ffmpeg.source === 'bundled' ? 'aus dem Arbeitsverzeichnis (bin/)' : 'aus dem PATH';
    ok(`ffmpeg ${v || ''}`.trim(), `${src}: ${loc.ffmpeg.path}`);
  } else {
    missing('ffmpeg', installHint());
  }

  if (loc.ffprobe.found) {
    ok('ffprobe', loc.ffprobe.path);
  } else {
    missing('ffprobe', installHint());
  }

  if (pathsMod.legacyBin) {
    warn(
      'Altes bin/ im Programmordner',
      `${pathsMod.legacyBin} wird noch benutzt. Bei einer Installation per npm ist es ` +
        'beim naechsten Update weg — dann "Theater-Bild-Gelöte install-ffmpeg" ausfuehren.'
    );
  }

  if (!loc.ffmpeg.found) return;

  head('Encoder');
  const enc = await ffmpeg.probeEncoders();
  const nachinstallieren =
    process.platform === 'darwin' ? 'Theater-Bild-Gelöte install-ffmpeg --brew' : 'Theater-Bild-Gelöte install-ffmpeg';

  if (enc.hap) ok('hap', 'HAP-Delivery moeglich');
  else
    missing('hap', `Dieser Build kann kein HAP. HAP-Delivery ist unmoeglich — ${nachinstallieren}`);
  if (enc.prores_ks) ok('prores_ks', 'ProRes-Delivery moeglich');
  else missing('prores_ks', `ProRes-Delivery nicht moeglich — ${nachinstallieren}`);
  if (enc.mpeg2video) ok('mpeg2video', 'Alternative zu HAP');
  else warn('mpeg2video', 'Alternative zu HAP steht nicht zur Verfuegung');
  if (enc.libx264) ok('libx264', 'Proxies und Ansichtsexemplare');
  else missing('libx264', 'Ohne libx264 gibt es keine Browser-Vorschau');
}

function checkVenues() {
  head('Venues');

  ok('Vorlagen (schreibgeschuetzt)', paths.builtinVenues);
  ok('Eigene Venues', paths.venues);

  let list = [];
  try {
    list = venues.list();
  } catch (err) {
    missing('Venue-Verzeichnis', err.message);
    return;
  }
  if (list.length === 0) {
    missing('Venue-Verzeichnis', `keine Venue-Datei gefunden in ${paths.builtinVenues}`);
    return;
  }
  for (const v of list) {
    const full = venues.find(v.id);
    const walls = (full?.walls || []).map((w) => `${w.id} ${w.width}x${w.height}`).join(', ');
    ok(`${v.name} (${v.id})`, `${v.wallCount} Wand/Waende: ${walls}`);
  }
  const problems = venues.getWarnings();
  for (const p of problems) warn('Venue-Pruefung', p);
  if (problems.length === 0) ok('Panelbreiten', 'Summe passt auf allen Waenden zur Wandbreite');
}

function checkDisk() {
  head('Plattenplatz');
  const free = freeBytes(paths.out);
  const venue = venues.base();
  const wo = path.parse(paths.out).root || paths.out;

  if (free == null) {
    warn('Freier Platz', `konnte fuer ${paths.out} nicht ermittelt werden`);
    return;
  }
  if (!venue) {
    ok('Freier Platz', `${formatBytes(free)} auf ${wo}`);
    return;
  }
  const need120 = estimateProjectBytes(venue, 120);
  const detail =
    `${formatBytes(free)} frei auf ${wo} — ` +
    `ein 2-Minuten-Loop ueber alle Flaechen von "${venue.name || venue.id}" ` +
    `braucht rund ${formatBytes(need120)}`;
  if (free < need120) missing('Freier Platz', detail);
  else if (free < need120 * 2) warn('Freier Platz', `${detail} (knapp)`);
  else ok('Freier Platz', detail);
}

/* ==========================================================================
 * Hauptlauf
 * ========================================================================== */

async function main() {
  // paths.js hat sich beim Import bereits selbst eingerichtet; der Aufruf hier
  // ist nur die ausdrueckliche Bestaetigung und legt fehlende Ordner an.
  initPaths();

  console.log('');
  console.log('Theater-Bild-Gelöte — Selbstpruefung');
  console.log('===========================');

  checkPlatform();
  checkWorkspace();
  await checkFfmpeg();
  checkVenues();
  checkDisk();

  console.log(lines.join('\n'));
  console.log('');

  if (criticalMissing > 0) {
    console.log(
      `  ${criticalMissing} kritische(r) Punkt(e) fehlen, ${warnCount} Warnung(en). Bitte oben nachsehen.`
    );
    console.log('  Haeufigster Fall: ffmpeg fehlt → Theater-Bild-Gelöte install-ffmpeg');
    console.log('');
    process.exit(1);
  }

  console.log(`  Alles Kritische ist da. ${warnCount} Warnung(en).`);
  console.log('  Start mit: Theater-Bild-Gelöte        (danach http://127.0.0.1:7333)');
  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error('');
  console.error(`Die Selbstpruefung selbst ist gescheitert: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
