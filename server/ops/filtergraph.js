/**
 * Theater-Bild-Gelöte — Filtergraph-Generator
 * ===========================================================================
 *
 * Baut aus Projekt + Venue einen vollstaendigen ffmpeg-filter_complex fuer EINE
 * Wand. Das ist das Herzstueck: alles, was der Nutzer im Editor einstellt,
 * landet hier als Filterkette. Nichts davon ist eine Black Box — der erzeugte
 * Graph wird im UI im Klartext angezeigt (siehe explainGraph).
 *
 * ---------------------------------------------------------------------------
 * GRUNDAUFBAU
 * ---------------------------------------------------------------------------
 *   Input 0  = schwarze (bzw. transparente) Basisflaeche in Wandgroesse (lavfi)
 *   Input 1..n = je eine Quelldatei pro Layer
 *
 *   [0:v] -> [base]
 *   [1:v] -> Zeit -> Crop -> Orientierung -> Skalierung -> Farbe -> Dither
 *            -> Feather -> Deckkraft -> zeitlicher Versatz  -> [v1]
 *   [base][v1] overlay -> [o1]
 *   [o1][v2]   overlay -> [o2]  ...
 *   [oN] -> format -> [out]
 *
 * ---------------------------------------------------------------------------
 * FARBRAUM — warum intern rgba
 * ---------------------------------------------------------------------------
 * Deckkraft, Feather und Ueberblendungen brauchen einen echten Alphakanal.
 * Deshalb rechnet der Graph ab der Skalierung in rgba. Erst ganz am Ende wird
 * (bei alpha=false) in das Zielformat gewandelt — bzw. gar nicht, dann macht
 * das der Encoder ueber -pix_fmt aus deliver.js.
 *
 * Zwei Filter, die wir laut Vorgabe benutzen sollen (eq und hue), koennen KEIN
 * Alpha: ffmpeg wuerde stillschweigend nach yuv wandeln und den Alphakanal
 * wegwerfen. Darum laufen eq/hue/noise in einer eigenen "gesicherten Zone":
 * hat die Quelle selbst Alpha, wird der Alphakanal vorher per alphaextract
 * abgezweigt und danach per alphamerge wieder angeheftet. Hat die Quelle kein
 * Alpha, ist das unnoetig und die Filter stehen direkt in der Kette.
 *
 * ---------------------------------------------------------------------------
 * LABEL-DISZIPLIN (harte Anforderung)
 * ---------------------------------------------------------------------------
 * Jedes Label wird genau einmal erzeugt und genau einmal verbraucht. Praefixe:
 *   base          Basisflaeche
 *   g<n>s/c/a/... gesicherte Farbzone von Layer n
 *   v<n>          fertiger Layer n
 *   bp<n>         auf Wandgroesse gepaddeter Layer n (nur bei blend != normal)
 *   bs<n>a/b/c/d  Hilfslabels fuer blend
 *   o<n>          Komposit nach Layer n
 *   out           Endergebnis
 *   q<n> / p<n>   Panel-Split und Panel-Ausschnitte
 *
 * ---------------------------------------------------------------------------
 * WINDOWS
 * ---------------------------------------------------------------------------
 * Dateipfade tauchen NIE im filter_complex auf, ausschliesslich hinter -i.
 * Damit entfaellt das gesamte Escaping-Problem von Backslashes und Doppelpunkten
 * (D:\... waere im Filtergraph ein Minenfeld).
 */

import {
  getWallSpec,
  findMedia,
  wallLayersInOrder,
  targetFrameCount,
  defaultTransform,
  defaultFilters,
  defaultTime,
} from '../../shared/model.js';

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

/**
 * Kommazahl fuer ffmpeg formatieren — IMMER mit Punkt, nie mit Komma.
 * toFixed() ist in JS locale-unabhaengig, im Gegensatz zu toLocaleString().
 * Ueberfluessige Nullen fallen weg, damit die Kommandozeile lesbar bleibt.
 */
