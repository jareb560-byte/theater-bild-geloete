/**
 * Theater-Bild-Gelöte — Zerlegen, Zusammensetzen, Aneinanderhaengen.
 *
 *   sliceMaster()   Wand-Master  ->  vier Panel-Dateien (raeumlich zerlegen)
 *   stitchPanels()  vier Panel-Dateien -> Wand-Master  (raeumlich fuegen)
 *   concatClips()   mehrere Clips -> ein durchgehendes Video (zeitlich fuegen)
 *
 * Panelgrenzen kommen ausnahmslos aus dem Venue-JSON. Hier wird nie gerechnet,
 * wo eine Naht liegt — sonst waere die Spezifikation nur noch eine Meinung.
 *
 * Nachbarmodule, die hier NICHT implementiert werden:
 *   ../ffmpeg.js  -> runFfmpeg(ctx, args, opts) -> { code, command, log }
 *   ../probe.js   -> probeFile(absPath) -> probeShape()
 *   ./deliver.js  -> deliveryArgs(), deliveryOutName()
 *   ./proxy.js    -> GLOBAL_ARGS, PROGRESS_ARGS
 */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { getWallSpec } from '../../shared/model.js';
import { runFfmpeg } from '../ffmpeg.js';
import { probeFile as probeFileMedia } from '../probe.js';

/**
 * ../probe.js liefert ein MEDIA-Objekt (makeMedia); die Messwerte liegen eine
 * Ebene tiefer unter .probe. In diesem Modul wird ueberall direkt mit
 * probe.width / probe.height / probe.frames gearbeitet - also hier einmal
 * auspacken statt an jeder Fundstelle. Ohne das waeren alle Masse undefined
 * und die Pruefungen "Master hat die richtige Groesse" bzw. "alle Panels
 * gleich hoch" wuerden IMMER anschlagen.
 */
async function probeFile(file) {
  const r = await probeFileMedia(file);
  return r?.probe ?? r;
}
import { deliveryArgs, deliveryOutName } from './deliver.js';
import { GLOBAL_ARGS, PROGRESS_ARGS } from './proxy.js';

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

function say(ctx, line) {
  if (ctx && typeof ctx.log === 'function') ctx.log(line);
  else console.log(`[slice] ${line}`);
}

function throwIfCancelled(ctx) {
  if (ctx?.signal?.aborted || ctx?.cancelled === true) {
    throw new Error('Vom Nutzer abgebrochen.');
  }
}

function de(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  let s = n.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',');
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

/** Framerate als Bruch, wo es einen gibt. */
function formatRate(fps) {
  const n = Number(fps);
  if (!Number.isFinite(n) || n <= 0) return '30';
  if (Number.isInteger(n)) return String(n);
  const ntsc = [
    [23.976, '24000/1001'],
    [29.97, '30000/1001'],
    [47.952, '48000/1001'],
    [59.94, '60000/1001'],
  ];
  for (const [value, frac] of ntsc) if (Math.abs(n - value) < 0.01) return frac;
  return String(Number(n.toFixed(6)));
}

function framesOf(probe) {
  if (Number.isFinite(probe?.frames) && probe.frames > 0) return probe.frames;
  const dur = Number(probe?.durationSec) || 0;
  const fps = Number(probe?.fps) || 0;
  return dur > 0 && fps > 0 ? Math.round(dur * fps) : 0;
}

function durationOf(probe) {
  if (Number.isFinite(probe?.durationSec) && probe.durationSec > 0) return probe.durationSec;
  const frames = Number(probe?.frames) || 0;
  const fps = Number(probe?.fps) || 0;
  return frames > 0 && fps > 0 ? frames / fps : 0;
}

/** Panelbreiten gegen die Wandbreite pruefen — eine widerspruechliche Spec faellt sofort auf. */
function assertWallSpecConsistent(wall) {
  const sum = (wall.panels || []).reduce((a, p) => a + Number(p.width || 0), 0);
  if (sum !== wall.width) {
    throw new Error(
      `Die Venue-Spezifikation für Wand ${wall.id} ist widersprüchlich: die Panels ergeben zusammen ${sum} px, ` +
        `die Wand ist aber mit ${wall.width} px angegeben. Bitte config/venues korrigieren, bevor irgendetwas gerendert wird.`
    );
  }
}

