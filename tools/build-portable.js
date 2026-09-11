#!/usr/bin/env node
/**
 * Theater-Bild-Gelöte — fertige Pakete bauen.
 *
 * Ergebnis je Zielsystem: ein Archiv, das entpackt und gestartet wird. Kein
 * Node auf dem Zielrechner, kein npm, kein Terminal.
 *
 *   dist/theater-bild-geloete-0.2.0-win-x64.zip
 *   dist/theater-bild-geloete-0.2.0-darwin-arm64.tar.gz
 *   dist/theater-bild-geloete-0.2.0-darwin-x64.tar.gz
 *   dist/theater-bild-geloete-0.2.0-linux-x64.tar.gz
 *
 * Inhalt eines Pakets:
 *   runtime/node[.exe]   offizielle Node-Laufzeit von nodejs.org, signiert
 *   app/                 das Programm
 *   app/node_modules/    express und three, auf das Noetige gekuerzt
 *   <Starter>            Doppelklick
 *   ZUERST-LESEN.txt     der Windows-Handgriff gegen die SmartScreen-Meldung
 *
 * ffmpeg ist ABSICHTLICH nicht dabei: es sind 290 MB, und das Programm holt es
 * beim ersten Start selbst — plattformrichtig und in der aktuellen Fassung.
 *
 * Aufruf:
 *   node tools/build-portable.js                    alle Zielsysteme
 *   node tools/build-portable.js --platforms win-x64
 *   node tools/build-portable.js --node-version v24.18.0
 *   node tools/build-portable.js --keep-staging     Zwischenordner behalten
 *
 * Warum Archiv und nicht eine einzige .exe: Node kann Einzeldateien bauen,
 * fuehrt darin aber nur CommonJS aus. Dieses Programm ist durchgaengig ESM.
 * Der Umbau haette einen Bundler und eine andere Serverstruktur erfordert —
 * viel Risiko fuer einen Klick weniger.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const DL = path.join(ROOT, '.cache', 'node-runtimes');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const APP = 'theater-bild-geloete';
const DISPLAY = 'Theater-Bild-Gelöte';

/* ==========================================================================
 * Zielsysteme
 * ========================================================================== */

const TARGETS = {
  'win-x64': { nodeDir: 'win-x64', archive: 'zip', exe: 'node.exe', pack: 'zip' },
  'darwin-arm64': { nodeDir: 'darwin-arm64', archive: 'tar.gz', exe: 'bin/node', pack: 'tar.gz' },
  'darwin-x64': { nodeDir: 'darwin-x64', archive: 'tar.gz', exe: 'bin/node', pack: 'tar.gz' },
  'linux-x64': { nodeDir: 'linux-x64', archive: 'tar.xz', exe: 'bin/node', pack: 'tar.gz' },
};

/* ==========================================================================
 * Argumente
 * ========================================================================== */

function parseArgs(argv) {
  const out = { platforms: Object.keys(TARGETS), nodeVersion: null, keepStaging: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--platforms') out.platforms = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--node-version') out.nodeVersion = String(argv[++i] || '').trim();
    else if (a === '--keep-staging') out.keepStaging = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error(`Unbekannter Schalter: ${a}`); usage(); process.exit(1); }
  }
  for (const p of out.platforms) {
    if (!TARGETS[p]) {
      console.error(`Unbekanntes Zielsystem "${p}". Moeglich: ${Object.keys(TARGETS).join(', ')}`);
      process.exit(1);
    }
  }
  return out;
}

function usage() {
  console.log(`
${DISPLAY} — Pakete bauen

  node tools/build-portable.js [Schalter]

  --platforms <liste>    Kommagetrennt. Standard: alle
                         ${Object.keys(TARGETS).join(', ')}
  --node-version <vX>    Node-Fassung, z.B. v24.18.0. Standard: neueste LTS
  --keep-staging         Zwischenordner nicht loeschen
  --help
`);
}

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

const log = (s) => console.log(s);
const step = (s) => console.log(`\n== ${s}`);

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function mb(n) {
  return `${(n / 1e6).toFixed(1)} MB`;
}

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}

