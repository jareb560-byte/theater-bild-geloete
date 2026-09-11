/**
 * Theater-Bild-Gelöte — Conform: Frames und Raster angleichen.
 *
 * Setzt den target-Block aus shared/API.md um. Das Ziel ist immer dasselbe:
 * eine Quelle so umbauen, dass sie ohne stille Umrechnung im spaeteren Render
 * landet. Alles, was dabei passiert, steht vorher in conformPlan() im Klartext
 * und waehrend des Laufs im Job-Log.
 *
 * Zwischenformat ist bewusst verlustarm (ProRes 422 bzw. ProRes 4444 bei
 * Alpha), damit zwischen Conform und Delivery nichts kaputtgeht.
 *
 * Nachbarmodule, die hier NICHT implementiert werden:
 *   ../paths.js   -> paths { root, bin, cache, proxies, thumbs, out }
 *   ../ffmpeg.js  -> runFfmpeg(ctx, args, opts) -> { code, command, log }
 *   ../probe.js   -> probeFile(absPath) -> probeShape()
 *   ./proxy.js    -> mediaInputArgs(), GLOBAL_ARGS, PROGRESS_ARGS
 */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { makeMedia } from '../../shared/model.js';
import { paths } from '../paths.js';
import { runFfmpeg } from '../ffmpeg.js';
import { probeFile as probeFileMedia } from '../probe.js';

/**
 * ../probe.js liefert ein MEDIA-Objekt (makeMedia); die Messwerte liegen eine
 * Ebene tiefer unter .probe. Hier wird durchgehend mit probe.fps / probe.width /
 * probe.frames gerechnet, also einmal zentral auspacken. Ohne das rechnet der
 * ganze Angleich mit undefined und NaN.
 */
async function probeFile(file) {
  const r = await probeFileMedia(file);
  return r?.probe ?? r;
}
import { GLOBAL_ARGS, PROGRESS_ARGS, mediaInputArgs } from './proxy.js';

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

function say(ctx, line) {
  if (ctx && typeof ctx.log === 'function') ctx.log(line);
  else console.log(`[conform] ${line}`);
}

function throwIfCancelled(ctx) {
  if (ctx?.signal?.aborted || ctx?.cancelled === true) {
    throw new Error('Vom Nutzer abgebrochen.');
  }
}

/** Zahl im deutschen Format, ohne ueberfluessige Nullen hinter dem Komma. */
function de(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  let s = n.toFixed(digits);
  // Nur NACH dem Punkt kuerzen — sonst wuerde aus 1000 eine 1.
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',');
}

/**
 * NTSC-Raten exakt als Bruch schreiben. 29,97 ist nicht 29.97, und wenn man
 * das ffmpeg als Dezimalzahl gibt, driftet die Zeitbasis ueber lange Loops.
 */
const NTSC_RATES = [
  [23.976, '24000/1001'],
  [29.97, '30000/1001'],
  [47.952, '48000/1001'],
  [59.94, '60000/1001'],
  [119.88, '120000/1001'],
];

function formatRate(fps) {
  const n = Number(fps);
  if (!Number.isFinite(n) || n <= 0) return '30';
  if (Number.isInteger(n)) return String(n);
  for (const [value, frac] of NTSC_RATES) {
    if (Math.abs(n - value) < 0.01) return frac;
  }
  return String(Number(n.toFixed(6)));
}

/** "1 Frame wird" statt "1 Frames werden". */
function frames(n, verb = 'werden') {
  const one = verb === 'werden' ? 'wird' : verb === 'fehlen' ? 'fehlt' : verb;
  return n === 1 ? `1 Frame ${one}` : `${n} Frames ${verb}`;
}

/** Framezahl einer Quelle, notfalls aus Dauer und Rate gerechnet. */
function sourceFrames(probe) {
  if (Number.isFinite(probe?.frames) && probe.frames > 0) return probe.frames;
  const dur = Number(probe?.durationSec) || 0;
  const fps = Number(probe?.fps) || 0;
  return dur > 0 && fps > 0 ? Math.round(dur * fps) : 0;
}

function sourceDuration(probe) {
  if (Number.isFinite(probe?.durationSec) && probe.durationSec > 0) return probe.durationSec;
  const frames = Number(probe?.frames) || 0;
  const fps = Number(probe?.fps) || 0;
  return frames > 0 && fps > 0 ? frames / fps : 0;
}