/* ==========================================================================
 * sliceMaster — eine Wand in ihre Panels schneiden
 * ========================================================================== */

/**
 * Schneidet eine fertige Wand-Masterdatei in die Panel-Einzeldateien.
 * EIN ffmpeg-Aufruf: split + crop + mehrere -map, genau wie in ENCODE.md.
 * Vier getrennte Laeufe wuerden die Quelle viermal dekodieren.
 */
export async function sliceMaster(ctx, { masterPath, venue, wallId, presetId, outDir } = {}) {
  if (!masterPath) throw new Error('sliceMaster: Es fehlt die Masterdatei (masterPath).');
  if (!existsSync(masterPath)) throw new Error(`sliceMaster: Die Masterdatei "${masterPath}" gibt es nicht.`);
  if (!outDir) throw new Error('sliceMaster: Es fehlt der Zielordner (outDir).');

  const wall = getWallSpec(venue, wallId);
  assertWallSpecConsistent(wall);
  const panels = wall.panels || [];
  if (panels.length === 0) throw new Error(`sliceMaster: Für Wand ${wallId} sind im Venue keine Panels hinterlegt.`);

  mkdirSync(outDir, { recursive: true });

  const probe = await probeFile(masterPath);
  if (probe.width !== wall.width || probe.height !== wall.height) {
    throw new Error(
      `Die Masterdatei ist ${probe.width}×${probe.height}, Wand ${wallId} verlangt aber ${wall.width}×${wall.height}. ` +
        `Ein Schnitt nach Panelgrenzen wäre damit falsch. Datei: ${path.basename(masterPath)}`
    );
  }

  const frames = framesOf(probe);
  const fps = Number(venue?.fps) || Number(probe.fps) || 30;

  // [0:v]split=4[s0][s1][s2][s3]; [s0]crop=...[p0]; ...
  const splitLabels = panels.map((_, i) => `s${i}`);
  const parts = [`[0:v]split=${panels.length}${splitLabels.map((l) => `[${l}]`).join('')}`];
  panels.forEach((p, i) => {
    parts.push(`[${splitLabels[i]}]crop=${p.width}:${wall.height}:${p.x}:0[p${i}]`);
  });

  const args = [...GLOBAL_ARGS, ...PROGRESS_ARGS, '-i', masterPath, '-filter_complex', parts.join(';')];
  const files = [];

  panels.forEach((p, i) => {
    const encArgs = deliveryArgs(venue, presetId, { width: p.width, height: wall.height });
    const name = deliveryOutName(venue, p.id, p.width, wall.height, presetId);
    const outPath = path.join(outDir, name);
    args.push('-map', `[p${i}]`, ...encArgs, '-r', formatRate(fps), '-fps_mode', 'cfr');
    if (frames > 0) args.push('-frames:v', String(frames));
    args.push(outPath);
    files.push({ panelId: p.id, wallId: wall.id, path: outPath, width: p.width, height: wall.height, x: p.x, presetId });
  });

  throwIfCancelled(ctx);
  say(
    ctx,
    `Wand ${wall.id} wird in ${panels.length} Panels geschnitten: ` +
      panels.map((p) => `${p.id} ${p.width}px ab x=${p.x}`).join(', ')
  );
  if (frames > 0) say(ctx, `Jede Panel-Datei bekommt exakt ${frames} Frames bei ${de(fps)} fps.`);

  const res = await runFfmpeg(ctx, args, { label: `Panels aus Wand ${wall.id}`, totalFrames: frames || null });

  // Nachkontrolle: jede Datei muss da sein und die Spec-Masse haben.
  const warnings = [];
  for (const f of files) {
    if (!existsSync(f.path)) {
      throw new Error(`Die Panel-Datei "${path.basename(f.path)}" wurde nicht geschrieben. ffmpeg-Aufruf: ${res?.command || '(unbekannt)'}`);
    }
    try {
      const p = await probeFile(f.path);
      f.probe = p;
      if (p.width !== f.width || p.height !== f.height) {
        warnings.push(`${path.basename(f.path)} ist ${p.width}×${p.height} statt ${f.width}×${f.height}.`);
      }
      if (frames > 0 && framesOf(p) !== frames) {
        warnings.push(`${path.basename(f.path)} hat ${framesOf(p)} Frames statt ${frames}.`);
      }
    } catch (err) {
      warnings.push(`${path.basename(f.path)} ließ sich nicht analysieren: ${err.message}`);
    }
  }
  for (const w of warnings) say(ctx, `ACHTUNG: ${w}`);

  return { wallId: wall.id, presetId, frames, files, warnings, command: res?.command || null };
}