/** https.get mit Weiterleitungen. */
function download(url, target, onProgress) {
  return new Promise((resolve, reject) => {
    const go = (u, tiefe) => {
      if (tiefe > 8) return reject(new Error('Zu viele Weiterleitungen.'));
      https.get(u, { headers: { 'User-Agent': `${APP}-build` } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return go(new URL(res.headers.location, u).toString(), tiefe + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} bei ${u}`));
        }
        const total = Number(res.headers['content-length']) || 0;
        let seen = 0;
        let letzte = -1;
        const out = fs.createWriteStream(target);
        res.on('data', (c) => {
          seen += c.length;
          if (total > 0 && onProgress) {
            const pct = Math.floor((seen / total) * 100 / 10) * 10;
            if (pct !== letzte) { letzte = pct; onProgress(pct, seen, total); }
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(target)));
        out.on('error', reject);
      }).on('error', reject);
    };
    go(url, 0);
  });
}

async function latestLts() {
  const text = await new Promise((resolve, reject) => {
    https.get('https://nodejs.org/dist/index.json', { headers: { 'User-Agent': `${APP}-build` } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { s += d; });
      res.on('end', () => resolve(s));
    }).on('error', reject);
  });
  const list = JSON.parse(text);
  const lts = list.find((v) => v.lts);
  if (!lts) throw new Error('Keine LTS-Fassung in der Liste von nodejs.org gefunden.');
  return lts.version;
}

/* ==========================================================================
 * Node-Laufzeit holen und auspacken
 * ========================================================================== */

async function getNodeBinary(platform, nodeVersion) {
  const t = TARGETS[platform];
  const base = `node-${nodeVersion}-${t.nodeDir}`;
  const file = `${base}.${t.archive}`;
  const url = `https://nodejs.org/dist/${nodeVersion}/${file}`;
  const local = path.join(DL, file);

  fs.mkdirSync(DL, { recursive: true });
  if (!fs.existsSync(local)) {
    log(`  Lade ${file} …`);
    await download(url, local, (pct, seen, total) => {
      if (pct % 20 === 0) log(`    ${pct} % (${mb(seen)} von ${mb(total)})`);
    });
  } else {
    log(`  ${file} liegt schon im Cache`);
  }

  // Entpacken in einen eigenen Ordner je Fassung, damit mehrere nebeneinander gehen.
  const outDir = path.join(DL, base);
  if (!fs.existsSync(path.join(outDir, base))) {
    log(`  Entpacke ${file} …`);
    fs.mkdirSync(outDir, { recursive: true });
    if (t.archive === 'zip') {
      // Windows-Bordmittel. -Force, damit ein Abbruch nicht blockiert.
      execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${local}' -DestinationPath '${outDir}' -Force`,
      ], { stdio: 'inherit' });
    } else {
      // tar liegt auf Windows 10+, macOS und Linux vor und kann gz wie xz.
      //
      // ACHTUNG: GNU tar (kommt mit Git fuer Windows) haelt "D:\pfad" fuer die
      // Angabe eines entfernten Rechners und bricht mit "Cannot connect to D:"
      // ab. Deshalb wird tar IM Zielordner gestartet und bekommt nur relative
      // Namen zu sehen — das verstehen GNU tar und bsdtar gleichermassen.
      execFileSync('tar', ['-xf', path.basename(local), '-C', base], {
        cwd: DL,
        stdio: 'inherit',
      });
    }
  }

  const src = path.join(outDir, base, ...t.exe.split('/'));
  if (!fs.existsSync(src)) {
    throw new Error(`Node-Binary nicht gefunden: ${src}`);
  }
  return src;
}

/* ==========================================================================
 * Programm zusammenstellen
 * ========================================================================== */

/** Rekursiv kopieren, mit Filter. */
function copyTree(from, to, filter) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from)) {
      const s = path.join(from, e);
      const d = path.join(to, e);
      if (filter && !filter(s, e)) continue;
      copyTree(s, d, filter);
    }
  } else {
    fs.copyFileSync(from, to);
  }
}

/**
 * three ist als Paket 260 MB gross, gebraucht werden davon 3,6 MB.
 * Der Server liefert genau zwei Pfade aus:
 *   /vendor/three.module.js      -> build/three.module.js
 *   /vendor/three/addons/<pfad>  -> examples/jsm/<pfad>
 * Alles andere (Quellen, Doku, ungenutzte Addons) bleibt draussen.
 */
