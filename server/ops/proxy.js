/**
 * Theater-Bild-Gelöte — Proxies und Posterframes.
 *
 * HAP, ProRes und MPEG-2 kann kein Browser abspielen. Damit die 3D-Buehne und
 * der Panel-Editor ueberhaupt etwas anzeigen koennen, bekommt jede Quelle einen
 * H.264-Proxy in proxies/<mediaId>.mp4 und ein Posterframe in thumbs/<mediaId>.jpg.
 *
 * Nachbarmodule, die hier NICHT implementiert werden:
 *   ../paths.js   -> paths { root, bin, cache, proxies, thumbs, out }
 *   ../ffmpeg.js  -> runFfmpeg(ctx, args, opts) -> { code, command, log }
 *                    baut die Kommandozeile mit dem gefundenen Binary und legt
 *                    sie im Job-Feld "command" ab
 *   ../probe.js   -> probeFile(absPath) -> probeShape() aus shared/model.js
 *
 * ctx ist der Job-Kontext: { log(line), progress(0..1), signal?, venue?, project? }
 * Alle ctx-Aufrufe sind optional abgesichert, damit die Ops auch aus der CLI
 * heraus ohne Jobsystem laufen.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { paths } from '../paths.js';
import { runFfmpeg } from '../ffmpeg.js';
import { probeFile } from '../probe.js';

/**
 * probeFile() liefert ein MEDIA-Objekt (makeMedia), die Messwerte liegen eine
 * Ebene tiefer unter .probe. Hier gebraucht werden nur die Messwerte - ohne
 * das Auspacken waeren width/height undefined und faenden nach JSON.stringify
 * gar nicht mehr statt, obwohl shared/model.js proxy:{path,width,height,ready}
 * festschreibt.
 */
async function probeOf(file) {
  const r = await probeFile(file);
  return r?.probe ?? r;
}

/* ==========================================================================
 * Konventionen
 * ========================================================================== */

/** Steht vor jedem Aufruf. -nostdin verhindert, dass ffmpeg auf Eingaben wartet. */
export const GLOBAL_ARGS = ['-y', '-hide_banner', '-nostdin'];

/** Fortschritt wird aus diesen Zeilen gelesen (out_time_us=, frame=). */
export const PROGRESS_ARGS = ['-progress', 'pipe:1', '-nostats'];

/** Rueckfall, wenn das Venue keine proxy-Argumente mitbringt. */
const DEFAULT_PROXY_ARGS = [
  '-c:v', 'libx264',
  '-crf', '26',
  '-preset', 'veryfast',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-an',
];

const DEFAULT_PROXY_MAX_WIDTH = 1280;
const THUMB_WIDTH = 320;
/** Standbilder werden zu 2 Sekunden Video, damit die 3D-Ansicht eine Textur bekommt. */
const STILL_SECONDS = 2;

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

/** Logzeile in den Job schreiben. Faellt auf die Konsole zurueck — nichts geht still verloren. */
function say(ctx, line) {
  if (ctx && typeof ctx.log === 'function') ctx.log(line);
  else console.log(`[proxy] ${line}`);
}

function tellProgress(ctx, value) {
  if (ctx && typeof ctx.progress === 'function') ctx.progress(Math.max(0, Math.min(1, value)));
}

