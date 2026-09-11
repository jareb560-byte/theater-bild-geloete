/**
 * Theater-Bild-Gelöte - Dateianalyse.
 *
 * probeFile() liefert ein Media-Objekt nach makeMedia() aus shared/model.js,
 * dessen Feld probe der Form aus probeShape() folgt. Ergebnisse landen im
 * Cache .cache/probe.json, Schluessel ist absPath + mtime + size.
 *
 * issues[] ist die Liste der Dinge, die spaeter im Render weh tun:
 * falsche fps, ungerade Kantenlaenge, nicht durch 4 teilbar (HAP!),
 * Aufloesung passt zu keiner Flaeche des Venues, Tonspur vorhanden.
 */

import fs from 'node:fs';
import path from 'node:path';

import { makeMedia } from '../shared/model.js';
import { runProbe } from './ffmpeg.js';
import { ensureDir, cacheDir, probeCacheFile } from './paths.js';
import * as venues from './venues.js';

/* ==========================================================================
 * Dateitypen
 * ========================================================================== */

export const VIDEO_EXT = ['.mov', '.mp4', '.mxf', '.avi', '.mkv', '.webm', '.m4v'];
export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.exr', '.bmp'];
export const MEDIA_EXT = [...VIDEO_EXT, ...IMAGE_EXT];

export function isVideoExt(p) {
  return VIDEO_EXT.includes(path.extname(p).toLowerCase());
}
export function isImageExt(p) {
  return IMAGE_EXT.includes(path.extname(p).toLowerCase());
}
export function isMediaFile(p) {
  return MEDIA_EXT.includes(path.extname(p).toLowerCase());
}

/* ==========================================================================
 * Cache
 * ========================================================================== */

let cache = null;
let writeTimer = null;

/**
 * Probe-Cache verwerfen.
 *
 * Noetig nach einem Wechsel des Arbeitsverzeichnisses: probeCacheFile zeigt
 * dann zwar schon auf die neue Datei, loadCache() steigt aber bei gefuelltem
 * cache sofort wieder aus und liefert weiter die Eintraege des alten
 * Verzeichnisses — inklusive Proxy-Pfade, die es dort nicht mehr gibt.
 * Ein ausstehender Schreibvorgang wird abgebrochen, damit der alte Stand
 * nicht noch in die neue Datei faellt.
 */
export function resetCache() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  cache = null;
}

function loadCache() {
  if (cache) return cache;
  cache = {};
  try {
    if (fs.existsSync(probeCacheFile)) {
      const parsed = JSON.parse(fs.readFileSync(probeCacheFile, 'utf8'));
      if (parsed && typeof parsed === 'object') cache = parsed;
    }
  } catch (err) {
    console.error(`[probe] Cache ${probeCacheFile} unlesbar, wird neu aufgebaut: ${err.message}`);
    cache = {};
  }
  return cache;
}

/** Schreiben wird gebuendelt - beim Bibliotheksscan kommen hunderte Eintraege. */
function scheduleCacheWrite() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      ensureDir(cacheDir);
      fs.writeFileSync(probeCacheFile, JSON.stringify(cache ?? {}, null, 1), 'utf8');
    } catch (err) {
      console.error(`[probe] Cache konnte nicht geschrieben werden: ${err.message}`);
    }
  }, 300);
  writeTimer.unref?.();
}

/** Cache sofort auf Platte schreiben (CLI-Ende, Serverstop). */
export function flushCache() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    ensureDir(cacheDir);
    fs.writeFileSync(probeCacheFile, JSON.stringify(cache ?? {}, null, 1), 'utf8');
  } catch (err) {
    console.error(`[probe] Cache konnte nicht geschrieben werden: ${err.message}`);
  }
}

/** Kompletten Cache verwerfen. */
export function clearCache() {
  cache = {};
  scheduleCacheWrite();
}

/* ==========================================================================
 * Hilfsrechnungen
 * ========================================================================== */