export function num(x, decimals = 3) {
  const v = typeof x === 'number' && Number.isFinite(x) ? x : 0;
  let s = v.toFixed(Math.max(0, Math.min(10, decimals)));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

/** Ganzzahl fuer ffmpeg (Pixelwerte, Framezahlen). */
function int(x) {
  return String(Math.round(Number.isFinite(x) ? x : 0));
}

/** Auf gerade Pixel runden. Gerade Kantenlaengen sind fuer jeden Codec sicher. */
function evenRound(x, min = 2) {
  let v = Math.round(Number.isFinite(x) ? x : 0);
  if (v % 2 !== 0) v += 1;
  return Math.max(min, v);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** '#112233' -> '0x112233' (ffmpeg-Farbsyntax). Alles andere unveraendert. */
function ffColor(hex, fallback = 'black') {
  if (typeof hex !== 'string') return fallback;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return m ? `0x${m[1]}` : fallback;
}

/**
 * rangeSec normalisieren. Erlaubt sind:
 *   null                      -> ganzer Loop
 *   12                        -> 0..12 s
 *   [3, 8] / {start,end} / {startSec,endSec}
 */
function normalizeRange(rangeSec, loopSeconds) {
  if (rangeSec == null) return null;
  let a = null;
  let b = null;
  if (typeof rangeSec === 'number') {
    a = 0;
    b = rangeSec;
  } else if (Array.isArray(rangeSec)) {
    a = Number(rangeSec[0]);
    b = Number(rangeSec[1]);
  } else if (typeof rangeSec === 'object') {
    a = Number(rangeSec.startSec ?? rangeSec.start ?? rangeSec.from ?? 0);
    b = Number(rangeSec.endSec ?? rangeSec.end ?? rangeSec.to ?? NaN);
    if (!Number.isFinite(b) && Number.isFinite(Number(rangeSec.durationSec))) {
      b = a + Number(rangeSec.durationSec);
    }
  }
  if (!Number.isFinite(a)) a = 0;
  if (!Number.isFinite(b)) b = loopSeconds;
  a = Math.max(0, a);
  b = Math.max(a, b);
  if (a === 0 && b >= loopSeconds) return null; // deckt den ganzen Loop ab
  return { startSec: a, endSec: b };
}

/* -- Defaults sauber mit den gespeicherten Werten mischen ------------------ */

function mergeTransform(t) {
  const d = defaultTransform();
  const s = t || {};
  return {
    ...d,
    ...s,
    crop: s.crop ? { x: 0, y: 0, w: 0, h: 0, ...s.crop } : null,
    dest: { ...d.dest, ...(s.dest || {}) },
    offset: { ...d.offset, ...(s.offset || {}) },
  };
}

function mergeFilters(f) {
  const d = defaultFilters();
  const s = f || {};
  return { ...d, ...s, feather: { ...d.feather, ...(s.feather || {}) } };
}

function mergeTime(t) {
  const d = defaultTime();
  const s = t || {};
  return { ...d, ...s, transition: { ...d.transition, ...(s.transition || {}) } };
}

/* ==========================================================================
 * Zielrechteck ausrechnen
 * ========================================================================== */

/**
 * Liefert das Zielrechteck eines Layers IM SLOT (Slot-Pixel, bereits mit
 * opts.scale multipliziert).
 *
 * sw/sh sind die Quellmasse NACH Crop und NACH Rotation — nur so stimmt das
 * Seitenverhaeltnis.
 *
 * Rechnung ueber den Mittelpunkt: erst Groesse aus dem fit-Modus bestimmen,
 * dann zoom als Faktor auf die Groesse (Zoom um den Mittelpunkt), dann den
 * Mittelpunkt um offset verschieben. Damit ist zoom fuer jeden fit-Modus
 * dasselbe Verhalten und es gibt keine Sonderfaelle.
 */
function computeDestRect(fit, sw, sh, slotW, slotH, zoom, offX, offY, dest, warn, scale = 1) {
  let w;
  let h;
  let cx = slotW / 2;
  let cy = slotH / 2;

  switch (fit) {
    case 'contain': {
      const r = Math.min(slotW / sw, slotH / sh);
      w = sw * r;
      h = sh * r;
      break;
    }
    case 'stretch': {
      w = slotW;
      h = slotH;
      break;
    }
    case 'native': {
      w = sw * scale;
      h = sh * scale;
      break;
    }
    case 'manual': {
      if (!dest || !(dest.w > 0) || !(dest.h > 0)) {
        // defaultTransform() liefert dest = {0,0,0,0}. Woertlich uebernommen
        // waere das ein Rechteck der Groesse 0 — also lieber cover und warnen.
        warn('fit=manual ohne gueltiges dest-Rechteck — es wird cover benutzt.');
        const r = Math.max(slotW / sw, slotH / sh);
        w = sw * r;
        h = sh * r;
        break;
      }
      w = dest.w;
      h = dest.h;
      cx = dest.x + dest.w / 2;
      cy = dest.y + dest.h / 2;
      break;
    }
    case 'cover':
    default: {
      const r = Math.max(slotW / sw, slotH / sh);
      w = sw * r;
      h = sh * r;
      break;
    }
  }

  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  w *= z;
  h *= z;
  cx += offX;
  cy += offY;

  const dw = evenRound(w);
  const dh = evenRound(h);
  return { x: Math.round(cx - dw / 2), y: Math.round(cy - dh / 2), w: dw, h: dh };
}

/* ==========================================================================
 * buildWallGraph
 * ========================================================================== */

/**
 * @param {object} project  Projekt aus shared/model.js
 * @param {object} venue    Venue-JSON aus config/venues/
 * @param {string} wallId   'A' | 'B' | 'C' | 'D'
 * @param {object} opts     { alpha, forPanels, rangeSec, scale, pixFmt }
 * @returns {{inputs:Array, filterComplex:string, map:string, panelMaps:Array,
 *            frames:number, warnings:string[], notes:string[], meta:object}}
 */
export function buildWallGraph(project, venue, wallId, opts = {}) {
  const o = {
    alpha: false,
    forPanels: false,
    rangeSec: null,
    scale: 1,
    pixFmt: null,
    ...opts,
  };

  const warnings = [];
  const notes = [];
  const warn = (msg) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };

  const wallSpec = getWallSpec(venue, wallId);

  let wallState = project?.walls?.[wallId];
  if (!wallState) {
    // Kein Absturz: eine fehlende Wand rendert schwarz und meldet das laut.
    warn(`Wand ${wallId} fehlt im Projekt — es wird nur die schwarze Basisflaeche gerendert.`);
    wallState = { id: wallId, slots: {}, visible: true };
  }

  const fps = Number(project?.fps) > 0 ? Number(project.fps) : Number(venue.fps) || 30;
  const loopSeconds = Number(project?.loopSeconds) > 0 ? Number(project.loopSeconds) : 20;
  const range = normalizeRange(o.rangeSec, loopSeconds);
  const t0 = range ? range.startSec : 0;
  const t1 = range ? range.endSec : loopSeconds;
  const duration = Math.max(1 / fps, t1 - t0);

  // Framezahl: fuer den ganzen Loop gilt die Regel aus dem Modell
  // (dropDuplicateEndFrame), fuer einen Ausschnitt einfach Dauer x fps.
  const frames = range
    ? Math.max(1, Math.round(duration * fps))
    : Math.max(1, targetFrameCount(project));

  const S = Number(o.scale) > 0 ? Number(o.scale) : 1;
  const px = (v) => Math.round(v * S);

  const W = evenRound(wallSpec.width * S);
  const H = evenRound(wallSpec.height * S);

  /* -- Basisflaeche ------------------------------------------------------- */

  // Ein Frame Reserve: -frames:v schneidet ohnehin exakt, aber so kann es nie
  // passieren, dass die lavfi-Quelle einen Frame zu frueh endet.
  const baseDurSec = (frames + 1) / fps;
  const baseColor = o.alpha ? 'black@0.0' : ffColor(project?.background, 'black');

  const inputs = [
    {
      args: [
        '-f',
        'lavfi',
        '-i',
        `color=c=${baseColor}:s=${W}x${H}:r=${num(fps, 5)}:d=${num(baseDurSec, 5)}`,
      ],
      mediaId: null,
      label: '0:v',
      kind: 'base',
    },
  ];

  const chains = [];

  // Der lavfi-color-Filter liefert je nach Aushandlung keinen Alphakanal.
  // format=rgba erzwingt ihn; colorchannelmixer=aa=0 macht die Basis dann
  // wirklich durchsichtig (c=black@0.0 allein reicht nicht zuverlaessig aus,
  // weil die Quelle auch als yuv420p aushandeln kann und Alpha verloren geht).
  chains.push(
    o.alpha ? '[0:v]format=rgba,colorchannelmixer=aa=0[base]' : '[0:v]format=rgba[base]'
  );

  notes.push(
    `Basisflaeche ${W}x${H} @ ${num(fps, 3)} fps, ${o.alpha ? 'transparent' : `Farbe ${baseColor}`}, ${num(baseDurSec, 3)} s.`
  );

  /* -- Layer einsammeln --------------------------------------------------- */

  const entries = wallLayersInOrder(wallState, wallSpec);

  // Vorabdurchlauf: pro Slot merken, welcher Layer der jeweils NAECHSTE ist.
  // Das brauchen wir fuer Uebergaenge (der abgehende Layer muss ausblenden).
  const nextInSlot = new Map(); // layer.id -> naechster Layer im selben Slot
  const bySlot = new Map();
  for (const e of entries) {
    if (!bySlot.has(e.slot.id)) bySlot.set(e.slot.id, []);
    bySlot.get(e.slot.id).push(e);
  }
  for (const list of bySlot.values()) {
    for (let i = 0; i < list.length - 1; i += 1) {
      nextInSlot.set(list[i].layer.id, list[i + 1].layer);
    }
  }

  let prevLabel = 'base';
  let compositeCount = 0;
  let inputIndex = 0; // 0 ist die Basis
  let layerNo = 0;
  const panelMaps = [];

  for (const { slot, layer } of entries) {
    const media = findMedia(project, layer.mediaId);
    if (!media) {
      warn(
        `${wallId}/${slot.id}: Layer "${layer.label || layer.id}" verweist auf eine Datei, die nicht mehr in der Bibliothek ist — Layer wird uebersprungen.`
      );
      continue;
    }
    if (!media.absPath) {
      warn(`${wallId}/${slot.id}: "${media.name}" hat keinen Dateipfad — Layer wird uebersprungen.`);
      continue;
    }

    const tr = mergeTransform(layer.transform);
    const fl = mergeFilters(layer.filters);
    const tm = mergeTime(layer.time);

    const probe = media.probe || null;
    const isStill = media.kind === 'image';
    const isSequence = media.kind === 'sequence';

    if (!probe) {
      warn(
        `${media.name}: Datei wurde noch nicht analysiert — Groesse und Dauer sind geraten. Bibliothek neu einlesen.`
      );
    } else if (!isStill && Math.abs((probe.fps || fps) - fps) > 0.01) {
      warn(
        `${media.name} laeuft mit ${num(probe.fps, 3)} fps, gerendert wird mit ${num(fps, 3)} fps — ffmpeg gleicht das stumm an. Besser vorher im Reiter Conform angleichen.`
      );
    }

    /* ---- Zeitfenster ---------------------------------------------------- */

    const speed = Number(tm.speed) > 0 ? Number(tm.speed) : 1;
    const srcDur = Number(probe?.durationSec) > 0 ? Number(probe.durationSec) : 0;
    const inSec = Math.max(0, Number(tm.inSec) || 0);

    let outSec;
    if (tm.outSec != null) outSec = Math.max(inSec, Number(tm.outSec));
    else if (isStill) outSec = null; // Standbild hat keine eigene Dauer
    else outSec = srcDur > 0 ? srcDur : null;

    const startSec = Math.max(0, Number(tm.startSec) || 0);

    // Ende im Loop
    let endSec;
    if (tm.loop) endSec = loopSeconds;
    else if (outSec == null) endSec = loopSeconds; // Standbild / unbekannte Dauer
    else endSec = startSec + (outSec - inSec) / speed;
    endSec = Math.min(endSec, loopSeconds);

    // Schnittmenge mit dem gerenderten Bereich
    const visStart = Math.max(startSec, t0);
    const visEnd = Math.min(endSec, t1);
    if (visEnd - visStart <= 1 / (2 * fps)) {
      if (range) {
        // Kein Fehler — der Layer liegt schlicht ausserhalb des Ausschnitts.
        notes.push(
          `Layer "${layer.label || media.name}" liegt ausserhalb des gerenderten Bereichs und faellt weg.`
        );
      } else {
        warn(
          `${wallId}/${slot.id}: Layer "${layer.label || media.name}" hat keine Laufzeit im Loop und wird uebersprungen.`
        );
      }
      continue;
    }

    const tlStart = visStart - t0; // Startzeit in der Ausgabe
    const tlEnd = visEnd - t0;
    const tlDur = tlEnd - tlStart;

    // Wieviel muss in der QUELLE zusaetzlich uebersprungen werden, wenn der
    // gerenderte Bereich mitten im Layer beginnt?
    const srcSkip = (visStart - startSec) * speed;
    const trimStart = inSec + srcSkip;
    const trimEnd = outSec == null ? null : Math.min(outSec, trimStart + tlDur * speed);

    if (tm.loop && (inSec > 0 || tm.outSec != null)) {
      warn(
        `${media.name}: In-/Out-Punkt wird bei aktivem Loop ignoriert. ffmpeg wiederholt die Datei per -stream_loop immer von vorn.`
      );
    }

    /* ---- Input ---------------------------------------------------------- */

    inputIndex += 1;
    layerNo += 1;
    const n = layerNo;
    const args = [];

    if (isStill) {
      // Standbild: unendlich wiederholen, Framerate der Ausgabe erzwingen.
      args.push('-loop', '1', '-framerate', num(fps, 5));
    } else if (isSequence) {
      args.push('-framerate', num(fps, 5));
      const startNumber = media.startNumber ?? probe?.startNumber ?? null;
      if (startNumber != null) args.push('-start_number', String(startNumber));
      if (tm.loop) args.push('-stream_loop', '-1');
    } else if (tm.loop) {
      args.push('-stream_loop', '-1');
    }
    args.push('-i', media.absPath);

    inputs.push({ args, mediaId: media.id, label: `${inputIndex}:v`, kind: media.kind || 'video' });

    /* ---- Kette ---------------------------------------------------------- */

    let inLabel = `${inputIndex}:v`;
    let cur = [];
    /** Teilkette abschliessen und Label weiterreichen. */
    const emit = (outLabel) => {
      chains.push(`[${inLabel}]${cur.length ? cur.join(',') : 'null'}[${outLabel}]`);
      inLabel = outLabel;
      cur = [];
    };

    // a) + b) Zeit ---------------------------------------------------------
    if (tm.loop) {
      // -stream_loop liefert fortlaufende Zeitstempel ueber alle Durchlaeufe.
      // Ein Ausschnitt muss deshalb in diesem Stream an srcSkip beginnen,
      // sonst zeigt jedes Standbild wieder Frame 0. Die Dauer bezieht sich
      // auf den sichtbaren Bereich, nicht auf das Ende der ersten Quelldatei.
      cur.push(
        `trim=start=${num(srcSkip, 4)}:duration=${num(tlDur * speed, 4)}`,
        'setpts=PTS-STARTPTS'
      );
    } else if (isStill) {
      cur.push(`trim=duration=${num(tlDur * speed, 4)}`, 'setpts=PTS-STARTPTS');
    } else {
      const tp = [];
      if (trimStart > 0) tp.push(`start=${num(trimStart, 4)}`);
      if (trimEnd != null) tp.push(`end=${num(trimEnd, 4)}`);
      if (tp.length) cur.push(`trim=${tp.join(':')}`);
      cur.push('setpts=PTS-STARTPTS');
    }
    if (speed !== 1) {
      // setpts=PTS/speed: speed 2 = doppelt so schnell.
      cur.push(`setpts=PTS/${num(speed, 5)}`);
    }

    // c) Crop aus der Quelle ----------------------------------------------
    // Pixelgenau beschneiden: YUV420 rundet ungerade Crop-Positionen/Groessen
    // auf das Chroma-Raster. RGB bewahrt die im Editor gewaehlten Pixel und
    // verhindert Verschiebungen an Panelnaht und Slotkante.
    cur.push('format=rgba');
    let sw = Number(probe?.width) > 0 ? Number(probe.width) : 0;
    let sh = Number(probe?.height) > 0 ? Number(probe.height) : 0;

    if (tr.crop && tr.crop.w > 0 && tr.crop.h > 0) {
      const cx = Math.max(0, Math.round(tr.crop.x || 0));
      const cy = Math.max(0, Math.round(tr.crop.y || 0));
      let cw = Math.round(tr.crop.w);
      let ch = Math.round(tr.crop.h);
      if (sw > 0 && cx + cw > sw) {
        cw = sw - cx;
        warn(`${media.name}: Crop ragt rechts aus der Quelle heraus und wurde auf ${cw} px gekuerzt.`);
      }
      if (sh > 0 && cy + ch > sh) {
        ch = sh - cy;
        warn(`${media.name}: Crop ragt unten aus der Quelle heraus und wurde auf ${ch} px gekuerzt.`);
      }
      if (cw > 0 && ch > 0) {
        cur.push(`crop=${int(cw)}:${int(ch)}:${int(cx)}:${int(cy)}`);
        sw = cw;
        sh = ch;
      }
    }

    // d) Orientierung ------------------------------------------------------
    const rot = ((Math.round(Number(tr.rotate) || 0) % 360) + 360) % 360;
    if (rot === 90) cur.push('transpose=1');
    else if (rot === 180) cur.push('transpose=1', 'transpose=1');
    else if (rot === 270) cur.push('transpose=2');
    else if (rot !== 0) {
      warn(
        `${media.name}: Drehung ${rot} Grad wird nicht unterstuetzt (nur 0/90/180/270) und ignoriert.`
      );
    }
    if (rot === 90 || rot === 270) {
      const t = sw;
      sw = sh;
      sh = t;
    }
    if (tr.flipH) cur.push('hflip');
    if (tr.flipV) cur.push('vflip');

    // e) Skalierung --------------------------------------------------------
    // Slotmasse im Zielraster. Die Kanten werden ueber px() abgeleitet, damit
    // benachbarte Panels bei scale != 1 exakt aneinanderstossen.
    const slotX = px(slot.x || 0);
    const slotW = Math.max(2, px((slot.x || 0) + slot.width) - slotX);
    const slotH = Math.max(2, px(slot.height));

    if (sw <= 0 || sh <= 0) {
      // Ohne Probe kennen wir die Quellgroesse nicht — Slotgroesse annehmen.
      sw = slotW;
      sh = slotH;
    }

    const destRect = computeDestRect(
      tr.fit,
      sw,
      sh,
      slotW,
      slotH,
      tr.zoom,
      px(tr.offset.x || 0),
      px(tr.offset.y || 0),
      tr.dest && tr.dest.w > 0
        ? { x: px(tr.dest.x), y: px(tr.dest.y), w: px(tr.dest.w), h: px(tr.dest.h) }
        : null,
      warn,
      S
    );

    if (destRect.w !== sw || destRect.h !== sh) {
      cur.push(`scale=${int(destRect.w)}:${int(destRect.h)}:flags=lanczos`);
    }
    // Ohne setsar=1 kann overlay/blend an unterschiedlichen Pixelseitenverhaelt-
    // nissen scheitern ("input link parameters do not match").
    cur.push('setsar=1');

    // Beschnitt auf das Slotrechteck.
    // WICHTIG: das ist kein Schoenheitsfehler, sondern Pflicht. Ohne diesen
    // Schnitt wuerde ein Layer, der in einem Panel-Slot liegt, per overlay ins
    // NACHBARPANEL hineinragen. Er erledigt gleichzeitig den Ueberstand bei
    // fit=cover, bei zoom > 1 und bei negativen Offsets.
    const visX = Math.max(0, destRect.x);
    const visY = Math.max(0, destRect.y);
    const visR = Math.min(slotW, destRect.x + destRect.w);
    const visB = Math.min(slotH, destRect.y + destRect.h);
    const visW = visR - visX;
    const visH = visB - visY;

    if (visW <= 0 || visH <= 0) {
      warn(
        `${wallId}/${slot.id}: Layer "${layer.label || media.name}" liegt vollstaendig ausserhalb des Slots und wird uebersprungen.`
      );
      // Input wieder zuruecknehmen, sonst stimmen die Indizes nicht mehr.
      inputs.pop();
      inputIndex -= 1;
      layerNo -= 1;
      continue;
    }

    if (visW !== destRect.w || visH !== destRect.h) {
      cur.push(
        `crop=${int(visW)}:${int(visH)}:${int(visX - destRect.x)}:${int(visY - destRect.y)}`
      );
    }

    const placeX = slotX + visX;
    const placeY = visY;

    // f) + g) Farbe und Dither in der gesicherten Zone ---------------------
    const zone = [];
    const eqParts = [];
    if (fl.brightness !== 0) eqParts.push(`brightness=${num(fl.brightness, 4)}`);
    if (fl.contrast !== 1) eqParts.push(`contrast=${num(fl.contrast, 4)}`);
    if (fl.saturation !== 1) eqParts.push(`saturation=${num(fl.saturation, 4)}`);
    if (fl.gamma !== 1) eqParts.push(`gamma=${num(fl.gamma, 4)}`);
    if (eqParts.length) zone.push(`eq=${eqParts.join(':')}`);
    if (fl.hueDeg) zone.push(`hue=h=${num(fl.hueDeg, 3)}`);

    if (fl.dither) {
      // Warum Rauschen gegen Banding hilft:
      // Ein Gradient wird beim Quantisieren auf 8 Bit in Stufen zerlegt; die
      // Kanten dieser Stufen sieht das Auge als Streifen (Banding). Feines
      // Rauschen VOR der Quantisierung verschiebt einzelne Pixel zufaellig
      // ueber die Stufengrenze. Ueber Flaeche und Zeit gemittelt entsteht so
      // ein Zwischenwert, den 8 Bit gar nicht darstellen koennen — die harte
      // Kante loest sich in Korn auf. allf=t+u: t = pro Frame neues Muster
      // (temporal, das Auge integriert ueber mehrere Frames), u = gleich-
      // verteilt statt gauss (billiger und hier voellig ausreichend).
      // alls=2 ist bewusst sehr schwach — auf einer 4-mm-LED-Wand ist mehr
      // sofort als Grieseln sichtbar.
      zone.push('noise=alls=2:allf=t+u');
    }

    const srcHasAlpha = Boolean(probe?.hasAlpha);
    if (zone.length) {
      if (srcHasAlpha) {
        // eq, hue und noise koennen kein Alpha. Ohne diesen Umweg wuerde
        // ffmpeg stillschweigend nach yuv wandeln und der Alphakanal der
        // Quelle waere weg. Also: Alpha abzweigen, Farbe rechnen, Alpha
        // wieder anheften.
        cur.push('format=rgba');
        emit(`g${n}s`);
        chains.push(`[g${n}s]split=2[g${n}c][g${n}a]`);
        chains.push(`[g${n}a]alphaextract[g${n}am]`);
        chains.push(`[g${n}c]${zone.join(',')}[g${n}cc]`);
        chains.push(`[g${n}cc][g${n}am]alphamerge[g${n}o]`);
        inLabel = `g${n}o`;
      } else {
        cur.push(...zone);
      }
    }

    // Ab hier laeuft alles mit Alphakanal.
    cur.push('format=rgba');

    // blackLift ------------------------------------------------------------
    // Entscheidung: lutrgb statt eq=brightness.
    // eq=brightness verschiebt die GESAMTE Kurve, also auch Weiss — das
    // clippt die Spitzlichter. Fuer die LED-Simulation wollen wir aber nur
    // den Schwarzpunkt anheben (Absen-Panels heben Schwarz an) und Weiss
    // stehen lassen. Die Abbildung val -> (val + L*255)/(1 + L) haelt
    // 255 auf 255 fest und hebt 0 auf L*255/(1+L). Negatives L druckt
    // Schwarz entsprechend nach unten. lutrgb baut die Tabelle einmal auf
    // und ist danach praktisch gratis; Alpha bleibt unberuehrt.
    if (fl.blackLift) {
      const L = clamp(Number(fl.blackLift) || 0, -0.9, 0.9);
      const expr = `clip((val+${num(L * 255, 3)})/${num(1 + L, 5)},0,255)`;
      cur.push(`lutrgb=r='${expr}':g='${expr}':b='${expr}'`);
    }

    if (fl.blurPx > 0) {
      // gblur=sigma: Faustregel Radius ~ 3*sigma, der Nutzer denkt in Pixeln.
      cur.push(`gblur=sigma=${num((Number(fl.blurPx) * S) / 3, 4)}`);
    }

    // h) Feather -----------------------------------------------------------
    const fe = {
      l: Math.max(0, Math.round((Number(fl.feather.l) || 0) * S)),
      r: Math.max(0, Math.round((Number(fl.feather.r) || 0) * S)),
      t: Math.max(0, Math.round((Number(fl.feather.t) || 0) * S)),
      b: Math.max(0, Math.round((Number(fl.feather.b) || 0) * S)),
    };
    if (fe.l || fe.r || fe.t || fe.b) {
      const terms = [];
      if (fe.l) terms.push(`min(1,X/${int(fe.l)})`);
      if (fe.r) terms.push(`min(1,(W-1-X)/${int(fe.r)})`);
      if (fe.t) terms.push(`min(1,Y/${int(fe.t)})`);
      if (fe.b) terms.push(`min(1,(H-1-Y)/${int(fe.b)})`);
      // min() nimmt genau zwei Argumente -> von Hand verschachteln.
      let factor = terms[0];
      for (let i = 1; i < terms.length; i += 1) factor = `min(${factor},${terms[i]})`;

      cur.push(
        `geq=r='p(X,Y)':g='p(X,Y)':b='p(X,Y)':a='alpha(X,Y)*${factor}'`
      );

      if (visW * visH > 2_000_000) {
        warn(
          `${wallId}/${slot.id}: weiche Kante auf ${visW}x${visH} px (${num((visW * visH) / 1e6, 1)} MPixel). geq rechnet pro Pixel im Ausdruck-Interpreter — das kostet spuerbar Renderzeit.`
        );
      }
    }

    // Uebergaenge ----------------------------------------------------------
    // Entscheidung gegen echtes xfade:
    // xfade verschmilzt ZWEI Streams zu einem, verlangt identische Groesse und
    // Framerate und kennt nur genau eine Blende. Unser Modell erlaubt beliebig
    // viele Layer pro Slot mit unterschiedlichen Zielrechtecken — das liesse
    // sich nur mit einem zweiten, voellig anderen Graphenzweig abbilden.
    // Deshalb wird der Uebergang als ALPHAVERLAUF auf beiden beteiligten
    // Layern umgesetzt (fade=alpha=1). Das Ergebnis ist bei ueberlappenden
    // Zeiten optisch eine Kreuzblende, bleibt aber im overlay-Modell.
    // Die Zeiten sind hier layer-lokal (der Stream beginnt bei 0), weil der
    // zeitliche Versatz erst danach per tpad kommt.
    const trans = tm.transition || {};
    const inDur = trans.durSec > 0 && trans.type && trans.type !== 'cut' ? Number(trans.durSec) : 0;
    // Die Fade-Uhr bleibt relativ zum urspruenglichen Layer. Ein Standbild
    // mitten im Layer darf die Blende nicht erneut bei Schwarz beginnen.
    const layerElapsed = visStart - startSec;
    const layerDuration = endSec - startSec;
    if (layerElapsed > 0) cur.push(`setpts=PTS+${num(layerElapsed, 4)}/TB`);
    if (inDur > 0) {
      const d = Math.min(inDur, layerDuration);
      const alphaFade = trans.type === 'fadeblack' ? '' : ':alpha=1';
      cur.push(`fade=t=in:st=0:d=${num(d, 4)}${alphaFade}`);
    }
    const nxt = nextInSlot.get(layer.id);
    const nxtTime = nxt ? mergeTime(nxt.time) : null;
    const nxtTrans = nxtTime ? nxtTime.transition : null;
    if (nxtTrans && nxtTrans.type && nxtTrans.type !== 'cut' && nxtTrans.durSec > 0) {
      // Nur ausblenden, wenn der naechste Layer wirklich anschliesst oder
      // ueberlappt. Liegt dazwischen eine Luecke, waere ein Ausblenden nur
      // ein ungewolltes Dunkelwerden am Ende.
      const d = Math.min(Number(nxtTrans.durSec), layerDuration);
      if ((Number(nxtTime.startSec) || 0) < endSec + d) {
        const alphaFade = nxtTrans.type === 'fadeblack' ? '' : ':alpha=1';
        cur.push(`fade=t=out:st=${num(Math.max(0, layerDuration - d), 4)}:d=${num(d, 4)}${alphaFade}`);
      }
    }
    if (layerElapsed > 0) cur.push(`setpts=PTS-${num(layerElapsed, 4)}/TB`);

    // i) Deckkraft ---------------------------------------------------------
    const opacity = clamp(Number(fl.opacity ?? 1), 0, 1);
    if (opacity < 1) cur.push(`colorchannelmixer=aa=${num(opacity, 4)}`);

    /* ---- Zeitlicher Versatz --------------------------------------------- */

    const blend = layer.blend || 'normal';
    // Neutrale Farbe der Fuellflaeche: bei multiply ist WEISS das neutrale
    // Element (x*255/255 = x), bei allen anderen Modi Schwarz.
    const neutral = blend === 'multiply' ? 'white@0.0' : 'black@0.0';

    if (tlStart > 1 / (2 * fps)) {
      // tpad schiebt den Layer auf seine Startzeit. Warum nicht nur enable?
      // enable blendet den overlay nur aus — der Layerstream laeuft trotzdem
      // ab t=0 mit. Bei enable-Start wuerde also nicht Frame 0 des Layers
      // erscheinen, sondern der Frame an dieser Stelle. tpad erzeugt statt-
      // dessen echte (transparente) Vorlauf-Frames, damit die Quelle wirklich
      // erst bei startSec mit ihrem ersten Bild anfaengt.
      // tpad steht bewusst am ENDE der Kette: so laufen die Fuellframes nicht
      // durch scale/geq und kosten fast nichts.
      cur.push(`tpad=start_duration=${num(tlStart, 4)}:start_mode=add:color=${neutral}`);
    }

    emit(`v${n}`);

    /* ---- Zusammensetzen -------------------------------------------------- */

    compositeCount += 1;
    const outLabel = `o${compositeCount}`;

    // enable nur setzen, wenn der Layer NICHT den ganzen Bereich abdeckt.
    const coversAll = tlStart <= 1 / (2 * fps) && tlEnd >= duration - 1 / (2 * fps);
    const enable = coversAll ? '' : `:enable='between(t,${num(tlStart, 4)},${num(tlEnd, 4)})'`;

    if (blend === 'normal') {
      chains.push(
        `[${prevLabel}][${inLabel}]overlay=x=${int(placeX)}:y=${int(placeY)}:eof_action=pass:format=auto${enable}[${outLabel}]`
      );
    } else {
      const mode =
        blend === 'add' ? 'addition' : blend === 'screen' ? 'screen' : blend === 'multiply' ? 'multiply' : null;
      if (!mode) {
        warn(`Unbekannter Blendmodus "${blend}" — es wird normal (overlay) benutzt.`);
        chains.push(
          `[${prevLabel}][${inLabel}]overlay=x=${int(placeX)}:y=${int(placeY)}:eof_action=pass:format=auto${enable}[${outLabel}]`
        );
      } else {
        // blend rechnet Pixel gegen Pixel und verlangt deshalb ZWEI GLEICH
        // GROSSE Eingaenge — anders als overlay, das ein kleines Bild an eine
        // Position setzen kann. Darum muss der Layer erst per pad auf die
        // volle Wandgroesse gebracht werden; die Fuellflaeche bekommt die fuer
        // den Modus neutrale Farbe, sonst wuerde sie den Rest der Wand
        // veraendern (bei multiply mit Schwarz waere die ganze Wand schwarz).
        // WICHTIG: blend rechnet Ebene gegen Ebene und sieht den Alphakanal
        // nicht an. Deckkraft (colorchannelmixer=aa=), weiche Kante (geq auf
        // dem Alphakanal) und die Ein-/Ausblendungen (fade=:alpha=1) schreiben
        // aber AUSSCHLIESSLICH ins Alpha. Ohne Gegenmassnahme landet ein Layer
        // mit Deckkraft 0,8 zu 100 % auf der Wand und eine weiche Kante an
        // einer Panelnaht wird zur harten Kante — auf 4-mm-LED gut sichtbar.
        //
        // premultiply rechnet das Alpha in die Farbwerte hinein. Fuer addition
        // und screen ist Schwarz das neutrale Element: was durchsichtig ist,
        // wird schwarz und traegt damit nichts bei. Genau das ist gewollt.
        if (mode === 'multiply') {
          // Bei multiply ist Weiss neutral, premultiply wuerde also abdunkeln
          // statt auszublenden. Lieber ehrlich warnen als still falsch rendern.
          if (opacity < 1 || fe.l || fe.r || fe.t || fe.b || tlStart > 0 || tlEnd < duration) {
            warn(
              `Layer ${n} ("${layer.label || media.name}"): bei Blendmodus "multiply" wirken Deckkraft, ` +
                'weiche Kante und Uebergaenge NICHT. ffmpeg wertet beim Mischen keinen Alphakanal aus. ' +
                'Wenn du die Deckkraft brauchst, nimm Blendmodus "normal" oder rechne sie in die Quelle.'
            );
          }
          chains.push(
            `[${inLabel}]pad=${int(W)}:${int(H)}:${int(placeX)}:${int(placeY)}:color=${neutral}[bp${n}]`
          );
        } else {
          chains.push(
            `[${inLabel}]premultiply=inplace=1,pad=${int(W)}:${int(H)}:${int(placeX)}:${int(placeY)}:color=${neutral}[bp${n}]`
          );
        }
        // c3_mode=addition haelt den Alphakanal ausserhalb des Layerrechtecks
        // unveraendert (base_a + 0 = base_a) und macht ihn innerhalb deckend.
        // repeatlast=0: wenn der Layerstream endet, laeuft die Basis unver-
        // aendert weiter, statt den letzten Layerframe einzufrieren.
        // Kein enable: ob blend Timeline-Editing unterstuetzt, ist nicht
        // garantiert, und ein Fehlschlag waere ein harter Abbruch. Start und
        // Ende regeln stattdessen tpad und repeatlast.
        const c3 = mode === 'multiply' ? ':c3_mode=addition' : '';
        chains.push(
          `[${prevLabel}][bp${n}]blend=all_mode=${mode}${c3}:shortest=0:repeatlast=0[${outLabel}]`
        );
      }
    }

    prevLabel = outLabel;

    notes.push(
      `Layer ${n}: "${layer.label || media.name}" in Slot ${slot.id} — Quelle ${sw}x${sh} -> ${destRect.w}x${destRect.h} (fit=${tr.fit}${tr.zoom !== 1 ? `, zoom ${num(tr.zoom, 2)}` : ''}), sichtbar ${visW}x${visH} px an x=${placeX} y=${placeY}, Zeit ${num(tlStart, 2)}–${num(tlEnd, 2)} s, Blend ${blend}${opacity < 1 ? `, Deckkraft ${num(opacity, 2)}` : ''}.`
    );
  }

  if (compositeCount === 0) {
    // Ausdruecklich erlaubter Fall: gueltiger Graph, nur die Basisflaeche.
    notes.push('Kein aktiver Layer auf dieser Wand — es wird nur die Basisflaeche ausgegeben.');
  }

  /* -- Abschluss ---------------------------------------------------------- */

  // Bei alpha=false wird das Zielpixelformat normalerweise NICHT hier gesetzt,
  // sondern von deliver.js ueber -pix_fmt am Encoder (yuv422p10le fuer ProRes,
  // rgb24/rgba fuer HAP). Nur wenn opts.pixFmt ausdruecklich gesetzt ist,
  // erzwingt der Graph es selbst.
  const finalFilter = o.alpha ? 'format=rgba' : o.pixFmt ? `format=${o.pixFmt}` : 'null';

  let map = '[out]';
  if (o.forPanels) {
    const panels = wallSpec.panels || [];
    // split liefert n+1 Ausgaenge: einmal die ganze Wand ([out]) und je einen
    // Zweig pro Panel. So kann ein einziger ffmpeg-Lauf Master und Einzelteile
    // gleichzeitig schreiben.
    const qLabels = panels.map((_, i) => `q${i + 1}`);
    chains.push(
      `[${prevLabel}]${finalFilter},split=${panels.length + 1}[out]${qLabels.map((q) => `[${q}]`).join('')}`
    );
    panels.forEach((p, i) => {
      const pxLeft = px(p.x);
      const pxRight = i === panels.length - 1 ? W : px(p.x + p.width);
      const pw = Math.max(2, pxRight - pxLeft);
      if (pw % 4 !== 0 || H % 4 !== 0) {
        warn(
          `Panel ${p.id} ergibt ${pw}x${H} px — nicht durch 4 teilbar. HAP verlangt Vielfache von 4, das schlaegt beim Encoden fehl.`
        );
      }
      chains.push(`[${qLabels[i]}]crop=${int(pw)}:${int(H)}:${int(pxLeft)}:0[p${i + 1}]`);
      panelMaps.push({ id: p.id, label: `[p${i + 1}]`, width: pw, height: H, x: pxLeft });
    });
    notes.push(
      `Panel-Ausschnitte: ${panelMaps.map((p) => `${p.id} ${p.width}x${p.height} @ x=${p.x}`).join(', ')}.`
    );
  } else {
    chains.push(`[${prevLabel}]${finalFilter}[out]`);
  }

  const filterComplex = chains.join(';');

  // Selbstkontrolle: jedes Label genau einmal erzeugt und einmal verbraucht.
  const labelProblems = checkLabels(filterComplex, map, panelMaps);
  for (const p of labelProblems) warn(`Interner Fehler im Filtergraph: ${p}`);

  return {
    inputs,
    filterComplex,
    map,
    panelMaps,
    frames,
    warnings,
    notes,
    meta: {
      wallId,
      width: W,
      height: H,
      fps,
      durationSec: duration,
      rangeSec: range,
      alpha: Boolean(o.alpha),
      scale: S,
      layerCount: compositeCount,
      pixFmt: o.pixFmt || null,
      loopSeconds,
    },
  };
}

/**
 * Prueft die Label-Bilanz des erzeugten Graphen. Rein defensiv — schlaegt nur
 * an, wenn oben etwas kaputt ist. Lieber eine deutliche Warnung als ein
 * kryptischer ffmpeg-Fehler nach zwei Minuten Rendern.
 */
function checkLabels(filterComplex, map, panelMaps) {
  const problems = [];
  const produced = new Map();
  const consumed = new Map();

  for (const chain of filterComplex.split(';')) {
    // Fuehrende [x] sind Eingaenge, abschliessende [y] sind Ausgaenge.
    const ins = chain.match(/^(\[[^\]]+\])+/);
    const outs = chain.match(/(\[[^\]]+\])+$/);
    if (ins) {
      for (const m of ins[0].match(/\[[^\]]+\]/g) || []) {
        const l = m.slice(1, -1);
        consumed.set(l, (consumed.get(l) || 0) + 1);
      }
    }
    if (outs) {
      for (const m of outs[0].match(/\[[^\]]+\]/g) || []) {
        const l = m.slice(1, -1);
        produced.set(l, (produced.get(l) || 0) + 1);
      }
    }
  }

  const finalLabels = new Set([map.replace(/[[\]]/g, ''), ...panelMaps.map((p) => p.label.replace(/[[\]]/g, ''))]);

  for (const [l, c] of produced) {
    if (c > 1) problems.push(`Label [${l}] wird ${c}x erzeugt.`);
    const used = consumed.get(l) || 0;
    if (used === 0 && !finalLabels.has(l)) problems.push(`Label [${l}] wird nie verbraucht.`);
    if (used > 1) problems.push(`Label [${l}] wird ${used}x verbraucht.`);
  }
  for (const [l] of consumed) {
    if (/^\d+:v$/.test(l)) continue; // Datei-Eingaenge
    if (!produced.has(l)) problems.push(`Label [${l}] wird benutzt, aber nie erzeugt.`);
  }
  return problems;
}

