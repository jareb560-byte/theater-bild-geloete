#!/usr/bin/env node
/**
 * Theater-Bild-Gelöte - Kommandozeile.
 *
 * Einstiegspunkt des npm-Pakets (package.json: bin['theater-bild-geloete']). Wertet die
 * Schalter aus, richtet das Arbeitsverzeichnis ein und startet den Server
 * aus server/index.js.
 *
 * Reihenfolge ist wichtig: server/paths.js richtet sich beim Import selbst
 * ein und liest dabei --workspace aus process.argv. Erst danach wird
 * server/index.js geladen - denn ESM zieht Importe hoch, und jedes Modul,
 * das beim Laden einen Pfad festhaelt, muss den richtigen sehen. Deshalb
 * wird server/index.js unten per await import() geholt, nicht oben statisch.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initPaths, resolveWorkspace, WORKSPACE_ENV } from '../server/paths.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const DEFAULT_PORT = 7333;
const DEFAULT_HOST = '127.0.0.1';

/* ==========================================================================
 * Version
 * ========================================================================== */

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0';
  } catch (err) {
    console.error(`[tbg] package.json nicht lesbar: ${err.message}`);
    return '0.0.0';
  }
}

/* ==========================================================================
 * Hilfe - deutsch und englisch, beide Bloecke untereinander
 * ========================================================================== */

function help() {
  return `
Theater-Bild-Gelöte ${version()} — Werkzeug fuer mehrteilige LED-Buehnenwaende

AUFRUF
  theater-bild-geloete [schalter]
  theater-bild-geloete doctor [schalter]           Selbstpruefung: laeuft hier alles?
  theater-bild-geloete install-ffmpeg [schalter]   ffmpeg ins Arbeitsverzeichnis holen

SCHALTER
  --workspace <pfad>   Arbeitsverzeichnis. Dort liegen projects/ venues/
                       cache/ proxies/ thumbs/ out/ bin/.
                       Reihenfolge: --workspace, dann ${WORKSPACE_ENV},
                       dann <home>/theater-bild-geloete.
  --port <n>           Port der Oberflaeche (Vorgabe ${DEFAULT_PORT}).
                       Ist er belegt, wird der naechste freie genommen und
                       das deutlich gemeldet.
  --host <adresse>     Adresse, auf der gelauscht wird (Vorgabe ${DEFAULT_HOST}).
                       0.0.0.0 macht Theater-Bild-Gelöte im Netz erreichbar.
  --project <datei>    Projektdatei beim Start oeffnen (*.tbg.json).
  --open               Standardbrowser oeffnen.
  --no-open            Browser nicht oeffnen (Vorgabe).
  --force              nur bei install-ffmpeg: neu laden, auch wenn schon da.
  --brew               nur bei install-ffmpeg auf macOS: "brew install ffmpeg"
                       ausfuehren duerfen. Ohne diesen Schalter passiert das nie.
  --version, -v        Version ausgeben.
  --help, -h           Diese Hilfe.

BEISPIELE
  theater-bild-geloete --open
  theater-bild-geloete --workspace "D:\\LED" --port 8080
  theater-bild-geloete --project ~/theater-bild-geloete/projects/show.tbg.json
  theater-bild-geloete doctor

--------------------------------------------------------------------------

Theater-Bild-Gelöte ${version()} — tool for multi-panel LED stage walls

USAGE
  theater-bild-geloete [options]
  theater-bild-geloete doctor [options]            Self-check: will this machine render?
  theater-bild-geloete install-ffmpeg [options]    Fetch ffmpeg into the workspace

OPTIONS
  --workspace <path>   Workspace directory holding projects/ venues/
                       cache/ proxies/ thumbs/ out/ bin/.
                       Resolved in this order: --workspace, then
                       ${WORKSPACE_ENV}, then <home>/theater-bild-geloete.
  --port <n>           Port for the interface (default ${DEFAULT_PORT}).
                       If taken, the next free port is used and clearly
                       reported.
  --host <address>     Address to listen on (default ${DEFAULT_HOST}).
                       Use 0.0.0.0 to reach Theater-Bild-Gelöte from the network.
  --project <file>     Open a project file on start (*.tbg.json).
  --open               Open the default browser.
  --no-open            Do not open a browser (default).
  --force              install-ffmpeg only: download again even if present.
  --brew               install-ffmpeg on macOS only: allow running
                       "brew install ffmpeg". Never happens without it.
  --version, -v        Print the version.
  --help, -h           This help.

EXAMPLES
  theater-bild-geloete --open
  theater-bild-geloete --workspace "D:\\LED" --port 8080
  theater-bild-geloete --project ~/theater-bild-geloete/projects/show.tbg.json
  theater-bild-geloete doctor
`.trim();
}

/* ==========================================================================
 * Schalter auswerten
 * ========================================================================== */

const FLAGS_WITH_VALUE = new Set(['--workspace', '-w', '--port', '--host', '--project']);
const FLAGS_WITHOUT_VALUE = new Set([
  '--open',
  '--no-open',
  '--force',
  '--brew',
  '--yes-brew',
  '--version',
  '-v',
  '--help',
  '-h',
]);

const COMMANDS = new Set(['doctor', 'install-ffmpeg', 'setup-ffmpeg', 'start']);