/** Referenzmedium fuer syncToMediaId finden. */
function findSyncRef(target, pools) {
  if (target?.syncToMedia?.probe) return target.syncToMedia;
  const id = target?.syncToMediaId;
  if (!id) return null;
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    const hit = pool.find((m) => m && m.id === id);
    if (hit) return hit;
  }
  return null;
}

/** Braucht das Ergebnis einen Alphakanal? */
function wantsAlpha(probe, target) {
  if (probe?.hasAlpha === true) return true;
  const pf = String(target?.pixFmt || '');
  return /^(rgba|bgra|argb|abgr)/.test(pf) || /^yuva/.test(pf);
}

/**
 * Zwischenformat waehlen. prores_ks ist der Normalfall; fehlt er im installierten
 * ffmpeg-Build, wird verlustfrei als FFV1 in MKV geschrieben — mit Hinweis.
 */
function pickIntermediateEncoder(ctx, alpha) {
  const encoders = ctx?.health?.ffmpeg?.encoders || ctx?.encoders || null;
  const hasProres = encoders ? encoders.prores_ks !== false : true;

  if (hasProres) {
    return alpha
      ? {
          id: 'prores4444',
          label: 'ProRes 4444',
          ext: '.mov',
          pixFmt: 'yuva444p10le',
          args: ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '8'],
        }
      : {
          id: 'prores422',
          label: 'ProRes 422',
          ext: '.mov',
          pixFmt: 'yuv422p10le',
          args: ['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'],
        };
  }

  const pixFmt = alpha ? 'rgba' : 'yuv422p10le';
  return {
    id: 'ffv1',
    label: 'FFV1 in MKV',
    ext: '.mkv',
    pixFmt,
    args: ['-c:v', 'ffv1', '-level', '3', '-coder', '1', '-context', '1', '-g', '1', '-pix_fmt', pixFmt],
    fallbackNote:
      'Dieser ffmpeg-Build kennt keinen prores_ks. Statt ProRes wird verlustfrei als FFV1 in MKV geschrieben. ' +
      'Für die Auslieferung ans Schiff ist ein Build mit HAP und ProRes nötig — siehe Reiter Systemzustand.',
  };
}

/** fps fuer den Dateinamen: 30 -> "30", 29,97 -> "29-97". */
function fpsTag(fps) {
  return String(Number(Number(fps).toFixed(3))).replace('.', '-');
}

/* ==========================================================================
 * Filterkette
 * ========================================================================== */

/**
 * Baut die Videofilterkette.
 * Reihenfolge ist nicht beliebig: erst die Zeit (fps/setpts), dann die Geometrie
 * (scale/crop/pad), dann das Verlaengern (tpad) — sonst wuerde tpad Frames in
 * der falschen Groesse klonen.
 */
function buildFilterChain({ ctx, probe, target, fps, srcFps, warnings }) {
  const chain = [];
  const fpsMode = target?.fpsMode || 'resample';
  const rate = formatRate(fps);

  if (fpsMode === 'interpolate') {
    say(
      ctx,
      'ACHTUNG: fpsMode "interpolate" benutzt minterpolate. Das ist bewegungskompensiert, ' +
        'sehr langsam (Faktor 20 bis 50 gegenüber einem normalen Lauf) und kann an harten Kanten ' +
        'Artefakte erzeugen. Bei Zweifel "resample" nehmen.'
    );
    warnings.push('minterpolate ist aktiv — Laufzeit und Artefaktrisiko im Auge behalten.');
    chain.push(`minterpolate=fps=${rate}:mi_mode=mci:mc_mode=aobmc:vsbmc=1`);
  } else if (fpsMode === 'retime') {
    // Kein Frame wird erfunden oder verworfen; das Video laeuft schneller oder langsamer.
    // Klammern sind Pflicht: bei Bruchraten wuerde 25/30000/1001 sonst falsch gerechnet.
    chain.push(`setpts=(${formatRate(srcFps)})/(${rate})*PTS`);
  } else {
    // 'resample' und 'duplicate' sind derselbe Filter, nur anders benannt.
    chain.push(`fps=${rate}`);
  }

  const colorRange = target?.colorRange || null;
  const rangeSuffix = colorRange ? `:out_range=${colorRange}` : '';

  const tw = Number(target?.width) || null;
  const th = Number(target?.height) || null;

  if (tw && th) {
    const fit = target?.fit || 'cover';
    if (fit === 'stretch') {
      chain.push(`scale=${tw}:${th}${rangeSuffix}`);
    } else if (fit === 'contain') {
      chain.push(`scale=${tw}:${th}:force_original_aspect_ratio=decrease${rangeSuffix}`);
      chain.push(`pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black`);
    } else if (fit === 'native') {
      chain.push(`crop=min(iw\\,${tw}):min(ih\\,${th})`);
      chain.push(`pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black`);
      if (rangeSuffix) chain.push(`scale=iw:ih${rangeSuffix}`);
    } else {
      // cover: fuellen und den Ueberstand mittig wegschneiden
      chain.push(`scale=${tw}:${th}:force_original_aspect_ratio=increase${rangeSuffix}`);
      chain.push(`crop=${tw}:${th}`);
    }
    chain.push('setsar=1');
  } else if (rangeSuffix) {
    chain.push(`scale=iw:ih${rangeSuffix}`);
  }

  return chain;
}