/** "30000/1001" -> 29.97, "30/1" -> 30, "0/0" -> 0 */
export function parseFraction(text) {
  if (!text) return 0;
  const s = String(text).trim();
  if (s.includes('/')) {
    const [a, b] = s.split('/');
    const num = Number(a);
    const den = Number(b);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
    return Math.round((num / den) * 1000) / 1000;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const ALPHA_PIXFMT = /^(yuva|rgba|bgra|argb|abgr|gbrap|ya8|ya16|pal8)/i;
/** HAP-Varianten mit Alphakanal, aus dem codec_tag_string. */
const HAP_ALPHA_TAGS = new Set(['Hap5', 'HapA', 'HapM']);

function detectAlpha(stream) {
  if (!stream) return false;
  const codec = String(stream.codec_name || '').toLowerCase();
  const tag = String(stream.codec_tag_string || '').trim();
  if (codec === 'hap') {
    // Der HAP-Dekoder meldet immer rgba - entscheidend ist der Fourcc.
    return HAP_ALPHA_TAGS.has(tag) || /alpha/i.test(String(stream.profile || ''));
  }

  // WebM/VP8/VP9: der Alphakanal liegt NICHT im pix_fmt. ffprobe meldet dort
  // yuv420p, die Transparenz steckt in einem zweiten Bitstrom und wird nur
  // ueber das Container-Tag alpha_mode=1 angekuendigt. Ohne diese Abfrage
  // haelt das Werkzeug eine Datei mit Alpha fuer deckend und verliert die
  // Transparenz bei einer HAP-Alpha- oder ProRes-4444-Lieferung stillschweigend.
  const alphaMode = stream.tags?.alpha_mode ?? stream.tags?.ALPHA_MODE;
  if (String(alphaMode ?? '') === '1') return true;

  const pix = String(stream.pix_fmt || '').toLowerCase();
  if (!pix) return false;
  if (pix === 'pal8') return false; // Palette, praktisch nie unser Fall
  return ALPHA_PIXFMT.test(pix) && pix !== 'pal8';
}

/* ==========================================================================
 * Bildsequenzen
 * ========================================================================== */

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Erkennt PNG-/Bildsequenzen.
 *
 * Zwei Wege:
 *   1. Der uebergebene Pfad enthaelt bereits ein printf-Muster (_%05d.png).
 *   2. Der Dateiname endet auf eine laufende Nummer und im selben Ordner
 *      liegen weitere Dateien mit gleichem Praefix und gleicher Stellenzahl.
 *
 * Liefert { pattern, start, count, first, ext } oder null.
 */
export function detectSequence(absPath) {
  const ext = path.extname(absPath);
  if (!IMAGE_EXT.includes(ext.toLowerCase())) return null;

  const dir = path.dirname(absPath);
  const base = path.basename(absPath, ext);

  let prefix = null;
  let width = 0;

  const printf = base.match(/^(.*?)%0?(\d*)d$/);
  if (printf) {
    prefix = printf[1];
    width = Number.parseInt(printf[2] || '0', 10) || 0;
  } else {
    const m = base.match(/^(.*?)(\d{2,})$/);
    if (!m) return null;
    prefix = m[1];
    width = m[2].length;
  }

  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null;
  }

  const re = new RegExp(`^${escapeRe(prefix)}(\\d${width > 0 ? `{${width}}` : '+'})$`);
  const numbers = [];
  for (const f of files) {
    const fext = path.extname(f);
    if (fext.toLowerCase() !== ext.toLowerCase()) continue;
    const mm = path.basename(f, fext).match(re);
    if (!mm) continue;
    numbers.push({ n: Number.parseInt(mm[1], 10), file: path.join(dir, f) });
  }
  if (numbers.length < 2) return null;
  numbers.sort((a, b) => a.n - b.n);

  const digits = width > 0 ? width : String(numbers[0].n).length;
  return {
    pattern: path.join(dir, `${prefix}%0${digits}d${ext}`),
    start: numbers[0].n,
    count: numbers.length,
    first: numbers[0].file,
    ext,
  };
}

/* ==========================================================================
 * Bemaengelungen
 * ========================================================================== */

function collectIssues(probe, kind, venue) {
  const issues = [];
  const add = (level, code, msg, hint) => issues.push({ level, code, msg, hint });

  if (!probe) return issues;

  if (venue && kind !== 'image' && probe.fps > 0 && Math.abs(probe.fps - venue.fps) > 0.01) {
    add(
      'warn',
      'fps',
      `${probe.fps} fps statt ${venue.fps} fps`,
      'Im Reiter Conform auf die Zielrate angleichen, sonst rechnet ffmpeg beim Render stumm um.'
    );
  }

  if (kind !== 'image' && probe.variableFps) {
    add(
      'warn',
      'vfr',
      'Variable Bildrate',
      'Die Datei hat keinen festen Bildabstand. Ein Haus mit fester Rate vertraegt das nicht — ' +
        'vor dem Render im Reiter Conform auf die Zielrate angleichen, sonst entscheidet ffmpeg ' +
        'allein, welche Frames gedoppelt oder verworfen werden.'
    );
  }

  if (kind !== 'image' && probe.fpsSource === 'gezaehlt') {
    add(
      'info',
      'fps-geschaetzt',
      `Bildrate ${probe.fps} fps aus ${probe.frames} gezaehlten Bildern ermittelt`,
      'Der Container nennt keine verlaessliche Bildrate (typisch fuer WebM). Der Wert stimmt, ' +
        'ist aber ein Durchschnitt — bei variabler Rate unbedingt angleichen.'
    );
  }

  if (probe.width > 0 && probe.height > 0) {
    if (probe.width % 2 !== 0 || probe.height % 2 !== 0) {
      add(
        'error',
        'odd',
        `Ungerade Kantenlänge ${probe.width}x${probe.height}`,
        'Die meisten Codecs verlangen gerade Kanten. Im Conform auf gerade Maße bringen.'
      );
    } else if (probe.width % 4 !== 0 || probe.height % 4 !== 0) {
      add(
        'warn',
        'mod4',
        `${probe.width}x${probe.height} ist nicht durch 4 teilbar`,
        'HAP arbeitet in 4x4-Blöcken. ffmpeg paddet sonst stillschweigend.'
      );
    }

    if (venue) {
      const fits = [];
      for (const wall of venue.walls || []) {
        if (probe.width === wall.width && probe.height === wall.height) fits.push(wall.id);
        for (const p of wall.panels || []) {
          if (probe.width === p.width && probe.height === wall.height) fits.push(p.id);
        }
      }
      if (venue.holo && probe.width === venue.holo.width && probe.height === venue.holo.height) {
        fits.push(venue.holo.id || 'H');
      }
      if (fits.length === 0) {
        add(
          'info',
          'resolution',
          `${probe.width}x${probe.height} passt zu keiner Wand und keinem Panel von ${venue.name || venue.id}`,
          'Kein Fehler — das Material wird im Editor skaliert oder beschnitten.'
        );
      } else {
        probe.matches = fits;
      }
    }
  }

  if (probe.audioStreams > 0) {
    add(
      'info',
      'audio',
      `${probe.audioStreams} Tonspur(en) vorhanden`,
      'Beim Render wird der Ton mit -an verworfen. Das Haus liefert Audio getrennt.'
    );
  }

  if (kind === 'sequence') {
    add(
      'info',
      'sequence',
      'Bildsequenz — die Framerate steht nicht in den Dateien und wird vom Projekt übernommen',
      'Falls die Sequenz mit einer anderen Rate gerendert wurde, im Conform korrigieren.'
    );
  }

  return issues;
}

/* ==========================================================================
 * Analyse
 * ========================================================================== */

const PROBE_ARGS = ['-v', 'error', '-show_streams', '-show_format', '-print_format', 'json'];

async function probeRaw(file, signal) {
  return runProbe([...PROBE_ARGS, file], { signal });
}

/**
 * Oberhalb dieser Bildrate glaubt das Werkzeug dem Container nicht mehr.
 *
 * WebM traegt als Zeitbasis 1/1000 und meldet dann r_frame_rate=1000/1 —
 * das ist die Aufloesung der Zeitstempel, nicht die Bildrate. Auch MPEG-TS
 * und einige MOVs liefern solche Fantasiewerte. Alles ab 480 fps ist im
 * Buehnenkontext praktisch immer ein Containerartefakt.
 */
const FPS_PLAUSIBEL_MAX = 480;

/**
 * Zaehlt die Videopakete, ohne zu dekodieren. Das ist schnell (unter 0,2 s
 * fuer eine 9-MB-Datei) und liefert bei Containern ohne nb_frames die einzige
 * belastbare Framezahl.
 */
async function countPackets(file, signal) {
  try {
    const raw = await runProbe(
      ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
       '-show_entries', 'stream=nb_read_packets', '-print_format', 'json', file],
      { signal }
    );
    const n = Number.parseInt(raw?.streams?.[0]?.nb_read_packets ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function buildProbe(raw, stat, file, signal) {
  const streams = Array.isArray(raw?.streams) ? raw.streams : [];
  const v = streams.find((s) => s.codec_type === 'video') || null;
  const audioStreams = streams.filter((s) => s.codec_type === 'audio').length;
  const format = raw?.format || {};

  let durationSec = Number(v?.duration ?? format.duration ?? 0);
  if (!Number.isFinite(durationSec) || durationSec < 0) durationSec = 0;

  // --- Bildrate bestimmen -------------------------------------------------
  //
  // Reihenfolge, absichtlich NICHT r_frame_rate zuerst:
  //   1. avg_frame_rate  - der tatsaechliche Durchschnitt, meist korrekt
  //   2. r_frame_rate    - nur wenn plausibel; bei WebM ist das die Zeitbasis
  //   3. Pakete zaehlen  - der Rueckfall, der immer stimmt
  const rRate = parseFraction(v?.r_frame_rate);
  const aRate = parseFraction(v?.avg_frame_rate);

  let fps = 0;
  let fpsExact = String(v?.avg_frame_rate || v?.r_frame_rate || '0/0');
  let fpsSource = 'avg_frame_rate';

  if (aRate > 0 && aRate <= FPS_PLAUSIBEL_MAX) {
    fps = aRate;
    fpsExact = String(v?.avg_frame_rate);
  } else if (rRate > 0 && rRate <= FPS_PLAUSIBEL_MAX) {
    fps = rRate;
    fpsExact = String(v?.r_frame_rate);
    fpsSource = 'r_frame_rate';
  }

  let frames = Number.parseInt(v?.nb_frames ?? '', 10);
  if (!Number.isFinite(frames) || frames <= 0) frames = 0;

  // Weder eine glaubwuerdige Rate noch eine Framezahl -> nachzaehlen.
  const brauchtZaehlung = v && (fps <= 0 || frames <= 0);
  if (brauchtZaehlung) {
    const pakete = await countPackets(file, signal);
    if (pakete > 0) {
      if (frames <= 0) frames = pakete;
      if (fps <= 0 && durationSec > 0) {
        fps = pakete / durationSec;
        fpsExact = `${pakete}/${durationSec.toFixed(6)}`;
        fpsSource = 'gezaehlt';
      }
    }
  }

  if (frames <= 0 && fps > 0 && durationSec > 0) frames = Math.round(durationSec * fps);

  // Variable Bildrate: r_frame_rate und der wahre Durchschnitt klaffen weit
  // auseinander. Das muss der Nutzer wissen, denn ein Haus mit fester Rate
  // vertraegt keine VFR-Datei - ffmpeg rechnet sie beim Render stumm um.
  const variableFps = Boolean(
    v && fps > 0 && rRate > 0 && (rRate > FPS_PLAUSIBEL_MAX || Math.abs(rRate - fps) / fps > 0.02)
  );

  return {
    width: Number(v?.width || 0),
    height: Number(v?.height || 0),
    fps: Math.round(fps * 1000) / 1000,
    fpsExact: String(fpsExact),
    /** Woher die Bildrate stammt: avg_frame_rate | r_frame_rate | gezaehlt */
    fpsSource,
    /** true = variable Bildrate, muss vor dem Render angeglichen werden */
    variableFps,
    durationSec: Math.round(durationSec * 1000) / 1000,
    frames,
    codec: String(v?.codec_name || ''),
    codecTag: String(v?.codec_tag_string || '').trim(),
    profile: v?.profile == null ? '' : String(v.profile),
    pixFmt: String(v?.pix_fmt || ''),
    hasAlpha: detectAlpha(v),
    colorRange: String(v?.color_range || ''),
    colorSpace: String(v?.color_space || ''),
    bitrate: Number.parseInt(v?.bit_rate ?? format.bit_rate ?? 0, 10) || 0,
    sizeBytes: stat ? stat.size : Number.parseInt(format.size ?? 0, 10) || 0,
    container: String(format.format_name || path.extname(file).replace('.', '')),
    audioStreams,
  };
}

function cacheKey(absPath, stat, extra = '') {
  return `${absPath}|${Math.round(stat.mtimeMs)}|${stat.size}${extra ? `|${extra}` : ''}`;
}

/**
 * Analysiert eine Datei und liefert ein Media-Objekt.
 *
 * opts:
 *   venue   Venue-Objekt fuer die issues-Pruefung (Standard: Basisvenue)
 *   force   Cache uebergehen
 *   signal  AbortSignal
 *   allowSequence  auf false setzen, um Sequenzerkennung zu unterdruecken
 */
export async function probeFile(absPath, opts = {}) {
  const file = path.resolve(absPath);
  const { force = false, signal, allowSequence = true } = opts;
  const venue = opts.venue !== undefined ? opts.venue : venues.base();

  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    throw new Error(`Datei nicht lesbar: ${file} (${err.message})`);
  }
  if (!stat.isFile()) throw new Error(`Kein regulärer Dateipfad: ${file}`);

  const seq = allowSequence ? detectSequence(file) : null;
  const store = loadCache();
  const key = cacheKey(file, stat, seq ? `seq${seq.count}@${seq.start}` : '');

  let payload = !force && store[key] ? store[key] : null;

  if (!payload) {
    const target = seq ? seq.first : file;
    let raw;
    try {
      raw = await probeRaw(target, signal);
    } catch (err) {
      throw new Error(`ffprobe konnte ${path.basename(target)} nicht analysieren: ${err.message}`);
    }

    let statForSize = stat;
    if (seq) {
      try {
        statForSize = fs.statSync(seq.first);
      } catch {
        statForSize = stat;
      }
    }

    const probe = await buildProbe(raw, statForSize, target, signal);
    let kind = 'video';

    if (seq) {
      kind = 'sequence';
      const fps = venue?.fps || 30;
      probe.fps = fps;
      probe.fpsExact = `${fps}/1`;
      probe.frames = seq.count;
      probe.durationSec = Math.round((seq.count / fps) * 1000) / 1000;
      probe.seqPattern = seq.pattern;
      probe.seqStart = seq.start;
      probe.seqCount = seq.count;
      probe.sizeBytes = statForSize.size * seq.count; // Naeherung, reicht fuer die Anzeige
      probe.audioStreams = 0;
    } else if (isImageExt(file)) {
      kind = 'image';
      probe.durationSec = 0;
      probe.frames = 1;
      probe.fps = 0;
      probe.fpsExact = '0/0';
      probe.audioStreams = 0;
    } else if (probe.width === 0 && probe.height === 0) {
      throw new Error(
        `${path.basename(file)} enthält keine Videospur — als Medium nicht verwendbar.`
      );
    }

    const issues = collectIssues(probe, kind, venue);
    payload = {
      kind,
      probe,
      issues,
      name: seq ? path.basename(seq.pattern) : path.basename(file),
      // Zweitschreibweise fuer server/ops/*: dort wird media.sequence gelesen.
      sequence: seq
        ? { pattern: seq.pattern, startNumber: seq.start, count: seq.count, fps: probe.fps }
        : null,
    };

    store[key] = payload;
    scheduleCacheWrite();
  }

  return makeMedia(file, {
    kind: payload.kind,
    name: payload.name,
    probe: payload.probe,
    issues: payload.issues,
    sequence: payload.sequence ?? null,
  });
}

/**
 * Frischt issues eines bereits geprobten Mediums gegen ein anderes Venue auf.
 * Billig, weil ffprobe nicht noch einmal laufen muss.
 */
export function refreshIssues(media, venue) {
  if (!media?.probe) return media;
  media.issues = collectIssues(media.probe, media.kind, venue);
  return media;
}

export default { probeFile, detectSequence, parseFraction, isMediaFile, flushCache, clearCache };