function parseArgs(argv) {
  const out = {
    command: 'start',
    workspace: null,
    port: null,
    host: null,
    project: null,
    open: false,
    force: false,
    brew: false,
    showHelp: false,
    showVersion: false,
  };
  const errors = [];
  const rest = argv.slice(2);

  if (rest.length > 0 && !rest[0].startsWith('-')) {
    const cmd = rest.shift();
    if (!COMMANDS.has(cmd)) {
      errors.push(`Unbekannter Befehl "${cmd}". Bekannt: ${[...COMMANDS].join(', ')}.`);
    } else {
      out.command = cmd === 'setup-ffmpeg' ? 'install-ffmpeg' : cmd;
    }
  }

  for (let i = 0; i < rest.length; i += 1) {
    let flag = rest[i];
    let inlineValue = null;

    const eq = flag.indexOf('=');
    if (flag.startsWith('--') && eq > 2) {
      inlineValue = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }

    if (FLAGS_WITH_VALUE.has(flag)) {
      let value = inlineValue;
      if (value == null) {
        value = rest[i + 1];
        i += 1;
      }
      if (value == null || value === '' || (String(value).startsWith('-') && flag !== '--host')) {
        errors.push(`${flag} braucht einen Wert.`);
        continue;
      }
      if (flag === '--workspace' || flag === '-w') out.workspace = String(value);
      else if (flag === '--port') out.port = String(value);
      else if (flag === '--host') out.host = String(value);
      else if (flag === '--project') out.project = String(value);
      continue;
    }

    if (FLAGS_WITHOUT_VALUE.has(flag)) {
      if (inlineValue != null) errors.push(`${flag} nimmt keinen Wert.`);
      if (flag === '--open') out.open = true;
      else if (flag === '--no-open') out.open = false;
      else if (flag === '--force') out.force = true;
      else if (flag === '--brew' || flag === '--yes-brew') out.brew = true;
      else if (flag === '--version' || flag === '-v') out.showVersion = true;
      else if (flag === '--help' || flag === '-h') out.showHelp = true;
      continue;
    }

    errors.push(`Unbekannter Schalter "${rest[i]}".`);
  }

  if (out.port != null) {
    const n = Number.parseInt(out.port, 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
      errors.push(`--port "${out.port}" ist keine gueltige Portnummer (1 bis 65535).`);
    } else {
      out.port = n;
    }
  }

  return { opts: out, errors };
}

/* ==========================================================================
 * Befehle
 * ========================================================================== */

async function runDoctor() {
  // doctor.js fuehrt seine Pruefung beim Import aus und beendet den Prozess
  // selbst mit passendem Exitcode.
  await import('../server/cli/doctor.js');
}

async function runInstallFfmpeg(opts) {
  const mod = await import('../server/cli/install-ffmpeg.js');
  console.log('Theater-Bild-Gelöte — ffmpeg einrichten');
  console.log('');
  try {
    const res = await mod.installFfmpeg({
      log: (line) => console.log(`  ${line}`),
      force: opts.force,
      allowBrew: opts.brew,
    });
    console.log('');
    console.log('  FERTIG. ffmpeg und ffprobe sind einsatzbereit.');
    console.log(`  Version: ${res.version}`);
    console.log('  Naechster Schritt: theater-bild-geloete doctor');
    process.exit(0);
  } catch (err) {
    console.error('');
    console.error(err.message);
    process.exit(1);
  }
}

async function runServer(opts) {
  const { start } = await import('../server/index.js');
  await start({
    host: opts.host || DEFAULT_HOST,
    port: opts.port ?? DEFAULT_PORT,
    project: opts.project,
    open: opts.open,
  });
}

/* ==========================================================================
 * Hauptlauf
 * ========================================================================== */

async function main() {
  const { opts, errors } = parseArgs(process.argv);

  if (opts.showHelp) {
    console.log(help());
    process.exit(0);
  }
  if (opts.showVersion) {
    console.log(version());
    process.exit(0);
  }
  if (errors.length > 0) {
    console.error('');
    for (const e of errors) console.error(`  ${e}`);
    console.error('');
    console.error('  "theater-bild-geloete --help" zeigt alle Schalter. / Run "theater-bild-geloete --help" for options.');
    console.error('');
    process.exit(1);
  }

  // Arbeitsverzeichnis festlegen, BEVOR server/index.js geladen wird.
  let ws;
  try {
    ws = initPaths({ workspace: opts.workspace }).workspace;
  } catch (err) {
    console.error('');
    console.error(
      `  Arbeitsverzeichnis "${resolveWorkspace(opts.workspace)}" konnte nicht ` +
        `eingerichtet werden: ${err.message}`
    );
    console.error(`  Anderes waehlen: theater-bild-geloete --workspace <pfad>  oder  ${WORKSPACE_ENV}=<pfad>`);
    console.error('');
    process.exit(1);
  }

  if (opts.project) {
    const file = path.resolve(String(opts.project));
    if (!fs.existsSync(file)) {
      console.error('');
      console.error(`  Projektdatei nicht gefunden: ${file}`);
      console.error(`  Projekte des Arbeitsverzeichnisses liegen in: ${path.join(ws, 'projects')}`);
      console.error('');
      process.exit(1);
    }
    opts.project = file;
  }

  if (opts.command === 'doctor') return runDoctor();
  if (opts.command === 'install-ffmpeg') return runInstallFfmpeg(opts);
  return runServer(opts);
}

main().catch((err) => {
  console.error('');
  console.error(`[tbg] Start fehlgeschlagen: ${err.message}`);
  if (err?.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('[tbg] Ein Modul fehlt. Wurde "npm install" ausgefuehrt?');
  }
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
