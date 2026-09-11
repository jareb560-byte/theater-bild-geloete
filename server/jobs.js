/**
 * Theater-Bild-Gelöte - Jobverwaltung.
 *
 * Alles, was laenger als einen Wimpernschlag dauert, laeuft als Job:
 * Scan, Proxy, Conform, Render, QC, ffmpeg-Installation.
 *
 * Hoechstens zwei Jobs laufen gleichzeitig, der Rest wartet in der Schlange.
 * Der Bus meldet 'job' (Statuswechsel/Fortschritt) und 'log' (eine Zeile).
 * Job-Objekte sind reines JSON - sie gehen 1:1 ueber die SSE-Verbindung.
 */

import { EventEmitter } from 'node:events';

import { makeId } from '../shared/model.js';

/** Ereignisbus: 'job' -> Job, 'log' -> { id, line }. */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

const MAX_PARALLEL = 2;
const MAX_LOG_LINES = 2000;
const LOG_DROP_CHUNK = 500;
const KEEP_JOBS = 500;
const LIST_LIMIT = 200;
const PROGRESS_THROTTLE_MS = 120;

/** Alle Jobs in Entstehungsreihenfolge. */
const order = [];
const byId = new Map();
/** Nicht serialisierbares Beiwerk pro Job. */
const meta = new Map();

const queue = [];
let running = 0;

/* ==========================================================================
 * Interna
 * ========================================================================== */

function emitJob(job) {
  bus.emit('job', job);
}

function prune() {
  while (order.length > KEEP_JOBS) {
    const old = order.shift();
    byId.delete(old.id);
    meta.delete(old.id);
  }
}

function appendLog(job, line) {
  const text = String(line).replace(/\r?\n$/, '');
  job.log.push(text);
  if (job.log.length > MAX_LOG_LINES) {
    const dropped = job.log.splice(0, LOG_DROP_CHUNK);
    job.log.unshift(`… ${dropped.length} ältere Zeilen verworfen …`);
  }
  bus.emit('log', { id: job.id, line: text });
}

/* ==========================================================================
 * Oeffentliche API
 * ========================================================================== */

/**
 * Legt einen Job an. Er steht danach auf 'queued' und ist ueber list()
 * sichtbar, laeuft aber erst mit start().
 */
export function createJob({ type = 'job', label = '', command = null, result = null } = {}) {
  const job = {
    id: makeId('job'),
    type,
    label: label || type,
    status: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    command,
    log: [],
    result,
    error: null,
  };
  order.push(job);
  byId.set(job.id, job);
  meta.set(job.id, { controller: null, lastEmit: 0 });
  prune();
  emitJob(job);
  return job;
}

/**
 * Startet (oder reiht ein) die Arbeitsfunktion eines Jobs.
 *
 * fn bekommt ctx = { setProgress, log, signal, setResult, setCommand, job }.
 * Der Rueckgabewert von fn wird - falls setResult nicht benutzt wurde -
 * als job.result uebernommen.
 *
 * Liefert ein Promise, das mit dem Job aufgeloest wird. Es lehnt NIE ab;
 * Fehler landen in job.error und job.status === 'error'.
 */
export function start(job, fn) {
  if (!job || !byId.has(job.id)) throw new Error('start() mit unbekanntem Job aufgerufen');
  if (typeof fn !== 'function') throw new Error('start() braucht eine Arbeitsfunktion');

  return new Promise((resolve) => {
    queue.push({ job, fn, resolve });
    pump();
  });
}

/** Bequemer Einzeiler: Job anlegen und sofort starten. */
export function run({ type, label }, fn) {
  const job = createJob({ type, label });
  start(job, fn);
  return job;
}

function pump() {
  while (running < MAX_PARALLEL && queue.length > 0) {
    const entry = queue.shift();
    if (entry.job.status === 'cancelled') {
      entry.resolve(entry.job);
      continue;
    }
    running += 1;
    execute(entry).finally(() => {
      running -= 1;
      pump();
    });
  }
}

async function execute({ job, fn, resolve }) {
  const m = meta.get(job.id) || {};
  const controller = new AbortController();
  m.controller = controller;
  m.lastEmit = 0;
  meta.set(job.id, m);

  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.progress = 0;
  emitJob(job);

  let resultSet = false;

  const ctx = {
    job,
    signal: controller.signal,
    /** Alias fuer setProgress - die ops-Module rufen ctx.progress(). */
    progress(p) {
      ctx.setProgress(p);
    },
    setProgress(p) {
      const v = Math.max(0, Math.min(1, Number(p) || 0));
      job.progress = v;
      const now = Date.now();
      const info = meta.get(job.id);
      if (!info || now - info.lastEmit >= PROGRESS_THROTTLE_MS || v >= 1) {
        if (info) info.lastEmit = now;
        emitJob(job);
      }
    },
    log(line) {
      if (line == null) return;
      for (const part of String(line).split(/\r?\n/)) {
        if (part.trim() === '') continue;
        appendLog(job, part);
      }
    },
    setResult(value) {
      resultSet = true;
      job.result = value ?? null;
    },
    setCommand(cmd) {
      job.command = cmd == null ? null : String(cmd);
      emitJob(job);
    },
  };

  try {
    const value = await fn(ctx);
    if (controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = job.error || 'Abgebrochen.';
      appendLog(job, 'Abgebrochen.');
    } else {
      if (!resultSet && value !== undefined) job.result = value ?? null;
      job.status = 'done';
      job.progress = 1;
    }
  } catch (err) {
    if (controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = 'Abgebrochen.';
      appendLog(job, 'Abgebrochen.');
    } else {
      job.status = 'error';
      job.error = err?.message ? String(err.message) : String(err);
      // Fehler sind nie still: Konsole und Joblog bekommen ihn.
      console.error(`[jobs] ${job.type} ${job.id} fehlgeschlagen: ${job.error}`);
      if (err?.stack) console.error(err.stack);
      appendLog(job, `FEHLER: ${job.error}`);
    }
  } finally {
    job.endedAt = new Date().toISOString();
    const info = meta.get(job.id);
    if (info) info.controller = null;
    emitJob(job);
    resolve(job);
  }
}

/** Bricht einen Job ab. Liefert true, wenn es etwas abzubrechen gab. */
export function cancel(id) {
  const job = byId.get(id);
  if (!job) return false;

  if (job.status === 'queued') {
    const idx = queue.findIndex((e) => e.job.id === id);
    job.status = 'cancelled';
    job.error = 'Abgebrochen, bevor der Job gestartet ist.';
    job.endedAt = new Date().toISOString();
    if (idx >= 0) {
      const [entry] = queue.splice(idx, 1);
      entry.resolve(job);
    }
    appendLog(job, 'Abgebrochen (stand noch in der Warteschlange).');
    emitJob(job);
    return true;
  }

  if (job.status === 'running') {
    const info = meta.get(id);
    if (info?.controller) {
      info.controller.abort();
      appendLog(job, 'Abbruch angefordert …');
      return true;
    }
    return false;
  }

  return false;
}

/** Neueste zuerst, hoechstens 200. */
export function list() {
  return order.slice(-LIST_LIMIT).reverse();
}

/** Einzelner Job oder null. */
export function get(id) {
  return byId.get(id) || null;
}

/** Wie viele Jobs gerade laufen bzw. warten - fuer die Statuszeile. */
export function stats() {
  return { running, queued: queue.length, total: order.length, maxParallel: MAX_PARALLEL };
}

export default { bus, createJob, start, run, cancel, list, get, stats };