/* ==========================================================================
 * conformMedia
 * ========================================================================== */

/**
 * Eine Quelle auf das Zielraster bringen.
 *
 * Ergebnis:
 *   { media: [neuesMedia], path, command, encoder, frames, warnings, plan }
 * media ist bewusst eine Liste — so kann die Route mehrere Laeufe einfach zu
 * result.media zusammenhaengen, passend zum Rest der API.
 */
export async function conformMedia(ctx, { media, target, outDir, venue } = {}) {
  if (!media) throw new Error('conform: Es wurde keine Quelldatei übergeben.');
  if (!media.absPath || !existsSync(media.absPath)) {
    throw new Error(`conform: Die Quelldatei "${media?.absPath || media?.name || '?'}" gibt es nicht (mehr).`);
  }

  const warnings = [];
  const targetDir = outDir || paths?.out;
  if (!targetDir) throw new Error('conform: Es fehlt ein Zielordner (outDir).');
  mkdirSync(targetDir, { recursive: true });

  const probe = media.probe || (await probeFile(media.absPath));
  if (!media.probe) media.probe = probe;
  if (!probe) throw new Error(`conform: "${media.name}" konnte nicht analysiert werden.`);

  const fps = Number(target?.fps) || Number(venue?.fps) || Number(probe.fps) || 30;
  const srcFps = Number(probe.fps) || fps;
  const fpsMode = target?.fpsMode || 'resample';
  const durationMode = target?.durationMode || 'none';

  // Referenzmedium fuer den Frameabgleich einmal aufloesen — die Vorschau
  // braucht es genauso wie der Lauf selbst.
  const syncRef = findSyncRef(target, [ctx?.media, ctx?.project?.media, target?.mediaPool]);

  // Vorschau in den Job schreiben, bevor irgendetwas laeuft.
  const plan = conformPlan(syncRef ? [media, syncRef] : [media], target, venue);
  for (const line of plan.rows[0]?.lines || []) say(ctx, line);

  /* --- Framezahlen ---------------------------------------------------- */

  const srcFrames = sourceFrames(probe);
  const srcDur = sourceDuration(probe);
  // Frames nach der fps-Behandlung, bevor gekuerzt oder verlaengert wird.
  const framesAfterFps = fpsMode === 'retime' ? srcFrames : Math.round(srcDur * fps);
  const durAfterFps = fps > 0 ? framesAfterFps / fps : 0;

  let targetFrames = null;
  let frameSource = null;

  if (target?.syncToMediaId) {
    const ref = syncRef;
    if (!ref) {
      throw new Error(
        `conform: Das Referenzmedium "${target.syncToMediaId}" für den Frameabgleich ist nicht auffindbar. ` +
          `Es muss in der Bibliothek des laufenden Projekts liegen.`
      );
    }
    if (!ref.probe) {
      throw new Error(`conform: Das Referenzmedium "${ref.name}" wurde noch nicht analysiert — Bibliothek neu einlesen.`);
    }
    targetFrames = sourceFrames(ref.probe);
    frameSource = `Referenz "${ref.name}" (${targetFrames} Frames)`;
    if (!targetFrames) {
      throw new Error(`conform: Das Referenzmedium "${ref.name}" hat keine ermittelbare Framezahl.`);
    }
  } else if (Number(target?.durationSec) > 0) {
    targetFrames = Math.round(Number(target.durationSec) * fps);
    frameSource = `Zieldauer ${de(target.durationSec)} s bei ${de(fps)} fps`;
  }

  /* --- Dauer angleichen ------------------------------------------------ */

  const padChain = [];
  const inputLoop = durationMode === 'loop';
  let forcedFrames = null;

  if (durationMode !== 'none') {
    if (targetFrames == null) {
      throw new Error(
        `conform: durationMode "${durationMode}" braucht eine Zielvorgabe — entweder durationSec setzen oder syncToMediaId angeben.`
      );
    }
    forcedFrames = targetFrames;
    const restFrames = targetFrames - framesAfterFps;
    const restSec = fps > 0 ? restFrames / fps : 0;

    if (durationMode === 'trim') {
      if (restFrames > 0) {
        warnings.push(
          `"${media.name}" ist mit ${framesAfterFps} Frames kürzer als das Ziel (${targetFrames}). ` +
            `durationMode "trim" verlängert nicht — das Ergebnis bleibt kurz. Für Verlängerung padBlack, padFreeze oder loop wählen.`
        );
        say(ctx, `Hinweis: ${warnings[warnings.length - 1]}`);
      }
    } else if (durationMode === 'padBlack') {
      if (restSec > 0) padChain.push(`tpad=stop_mode=add:stop_duration=${restSec.toFixed(3)}:color=black`);
      else say(ctx, 'padBlack: Die Quelle ist schon lang genug, es wird nur gekürzt.');
    } else if (durationMode === 'padFreeze') {
      if (restSec > 0) padChain.push(`tpad=stop_mode=clone:stop_duration=${restSec.toFixed(3)}`);
      else say(ctx, 'padFreeze: Die Quelle ist schon lang genug, es wird nur gekürzt.');
    } else if (durationMode === 'loop') {
      say(ctx, `Die Quelle wird endlos wiederholt und nach ${targetFrames} Frames hart abgeschnitten.`);
    } else {
      throw new Error(`conform: durationMode "${durationMode}" ist unbekannt.`);
    }
    say(ctx, `Zielframezahl: ${targetFrames} — Quelle: ${frameSource || 'Vorgabe'}`);
  }

  /* --- Filterkette ----------------------------------------------------- */

  const chain = buildFilterChain({ ctx, probe, target, fps, srcFps, warnings });
  chain.push(...padChain);

  /* --- Encoder --------------------------------------------------------- */

  const alpha = wantsAlpha(probe, target);
  const encoder = pickIntermediateEncoder(ctx, alpha);
  if (encoder.fallbackNote) {
    say(ctx, encoder.fallbackNote);
    warnings.push(encoder.fallbackNote);
  }
  if (target?.pixFmt && target.pixFmt !== encoder.pixFmt) {
    const note =
      `Angefragtes Pixelformat "${target.pixFmt}" passt nicht zum Zwischenformat ${encoder.label}. ` +
      `Geschrieben wird ${encoder.pixFmt} — das ist verlustärmer als die Anfrage, nicht schlechter. ` +
      `Das endgültige Pixelformat setzt erst das Delivery-Preset.`;
    say(ctx, note);
    warnings.push(note);
  }

  /* --- Ausgabename ----------------------------------------------------- */

  const ext = path.extname(media.absPath);
  const rawStem = path.basename(media.absPath, ext);
  // Bei Bildsequenzen den Nummernblock aus dem Namen nehmen.
  const stem = (media.kind === 'sequence' ? rawStem.replace(/[_.-]?\d+$/, '') : rawStem) || 'clip';
  const outName = `${stem}_conform_${fpsTag(fps)}p${encoder.ext}`;
  const outPath = path.join(targetDir, outName);

  /* --- Aufruf ---------------------------------------------------------- */

  const input = mediaInputArgs(media, {
    fps: srcFps,
    stillSec: media.kind === 'image' ? Math.max(1, Math.ceil((targetFrames || fps) / fps)) : null,
    loopInput: inputLoop && media.kind !== 'image',
  });
  if (input.note) say(ctx, `Eingang: ${input.note}`);

  const args = [
    ...GLOBAL_ARGS,
    ...PROGRESS_ARGS,
    ...input.args,
    '-vf', chain.join(','),
    ...encoder.args,
    '-r', formatRate(fps),
    '-fps_mode', 'cfr',
    '-an',
  ];
  if (target?.colorRange) args.push('-color_range', target.colorRange);
  if (forcedFrames) args.push('-frames:v', String(forcedFrames));
  args.push(outPath);

  throwIfCancelled(ctx);
  say(ctx, `Zwischenformat: ${encoder.label} → ${outName}`);
  const res = await runFfmpeg(ctx, args, {
    label: `Conform ${media.name}`,
    totalFrames: forcedFrames || framesAfterFps || null,
  });

  if (!existsSync(outPath)) {
    throw new Error(`conform: "${outName}" wurde nicht geschrieben. ffmpeg-Aufruf: ${res?.command || '(unbekannt)'}`);
  }

  /* --- Ergebnis pruefen und als Media zurueckgeben ---------------------- */

  const outProbe = await probeFile(outPath);
  if (forcedFrames && Number.isFinite(outProbe?.frames) && outProbe.frames !== forcedFrames) {
    const note = `"${outName}" hat ${outProbe.frames} Frames statt der geforderten ${forcedFrames}. Bitte vor dem Render prüfen.`;
    say(ctx, `ACHTUNG: ${note}`);
    warnings.push(note);
  }
  if (Math.abs((Number(outProbe?.fps) || 0) - fps) > 0.01) {
    const note = `"${outName}" liegt bei ${de(outProbe?.fps)} fps statt ${de(fps)} fps.`;
    say(ctx, `ACHTUNG: ${note}`);
    warnings.push(note);
  }

  const newMedia = makeMedia(outPath, {
    kind: 'video',
    name: outName,
    probe: outProbe,
    issues: warnings.map((w) => ({ level: 'warn', msg: w })),
  });

  return {
    media: [newMedia],
    path: outPath,
    command: res?.command || null,
    encoder: encoder.label,
    frames: outProbe?.frames ?? forcedFrames ?? null,
    warnings,
    plan: plan.rows[0] || null,
  };
}