/* ==========================================================================
 * stitchPanels — vier Panels zu einer Wand
 * ========================================================================== */

/** Eingaben in die Panelreihenfolge der Spec bringen. */
function orderPanelInputs(panelPaths, wall) {
  const panels = wall.panels || [];

  if (Array.isArray(panelPaths)) {
    const list = panelPaths.map((entry) =>
      typeof entry === 'string' ? { path: entry } : { ...entry, path: entry?.path || entry?.file }
    );
    // Wenn die Eintraege ihre Panel-ID kennen, wird danach sortiert, sonst gilt die Reihenfolge.
    if (list.every((e) => e.panelId)) {
      return panels.map((p) => {
        const hit = list.find((e) => e.panelId === p.id);
        if (!hit) throw new Error(`Für Panel ${p.id} der Wand ${wall.id} wurde keine Datei übergeben.`);
        return { panelId: p.id, path: hit.path, spec: p };
      });
    }
    if (list.length !== panels.length) {
      throw new Error(
        `Wand ${wall.id} hat ${panels.length} Panels (${panels.map((p) => p.id).join(', ')}), übergeben wurden aber ${list.length} Dateien.`
      );
    }
    return panels.map((p, i) => ({ panelId: p.id, path: list[i].path, spec: p }));
  }

  if (panelPaths && typeof panelPaths === 'object') {
    return panels.map((p) => {
      const value = panelPaths[p.id];
      if (!value) throw new Error(`Für Panel ${p.id} der Wand ${wall.id} wurde keine Datei übergeben.`);
      return { panelId: p.id, path: typeof value === 'string' ? value : value.path, spec: p };
    });
  }

  throw new Error('stitchPanels: panelPaths muss eine Liste von Pfaden oder eine Zuordnung { D1: "pfad", ... } sein.');
}

/**
 * Setzt Panel-Dateien per hstack wieder zu einer Wand zusammen.
 * Vorher wird geprueft: alle gleich hoch, Breiten exakt nach Spec, gleiche
 * Framezahl, gleiche Framerate. Alle Abweichungen werden GEMEINSAM gemeldet —
 * sonst repariert der Nutzer eine Datei nach der anderen.
 */