function copyPrunedThree(fromRoot, toRoot) {
  const src = path.join(fromRoot, 'three');
  const dst = path.join(toRoot, 'three');
  fs.mkdirSync(path.join(dst, 'build'), { recursive: true });
  fs.copyFileSync(path.join(src, 'build', 'three.module.js'), path.join(dst, 'build', 'three.module.js'));
  fs.copyFileSync(path.join(src, 'package.json'), path.join(dst, 'package.json'));
  // Nur die Addons, die wirklich importiert werden — plus deren Nachbarn im
  // controls-Ordner, weil OrbitControls daraus nachlaedt.
  copyTree(path.join(src, 'examples', 'jsm', 'controls'), path.join(dst, 'examples', 'jsm', 'controls'));
  const lic = path.join(src, 'LICENSE');
  if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(dst, 'LICENSE'));
}

const APP_SKIP = new Set([
  'node_modules', 'bin', 'out', 'dist', 'dist-web', '.git', '.cache', '.claude',
  'proxies', 'thumbs', 'tmp', 'venues',
]);

function stageApp(appDir) {
  fs.mkdirSync(appDir, { recursive: true });

  for (const e of fs.readdirSync(ROOT)) {
    if (APP_SKIP.has(e)) continue;
    if (e.startsWith('.') && e !== '.gitignore') continue;
    copyTree(path.join(ROOT, e), path.join(appDir, e));
  }

  // bin/ enthaelt im Programmordner die ffmpeg-Binaries — die wollen wir NICHT.
  // Der CLI-Einstieg daraus wird einzeln kopiert.
  fs.mkdirSync(path.join(appDir, 'bin'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'bin', `${APP}.js`),
    path.join(appDir, 'bin', `${APP}.js`)
  );

  // Abhaengigkeiten
  const nm = path.join(appDir, 'node_modules');
  fs.mkdirSync(nm, { recursive: true });
  const src = path.join(ROOT, 'node_modules');
  for (const e of fs.readdirSync(src)) {
    if (e === 'three' || e === '.bin' || e === '.package-lock.json') continue;
    copyTree(path.join(src, e), path.join(nm, e));
  }
  copyPrunedThree(src, nm);
}

/* ==========================================================================
 * Starter und Hinweistext
 * ========================================================================== */

const CMD_WIN = `@echo off
rem ${DISPLAY} — Starter fuer Windows
rem Doppelklick genuegt. Das Fenster zeigt das Protokoll und darf offen bleiben;
rem wird es geschlossen, endet das Programm.
chcp 65001 >nul
cd /d "%~dp0"
title ${DISPLAY}
echo.
echo   ${DISPLAY} startet ...
echo   Der Browser oeffnet sich gleich von selbst.
echo   Zum Beenden dieses Fenster schliessen.
echo.
"runtime\\node.exe" "app\\bin\\${APP}.js" --open
echo.
echo   Beendet. Taste druecken zum Schliessen.
pause >nul
`;

const SH_UNIX = `#!/bin/sh
# ${DISPLAY} — Starter
# Das Terminalfenster zeigt das Protokoll und darf offen bleiben.
cd "$(dirname "$0")" || exit 1

# Das Paket wird auf einem Windows-Rechner gebaut, und NTFS kennt kein
# Ausfuehrungs-Bit. Die mitgelieferte Node-Laufzeit kommt deshalb ohne +x aus
# dem Archiv. Hier einmal nachholen, damit niemand von Hand chmod tippen muss.
if [ ! -x ./runtime/node ]; then
  chmod +x ./runtime/node 2>/dev/null || {
    echo ""
    echo "  Die Node-Laufzeit laesst sich nicht ausfuehrbar machen."
    echo "  Bitte von Hand:  chmod +x \\"$(pwd)/runtime/node\\""
    echo ""
    exit 1
  }
fi

echo ""
echo "  ${DISPLAY} startet ..."
echo "  Der Browser oeffnet sich gleich von selbst."
echo "  Zum Beenden Strg+C druecken."
echo ""
exec ./runtime/node ./app/bin/${APP}.js --open
`;