/* ==========================================================================
 * conformPlan — Vorschau ohne zu rendern
 * ========================================================================== */

/** Text zur fps-Umstellung. */
function fpsText(probe, target, fps) {
  const srcFps = Number(probe.fps) || 0;
  const srcFrames = sourceFrames(probe);
  const dur = sourceDuration(probe);
  const mode = target?.fpsMode || 'resample';

  if (mode === 'retime') {
    const newDur = fps > 0 ? srcFrames / fps : 0;
    const richtung = fps > srcFps ? 'schneller' : fps < srcFps ? 'langsamer' : 'gleich schnell';
    return `${de(srcFps)} → ${de(fps)} fps (retime): Framezahl bleibt ${srcFrames}, das Video läuft ${richtung} und dauert dann ${de(newDur)} s statt ${de(dur)} s`;
  }

  const dstFrames = Math.round(dur * fps);
  const diff = dstFrames - srcFrames;

  if (Math.abs(srcFps - fps) < 0.001) {
    return `${de(fps)} fps — keine Änderung (${srcFrames} Frames)`;
  }
  if (mode === 'interpolate') {
    return `${de(srcFps)} → ${de(fps)} fps (interpolate): ${frames(Math.abs(diff))} bewegungskompensiert neu berechnet (${srcFrames} → ${dstFrames}) — langsam`;
  }
  if (diff > 0) {
    return `${de(srcFps)} → ${de(fps)} fps: ${frames(diff)} gedoppelt (${srcFrames} → ${dstFrames})`;
  }
  if (diff < 0) {
    return `${de(srcFps)} → ${de(fps)} fps: ${frames(-diff)} verworfen (${srcFrames} → ${dstFrames})`;
  }
  return `${de(srcFps)} → ${de(fps)} fps: Framezahl bleibt ${srcFrames}`;
}