/** Abbruchwunsch des Nutzers respektieren, bevor der naechste Aufruf startet. */
function throwIfCancelled(ctx) {
  if (ctx?.signal?.aborted || ctx?.cancelled === true) {
    throw new Error('Vom Nutzer abgebrochen.');
  }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Gerade Kantenlaenge nach unten — H.264 braucht das. */
function evenDown(n) {
  return Math.max(2, Math.floor(n / 2) * 2);
}

export function proxyPathFor(mediaId) {
  return path.join(paths.proxies, `${mediaId}.mp4`);
}

export function thumbPathFor(mediaId) {
  return path.join(paths.thumbs, `${mediaId}.jpg`);
}

/**
 * Nummernmuster einer Bildsequenz.
 * Bevorzugt media.sequence, sonst wird es aus dem Dateinamen abgeleitet:
 * "D_00000.png" -> Muster "D_%05d.png", Startnummer 0.
 */
export function sequenceSpec(media) {
  const seq = media?.sequence;
  if (seq?.pattern) {
    return {
      pattern: seq.pattern,
      startNumber: Number.isFinite(seq.startNumber) ? seq.startNumber : 0,
      fps: Number(seq.fps) || null,
      derived: false,
    };
  }
  const abs = media?.absPath;
  if (!abs) throw new Error(`Bildsequenz "${media?.name || '?'}" hat keinen Pfad.`);

  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const m = /^(.*?)(\d+)(\.[^.]+)$/.exec(base);
  if (!m) {
    throw new Error(
      `Aus dem Dateinamen "${base}" lässt sich kein Nummernmuster für eine Bildsequenz ableiten. ` +
        `Erwartet wird ein durchnummerierter Name wie "D_00000.png".`
    );
  }
  return {
    pattern: path.join(dir, `${m[1]}%0${m[2].length}d${m[3]}`),
    startNumber: Number(m[2]),
    fps: null,
    derived: true,
  };
}

/**
 * Eingangs-Argumente fuer ein Media-Objekt, inklusive allem, was VOR "-i" gehoert.
 * Wird auch von conform.js benutzt — Video, Bildsequenz und Standbild muessen
 * ueberall gleich gefuettert werden.
 *
 * opts:
 *   fps        Rate fuer Sequenzen und Standbilder
 *   stillSec   Bei kind 'image': Laenge des erzeugten Standbildvideos.
 *              null = Einzelbild (fuer Posterframes).
 *   loopInput  '-stream_loop -1' voranstellen (durationMode 'loop')
 */
export function mediaInputArgs(media, { fps = 30, stillSec = null, loopInput = false } = {}) {
  const kind = media?.kind || 'video';

  if (kind === 'sequence') {
    const seq = sequenceSpec(media);
    const rate = seq.fps || fps;
    const args = [];
    if (loopInput) args.push('-stream_loop', '-1');
    args.push('-framerate', String(rate), '-start_number', String(seq.startNumber), '-i', seq.pattern);
    return {
      args,
      note: `Bildsequenz ${path.basename(seq.pattern)} ab Nummer ${seq.startNumber}, ${rate} fps${seq.derived ? ' (Muster aus dem Dateinamen abgeleitet)' : ''}`,
    };
  }

  if (kind === 'image') {
    if (stillSec == null) {
      return { args: ['-i', media.absPath], note: 'Einzelbild' };
    }
    return {
      args: ['-loop', '1', '-framerate', String(fps), '-t', String(stillSec), '-i', media.absPath],
      note: `Standbild, ${stillSec} s bei ${fps} fps`,
    };
  }

  const args = [];
  if (loopInput) args.push('-stream_loop', '-1');
  args.push('-i', media.absPath);
  return { args, note: '' };
}

/** Zeitstempel der Quelle. Bei Sequenzen zaehlt das erste Bild. */
function sourceMtimeMs(media) {
  const abs = media?.absPath;
  if (!abs || !existsSync(abs)) {
    throw new Error(`Die Quelldatei "${abs || '(ohne Pfad)'}" gibt es nicht (mehr).`);
  }
  return statSync(abs).mtimeMs;
}

/** fps fuer Sequenzen und Standbilder: Venue vor Projekt vor 30. */
function contextFps(ctx, media) {
  return (
    Number(media?.probe?.fps) ||
    Number(ctx?.venue?.fps) ||
    Number(ctx?.project?.fps) ||
    30
  );
}

/* ==========================================================================
 * Proxy
 * ========================================================================== */

/**
 * H.264-MP4 nach proxies/<mediaId>.mp4.
 * yuv420p, +faststart, ohne Ton, gerade Kantenlaengen, maximal maxWidth breit.
 * Wird uebersprungen, wenn der vorhandene Proxy neuer ist als die Quelle.
 */
export async function makeProxy(ctx, media, opts = {}) {
  if (!media?.id) throw new Error('makeProxy: Media-Objekt ohne id.');

  const cfg = ctx?.venue?.delivery?.proxy || null;
  const maxWidth = Number(opts.maxWidth) || Number(cfg?.maxWidth) || DEFAULT_PROXY_MAX_WIDTH;
  const force = opts.force === true;
  const encodeArgs = Array.isArray(opts.args)
    ? opts.args
    : Array.isArray(cfg?.args)
      ? cfg.args
      : DEFAULT_PROXY_ARGS;

  ensureDir(paths.proxies);
  const outPath = proxyPathFor(media.id);
  const srcMtime = sourceMtimeMs(media);

  if (!force && existsSync(outPath)) {
    const st = statSync(outPath);
    if (st.size > 0 && st.mtimeMs >= srcMtime) {
      say(ctx, `Proxy für "${media.name}" ist aktuell — übersprungen.`);
      let width = media.proxy?.width ?? null;
      let height = media.proxy?.height ?? null;
      if (width == null || height == null) {
        try {
          const p = await probeOf(outPath);
          width = p.width;
          height = p.height;
        } catch (err) {
          say(ctx, `Vorhandener Proxy für "${media.name}" ließ sich nicht analysieren: ${err.message}`);
        }
      }
      media.proxy = { path: outPath, width, height, ready: true };
      return { mediaId: media.id, path: outPath, width, height, skipped: true, command: null };
    }
  }

  const probe = media.probe || (await probeOf(media.absPath));
  if (!media.probe) media.probe = probe;

  const kind = media.kind || 'video';
  const fps = contextFps(ctx, media);
  const srcWidth = Number(probe?.width) || 0;
  const targetWidth = evenDown(Math.min(maxWidth, srcWidth || maxWidth));

  const input = mediaInputArgs(media, {
    fps,
    stillSec: kind === 'image' ? STILL_SECONDS : null,
  });
  if (input.note) say(ctx, `Eingang: ${input.note}`);

  // scale=<w>:-2 haelt das Seitenverhaeltnis und erzwingt gerade Kanten.
  const vf = `scale=${targetWidth}:-2:flags=bicubic`;
  // Video behaelt seine eigene Rate, Bild und Sequenz bekommen die Hausrate.
  const outRate = kind === 'video' ? (Number(probe?.fps) || fps) : fps;

  const args = [
    ...GLOBAL_ARGS,
    ...PROGRESS_ARGS,
    ...input.args,
    '-vf', vf,
    ...encodeArgs,
    '-r', String(outRate),
    '-fps_mode', 'cfr',
    outPath,
  ];
  if (!encodeArgs.includes('-an')) args.splice(args.length - 1, 0, '-an');

  throwIfCancelled(ctx);
  say(ctx, `Proxy für "${media.name}" → ${targetWidth} px breit, ${outRate} fps`);
  const res = await runFfmpeg(ctx, args, {
    label: `Proxy ${media.name}`,
    totalFrames: Number(probe?.frames) || null,
  });

  if (!existsSync(outPath)) {
    throw new Error(`Der Proxy für "${media.name}" wurde nicht geschrieben. ffmpeg-Aufruf: ${res?.command || '(unbekannt)'}`);
  }

  let width = targetWidth;
  let height = null;
  try {
    const p = await probeOf(outPath);
    width = p.width;
    height = p.height;
  } catch (err) {
    say(ctx, `Proxy wurde geschrieben, ließ sich aber nicht analysieren: ${err.message}`);
  }

  media.proxy = { path: outPath, width, height, ready: true };
  return { mediaId: media.id, path: outPath, width, height, skipped: false, command: res?.command || null };
}

/* ==========================================================================
 * Posterframe
 * ========================================================================== */

/** JPEG nach thumbs/<mediaId>.jpg, 320 px breit. */
export async function makeThumb(ctx, media, opts = {}) {
  if (!media?.id) throw new Error('makeThumb: Media-Objekt ohne id.');
  const atSec = Number(opts.atSec) || 0;

  ensureDir(paths.thumbs);
  const outPath = thumbPathFor(media.id);
  const kind = media.kind || 'video';
  const fps = contextFps(ctx, media);

  const input = mediaInputArgs(media, { fps, stillSec: null });

  const args = [...GLOBAL_ARGS];
  // -ss vor -i heisst schnelles Suchen. Bei Einzelbildern sinnlos.
  if (atSec > 0 && kind !== 'image') args.push('-ss', String(atSec));
  args.push(
    ...input.args,
    '-frames:v', '1',
    '-vf', `scale=${THUMB_WIDTH}:-2:flags=bicubic`,
    '-q:v', '3',
    '-an',
    outPath
  );

  throwIfCancelled(ctx);
  const res = await runFfmpeg(ctx, args, { label: `Posterframe ${media.name}`, totalFrames: 1 });

  if (!existsSync(outPath)) {
    throw new Error(`Das Posterframe für "${media.name}" wurde nicht geschrieben. ffmpeg-Aufruf: ${res?.command || '(unbekannt)'}`);
  }
  media.thumb = { path: outPath, ready: true };
  return { mediaId: media.id, path: outPath, command: res?.command || null };
}

/* ==========================================================================
 * Stapelverarbeitung
 * ========================================================================== */

/**
 * Proxies und Posterframes fuer eine Liste von Medien, sequenziell.
 * Sequenziell, weil vier parallele ffmpeg-Laeufe auf einem Arbeitsrechner die
 * Platte saettigen und der Fortschrittsbalken dann nichts mehr aussagt.
 *
 * Ein Fehler an einer Datei bricht den Stapel nicht ab — er wird protokolliert
 * und in result.errors gemeldet. Nur wenn ausnahmslos alles scheitert, wirft
 * die Funktion, damit der Job als Fehler endet.
 */
export async function makeProxies(ctx, mediaList, opts = {}) {
  const list = Array.isArray(mediaList) ? mediaList.filter(Boolean) : [];
  const proxies = [];
  const thumbs = [];
  const errors = [];

  if (list.length === 0) {
    say(ctx, 'Keine Medien übergeben — nichts zu tun.');
    return { proxies, thumbs, errors, media: list };
  }

  for (let i = 0; i < list.length; i++) {
    throwIfCancelled(ctx);
    const media = list[i];
    tellProgress(ctx, i / list.length);
    say(ctx, `[${i + 1}/${list.length}] ${media.name || media.id}`);

    try {
      proxies.push(await makeProxy(ctx, media, opts));
    } catch (err) {
      say(ctx, `FEHLER beim Proxy für "${media.name || media.id}": ${err.message}`);
      errors.push({ mediaId: media.id, name: media.name, step: 'proxy', message: err.message });
      continue;
    }

    // Ein fehlendes Posterframe ist aergerlich, aber kein Grund, den Proxy zu verwerfen.
    try {
      thumbs.push(await makeThumb(ctx, media, { atSec: opts.thumbAtSec ?? 0 }));
    } catch (err) {
      say(ctx, `Hinweis: Posterframe für "${media.name || media.id}" fehlgeschlagen: ${err.message}`);
      errors.push({ mediaId: media.id, name: media.name, step: 'thumb', message: err.message });
    }
  }

  tellProgress(ctx, 1);

  if (proxies.length === 0) {
    throw new Error(
      `Kein einziger Proxy konnte erzeugt werden (${list.length} Dateien versucht). Erster Fehler: ${errors[0]?.message || 'unbekannt'}`
    );
  }
  say(ctx, `Fertig: ${proxies.length} Proxies, ${thumbs.length} Posterframes, ${errors.length} Fehler.`);
  return { proxies, thumbs, errors, media: list };
}
