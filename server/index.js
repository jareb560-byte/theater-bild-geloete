/**
 * Theater-Bild-Gelöte - HTTP-Server.
 *
 * Verdrahtet alle Routen aus shared/API.md. Die eigentliche Arbeit an
 * Filtergraphen, Rendern, Conform, Proxies und QC liegt in server/ops/*;
 * dieses Modul kennt nur den Vertrag, nicht die Innereien.
 *
 * Aufruf-Konvention fuer die ops-Module (einheitlich):
 *   await opsFunktion({ ...RequestBody, project, venue }, ctx)
 * ctx ist der Jobkontext aus server/jobs.js:
 *   { setProgress, log, signal, setResult, setCommand, job }
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { findMedia } from '../shared/model.js';

// initPaths() richtet das Arbeitsverzeichnis ein. server/paths.js tut das
// bereits beim eigenen Import selbst - ESM zieht alle Importe hoch, ein Aufruf
// hier im Rumpf kaeme fuer Module, die beim Laden einen Pfad festhalten, zu
// spaet. Der Aufruf unten ist die ausdrueckliche Bestaetigung und der Haken,
// an dem POST /api/workspace zur Laufzeit umschaltet.
import * as pathsMod from './paths.js';
import { paths, initPaths, freeBytes, workspaceSource, WORKSPACE_ENV } from './paths.js';
import * as ffmpeg from './ffmpeg.js';
import * as jobs from './jobs.js';
import * as venues from './venues.js';
import * as projects from './project.js';
import * as library from './library.js';
import * as probe from './probe.js';
import { browse } from './fsbrowse.js';
import { installFfmpeg } from './cli/install-ffmpeg.js';

// --- fremde Module, Vertrag siehe Projektvorgabe -------------------------
import venuesRouter from './routes/venues.js';
import { renderWall, renderPanels, renderAll, renderStill, resetBins } from './ops/render.js';
import { buildWallGraph, graphToCommand, formatCommandLine } from './ops/filtergraph.js';
import { conformMedia } from './ops/conform.js';
import { makeProxy, makeThumb } from './ops/proxy.js';
import { runChecks } from './ops/qc.js';

initPaths();

/** Vorgabewerte. Ueberschreibbar per CLI (--host/--port) und Umgebung. */
export const HOST = '127.0.0.1';
export const PORT = 7333;

/** Dateiendung der Projektdateien im Arbeitsverzeichnis. */
const PROJECT_EXT = '.tbg.json';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64mb' }));

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(paths.root, 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

/** Plattformangaben fuer /api/health und /api/workspace. */
function platformInfo() {
  const label = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform];
  return {
    os: process.platform,
    label: label || process.platform,
    release: os.release(),
    arch: process.arch,
    node: process.versions.node,
    homedir: os.homedir(),
  };
}

/** Async-Route ohne try/catch-Wildwuchs. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fail(status, message, detail) {
  const err = new Error(message);
  err.status = status;
  if (detail) err.detail = detail;
  return err;
}

/** Projekt + Venue in einem Rutsch - jede ops-Funktion braucht beides. */
function context() {
  const project = projects.current();
  const venue = venues.get(project.venueId);
  return { project, venue };
}

// Render-/QC-Routen kopieren diesen Kontext bereits beim Request. Jobs
// koennen warten; spaetere Bearbeitungen oder Projektwechsel duerfen ihren
// Inhalt und die zugehoerige Venue-Spezifikation nicht mehr veraendern.

/**
 * Argument fuer die ops-Module.
 *
 * Die ops-Module in server/ops/ erwarten den Jobkontext zuerst
 * (siehe server/ops/proxy.js: makeProxy(ctx, media, opts)) und lesen daraus
 * ctx.log, ctx.progress, ctx.signal, ctx.venue und ctx.project. Damit die
 * Verdrahtung nicht an der Argumentreihenfolge scheitert, baut opsArg EIN
 * Objekt, das sowohl Jobkontext als auch Anfragedaten enthaelt; es wird an
 * beide Parameterpositionen uebergeben. Egal, welche Reihenfolge ein
 * ops-Modul erwartet - es findet alles, was es braucht.
 */
function opsArg(ctx, body = {}, capturedContext = context()) {
  const { project, venue } = capturedContext;
  return {
    ...body,
    project,
    venue,
    paths,
    job: ctx?.job ?? null,
    signal: ctx?.signal ?? null,
    log: ctx?.log ?? ((line) => console.log(`[ops] ${line}`)),
    progress: ctx?.setProgress ?? (() => {}),
    setProgress: ctx?.setProgress ?? (() => {}),
    setResult: ctx?.setResult ?? (() => {}),
    setCommand: ctx?.setCommand ?? (() => {}),
  };
}

function mediaOr404(id) {
  const { project } = context();
  const media = findMedia(project, id);
  if (!media) throw fail(404, `Medium ${id} ist nicht in der Bibliothek.`);
  return media;
}

