/**
 * Theater-Bild-Gelöte — Delivery.
 *
 * Reine Rechen- und Textarbeit, kein ffmpeg-Aufruf. Dieses Modul beantwortet
 * vier Fragen:
 *
 *   1. Mit welchen Encoder-Argumenten wird ausgegeben?      deliveryArgs()
 *   2. Wie heisst die Datei?                                 deliveryOutName()
 *   3. Wieviel Daten wird das?                               estimateDelivery()
 *   4. Was steht auf dem Lieferschein an den Kunden?         deliveryManifest()
 *
 * Alle Kanten- und Panelmasse kommen aus dem Venue-JSON. Hier wird nichts
 * geraten und nichts nachgerechnet, was dort schon steht.
 *
 * Nachbarmodule, die hier NICHT implementiert werden:
 *   ../../shared/model.js  -> deliveryName(), estimateSize(), formatBytes(),
 *                             targetFrameCount()
 */

import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  deliveryName,
  estimateSize,
  deliveryBytesPerPixel,
  formatBytes,
  targetFrameCount,
} from '../../shared/model.js';

/* ==========================================================================
 * Konstanten
 * ========================================================================== */

/**
 * Datenrate, ab der gewarnt wird. Der Christie Pandoras Box V8 im Theater muss
 * alle Flaechen gleichzeitig von Platte lesen; laut LED-SPECS liegt die Summe
 * ueber A/B/C/D/Holo in HAP bereits bei rund 231 MB/s. Das ist das Nadeloehr
 * der ganzen Produktion.
 */
export const DELIVERY_BUDGET_MB_PER_SEC = 200;

/**
 * Eingangs-Pixelformat fuer die HAP-Presets.
 *
 * ACHTUNG — bewusste Abweichung von der urspruenglichen Vorgabe "rgb24":
 * Der HAP-Encoder von ffmpeg (libavcodec/hapenc.c) deklariert als einziges
 * unterstuetztes Eingangsformat rgba, und zwar fuer hap, hap_q UND hap_alpha.
 * Mit "-pix_fmt rgb24" bricht ffmpeg mit
 *   "Specified pixel format rgb24 is invalid or not supported"
 * ab, also genau bei dem Preset, das ans Schiff geht. hap packt intern als
 * DXT1, hap_q als YCoCg-DXT5 ohne Bild-Alphakanal. Beide vermeiden dabei die
 * fuer klassische Videoformate typische Chroma-Unterabtastung.
 * Wer das doch auf rgb24 stellen will, aendert genau diese Tabelle.
 */
const HAP_PIX_FMT = {
  hap: 'rgba',
  hap_q: 'rgba',
  hap_alpha: 'rgba',
};

/** ProRes-Profile, die einen Alphakanal transportieren. */
const PRORES_ALPHA_PROFILES = new Set(['4', '4444', '5', '4444xq']);

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

/** Wert hinter einem Argument-Flag holen, z. B. argValue(args, '-c:v'). */
function argValue(args, flag) {
  if (!Array.isArray(args)) return null;
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

/** Zahl im deutschen Format, mit Komma. */
function de(n, digits = 1) {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits).replace('.', ',');
}

/** Naechstes Vielfaches von 4 nach oben. */
function up4(n) {
  return Math.ceil(n / 4) * 4;
}

/** Naechstes Vielfaches von 4 nach unten. */
function down4(n) {
  return Math.floor(n / 4) * 4;
}

/** Pipes in Markdown-Tabellenzellen entschaerfen. */
function cell(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v).replace(/\|/g, '\\|');
}