/** Text zur Geometrie. */
function geometryText(probe, target) {
  const w = Number(probe.width) || 0;
  const h = Number(probe.height) || 0;
  const tw = Number(target?.width) || null;
  const th = Number(target?.height) || null;
  const fit = target?.fit || 'cover';

  if (!tw || !th) return `${w}×${h} — unverändert`;
  if (w === tw && h === th) return `${w}×${h} — passt exakt, nichts wird angefasst`;
  if (!w || !h) return `Zielraster ${tw}×${th} — Quellgröße unbekannt`;

  if (fit === 'stretch') {
    return `${w}×${h} → ${tw}×${th}: verzerrt (Seitenverhältnis ${de(w / h)} → ${de(tw / th)})`;
  }
  if (fit === 'native') {
    const dx = Math.round(Math.abs(tw - w) / 2);
    const dy = Math.round(Math.abs(th - h) / 2);
    const parts = [];
    if (tw > w) parts.push(`schwarze Ränder links/rechts (je ${dx} px)`);
    if (tw < w) parts.push(`beschnitten links/rechts (je ${dx} px)`);
    if (th > h) parts.push(`schwarze Ränder oben/unten (je ${dy} px)`);
    if (th < h) parts.push(`beschnitten oben/unten (je ${dy} px)`);
    return `${w}×${h} → ${tw}×${th}: unskaliert zentriert${parts.length ? ', ' + parts.join(', ') : ''}`;
  }

  const factor = fit === 'contain' ? Math.min(tw / w, th / h) : Math.max(tw / w, th / h);
  const sw = Math.round(w * factor);
  const sh = Math.round(h * factor);
  const parts = [];

  if (fit === 'contain') {
    const px = Math.round((tw - sw) / 2);
    const py = Math.round((th - sh) / 2);
    if (px > 0) parts.push(`schwarze Balken links/rechts (je ${px} px)`);
    if (py > 0) parts.push(`schwarze Balken oben/unten (je ${py} px)`);
    if (parts.length === 0) parts.push('nur skaliert');
    return `${w}×${h} → ${tw}×${th}: eingepasst auf ${sw}×${sh} (${de(factor * 100, 1)} %), ${parts.join(', ')}`;
  }

  const cx = Math.round((sw - tw) / 2);
  const cy = Math.round((sh - th) / 2);
  if (cx > 0) parts.push(`beschnitten links/rechts (je ${cx} px)`);
  if (cy > 0) parts.push(`beschnitten oben/unten (je ${cy} px)`);
  if (parts.length === 0) parts.push('nur skaliert');
  return `${w}×${h} → ${tw}×${th}: gefüllt auf ${sw}×${sh} (${de(factor * 100, 1)} %), ${parts.join(', ')}`;
}