function readmeFor(platform) {
  const gemeinsam = `
Was ist das
-----------
${DISPLAY} ist ein Werkzeug fuer mehrteilige LED-Buehnenwaende: Material
aufbereiten, in einer massstabsgetreuen 3D-Buehne pruefen, wie der Inhalt beim
Auffahren der Panels wirkt, und in den Codecs ausliefern, die das Haus verlangt.

Es wird NICHTS installiert. Kein Setup, keine Registry, keine Adminrechte.
Der Ordner liegt, wo du ihn hinlegst. Loeschen = deinstalliert.

Beim ersten Start fuehrt ein Assistent durch Arbeitsordner, ffmpeg und Venue.

ffmpeg
------
Zum Umwandeln und Rendern wird ffmpeg gebraucht (rund 170 MB). Es ist hier
NICHT dabei, weil es je nach System anders aussieht. Das Programm bietet beim
ersten Start an, es selbst zu holen — ein Klick.

Wichtig: ffmpeg aus Paketquellen bringt oft KEINEN hap-Encoder mit. Ohne den
ist eine HAP-Auslieferung nicht moeglich. Der eingebaute Bezug holt einen Build,
der HAP und ProRes kann.

Datenschutz
-----------
Das Programm laeuft ausschliesslich auf deinem Rechner und lauscht nur auf
127.0.0.1 — also nicht im Netzwerk. Es sendet nichts nach aussen. Die einzigen
Verbindungen nach draussen sind der ffmpeg-Bezug und nur dann, wenn du ihn
anstoesst.
`;

  if (platform.startsWith('win')) {
    return `${DISPLAY} ${VERSION} — Windows
==================================================

ZUERST: die Windows-Sperre loesen
---------------------------------
Windows markiert alles aus dem Internet und warnt beim ersten Start.
Das laesst sich in fuenf Sekunden vermeiden:

  1. Rechtsklick auf die heruntergeladene ZIP-Datei
  2. Eigenschaften
  3. Ganz unten "Zulassen" ankreuzen   (bei aelteren Fassungen: "Zulassen"-Knopf)
  4. OK
  5. ERST JETZT entpacken

Das muss VOR dem Entpacken passieren, nachtraeglich wirkt es nicht mehr.

Hast du schon entpackt und bekommst beim Start "Windows hat Ihren PC
geschuetzt": auf "Weitere Informationen" klicken, dann "Trotzdem ausfuehren".
Das kommt nur einmal.

Starten
-------
  Theater-Bild-Geloete.cmd  doppelklicken

Das Fenster gehoert dazu und zeigt das Protokoll. Schliesst du es, endet das
Programm. Der Browser oeffnet sich von selbst.

Warum die Warnung ueberhaupt kommt
----------------------------------
Die mitgelieferte node.exe ist gueltig signiert (OpenJS Foundation). Der
Starter selbst ist eine einfache Textdatei ohne Signatur — dafuer braeuchte es
ein kostenpflichtiges Zertifikat. An der Sicherheit aendert das nichts.
${gemeinsam}`;
  }

  if (platform.startsWith('darwin')) {
    return `${DISPLAY} ${VERSION} — macOS
==================================================

ZUERST: Gatekeeper
------------------
macOS blockt Programme ohne Apple-Signatur. Deshalb NICHT doppelklicken,
sondern beim ersten Mal:

  1. Rechtsklick auf  Theater-Bild-Geloete.command
  2. "Oeffnen" waehlen
  3. Im Dialog noch einmal "Oeffnen" bestaetigen

Ab dann genuegt der Doppelklick.

Meldet macOS trotzdem "kann nicht geoeffnet werden", im Terminal einmal:

  xattr -dr com.apple.quarantine "<Pfad zu diesem Ordner>"

Falls der Starter nicht ausfuehrbar ist:

  chmod +x "<Pfad>/Theater-Bild-Geloete.command" "<Pfad>/runtime/node"

Starten
-------
  Theater-Bild-Geloete.command   (beim ersten Mal per Rechtsklick, s.o.)

Das Terminalfenster gehoert dazu und zeigt das Protokoll. Beenden mit Strg+C.
${gemeinsam}`;
  }

  return `${DISPLAY} ${VERSION} — Linux
==================================================

Starten
-------
  ./theater-bild-geloete.sh

Ist die Datei nicht ausfuehrbar (kommt vor, je nach Entpacker):

  chmod +x theater-bild-geloete.sh runtime/node

Das Terminalfenster zeigt das Protokoll. Beenden mit Strg+C.
${gemeinsam}`;
}