export async function stitchPanels(ctx, { panelPaths, venue, wallId, presetId, outDir } = {}) {
  if (!outDir) throw new Error('stitchPanels: Es fehlt der Zielordner (outDir).');

  const wall = getWallSpec(venue, wallId);
  assertWallSpecConsistent(wall);
  const inputs = orderPanelInputs(panelPaths, wall);
  mkdirSync(outDir, { recursive: true });

  const problems = [];

  for (const item of inputs) {
    if (!item.path) {
      problems.push(`Panel ${item.panelId}: kein Pfad übergeben.`);
      continue;
    }
    if (!existsSync(item.path)) {
      problems.push(`Panel ${item.panelId}: die Datei "${item.path}" gibt es nicht.`);
      continue;
    }
    try {
      item.probe = await probeFile(item.path);
    } catch (err) {
      problems.push(`Panel ${item.panelId} (${path.basename(item.path)}): nicht analysierbar — ${err.message}`);
    }
  }

  const usable = inputs.filter((i) => i.probe);
  if (usable.length) {
    const refFrames = framesOf(usable[0].probe);
    const refFps = Number(usable[0].probe.fps) || 0;

    for (const item of usable) {
      const name = path.basename(item.path);
      const p = item.probe;

      if (p.height !== wall.height) {
        problems.push(
          `${name} (Panel ${item.panelId}) ist ${p.height} px hoch, Wand ${wall.id} verlangt ${wall.height} px — Differenz ${p.height - wall.height} px.`
        );
      }
      if (p.width !== item.spec.width) {
        problems.push(
          `${name} (Panel ${item.panelId}) ist ${p.width} px breit, die Spec verlangt ${item.spec.width} px — Differenz ${p.width - item.spec.width} px.`
        );
      }
      const f = framesOf(p);
      if (f !== refFrames) {
        problems.push(
          `${name} (Panel ${item.panelId}) hat ${f} Frames, ${path.basename(usable[0].path)} (Panel ${usable[0].panelId}) hat ${refFrames} — Differenz ${f - refFrames}.`
        );
      }
      if (refFps && Math.abs((Number(p.fps) || 0) - refFps) > 0.01) {
        problems.push(
          `${name} (Panel ${item.panelId}) läuft mit ${de(p.fps)} fps, ${path.basename(usable[0].path)} mit ${de(refFps)} fps.`
        );
      }
    }
  }

  if (problems.length) {
    throw new Error(
      `Die Panel-Dateien passen nicht zu Wand ${wall.id}:\n- ${problems.join('\n- ')}\n` +
        `Solange das nicht stimmt, wäre die zusammengesetzte Wand falsch. Erst angleichen (Reiter Conform), dann erneut fügen.`
    );
  }

  const frames = framesOf(inputs[0].probe);
  const fps = Number(venue?.fps) || Number(inputs[0].probe.fps) || 30;
  const encArgs = deliveryArgs(venue, presetId, { width: wall.width, height: wall.height });
  const outName = deliveryOutName(venue, wall.id, wall.width, wall.height, presetId);
  const outPath = path.join(outDir, outName);

  const args = [...GLOBAL_ARGS, ...PROGRESS_ARGS];
  for (const item of inputs) args.push('-i', item.path);
  const labels = inputs.map((_, i) => `[${i}:v]`).join('');
  args.push(
    '-filter_complex', `${labels}hstack=inputs=${inputs.length}[out]`,
    '-map', '[out]',
    ...encArgs,
    '-r', formatRate(fps),
    '-fps_mode', 'cfr'
  );
  if (frames > 0) args.push('-frames:v', String(frames));
  args.push(outPath);

  throwIfCancelled(ctx);
  say(ctx, `Wand ${wall.id} wird aus ${inputs.length} Panels gefügt: ${inputs.map((i) => i.panelId).join(' + ')} → ${wall.width}×${wall.height}`);
  const res = await runFfmpeg(ctx, args, { label: `Wand ${wall.id} aus Panels`, totalFrames: frames || null });

  if (!existsSync(outPath)) {
    throw new Error(`"${outName}" wurde nicht geschrieben. ffmpeg-Aufruf: ${res?.command || '(unbekannt)'}`);
  }

  const warnings = [];
  let outProbe = null;
  try {
    outProbe = await probeFile(outPath);
    if (outProbe.width !== wall.width || outProbe.height !== wall.height) {
      warnings.push(`Das Ergebnis ist ${outProbe.width}×${outProbe.height} statt ${wall.width}×${wall.height}.`);
    }
    if (frames > 0 && framesOf(outProbe) !== frames) {
      warnings.push(`Das Ergebnis hat ${framesOf(outProbe)} Frames statt ${frames}.`);
    }
  } catch (err) {
    warnings.push(`Das Ergebnis ließ sich nicht analysieren: ${err.message}`);
  }
  for (const w of warnings) say(ctx, `ACHTUNG: ${w}`);

  return {
    wallId: wall.id,
    presetId,
    path: outPath,
    width: wall.width,
    height: wall.height,
    frames,
    probe: outProbe,
    warnings,
    command: res?.command || null,
  };
}

/* ==========================================================================
 * concatClips — zeitlich aneinanderhaengen
 * ========================================================================== */

/** Encoder fuer den Zusammenschnitt: Venue-Preset, sonst nach Dateiendung. */
function pickConcatEncoder(outPath, venue, presetId, size) {
  if (venue && presetId) {
    const args = deliveryArgs(venue, presetId, size);
    return { args, pixFmt: argValue(args, '-pix_fmt') || 'yuv420p', label: `Venue-Preset "${presetId}"` };
  }
  const ext = path.extname(outPath).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') {
    return {
      args: ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'],
      pixFmt: 'yuv420p',
      label: 'H.264 (aus der Dateiendung abgeleitet)',
    };
  }
  return {
    args: ['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-an'],
    pixFmt: 'yuv422p10le',
    label: 'ProRes 422 (Standard für Zwischenstände)',
  };
}