/** Text zur Dauer. */
function durationText(probe, target, fps, refMedia) {
  const mode = target?.durationMode || 'none';
  const srcFrames = sourceFrames(probe);
  const dur = sourceDuration(probe);
  const framesAfter =
    (target?.fpsMode || 'resample') === 'retime' ? srcFrames : Math.round(dur * fps);

  let targetFrames = null;
  let quelle = null;
  if (target?.syncToMediaId) {
    if (!refMedia) {
      return `Frameabgleich auf "${target.syncToMediaId}" verlangt — dieses Medium ist in der Liste nicht auffindbar`;
    }
    targetFrames = sourceFrames(refMedia.probe);
    quelle = `Referenz "${refMedia.name}"`;
  } else if (Number(target?.durationSec) > 0) {
    targetFrames = Math.round(Number(target.durationSec) * fps);
    quelle = `Vorgabe ${de(target.durationSec)} s`;
  }

  if (mode === 'none') {
    return targetFrames != null
      ? `Dauer bleibt bei ${framesAfter} Frames — durationMode steht auf "none", die Zielvorgabe (${targetFrames} Frames) wird ignoriert`
      : `Dauer bleibt bei ${framesAfter} Frames (${de(framesAfter / fps)} s)`;
  }
  if (targetFrames == null) {
    return `durationMode "${mode}" ohne Zielvorgabe — es fehlt durationSec oder syncToMediaId`;
  }

  const diff = targetFrames - framesAfter;
  const head = `${framesAfter} → ${targetFrames} Frames (${quelle})`;
  if (diff === 0) return `${head}: passt bereits`;
  if (mode === 'trim') {
    return diff < 0
      ? `${head}: ${frames(-diff)} abgeschnitten`
      : `${head}: zu kurz — "trim" verlängert nicht, es ${frames(diff, 'fehlen')}`;
  }
  if (mode === 'padBlack') {
    return diff > 0
      ? `${head}: ${frames(diff)} Schwarz angehängt (${de(diff / fps)} s)`
      : `${head}: ${frames(-diff)} abgeschnitten`;
  }
  if (mode === 'padFreeze') {
    return diff > 0
      ? `${head}: der letzte Frame wird ${diff}× wiederholt (${de(diff / fps)} s Standbild)`
      : `${head}: ${frames(-diff)} abgeschnitten`;
  }
  if (mode === 'loop') {
    const runs = framesAfter > 0 ? targetFrames / framesAfter : 0;
    return `${head}: die Quelle wird ${de(runs)}× wiederholt und dann hart geschnitten`;
  }
  return `${head}: durationMode "${mode}" ist unbekannt`;
}