/* ==========================================================================
 * Packen
 * ========================================================================== */

function packDir(stagingParent, name, kind, outFile) {
  rmrf(outFile);
  if (kind === 'zip') {
    // Compress-Archive erhaelt KEINE Unix-Rechte — fuer Windows egal.
    execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -LiteralPath '${path.join(stagingParent, name)}' -DestinationPath '${outFile}' -Force`,
    ], { stdio: 'inherit' });
  } else {
    // tar erhaelt das Ausfuehrbar-Bit — fuer macOS und Linux zwingend, sonst
    // laesst sich weder der Starter noch node ausfuehren.
    // Auch hier relativ arbeiten, siehe Hinweis zu GNU tar oben.
    execFileSync('tar', ['-czf', path.join('..', path.basename(outFile)), name], {
      cwd: stagingParent,
      stdio: 'inherit',
    });
  }
}

/* ==========================================================================
 * Hauptlauf
 * ========================================================================== */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodeVersion = args.nodeVersion || (await latestLts());

  log(`${DISPLAY} ${VERSION}`);
  log(`Node-Laufzeit: ${nodeVersion}`);
  log(`Zielsysteme:   ${args.platforms.join(', ')}`);

  fs.mkdirSync(DIST, { recursive: true });
  const staging = path.join(DIST, '.staging');
  rmrf(staging);
  fs.mkdirSync(staging, { recursive: true });

  const ergebnisse = [];

  for (const platform of args.platforms) {
    step(`${platform}`);
    const t = TARGETS[platform];
    const nodeBin = await getNodeBinary(platform, nodeVersion);

    const name = `${APP}-${VERSION}-${platform}`;
    const dir = path.join(staging, name);
    rmrf(dir);
    fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });

    // Laufzeit
    const zielName = platform.startsWith('win') ? 'node.exe' : 'node';
    const zielNode = path.join(dir, 'runtime', zielName);
    fs.copyFileSync(nodeBin, zielNode);
    if (!platform.startsWith('win')) fs.chmodSync(zielNode, 0o755);

    // Programm
    log('  Programm zusammenstellen …');
    stageApp(path.join(dir, 'app'));

    // Starter
    if (platform.startsWith('win')) {
      fs.writeFileSync(path.join(dir, 'Theater-Bild-Geloete.cmd'), CMD_WIN.replace(/\n/g, '\r\n'), 'utf8');
    } else if (platform.startsWith('darwin')) {
      const f = path.join(dir, 'Theater-Bild-Geloete.command');
      fs.writeFileSync(f, SH_UNIX, 'utf8');
      fs.chmodSync(f, 0o755);
    } else {
      const f = path.join(dir, `${APP}.sh`);
      fs.writeFileSync(f, SH_UNIX, 'utf8');
      fs.chmodSync(f, 0o755);
    }

    // Hinweistext
    const rmName = platform.startsWith('win') ? 'ZUERST-LESEN.txt' : 'ZUERST-LESEN.txt';
    fs.writeFileSync(
      path.join(dir, rmName),
      readmeFor(platform).replace(/\n/g, platform.startsWith('win') ? '\r\n' : '\n'),
      'utf8'
    );

    const roh = dirSize(dir);
    log(`  Entpackt: ${mb(roh)}`);

    // Packen
    const ext = t.pack === 'zip' ? 'zip' : 'tar.gz';
    const outFile = path.join(DIST, `${name}.${ext}`);
    log(`  Packe ${path.basename(outFile)} …`);
    packDir(staging, name, t.pack, outFile);

    const gepackt = fs.statSync(outFile).size;
    log(`  Fertig: ${path.basename(outFile)} — ${mb(gepackt)}`);
    ergebnisse.push({ platform, file: outFile, roh, gepackt });
  }

  if (!args.keepStaging) rmrf(staging);

  step('Ergebnis');
  for (const r of ergebnisse) {
    log(`  ${r.platform.padEnd(14)} ${mb(r.gepackt).padStart(9)}   ${path.basename(r.file)}`);
  }
  log(`\nDie Archive liegen in ${DIST}`);
  log('Weitergabe: Datei verschicken oder an eine GitHub-Release haengen.');
}

main().catch((err) => {
  console.error(`\nFEHLGESCHLAGEN: ${err.message}`);
  if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