/* ==========================================================================
 * graphToCommand
 * ========================================================================== */

/**
 * Baut das vollstaendige Argumentarray fuer ffmpeg.
 *
 * Das Array enthaelt das Programm SELBST NICHT — spawn() bekommt den Pfad
 * getrennt. ffmpegPath wird nur fuer die lesbare Anzeige durchgereicht
 * (siehe formatCommandLine).
 *
 * @param {object} graph  Rueckgabe von buildWallGraph
 * @param {object} opts
 *        ffmpegPath   nur fuer die Anzeige
 *        outArgs      Encoder-Argumente aus deliver.js
 *        outPath      Zieldatei
 *        fps          Ausgabeframerate
 *        progress     true -> -progress pipe:1 -nostats voranstellen
 *        extraOutputs [{ map, args, path }] fuer Mehrfachausgaben (Panels)
 */
export function graphToCommand(graph, opts = {}) {
  const { outArgs = [], outPath, fps, progress = false, extraOutputs = [] } = opts;
  const rate = Number(fps) > 0 ? Number(fps) : graph?.meta?.fps || 30;

  const args = ['-y', '-hide_banner', '-nostdin'];
  // -progress pipe:1 -nostats: maschinenlesbarer Fortschritt auf stdout,
  // stderr bleibt fuer die Logzeilen frei.
  if (progress) args.push('-progress', 'pipe:1', '-nostats');

  for (const inp of graph.inputs) args.push(...inp.args);

  args.push('-filter_complex', graph.filterComplex);
  args.push('-map', graph.map);
  args.push(...outArgs);

  const has = (flag) => outArgs.includes(flag);
  if (!has('-frames:v') && !has('-vframes')) args.push('-frames:v', String(graph.frames));
  if (!has('-r')) args.push('-r', num(rate, 5));
  if (!has('-fps_mode') && !has('-vsync')) args.push('-fps_mode', 'cfr');
  if (!has('-an')) args.push('-an'); // Ton gibt es hier grundsaetzlich nicht
  if (outPath) args.push(outPath);

  // Weitere Ausgaenge desselben Laufs (z.B. die vier Panels).
  for (const extra of extraOutputs) {
    args.push('-map', extra.map);
    args.push(...(extra.args || []));
    const eh = (flag) => (extra.args || []).includes(flag);
    if (!eh('-frames:v') && !eh('-vframes')) args.push('-frames:v', String(graph.frames));
    if (!eh('-r')) args.push('-r', num(rate, 5));
    if (!eh('-fps_mode') && !eh('-vsync')) args.push('-fps_mode', 'cfr');
    if (!eh('-an')) args.push('-an');
    args.push(extra.path);
  }

  return args;
}