/**
 * Vorschau-Tabelle OHNE zu rendern. Genau das zeigt das UI, bevor der Nutzer
 * auf Start drueckt.
 */
export function conformPlan(mediaList, target, venue) {
  const list = Array.isArray(mediaList) ? mediaList.filter(Boolean) : [];
  const fps = Number(target?.fps) || Number(venue?.fps) || 30;
  const rows = [];
  const warnings = [];

  for (const m of list) {
    const probe = m.probe;
    if (!probe) {
      const msg = `"${m.name || m.id}" wurde noch nicht analysiert — Bibliothek neu einlesen, sonst lässt sich nichts vorhersagen.`;
      warnings.push(msg);
      rows.push({
        mediaId: m.id,
        name: m.name,
        fps: 'unbekannt',
        geometry: 'unbekannt',
        duration: 'unbekannt',
        format: 'unbekannt',
        lines: [msg],
        blocked: true,
      });
      continue;
    }

    const refMedia = findSyncRef(target, [list]);
    const row = {
      mediaId: m.id,
      name: m.name,
      fps: fpsText(probe, target, fps),
      geometry: geometryText(probe, target),
      duration: durationText(probe, target, fps, refMedia),
      format: '',
      blocked: false,
    };

    const fmtParts = [];
    if (target?.pixFmt && target.pixFmt !== probe.pixFmt) {
      fmtParts.push(`Pixelformat ${probe.pixFmt || 'unbekannt'} → ${target.pixFmt}`);
    }
    if (target?.colorRange && target.colorRange !== probe.colorRange) {
      fmtParts.push(`Wertebereich ${probe.colorRange || 'unbekannt'} → ${target.colorRange}`);
    }
    if (probe.hasAlpha) fmtParts.push('hat Alpha — Zwischenformat wird ProRes 4444');
    if (probe.audioStreams > 0) fmtParts.push(`${probe.audioStreams} Tonspur(en) werden verworfen`);
    row.format = fmtParts.join(', ') || 'unverändert';

    row.lines = [
      `${m.name}:`,
      `  Framerate: ${row.fps}`,
      `  Raster:    ${row.geometry}`,
      `  Dauer:     ${row.duration}`,
      `  Format:    ${row.format}`,
    ];

    if ((target?.fpsMode || 'resample') === 'interpolate') {
      warnings.push(`"${m.name}": minterpolate ist sehr langsam und kann an harten Kanten Artefakte erzeugen.`);
    }
    if (venue?.fps && Math.abs(fps - venue.fps) > 0.01) {
      const msg = `Zielrate ${de(fps)} fps weicht von der Hausrate ${de(venue.fps)} fps ab.`;
      if (!warnings.includes(msg)) warnings.push(msg);
    }

    rows.push(row);
  }

  const md = ['| Datei | Framerate | Raster | Dauer | Format |', '|---|---|---|---|---|'];
  for (const r of rows) {
    const c = (v) => String(v ?? '—').replace(/\|/g, '\\|');
    md.push(`| ${c(r.name)} | ${c(r.fps)} | ${c(r.geometry)} | ${c(r.duration)} | ${c(r.format)} |`);
  }

  return { fps, rows, warnings, markdown: md.join('\n') };
}