/** Zeitstempel als "29.07.2026, 14:05 Uhr" — bewusst ohne Intl, damit es ueberall gleich aussieht. */
function stampNow(d = new Date()) {
  const p2 = (x) => String(x).padStart(2, '0');
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}, ${p2(d.getHours())}:${p2(d.getMinutes())} Uhr`;
}

/**
 * SHA-256 einer Datei, blockweise gelesen.
 * Bewusst synchron, weil deliveryManifest() laut Vertrag synchron ist; die
 * 1-MB-Bloecke verhindern, dass eine 6-GB-Masterdatei in den Speicher faellt.
 */
export function sha256Sync(absPath) {
  const hash = createHash('sha256');
  const fd = openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let read = 0;
    while ((read = readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/* ==========================================================================
 * Presets
 * ========================================================================== */

/** Preset aus dem Venue holen oder mit einer brauchbaren Liste sterben. */
export function findDeliveryPreset(venue, presetId) {
  const list = venue?.delivery?.presets || [];
  const preset = list.find((p) => p.id === presetId);
  if (!preset) {
    const known = list.map((p) => p.id).join(', ') || '(keine)';
    throw new Error(
      `Delivery-Preset "${presetId}" gibt es im Venue "${venue?.id ?? '?'}" nicht. Bekannt sind: ${known}`
    );
  }
  return preset;
}

/** true, wenn das Preset auf den HAP-Encoder geht. */
function isHapPreset(preset) {
  return argValue(preset.args, '-c:v') === 'hap';
}

/**
 * Passendes Eingangs-Pixelformat, falls das Preset selbst keines mitbringt.
 * Gibt null zurueck, wenn wir keine begruendete Meinung haben — dann laesst
 * man ffmpeg entscheiden, statt etwas Falsches zu erzwingen.
 */
function defaultPixFmt(preset) {
  const codec = argValue(preset.args, '-c:v');
  if (codec === 'hap') {
    const format = argValue(preset.args, '-format') || 'hap';
    return HAP_PIX_FMT[format] || 'rgba';
  }
  if (codec === 'prores_ks' || codec === 'prores') {
    const profile = String(argValue(preset.args, '-profile:v') ?? '2');
    return PRORES_ALPHA_PROFILES.has(profile) ? 'yuva444p10le' : 'yuv422p10le';
  }
  return null;
}

/**
 * HAP-Kantenpruefung. HAP komprimiert in 4x4-Bloecken, krumme Kanten sind
 * schlicht nicht kodierbar. Die Fehlermeldung nennt den naechsten gueltigen
 * Wert, damit der Nutzer nicht selbst rechnen muss.
 */
function assertHapDimensions(width, height, preset) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error(
      `HAP-Preset "${preset.label || preset.id}": Breite und Höhe müssen bekannt sein, übergeben wurde ${width}×${height}.`
    );
  }
  const bad = [];
  if (w % 4 !== 0) {
    const down = down4(w);
    bad.push(
      `Breite ${w} px — nächster gültiger Wert nach oben: ${up4(w)} px${down > 0 ? `, nach unten: ${down} px` : ''}`
    );
  }
  if (h % 4 !== 0) {
    const down = down4(h);
    bad.push(
      `Höhe ${h} px — nächster gültiger Wert nach oben: ${up4(h)} px${down > 0 ? `, nach unten: ${down} px` : ''}`
    );
  }
  if (bad.length === 0) return;

  throw new Error(
    `HAP verlangt Kantenlängen als Vielfache von 4. Bei ${w}×${h} passt das nicht: ${bad.join('; ')}. ` +
      `Entweder die Fläche auf ${up4(w)}×${up4(h)} padden (schwarz auffüllen, wie es die Blaue Flora mit 1530→1532 vormacht) ` +
      `oder ein Preset ohne HAP wählen. Betroffenes Preset: "${preset.label || preset.id}".`
  );
}

/* ==========================================================================
 * 1) Encoder-Argumente
 * ========================================================================== */

/**
 * Argumentarray fuer den Encoder, gebaut aus delivery.presets[].args des Venue.
 * Ergaenzt -pix_fmt nur dann, wenn das Preset keines mitbringt.
 */
export function deliveryArgs(venue, presetId, { width, height } = {}) {
  const preset = findDeliveryPreset(venue, presetId);

  if (isHapPreset(preset)) assertHapDimensions(width, height, preset);

  const args = [...(preset.args || [])];
  if (!args.includes('-pix_fmt')) {
    const pixFmt = defaultPixFmt(preset);
    if (pixFmt) args.push('-pix_fmt', pixFmt);
  }
  // Ton wird in dieser Pipeline grundsaetzlich nicht mitgeliefert.
  if (!args.includes('-an')) args.push('-an');
  return args;
}

/* ==========================================================================
 * 2) Dateiname
 * ========================================================================== */

/**
 * Dateiname nach dem Namensschema des Venue.
 * B und C sind pixelidentisch — der Dateiname ist das einzige, was sie auf dem
 * Mediaserver auseinanderhaelt. Deshalb laeuft alles ueber deliveryName().
 */
export function deliveryOutName(venue, idOrWall, w, h, presetId) {
  if (!idOrWall) throw new Error('Für den Dateinamen fehlt die Wand- bzw. Panel-Kennung.');
  return deliveryName(venue, idOrWall, w, h, presetId);
}

/* ==========================================================================
 * 3) Mengenabschaetzung
 * ========================================================================== */

/** Alle Flaechen des Venue, die geliefert werden koennen. */
function collectSurfaces(venue, project) {
  const out = (venue.walls || []).map((w) => ({
    id: w.id,
    label: w.label || w.id,
    width: w.width,
    height: w.height,
    alpha: false,
    kind: 'wall',
  }));
  if (venue.holo) {
    out.push({
      id: venue.holo.id || 'H',
      label: venue.holo.label || 'Holo',
      width: venue.holo.width,
      height: venue.holo.height,
      alpha: !!venue.holo.alpha,
      kind: 'holo',
      inProject: !!project?.holo,
    });
  }
  return out;
}

/**
 * Tabelle: pro Flaeche und Preset die geschaetzte Datenrate und Gesamtgroesse,
 * dazu je Preset die Summe ueber alle Flaechen und eine Warnung, wenn diese
 * Summe DELIVERY_BUDGET_MB_PER_SEC ueberschreitet.
 */
export function estimateDelivery(venue, project) {
  if (!venue) throw new Error('Für die Mengenabschätzung fehlt das Venue.');
  if (!project) throw new Error('Für die Mengenabschätzung fehlt das Projekt.');

  const fps = project.fps ?? venue.fps;
  const seconds = project.loopSeconds ?? 0;
  const frames = targetFrameCount(project);
  const presets = venue.delivery?.presets || [];
  const surfaces = collectSurfaces(venue, project);

  const rows = [];
  const warnings = [];

  for (const s of surfaces) {
    for (const preset of presets) {
      const bpp = deliveryBytesPerPixel(preset);
      const est = estimateSize(s.width, s.height, fps, seconds, bpp);

      const notes = [];
      if (s.alpha && preset.alpha === false) {
        notes.push('Preset ohne Alpha — die Transparenz der Fläche geht verloren');
      }
      if (!s.alpha && preset.alpha === true) {
        notes.push('Alpha-Preset auf einer Fläche ohne Transparenz — unnötig groß');
      }
      if (bpp === 0) {
        notes.push('bytesPerPixel fehlt im Preset — Schätzung nicht möglich');
      }
      // Kantenpruefung gleich hier mitnehmen, damit sie nicht erst beim
      // Rendern nach 40 Minuten auffaellt.
      let blocked = null;
      try {
        deliveryArgs(venue, preset.id, { width: s.width, height: s.height });
      } catch (err) {
        blocked = err.message;
        notes.push(err.message);
        if (!warnings.includes(err.message)) warnings.push(err.message);
      }

      rows.push({
        surfaceId: s.id,
        surfaceLabel: s.label,
        width: s.width,
        height: s.height,
        presetId: preset.id,
        presetLabel: preset.label || preset.id,
        bytesPerPixel: bpp,
        bytesPerFrame: est.bytesPerFrame,
        mbPerFrame: est.bytesPerFrame / 1e6,
        mbPerSec: est.mbPerSec,
        totalBytes: est.totalBytes,
        gbTotal: est.gbTotal,
        rateText: `${de(est.mbPerSec, 1)} MB/s`,
        sizeText: formatBytes(est.totalBytes),
        blocked,
        notes,
      });
    }
  }

  const totals = presets.map((preset) => {
    const mine = rows.filter((r) => r.presetId === preset.id);
    const mbPerSec = mine.reduce((a, r) => a + r.mbPerSec, 0);
    const totalBytes = mine.reduce((a, r) => a + r.totalBytes, 0);
    const overBudget = mbPerSec > DELIVERY_BUDGET_MB_PER_SEC;
    if (overBudget) {
      warnings.push(
        `Preset "${preset.label || preset.id}" über alle Flächen: ${de(mbPerSec, 1)} MB/s. ` +
          `Das liegt über der Marke von ${DELIVERY_BUDGET_MB_PER_SEC} MB/s — der Pandoras Box V8 im Theater ist das Nadelöhr. ` +
          `Gegenmittel: Preset mit geringerer Datenrate (z. B. HAP statt HAP Q), kleinere freigegebene Auflösung oder schnellere Wiedergabe-SSD. Ein kürzerer Loop spart Speicherplatz, senkt aber nicht die Datenrate pro Sekunde.`
      );
    }
    return {
      presetId: preset.id,
      presetLabel: preset.label || preset.id,
      mbPerSec,
      totalBytes,
      gbTotal: totalBytes / 1e9,
      rateText: `${de(mbPerSec, 1)} MB/s`,
      sizeText: formatBytes(totalBytes),
      overBudget,
    };
  });

  const md = [];
  md.push(`### Datenmengen — ${project.name || 'Projekt'} · ${de(seconds, 0)} s Loop · ${frames} Frames · ${fps} fps`);
  md.push('');
  md.push('| Fläche | Auflösung | Preset | MB/Frame | MB/s | Gesamt | Hinweis |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    md.push(
      `| ${cell(r.surfaceLabel)} | ${r.width}×${r.height} | ${cell(r.presetLabel)} | ${de(r.mbPerFrame, 2)} | ${de(r.mbPerSec, 1)} | ${cell(r.sizeText)} | ${cell(r.notes.join(' · '))} |`
    );
  }
  md.push('');
  md.push('| Preset | Summe MB/s | Summe gesamt | Budget |');
  md.push('|---|---|---|---|');
  for (const t of totals) {
    md.push(
      `| ${cell(t.presetLabel)} | ${de(t.mbPerSec, 1)} | ${cell(t.sizeText)} | ${t.overBudget ? `über ${DELIVERY_BUDGET_MB_PER_SEC} MB/s` : 'ok'} |`
    );
  }

  return {
    fps,
    seconds,
    frames,
    budgetMbPerSec: DELIVERY_BUDGET_MB_PER_SEC,
    surfaces,
    rows,
    totals,
    warnings,
    markdown: md.join('\n'),
  };
}