/**
 * Mehrere Clips zu einem durchgehenden Video verbinden.
 *
 *   mode 'cut'       concat-Filter (nicht der Demuxer — so duerfen die Quellen
 *                    unterschiedlich sein)
 *   mode 'xfade'     Ueberblendkette, Offsets aus der kumulierten Dauer
 *   mode 'fadeblack' Ab- und Aufblende um jede Schnittstelle, danach concat
 *
 * Weichen Aufloesung oder fps voneinander ab, wird automatisch scale+fps
 * eingeschoben und das im Log vermerkt. Referenz ist der erste Clip, sofern
 * width/height/fps nicht ausdruecklich uebergeben werden.
 */
export async function concatClips(ctx, { clips, outPath, mode = 'cut', xfadeSec = 1, venue = null, presetId = null, width = null, height = null, fps = null, frames = null } = {}) {
  const list = (Array.isArray(clips) ? clips : [])
    .map((c) => (typeof c === 'string' ? { path: c } : { ...c, path: c?.path || c?.file }))
    .filter((c) => c.path);

  if (list.length === 0) throw new Error('concatClips: Es wurden keine Clips übergeben.');
  if (!outPath) throw new Error('concatClips: Es fehlt der Zielpfad (outPath).');
  if (!['cut', 'xfade', 'fadeblack'].includes(mode)) {
    throw new Error(`concatClips: Modus "${mode}" ist unbekannt. Erlaubt sind "cut", "xfade" und "fadeblack".`);
  }

  const missing = list.filter((c) => !existsSync(c.path));
  if (missing.length) {
    throw new Error(`concatClips: Diese Dateien gibt es nicht:\n- ${missing.map((c) => c.path).join('\n- ')}`);
  }
  mkdirSync(path.dirname(outPath), { recursive: true });

  for (const c of list) c.probe = await probeFile(c.path);

  const W = Number(width) || Number(list[0].probe.width) || 0;
  const H = Number(height) || Number(list[0].probe.height) || 0;
  const F = Number(fps) || Number(venue?.fps) || Number(list[0].probe.fps) || 30;
  if (!W || !H) throw new Error('concatClips: Die Zielauflösung ließ sich nicht bestimmen.');

  if (list.length === 1) {
    say(ctx, 'Nur ein Clip übergeben — es wird lediglich umkodiert, nichts gefügt.');
  }

  const size = { width: W, height: H };
  const encoder = pickConcatEncoder(outPath, venue, presetId, size);
  const filterPixFmt = /^(rgba|bgra|argb|abgr)/.test(encoder.pixFmt) || list.some((c) => c.probe?.hasAlpha)
    ? 'rgba'
    : encoder.pixFmt;

  const D = Math.max(0, Number(xfadeSec) || 0);
  if ((mode === 'xfade' || mode === 'fadeblack') && D <= 0) {
    throw new Error(`concatClips: Modus "${mode}" braucht eine Übergangsdauer größer 0 (xfadeSec).`);
  }
  const durations = list.map((c) => durationOf(c.probe));
  if (mode === 'xfade') {
    const tooShort = list
      .map((c, i) => ({ name: path.basename(c.path), sec: durations[i] }))
      .filter((c) => c.sec <= D);
    if (tooShort.length) {
      throw new Error(
        `concatClips: Die Überblendung dauert ${de(D)} s, aber diese Clips sind nicht länger:\n- ` +
          tooShort.map((c) => `${c.name} (${de(c.sec)} s)`).join('\n- ')
      );
    }
  }

  /* --- Eingaenge auf einen gemeinsamen Nenner bringen ------------------ */

  const args = [...GLOBAL_ARGS, ...PROGRESS_ARGS];
  for (const c of list) args.push('-i', c.path);

  const chains = [];
  list.forEach((c, i) => {
    const p = c.probe;
    const steps = [];
    if (p.width !== W || p.height !== H) {
      say(
        ctx,
        `${path.basename(c.path)} ist ${p.width}×${p.height} statt ${W}×${H} — es wird eingepasst und schwarz aufgefüllt.`
      );
      steps.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
      steps.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`);
    }
    steps.push('setsar=1');
    if (Math.abs((Number(p.fps) || 0) - F) > 0.01) {
      say(ctx, `${path.basename(c.path)} läuft mit ${de(p.fps)} fps statt ${de(F)} fps — es wird umgerechnet.`);
    }
    // fps und format immer setzen: concat und xfade verlangen identische
    // Zeitbasis und identisches Pixelformat an allen Eingaengen.
    steps.push(`fps=${formatRate(F)}`, `format=${filterPixFmt}`, 'settb=AVTB');

    if (mode === 'fadeblack') {
      if (i > 0) steps.push(`fade=t=in:st=0:d=${D.toFixed(3)}`);
      if (i < list.length - 1) {
        const st = Math.max(0, durations[i] - D);
        steps.push(`fade=t=out:st=${st.toFixed(3)}:d=${D.toFixed(3)}`);
      }
    }
    chains.push(`[${i}:v]${steps.join(',')}[v${i}]`);
  });

  /* --- Fuegen ----------------------------------------------------------- */

  let mapLabel = '[v0]';
  let expectedFrames = 0;

  if (mode === 'xfade' && list.length > 1) {
    let acc = durations[0];
    let cur = '[v0]';
    for (let i = 1; i < list.length; i++) {
      const offset = acc - D;
      const outLabel = `[x${i}]`;
      chains.push(`${cur}[v${i}]xfade=transition=fade:duration=${D.toFixed(3)}:offset=${offset.toFixed(3)}${outLabel}`);
      cur = outLabel;
      acc = acc + durations[i] - D;
    }
    mapLabel = cur;
    expectedFrames = durations.reduce((a, d) => a + Math.round(d * F), 0) - (list.length - 1) * Math.round(D * F);
    say(ctx, `Überblendkette: ${list.length} Clips, je ${de(D)} s Überblendung, Gesamtdauer ${de(acc)} s.`);
  } else if (list.length > 1) {
    const inLabels = list.map((_, i) => `[v${i}]`).join('');
    chains.push(`${inLabels}concat=n=${list.length}:v=1:a=0[out]`);
    mapLabel = '[out]';
    expectedFrames = durations.reduce((a, d) => a + Math.round(d * F), 0);
    say(
      ctx,
      mode === 'fadeblack'
        ? `Harte Schnitte mit je ${de(D)} s Ab- und Aufblende an ${list.length - 1} Schnittstellen.`
        : `Harte Schnitte, ${list.length} Clips hintereinander.`
    );
  } else {
    expectedFrames = Math.round(durations[0] * F);
  }

  const finalFrames = Number(frames) > 0 ? Number(frames) : expectedFrames > 0 ? expectedFrames : null;

  args.push('-filter_complex', chains.join(';'), '-map', mapLabel, ...encoder.args, '-r', formatRate(F), '-fps_mode', 'cfr');
  if (!encoder.args.includes('-an')) args.push('-an');
  if (finalFrames) args.push('-frames:v', String(finalFrames));
  args.push(outPath);

  throwIfCancelled(ctx);
  say(ctx, `Ziel: ${W}×${H}, ${de(F)} fps, ${encoder.label}${finalFrames ? `, ${finalFrames} Frames` : ''}`);

  const res = await runFfmpeg(ctx, args, { label: `Clips fügen (${mode})`, totalFrames: finalFrames || null });

  if (!existsSync(outPath)) {
    throw new Error(`"${path.basename(outPath)}" wurde nicht geschrieben. ffmpeg-Aufruf: ${res?.command || '(unbekannt)'}`);
  }

  const warnings = [];
  let outProbe = null;
  try {
    outProbe = await probeFile(outPath);
    if (finalFrames && framesOf(outProbe) !== finalFrames) {
      warnings.push(
        `Das Ergebnis hat ${framesOf(outProbe)} Frames, erwartet waren ${finalFrames}. ` +
          `Die Dauerangaben der Quellen sind vermutlich nicht framegenau.`
      );
    }
  } catch (err) {
    warnings.push(`Das Ergebnis ließ sich nicht analysieren: ${err.message}`);
  }
  for (const w of warnings) say(ctx, `ACHTUNG: ${w}`);

  return {
    path: outPath,
    mode,
    width: W,
    height: H,
    fps: F,
    frames: finalFrames,
    clips: list.map((c) => ({ path: c.path, frames: framesOf(c.probe), durationSec: durationOf(c.probe) })),
    probe: outProbe,
    warnings,
    command: res?.command || null,
  };
}