/** Datei mit HTTP-Range ausliefern - ohne das kann <video> nicht springen. */
function sendWithRange(req, res, file, contentType) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.status(404).json({ error: 'Datei nicht gefunden.', detail: file });
    return;
  }
  const total = stat.size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');

  const rangeHeader = req.headers.range;
  if (!rangeHeader) {
    res.setHeader('Content-Length', String(total));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const all = fs.createReadStream(file);
    all.on('error', (err) => {
      console.error(`[http] Lesefehler ${file}: ${err.message}`);
      res.destroy();
    });
    all.pipe(res);
    return;
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    res.setHeader('Content-Range', `bytes */${total}`);
    res.status(416).end();
    return;
  }

  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number.parseInt(m[2], 10);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      res.setHeader('Content-Range', `bytes */${total}`);
      res.status(416).end();
      return;
    }
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number.parseInt(m[1], 10);
    end = m[2] === '' ? total - 1 : Number.parseInt(m[2], 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    res.setHeader('Content-Range', `bytes */${total}`);
    res.status(416).end();
    return;
  }
  end = Math.min(end, total - 1);

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  res.setHeader('Content-Length', String(end - start + 1));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', (err) => {
    console.error(`[http] Lesefehler ${file}: ${err.message}`);
    res.destroy();
  });
  stream.pipe(res);
}

/* ==========================================================================
 * Systemzustand
 * ========================================================================== */

app.get(
  '/api/health',
  wrap(async (req, res) => {
    const status = await ffmpeg.status();
    res.json({
      ok: true,
      version: pkgVersion(),
      platform: platformInfo(),
      workspace: paths.workspace,
      ffmpeg: status.ffmpeg,
      ffprobe: status.ffprobe,
      paths: {
        root: paths.root,
        workspace: paths.workspace,
        projects: paths.projects,
        venues: paths.venues,
        builtinVenues: paths.builtinVenues,
        cache: paths.cache,
        proxies: paths.proxies,
        thumbs: paths.thumbs,
        out: paths.out,
        bin: paths.bin,
        project: projects.currentFile(),
      },
      jobs: jobs.stats(),
      hint: status.ffmpeg.found ? null : ffmpeg.installHint(),
    });
  })
);

app.post(
  '/api/ffmpeg/install',
  wrap(async (req, res) => {
    const job = jobs.createJob({ type: 'ffmpeg.install', label: 'ffmpeg installieren (BtbN GPL)' });
    jobs.start(job, async (ctx) => {
      const result = await installFfmpeg({
        log: ctx.log,
        onProgress: ctx.setProgress,
        signal: ctx.signal,
        // macOS hat keinen fertigen Build. Ob dort brew laufen darf,
        // entscheidet ausdruecklich der Nutzer — nie das Programm.
        allowBrew: req.body?.brew === true,
      });
      ffmpeg.refresh();
      // ops/render.js hat die ffmpeg-Pfade beim ersten Render gemerkt. Ohne
      // das Verwerfen benutzt der naechste Render weiter den Rueckfall
      // "ffmpeg aus dem PATH" statt des soeben installierten Binaries.
      try {
        resetBins();
      } catch (err) {
        ctx.log(`ffmpeg-Pfade zuruecksetzen fehlgeschlagen: ${err.message}`);
      }
      const status = await ffmpeg.status();
      return { ...result, ffmpeg: status.ffmpeg };
    });
    res.json({ jobId: job.id });
  })
);

/* ==========================================================================
 * Venues
 *
 * Der Router liegt in server/routes/venues.js und beherrscht laut Vertrag
 * GET /, GET /:id, POST /, PUT /:id, DELETE /:id, POST /:id/duplicate,
 * POST /validate und GET /template. Die frueheren zwei Routen hier sind
 * darin enthalten.
 * ========================================================================== */

app.use('/api/venues', venuesRouter);

/* ==========================================================================
 * Arbeitsverzeichnis
 * ========================================================================== */

/** Antwortkoerper fuer GET und POST /api/workspace. */
function workspaceInfo() {
  return {
    workspace: paths.workspace,
    source: workspaceSource(),
    projects: paths.projects,
    venues: paths.venues,
    builtinVenues: paths.builtinVenues,
    cache: paths.cache,
    proxies: paths.proxies,
    thumbs: paths.thumbs,
    out: paths.out,
    bin: paths.bin,
    root: paths.root,
    platform: platformInfo(),
    freeBytes: freeBytes(paths.workspace),
  };
}

app.get('/api/workspace', (req, res) => {
  res.json(workspaceInfo());
});