/**
 * Argumentarray in eine kopierbare Kommandozeile verwandeln.
 * Nur zur Anzeige — ausgefuehrt wird immer das Array ohne Shell.
 * Alles, was nicht aus unbedenklichen Zeichen besteht, kommt in Anfuehrungs-
 * zeichen. Der filter_complex enthaelt einfache Anfuehrungszeichen, Klammern
 * und Semikolons und muss deshalb immer gequotet werden.
 */
export function formatCommandLine(ffmpegPath, args) {
  const safe = /^[-A-Za-z0-9_.:/\\=+%@]+$/;
  const q = (s) => {
    const str = String(s);
    if (safe.test(str)) return str;
    return `"${str.replace(/"/g, '\\"')}"`;
  };
  return [q(ffmpegPath || 'ffmpeg'), ...args.map(q)].join(' ');
}

/* ==========================================================================
 * explainGraph
 * ========================================================================== */

/**
 * Mehrzeiliger deutscher Klartext: was macht dieser Graph, Schritt fuer
 * Schritt. Wird im UI unter der Kommandozeile angezeigt, damit der Nutzer
 * die Pipeline nachvollziehen kann, ohne ffmpeg-Syntax zu lesen.
 */
export function explainGraph(graph) {
  if (!graph) return 'Kein Filtergraph vorhanden.';
  const m = graph.meta || {};
  const L = [];

  L.push(`Wand ${m.wallId ?? '?'} — ${m.width}x${m.height} Pixel, ${num(m.fps, 3)} fps`);
  L.push(
    `Ausgabe: ${graph.frames} Frames = ${num(m.durationSec, 3)} Sekunden${m.rangeSec ? ` (Ausschnitt ${num(m.rangeSec.startSec, 2)}–${num(m.rangeSec.endSec, 2)} s aus einem ${num(m.loopSeconds, 2)}-s-Loop)` : ' (kompletter Loop)'}`
  );
  L.push(
    `Farbe: intern rgba (fuer Deckkraft, weiche Kanten und Ueberblendungen), ` +
      (m.alpha
        ? 'Ergebnis MIT Alphakanal.'
        : m.pixFmt
          ? `Ergebnis als ${m.pixFmt}.`
          : 'Ergebnis ohne Alphakanal, das Zielpixelformat setzt der Encoder.')
  );
  if (m.scale && m.scale !== 1) L.push(`Massstab: ${num(m.scale, 3)} — das ist KEINE Delivery-Aufloesung.`);
  L.push('');

  L.push(`Eingaenge (${graph.inputs.length}):`);
  graph.inputs.forEach((inp, i) => {
    if (inp.kind === 'base') {
      L.push(`  [${i}] erzeugte Basisflaeche (lavfi color) — die leere Wand.`);
    } else {
      const file = inp.args[inp.args.length - 1];
      const flags = inp.args.slice(0, -2).join(' ');
      L.push(`  [${i}] ${file}${flags ? `   (${flags})` : ''}`);
    }
  });
  L.push('');

  L.push('Ablauf:');
  L.push('  1. Basisflaeche in Wandgroesse anlegen und nach rgba wandeln.');
  L.push(
    '  2. Pro Layer: Zeitfenster schneiden (trim/setpts) - Ausschnitt aus der Quelle (crop) -'
  );
  L.push(
    '     Drehen/Spiegeln - auf das Zielrechteck skalieren (lanczos) - auf den Slot beschneiden -'
  );
  L.push('     Farbe (eq/hue) - Dither - Schwarzwert (lutrgb) - weiche Kanten (geq) -');
  L.push('     Deckkraft - zeitlicher Versatz (tpad).');
  L.push('  3. Layer der Reihe nach auf das Zwischenbild legen (overlay bzw. blend).');
  L.push(
    `  4. Abschluss${graph.panelMaps.length ? ` und Aufteilen in ${graph.panelMaps.length} Panel-Ausschnitte` : ''}.`
  );
  L.push('');

  if (graph.notes && graph.notes.length) {
    L.push('Im Einzelnen:');
    for (const n of graph.notes) L.push(`  - ${n}`);
    L.push('');
  }

  if (graph.panelMaps && graph.panelMaps.length) {
    L.push('Panel-Ausgaenge:');
    for (const p of graph.panelMaps) {
      L.push(`  ${p.label}  ${p.id}: ${p.width}x${p.height} ab x=${p.x}`);
    }
    L.push('');
  }

  if (graph.warnings && graph.warnings.length) {
    L.push('Hinweise und Warnungen:');
    for (const w of graph.warnings) L.push(`  ! ${w}`);
  } else {
    L.push('Keine Warnungen.');
  }

  return L.join('\n');
}