/* ==========================================================================
 * 4) Lieferschein
 * ========================================================================== */

/** Eintraege duerfen Pfad-Strings oder Objekte sein. */
function normalizeRenderedFile(entry) {
  if (typeof entry === 'string') return { path: entry };
  const e = entry || {};
  return { ...e, path: e.path || e.file || e.outPath || null };
}

/**
 * Markdown-Lieferschein. Geht so wie er ist an den Kunden, deshalb stehen die
 * offenen Punkte und Annahmen des Venue mit drin — was ungeklaert ist, muss
 * sichtbar ungeklaert bleiben.
 *
 * renderedFiles: [ "pfad" | { path, wallId|panelId, presetId, width, height,
 *                             frames, durationSec, sizeBytes, sha256 } ]
 */
export function deliveryManifest(project, venue, renderedFiles = []) {
  const fps = project?.fps ?? venue?.fps ?? 0;
  const expectedFrames = project ? targetFrameCount(project) : null;
  const files = (Array.isArray(renderedFiles) ? renderedFiles : []).map(normalizeRenderedFile);

  const out = [];
  out.push(`# Lieferschein — ${project?.name || 'Unbenanntes Projekt'}`);
  out.push('');
  out.push(`- **Datum:** ${stampNow()}`);
  out.push(`- **Venue:** ${venue?.name || '—'} (\`${venue?.id || '—'}\`)`);
  out.push(`- **Framerate:** ${fps} fps`);
  out.push(`- **Looplänge:** ${de(project?.loopSeconds ?? 0, 2)} s`);
  if (expectedFrames != null) {
    out.push(
      `- **Framezahl je Datei (Soll):** ${expectedFrames}` +
        (project?.dropDuplicateEndFrame ? ' — ohne doppelten Schlussframe' : ' — inklusive Schlussframe')
    );
  }
  out.push(`- **Dateien:** ${files.length}`);
  out.push('');

  const problems = [];
  let totalBytes = 0;

  out.push('## Dateien');
  out.push('');
  out.push('| Datei | Fläche | Auflösung | Codec | Frames | Dauer | Größe | SHA-256 (16) |');
  out.push('|---|---|---|---|---|---|---|---|');

  for (const f of files) {
    const abs = f.path;
    const name = abs ? path.basename(abs) : '(ohne Pfad)';
    const exists = !!abs && existsSync(abs);
    if (!exists) problems.push(`Datei fehlt auf der Platte: ${abs || '(ohne Pfad)'}`);

    let sizeBytes = f.sizeBytes ?? null;
    if (sizeBytes == null && exists) {
      try {
        sizeBytes = statSync(abs).size;
      } catch (err) {
        problems.push(`Größe von ${name} nicht lesbar: ${err.message}`);
      }
    }
    if (Number.isFinite(sizeBytes)) totalBytes += sizeBytes;

    let sha = f.sha256 ?? null;
    if (!sha && exists) {
      try {
        sha = sha256Sync(abs);
      } catch (err) {
        problems.push(`Prüfsumme von ${name} nicht berechenbar: ${err.message}`);
      }
    }

    let codec = f.codec || null;
    if (!codec && f.presetId && venue) {
      try {
        const preset = findDeliveryPreset(venue, f.presetId);
        codec = preset.codecTag || preset.label || f.presetId;
      } catch (err) {
        problems.push(err.message);
        codec = f.presetId;
      }
    }

    const frames = Number.isFinite(f.frames) ? f.frames : null;
    if (frames != null && expectedFrames != null && frames !== expectedFrames) {
      problems.push(
        `${name}: ${frames} Frames statt ${expectedFrames}. Entweder ist die Quelle lückenhaft oder der Loop wurde anders gerechnet.`
      );
    }
    const durationSec = Number.isFinite(f.durationSec)
      ? f.durationSec
      : frames != null && fps
        ? frames / fps
        : null;

    out.push(
      [
        '',
        cell(name),
        cell(f.wallId || f.panelId || f.surfaceId),
        f.width && f.height ? `${f.width}×${f.height}` : '—',
        cell(codec),
        frames != null ? String(frames) : '—',
        durationSec != null ? `${de(durationSec, 2)} s` : '—',
        Number.isFinite(sizeBytes) ? formatBytes(sizeBytes) : (exists ? '—' : 'DATEI FEHLT'),
        sha ? `\`${sha.slice(0, 16)}\`` : '—',
        '',
      ].join(' | ').trim()
    );
  }

  out.push('');
  out.push(`**Summe:** ${formatBytes(totalBytes)}`);
  out.push('');

  if (problems.length) {
    out.push('## Beanstandungen aus der Prüfung');
    out.push('');
    for (const p of problems) out.push(`- ${p}`);
    out.push('');
  }

  if (project?.notes) {
    out.push('## Notizen zum Projekt');
    out.push('');
    out.push(project.notes);
    out.push('');
  }

  const openQuestions = venue?.openQuestions || [];
  if (openQuestions.length) {
    out.push('## Offene Punkte — bitte vor Einspielung klären');
    out.push('');
    for (const q of openQuestions) out.push(`- ${q}`);
    out.push('');
  }

  const assumptions = venue?.assumptions || [];
  if (assumptions.length) {
    out.push('## Annahmen, die dieser Lieferung zugrunde liegen');
    out.push('');
    for (const a of assumptions) out.push(`- ${a}`);
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('Erzeugt mit Theater-Bild-Gelöte. Alle Maße stammen aus der Venue-Spezifikation, nicht aus Schätzungen des Werkzeugs.');
  out.push('');

  return out.join('\n');
}