app.post('/api/workspace', (req, res) => {
  const wanted = req.body?.path;
  if (typeof wanted !== 'string' || wanted.trim() === '') {
    throw fail(400, 'Kein Pfad angegeben.', 'Erwartet wird { "path": "…" }.');
  }

  // (1) Erst pruefen, ob ueberhaupt gewechselt werden DARF.
  //
  // Ein laufender Render schreibt in den alten Ausgabeordner und liest aus dem
  // alten Cache. Zieht man ihm das Verzeichnis unter den Fuessen weg, landet
  // die halbfertige Datei irgendwo und der Fortschritt zeigt ins Leere.
  const s = jobs.stats();
  const offen = (s.running || 0) + (s.queued || 0);
  if (offen > 0) {
    throw fail(
      409,
      `${offen} Job(s) laufen noch.`,
      'Erst abwarten oder abbrechen, dann das Arbeitsverzeichnis wechseln.'
    );
  }

  // (2) Beschreibbarkeit WIRKLICH pruefen, bevor irgendetwas umgestellt wird.
  //
  // initPaths() mutiert die Pfadfelder zuerst und faengt mkdir-Fehler danach
  // nur ab und protokolliert sie. Ohne diese Vorpruefung wuerde ein
  // unbeschreibbarer Ordner klaglos uebernommen, und erst der naechste Render
  // scheitert — mit einem Fehler, der wie ein Renderproblem aussieht.
  const target = path.resolve(wanted.trim());
  try {
    fs.mkdirSync(target, { recursive: true });
    const probe = path.join(target, `.Theater-Bild-Gelöte-schreibprobe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (err) {
    throw fail(
      400,
      `In "${target}" kann nicht geschrieben werden: ${err.message}`,
      'Anderen Ordner waehlen oder die Schreibrechte pruefen.'
    );
  }

  const before = paths.workspace;
  try {
    initPaths({ workspace: target });
  } catch (err) {
    throw fail(
      400,
      `Arbeitsverzeichnis "${target}" konnte nicht eingerichtet werden: ${err.message}`,
      'Anderen Ordner waehlen oder Schreibrechte pruefen.'
    );
  }

  if (paths.workspace !== before) {
    // ffmpeg liegt jetzt woanders, und die Venue-Dateien koennen sich
    // unterscheiden. Beide Caches muessen weg, sonst zeigt die Oberflaeche
    // stumm den alten Stand.
    ffmpeg.refresh();
    try {
      venues.reload();
    } catch (err) {
      console.error(`[http] Venues neu laden fehlgeschlagen: ${err.message}`);
    }
    // Der Probe-Cache liegt als Modulvariable im Speicher und zeigt sonst
    // weiter auf die Eintraege des alten Arbeitsverzeichnisses — inklusive
    // Proxy-Pfaden, die es dort nicht mehr gibt.
    try {
      probe.resetCache();
    } catch (err) {
      console.error(`[http] Probe-Cache zuruecksetzen fehlgeschlagen: ${err.message}`);
    }
    // Die ffmpeg-Pfade in ops/render.js werden beim ersten Render gemerkt und
    // nie wieder verworfen. Nach einem Verzeichniswechsel zeigen sie auf das
    // bin/ des alten Arbeitsverzeichnisses.
    try {
      resetBins();
    } catch (err) {
      console.error(`[http] ffmpeg-Pfade zuruecksetzen fehlgeschlagen: ${err.message}`);
    }
    console.log(`[server] Arbeitsverzeichnis gewechselt: ${before} → ${paths.workspace}`);
  }

  res.json({ ok: true, changed: paths.workspace !== before, previous: before, ...workspaceInfo() });
});

/* ==========================================================================
 * Projekt
 * ========================================================================== */

/**
 * Liest venueId und name aus dem Kopf einer Projektdatei, ohne sie ganz zu
 * parsen. makeProject() schreibt beide Felder weit vorn; 64 KB reichen
 * sicher, und eine 40-MB-Projektdatei blockiert die Liste nicht.
 */
function peekProjectMeta(file) {
  let head = '';
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    head = buf.slice(0, read).toString('utf8');
  } catch (err) {
    console.error(`[http] Projektdatei ${file} nicht lesbar: ${err.message}`);
    return { venueId: null, projectName: null, error: err.message };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* schon zu */
      }
    }
  }
  const venueId = /"venueId"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head)?.[1] ?? null;
  const projectName = /"name"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head)?.[1] ?? null;
  return { venueId, projectName, error: null };
}

app.get('/api/projects', (req, res) => {
  let names = [];
  try {
    names = fs
      .readdirSync(paths.projects)
      .filter((f) => f.toLowerCase().endsWith(PROJECT_EXT));
  } catch (err) {
    throw fail(
      500,
      `Projektordner ${paths.projects} ist nicht lesbar: ${err.message}`,
      'Arbeitsverzeichnis pruefen oder mit --workspace ein anderes waehlen.'
    );
  }

  const out = [];
  for (const name of names) {
    const full = path.join(paths.projects, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (err) {
      console.error(`[http] ${full} nicht lesbar: ${err.message}`);
      continue;
    }
    if (!stat.isFile()) continue;
    const meta = peekProjectMeta(full);
    out.push({
      name,
      path: full,
      mtime: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      venueId: meta.venueId,
      projectName: meta.projectName,
      error: meta.error,
    });
  }
  out.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
  res.json(out);
});

app.get('/api/project', (req, res) => {
  res.json(projects.current());
});

app.put('/api/project', (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object' || !incoming.walls) {
    throw fail(400, 'Der Body enthält kein Projekt (Feld "walls" fehlt).');
  }
  const p = projects.setCurrent(incoming);
  p.modifiedAt = new Date().toISOString();
  res.json({ ok: true, modifiedAt: p.modifiedAt });
});

app.post('/api/project/new', (req, res) => {
  const { venueId, name } = req.body || {};
  const id = venueId || venues.BASE_VENUE_ID;
  let p;
  try {
    p = projects.create(id, name || 'Unbenannt');
  } catch (err) {
    throw fail(400, err.message);
  }
  projects.setCurrent(p, null);
  res.json(p);
});

app.post('/api/project/open', (req, res) => {
  const { path: file } = req.body || {};
  if (!file) throw fail(400, 'Kein Pfad angegeben.');
  res.json(projects.open(file));
});

app.post('/api/project/save', (req, res) => {
  const { path: file } = req.body || {};
  const abs = projects.saveCurrent(file || undefined);
  res.json({ ok: true, path: abs });
});

app.get('/api/project/validate', (req, res) => {
  res.json(projects.validate());
});

/* ==========================================================================
 * Medien
 * ========================================================================== */

app.post('/api/library/scan', (req, res) => {
  const { roots, recursive = true } = req.body || {};
  const list = Array.isArray(roots) ? roots : roots ? [roots] : [];
  if (list.length === 0) throw fail(400, 'Kein Ordner angegeben.');

  const job = jobs.createJob({
    type: 'library.scan',
    label: `Bibliothek einlesen: ${list.map((r) => path.basename(r) || r).join(', ')}`,
  });
  jobs.start(job, async (ctx) => {
    const { project, venue } = context();
    const result = await library.scanRoots(list, {
      recursive: recursive !== false,
      venue,
      signal: ctx.signal,
      log: ctx.log,
      onProgress: ctx.setProgress,
    });
    const merged = library.mergeIntoProject(project, result.media);
    projects.touch();
    return { media: merged, errors: result.errors, scanned: result.scanned };
  });
  res.json({ jobId: job.id });
});

app.post(
  '/api/media/add',
  wrap(async (req, res) => {
    const list = Array.isArray(req.body?.paths) ? req.body.paths : [];
    if (list.length === 0) throw fail(400, 'Keine Pfade angegeben.');
    const { project, venue } = context();
    const { media, errors } = await library.addPaths(list, { venue });
    const merged = library.mergeIntoProject(project, media);
    projects.touch();
    if (merged.length === 0 && errors.length > 0) {
      throw fail(400, 'Keine der Dateien konnte gelesen werden.', errors.join('\n'));
    }
    res.json({ media: merged, errors });
  })
);

app.post('/api/media/proxy', (req, res) => {
  const ids = Array.isArray(req.body?.mediaIds) ? req.body.mediaIds : [];
  const force = req.body?.force === true;
  if (ids.length === 0) throw fail(400, 'Keine mediaIds angegeben.');

  const job = jobs.createJob({
    type: 'media.proxy',
    label: `Proxies erzeugen (${ids.length} Datei${ids.length === 1 ? '' : 'en'})`,
  });
  jobs.start(job, async (ctx) => {
    const { project } = context();
    const arg = opsArg(ctx, {});
    const done = [];
    const errors = [];
    for (let i = 0; i < ids.length; i += 1) {
      if (ctx.signal.aborted) break;
      const media = findMedia(project, ids[i]);
      if (!media) {
        errors.push(`Medium ${ids[i]} ist nicht in der Bibliothek.`);
        ctx.log(`Medium ${ids[i]} ist nicht in der Bibliothek.`);
        continue;
      }
      ctx.log(`Proxy: ${media.name}`);
      try {
        // Signatur aus server/ops/proxy.js: (ctx, media, opts)
        applyArtifact(media, 'proxy', await makeProxy(arg, media, { force }));
        applyArtifact(media, 'thumb', await makeThumb(arg, media, { force }));
        done.push(media.id);
      } catch (err) {
        errors.push(`${media.name}: ${err.message}`);
        ctx.log(`FEHLER bei ${media.name}: ${err.message}`);
      }
      ctx.setProgress((i + 1) / ids.length);
    }
    projects.touch();
    return { mediaIds: done, errors, media: done.map((id) => findMedia(project, id)) };
  });
  res.json({ jobId: job.id });
});

/**
 * ops/proxy.js darf das Medium selbst beschreiben ODER einen Deskriptor
 * zurueckgeben. Beides wird akzeptiert, damit der Vertrag nicht an einer
 * Formfrage scheitert.
 */
function applyArtifact(media, field, value) {
  if (!value || typeof value !== 'object') return;
  if (value[field] && typeof value[field] === 'object') {
    media[field] = value[field];
    return;
  }
  if (typeof value.path === 'string') {
    media[field] =
      field === 'thumb'
        ? { path: value.path, ready: value.ready !== false }
        : {
            path: value.path,
            width: value.width ?? 0,
            height: value.height ?? 0,
            ready: value.ready !== false,
          };
  }
}

app.get('/api/media/:id/proxy', (req, res) => {
  const media = mediaOr404(req.params.id);
  const file = media.proxy?.path;
  if (!file || !fs.existsSync(file)) {
    throw fail(
      404,
      `Für "${media.name}" gibt es noch keinen Proxy.`,
      'Im Reiter Bibliothek "Proxies erzeugen" ausführen.'
    );
  }
  const ext = path.extname(file).toLowerCase();
  const type = ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';
  sendWithRange(req, res, file, type);
});

app.get('/api/media/:id/thumb', (req, res) => {
  const media = mediaOr404(req.params.id);
  const file = media.thumb?.path;
  if (!file || !fs.existsSync(file)) {
    throw fail(404, `Für "${media.name}" gibt es noch keinen Posterframe.`);
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.type('image/jpeg');
  res.sendFile(file);
});

app.delete('/api/media/:id', (req, res) => {
  const { project } = context();
  const idx = project.media.findIndex((m) => m.id === req.params.id);
  if (idx < 0) throw fail(404, `Medium ${req.params.id} ist nicht in der Bibliothek.`);
  const [media] = project.media.splice(idx, 1);

  // Quelldateien bleiben unangetastet - nur unsere eigenen Ableitungen gehen.
  const removed = [];
  for (const f of [media.proxy?.path, media.thumb?.path]) {
    if (!f) continue;
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        removed.push(f);
      }
    } catch (err) {
      console.error(`[http] Konnte ${f} nicht löschen: ${err.message}`);
    }
  }
  projects.touch();
  res.json({ ok: true, id: media.id, removed });
});

/* ==========================================================================
 * Dateisystem
 * ========================================================================== */

app.get('/api/fs/browse', (req, res) => {
  const target = req.query.path;
  res.json(
    browse(target, {
      onlyDirs: req.query.onlyDirs === '1' || req.query.onlyDirs === 'true',
      mediaOnly: req.query.mediaOnly === '1' || req.query.mediaOnly === 'true',
    })
  );
});

/* ==========================================================================
 * Verarbeitung
 * ========================================================================== */

app.post('/api/conform', (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.mediaIds) ? body.mediaIds : [];
  if (ids.length === 0) throw fail(400, 'Keine mediaIds angegeben.');
  if (!body.target) throw fail(400, 'Kein target-Objekt angegeben.');

  const job = jobs.createJob({
    type: 'conform',
    label: `Conform (${ids.length} Datei${ids.length === 1 ? '' : 'en'})`,
  });
  jobs.start(job, async (ctx) => {
    const arg = opsArg(ctx, { ...body, outDir: body.outDir || paths.out });

    // conformMedia verarbeitet GENAU EINE Datei und erwartet ein aufgeloestes
    // Media-Objekt - nicht die Liste der IDs aus dem Request. Also hier
    // aufloesen und der Reihe nach durchgehen.
    const produced = [];
    const errors = [];
    for (let i = 0; i < ids.length; i += 1) {
      if (arg.signal?.aborted) throw new Error('Job wurde abgebrochen.');
      const id = ids[i];
      const media = findMedia(arg.project, id);
      if (!media) {
        // Fehlende Dateien sammeln statt schweigend ueberspringen.
        errors.push({ mediaId: id, error: `Medium ${id} ist nicht in der Bibliothek.` });
        ctx.log(`Uebersprungen: Medium ${id} ist nicht in der Bibliothek.`);
        continue;
      }
      ctx.log(`(${i + 1}/${ids.length}) ${media.name}`);
      try {
        const one = await conformMedia(
          { ...arg, setProgress: (p) => ctx.setProgress((i + Math.max(0, Math.min(1, p))) / ids.length) },
          { media, target: body.target, outDir: arg.outDir, venue: arg.venue }
        );
        if (Array.isArray(one?.media)) produced.push(...one.media);
        else if (one?.media) produced.push(one.media);
      } catch (err) {
        if (err?.cancelled) throw err;
        errors.push({ mediaId: id, name: media.name, error: err.message });
        ctx.log(`FEHLER bei ${media.name}: ${err.message}`);
      }
      ctx.setProgress((i + 1) / ids.length);
    }

    if (body.addToLibrary !== false && produced.length) {
      library.mergeIntoProject(arg.project, produced);
      projects.touch();
    }
    if (!produced.length && errors.length) {
      throw new Error(
        `Keine einzige Datei konnte angeglichen werden:\n${errors.map((e) => `${e.name || e.mediaId}: ${e.error}`).join('\n')}`
      );
    }
    return { media: produced, errors };
  });
  res.json({ jobId: job.id });
});

app.post('/api/render/wall', (req, res) => {
  const body = req.body || {};
  if (!body.wallId) throw fail(400, 'Kein wallId angegeben.');
  const snapshot = structuredClone(context());
  const job = jobs.createJob({
    type: 'render.wall',
    label: `Wand ${body.wallId} → ${body.presetId || 'Standard'}${body.dryRun ? ' (nur Kommando)' : ''}`,
  });
  jobs.start(job, async (ctx) => {
    const arg = opsArg(ctx, { ...body, outDir: body.outDir || paths.out }, snapshot);
    return renderWall(arg, arg);
  });
  res.json({ jobId: job.id });
});

app.post('/api/render/panels', (req, res) => {
  const body = req.body || {};
  if (!body.wallId) throw fail(400, 'Kein wallId angegeben.');
  const snapshot = structuredClone(context());
  const job = jobs.createJob({
    type: 'render.panels',
    label: `Panels von Wand ${body.wallId} → ${body.presetId || 'Standard'}`,
  });
  jobs.start(job, async (ctx) => {
    const arg = opsArg(ctx, { ...body, outDir: body.outDir || paths.out }, snapshot);
    return renderPanels(arg, arg);
  });
  res.json({ jobId: job.id });
});

app.post('/api/render/all', (req, res) => {
  const body = req.body || {};
  const snapshot = structuredClone(context());
  const job = jobs.createJob({
    type: 'render.all',
    label: `Alles rendern (${(body.walls || ['A', 'B', 'C', 'D']).join(', ')})`,
  });
  jobs.start(job, async (ctx) => {
    const arg = opsArg(ctx, { ...body, outDir: body.outDir || paths.out }, snapshot);
    return renderAll(arg, arg);
  });
  res.json({ jobId: job.id });
});

app.post('/api/render/still', (req, res) => {
  const body = req.body || {};
  if (!body.wallId) throw fail(400, 'Kein wallId angegeben.');
  const snapshot = structuredClone(context());
  const job = jobs.createJob({
    type: 'render.still',
    label: `Standbild Wand ${body.wallId} @ ${body.atSec ?? 0}s`,
  });
  jobs.start(job, async (ctx) => {
    const arg = opsArg(ctx, body, snapshot);
    return renderStill(arg, arg);
  });
  res.json({ jobId: job.id });
});

app.post('/api/qc/run', (req, res) => {
  const body = req.body || {};
  const snapshot = structuredClone(context());
  const job = jobs.createJob({
    type: 'qc.run',
    label: `QC ${body.wallId ? `Wand ${body.wallId}` : ''}`.trim(),
  });
  jobs.start(job, async (ctx) => {
    const arg = opsArg(ctx, body, snapshot);
    return runChecks(arg, arg);
  });
  res.json({ jobId: job.id });
});

/* ==========================================================================
 * Render-Vorschau ohne Rendern
 * ========================================================================== */

app.post(
  '/api/preview/filtergraph',
  wrap(async (req, res) => {
    const wallId = req.body?.wallId;
    if (!wallId) throw fail(400, 'Kein wallId angegeben.');
    const { project, venue } = context();
    if (!project) throw fail(409, 'Es ist kein Projekt geladen.');
    if (!venue) throw fail(409, 'Es ist kein Venue geladen.');

    // Kein Job - der Filtergraph wird nur gebaut, nicht ausgefuehrt.
    // buildWallGraph hat die Signatur (project, venue, wallId, opts) und NICHT
    // (ctx, opts) wie die render-Funktionen. Deshalb hier einzeln uebergeben.
    const graph = buildWallGraph(project, venue, wallId, {
      rangeSec: req.body?.rangeSec ?? null,
      forPanels: req.body?.alsoPanels === true,
    });

    // API.md sagt "command" zu: der vollstaendige ffmpeg-Aufruf im Klartext.
    // Das ist der Kern der Sichtpruefung - ohne das Feld zeigt die Oberflaeche
    // nur "(kein Befehl geliefert)".
    const exe = ffmpeg.locate()?.ffmpeg?.path || 'ffmpeg';
    let command = null;
    try {
      const args = graphToCommand(graph, {
        ffmpegPath: exe,
        outArgs: [],
        outPath: '<Zieldatei>',
        fps: graph.meta?.fps ?? project.fps,
      });
      command = formatCommandLine(exe, args);
    } catch (err) {
      // Die Kommandozeile ist nur Anzeige - ein Fehler hier darf die Vorschau
      // des Graphen nicht kaputtmachen.
      command = null;
      graph.warnings = [...(graph.warnings || []), `Kommandozeile nicht darstellbar: ${err.message}`];
    }

    res.json({ ...graph, command });
  })
);

/* ==========================================================================
 * Jobs
 * ========================================================================== */

app.get('/api/jobs', (req, res) => {
  res.json(jobs.list());
});

app.get('/api/jobs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch (err) {
      console.error(`[sse] Schreiben fehlgeschlagen: ${err.message}`);
    }
  };

  // Das Joblog NICHT ueber SSE mitschicken. Die Zeilen kommen ohnehin einzeln
  // als {type:'log'}. Wuerde man sie im Job-Objekt mitsenden, ginge bei einem
  // laufenden Render das gesamte bisherige Log rund achtmal pro Sekunde erneut
  // ueber die Leitung - und zwar genau dann, wenn der Browser die 3D-Vorschau
  // zeichnen soll. Das vollstaendige Log liefert GET /api/jobs/:id.
  const slim = ({ log, ...rest }) => rest;

  send({ type: 'hello', jobs: jobs.list().map(slim) });

  const onJob = (job) => send({ type: 'job', job: slim(job) });
  const onLog = (e) => send({ type: 'log', id: e.id, line: e.line });
  jobs.bus.on('job', onJob);
  jobs.bus.on('log', onLog);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* Verbindung ist weg, close raeumt gleich auf */
    }
  }, 15000);
  heartbeat.unref?.();

  req.on('close', () => {
    clearInterval(heartbeat);
    jobs.bus.off('job', onJob);
    jobs.bus.off('log', onLog);
  });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) throw fail(404, `Job ${req.params.id} ist unbekannt.`);
  res.json(job);
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) throw fail(404, `Job ${req.params.id} ist unbekannt.`);
  const ok = jobs.cancel(req.params.id);
  res.json({ ok, status: job.status });
});

/* ==========================================================================
 * Statische Auslieferung
 * ========================================================================== */

const noCache = (res) => {
  res.setHeader('Cache-Control', 'no-cache');
};

app.use('/src', express.static(path.join(paths.client, 'src'), { setHeaders: noCache }));
app.use('/assets', express.static(path.join(paths.client, 'assets'), { setHeaders: noCache }));
// shared/model.js wird von Server UND Client importiert - der Client braucht eine URL.
app.use('/shared', express.static(paths.shared, { setHeaders: noCache }));

app.get('/vendor/three.module.js', (req, res, next) => {
  const file = path.join(paths.nodeModules, 'three', 'build', 'three.module.js');
  if (!fs.existsSync(file)) {
    next(fail(404, 'three ist nicht installiert. Bitte "npm install" ausführen.'));
    return;
  }
  res.type('application/javascript');
  res.sendFile(file);
});

const threeAddons = express.static(path.join(paths.nodeModules, 'three', 'examples', 'jsm'));
// Vertragspfad …
app.use('/vendor/three-addons', threeAddons);
// … und der Pfad, den die import map in client/index.html benutzt.
app.use('/vendor/three/addons', threeAddons);

const indexHtml = path.join(paths.client, 'index.html');

app.get('/', (req, res) => {
  if (!fs.existsSync(indexHtml)) {
    res
      .status(503)
      .type('html')
      .send(
        '<h1>Theater-Bild-Gelöte</h1><p>Die Oberfläche (client/index.html) fehlt noch. ' +
          'Der Server läuft, die API unter <code>/api/health</code> antwortet.</p>'
      );
    return;
  }
  noCache(res);
  res.sendFile(indexHtml);
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

/* ==========================================================================
 * Fehlerbehandlung - nichts scheitert still
 * ========================================================================== */

app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unbekannter Endpunkt: ${req.method} /api${req.path}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(`[http] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
    if (err.stack) console.error(err.stack);
  } else {
    console.warn(`[http] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json({
    error: err.message || 'Unbekannter Fehler',
    detail: err.detail || null,
  });
});

/* ==========================================================================
 * Start
 * ========================================================================== */

/** Einmaliger Versuch, auf host:port zu lauschen. */
function listenOnce(host, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });
}

/**
 * Lauscht auf dem gewuenschten Port. Ist er belegt, wird der naechste freie
 * genommen - und das deutlich gemeldet, damit niemand im falschen Fenster sucht.
 */
async function listenWithFallback(host, port, tries = 20) {
  let taken = 0;
  for (let p = port; p < port + tries; p += 1) {
    try {
      const server = await listenOnce(host, p);
      if (p !== port) {
        console.log('');
        console.log(`  HINWEIS: Port ${port} ist belegt (${taken} Port(s) durchprobiert).`);
        console.log(`           Theater-Bild-Gelöte laeuft stattdessen auf Port ${p}.`);
        console.log('           Laeuft Theater-Bild-Gelöte vielleicht schon in einem anderen Fenster?');
      }
      return server;
    } catch (err) {
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') {
        throw new Error(`Server konnte nicht auf ${host}:${p} starten: ${err.message}`);
      }
      taken += 1;
    }
  }
  throw new Error(
    `Kein freier Port zwischen ${port} und ${port + tries - 1} auf ${host}. ` +
      'Mit --port <n> einen anderen Bereich waehlen.'
  );
}

/** Standardbrowser oeffnen. Plattformabhaengig, Fehler werden gemeldet. */
export function openBrowser(url) {
  const table = {
    win32: ['cmd', ['/c', 'start', '', url]],
    darwin: ['open', [url]],
  };
  const [cmd, args] = table[process.platform] || ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (err) => {
      console.error(`[server] Browser konnte nicht geoeffnet werden (${cmd}): ${err.message}`);
      console.error(`[server] Bitte von Hand oeffnen: ${url}`);
    });
    child.unref();
  } catch (err) {
    console.error(`[server] Browser konnte nicht geoeffnet werden: ${err.message}`);
    console.error(`[server] Bitte von Hand oeffnen: ${url}`);
  }
}

/**
 * Server starten.
 *
 * opts:
 *   host       Standard 127.0.0.1
 *   port       Standard 7333; belegt -> naechster freier
 *   open       Browser oeffnen
 *   project    Projektdatei, die beim Start geoeffnet wird
 *   workspace  Arbeitsverzeichnis (sonst CLI/Umgebung/Home)
 */
export async function start(opts = {}) {
  const host = opts.host || process.env.TBG_HOST || HOST;
  const wantedPort = Number.parseInt(opts.port ?? process.env.TBG_PORT ?? PORT, 10) || PORT;

  initPaths({ workspace: opts.workspace });

  // Venues frueh laden, damit Panel-Warnungen vor dem ersten Request stehen.
  try {
    venues.list();
  } catch (err) {
    console.error(`[server] Venues konnten nicht geladen werden: ${err.message}`);
  }

  if (opts.project) {
    const file = path.resolve(String(opts.project));
    try {
      const p = projects.open(file);
      console.log(`[server] Projekt geoeffnet: ${file} (${p.name || 'ohne Namen'})`);
    } catch (err) {
      console.error(`[server] Projekt ${file} konnte nicht geoeffnet werden: ${err.message}`);
      console.error('[server] Theater-Bild-Gelöte startet trotzdem — Projekt in der Oberflaeche waehlen.');
    }
  }

  const server = await listenWithFallback(host, wantedPort);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : wantedPort;
  const url = `http://${host}:${port}`;

  const status = await ffmpeg.status();
  console.log('');
  console.log(`  Theater-Bild-Gelöte ${pkgVersion()}  ·  ${platformInfo().label} ${process.arch}`);
  console.log(`  Oberflaeche:          ${url}`);
  console.log(`  Arbeitsverzeichnis:   ${paths.workspace}   (${WORKSPACE_ENV} bzw. --workspace)`);
  console.log(`  Ausgabeordner:        ${paths.out}`);
  console.log(`  Programmverzeichnis:  ${paths.root}`);
  if (pathsMod.legacyBin) {
    console.log(`  HINWEIS: ffmpeg aus dem Programmordner wird weiter benutzt: ${pathsMod.legacyBin}`);
    console.log('           Neu installiertes ffmpeg landet im Arbeitsverzeichnis unter bin/.');
  }
  if (!status.ffmpeg.found) {
    console.log('');
    console.log(`  ACHTUNG: ${ffmpeg.installHint()}`);
    console.log('           Abhilfe: Theater-Bild-Gelöte install-ffmpeg');
  } else {
    const e = status.ffmpeg.encoders;
    console.log(`  ffmpeg: ${status.ffmpeg.version || '?'} (${status.ffmpeg.source})`);
    if (!e.hap) {
      console.log('  ACHTUNG: Dieser ffmpeg-Build kann kein HAP — HAP-Delivery unmoeglich.');
      console.log('           Abhilfe: Theater-Bild-Gelöte install-ffmpeg');
    }
    if (!e.prores_ks) {
      console.log('  ACHTUNG: Dieser ffmpeg-Build kann kein ProRes.');
    }
  }
  console.log('');

  // Erst ab jetzt sind Fehler Laufzeitfehler - der Startfall ist erledigt.
  server.on('error', (err) => {
    console.error(`[server] Fehler: ${err.message}`);
    process.exitCode = 1;
  });

  if (opts.open) openBrowser(url);

  return server;
}

// Beim Beenden den ausstehenden Autosave nachholen. Ohne das geht die letzte
// Aenderung verloren, wenn man den Server innerhalb der Entprellzeit stoppt.
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      const saved = projects.autosaveNow();
      if (saved) console.log(`\n  Projekt gesichert: ${saved.path || saved}`);
    } catch (err) {
      console.error(`[server] Sichern beim Beenden fehlgeschlagen: ${err.message}`);
    }
    process.exit(0);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unbehandelte Promise-Ablehnung:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] Unbehandelter Fehler:', err?.stack || err);
});

/* ==========================================================================
 * Direktaufruf: node server/index.js
 *
 * Beim Import aus bin/theater-bild-geloete.js darf NICHT von allein gestartet werden -
 * dort werden erst die Schalter ausgewertet und dann start(opts) gerufen.
 * ========================================================================== */

/** Die wenigen Schalter, die auch bei "node server/index.js" gelten sollen. */
function optionsFromArgv(argv = process.argv) {
  const opts = { open: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = String(argv[i]);
    const value = () => {
      const v = argv[i + 1];
      i += 1;
      return v == null ? null : String(v);
    };
    if (a === '--port') opts.port = value();
    else if (a.startsWith('--port=')) opts.port = a.slice(7);
    else if (a === '--host') opts.host = value();
    else if (a.startsWith('--host=')) opts.host = a.slice(7);
    else if (a === '--project') opts.project = value();
    else if (a.startsWith('--project=')) opts.project = a.slice(10);
    else if (a === '--workspace' || a === '-w') opts.workspace = value();
    else if (a.startsWith('--workspace=')) opts.workspace = a.slice(12);
    else if (a === '--open') opts.open = true;
    else if (a === '--no-open') opts.open = false;
  }
  return opts;
}

const invokedDirectly = (() => {
  try {
    return path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  start(optionsFromArgv()).catch((err) => {
    console.error('');
    console.error(`[server] Start fehlgeschlagen: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
}

export { app };
export default app;
