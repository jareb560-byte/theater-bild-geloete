/**
 * Native-pixel browser composition. No stage lighting, travel, audio, decoding,
 * encoding, or access to user files belongs here.
 *
 * Geometry follows server/ops/filtergraph.js: crop, quarter-turn, flips,
 * fit/zoom/offset, even-sized scaled image, clipping to its slot, then overlay.
 * Unsupported processing is rejected before an encoder or decoder is opened.
 */

const FILTER_DEFAULTS = Object.freeze({
  brightness: 0, contrast: 1, saturation: 1, gamma: 1,
  hueDeg: 0, blurPx: 0, blackLift: 0, dither: false,
});
const EPSILON = 1e-9;

function fail(message, location = '') {
  throw new Error(`MP4-Export${location ? ` · ${location}` : ''}: ${message}`);
}

function number(value, label, fallback, location = '') {
  const result = value == null ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result)) fail(`${label} muss eine endliche Zahl sein.`, location);
  return result;
}

function positive(value, label, fallback, location = '') {
  const result = number(value, label, fallback, location);
  if (result <= 0) fail(`${label} muss größer als 0 sein.`, location);
  return result;
}

function pixels(value, label, location = '') {
  const result = positive(value, label, undefined, location);
  if (!Number.isSafeInteger(result)) fail(`${label} muss eine ganze Pixelzahl sein.`, location);
  return result;
}

function nonnegative(value, label, fallback = 0, location = '') {
  const result = number(value, label, fallback, location);
  if (result < 0) fail(`${label} darf nicht negativ sein.`, location);
  return result;
}

function normalizeRange(range, loopSeconds) {
  if (range == null) return { startSec: 0, endSec: loopSeconds, fullLoop: true };
  let start;
  let end;
  if (typeof range === 'number') { start = 0; end = range; }
  else if (Array.isArray(range) && range.length === 2) [start, end] = range;
  else if (typeof range === 'object' && !Array.isArray(range)) {
    start = range.startSec ?? range.start ?? range.from ?? 0;
    end = range.endSec ?? range.end ?? range.to;
    if (end == null && range.durationSec != null) {
      end = number(start, 'Beginn des Ausschnitts', 0) + positive(range.durationSec, 'Dauer des Ausschnitts');
    }
  } else fail('Der Zeitausschnitt ist ungültig.');
  start = nonnegative(start, 'Beginn des Ausschnitts');
  end = positive(end, 'Ende des Ausschnitts');
  if (end <= start) fail('Das Ende des Ausschnitts muss nach seinem Beginn liegen.');
  // This matches normalizeRange in the desktop exporter.
  if (start === 0 && end >= loopSeconds) return { startSec: 0, endSec: loopSeconds, fullLoop: true };
  return { startSec: start, endSec: end, fullLoop: false };
}

function layerFilters(layer, location) {
  if (layer.blend && layer.blend !== 'normal') {
    fail(`Der Blendmodus „${layer.blend}“ wird im Browser-Export noch nicht unterstützt. Bitte „normal“ wählen oder die Desktop-Fassung verwenden.`, location);
  }
  const filters = layer.filters || {};
  for (const [key, defaultValue] of Object.entries(FILTER_DEFAULTS)) {
    if (filters[key] != null && filters[key] !== defaultValue) {
      fail(`Der Filter „${key}“ wird im Browser-Export noch nicht unterstützt. Bitte zurücksetzen oder die Desktop-Fassung verwenden.`, location);
    }
  }
  for (const key of Object.keys(filters)) {
    if (!Object.hasOwn(FILTER_DEFAULTS, key) && key !== 'opacity' && key !== 'feather') {
      fail(`Der Filter „${key}“ ist unbekannt und kann nicht exportiert werden.`, location);
    }
  }
  for (const [edge, value] of Object.entries(filters.feather || {})) {
    if (!['l', 'r', 't', 'b'].includes(edge) || value !== 0) {
      fail('Weiche Kanten (Feather) werden im Browser-Export noch nicht unterstützt. Bitte zurücksetzen oder die Desktop-Fassung verwenden.', location);
    }
  }
  const opacity = number(filters.opacity, 'Deckkraft', 1, location);
  return Math.max(0, Math.min(1, opacity));
}

function sourceGeometry(layer, media, slot, location) {
  const sourceWidth = pixels(media.probe?.width, 'Quellbreite', location);
  const sourceHeight = pixels(media.probe?.height, 'Quellhöhe', location);
  const transform = layer.transform || {};
  let crop = { x: 0, y: 0, w: sourceWidth, h: sourceHeight };
  if (transform.crop != null) {
    const requested = transform.crop;
    const x = Math.max(0, Math.round(number(requested.x, 'Crop-X', 0, location)));
    const y = Math.max(0, Math.round(number(requested.y, 'Crop-Y', 0, location)));
    const w = Math.min(Math.round(positive(requested.w, 'Crop-Breite', undefined, location)), sourceWidth - x);
    const h = Math.min(Math.round(positive(requested.h, 'Crop-Höhe', undefined, location)), sourceHeight - y);
    if (w <= 0 || h <= 0) fail('Der Quellausschnitt liegt außerhalb des Bildes.', location);
    crop = { x, y, w, h };
  }
  const rotation = number(transform.rotate, 'Drehung', 0, location);
  const rotate = ((rotation % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotate)) fail('Drehungen sind nur in Schritten von 90° möglich.', location);
  const swapped = rotate === 90 || rotate === 270;
  const orientedWidth = swapped ? crop.h : crop.w;
  const orientedHeight = swapped ? crop.w : crop.h;
  const fit = transform.fit || 'cover';
  let width;
  let height;
  let cx = slot.width / 2;
  let cy = slot.height / 2;
  if (fit === 'cover' || fit === 'contain') {
    const ratio = Math[fit === 'cover' ? 'max' : 'min'](slot.width / orientedWidth, slot.height / orientedHeight);
    width = orientedWidth * ratio;
    height = orientedHeight * ratio;
  } else if (fit === 'stretch') {
    width = slot.width; height = slot.height;
  } else if (fit === 'native') {
    width = orientedWidth; height = orientedHeight;
  } else if (fit === 'manual') {
    width = positive(transform.dest?.w, 'Manuelle Breite', undefined, location);
    height = positive(transform.dest?.h, 'Manuelle Höhe', undefined, location);
    // The desktop exporter rounds the manual rectangle before zooming.
    width = Math.round(width); height = Math.round(height);
    cx = Math.round(number(transform.dest?.x, 'Manuelle X-Position', 0, location)) + width / 2;
    cy = Math.round(number(transform.dest?.y, 'Manuelle Y-Position', 0, location)) + height / 2;
  } else fail(`Der Einpassmodus „${fit}“ ist unbekannt.`, location);
  const zoom = positive(transform.zoom, 'Zoom', 1, location);
  cx += Math.round(number(transform.offset?.x, 'X-Versatz', 0, location));
  cy += Math.round(number(transform.offset?.y, 'Y-Versatz', 0, location));
  const even = (value) => { const rounded = Math.round(value); return Math.max(2, rounded + (rounded % 2)); };
  width = even(width * zoom);
  height = even(height * zoom);
  const dest = { x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), w: width, h: height };
  if (!Object.values(dest).every(Number.isSafeInteger)) fail('Das Zielrechteck ist zu groß oder ungültig.', location);
  return {
    sourceWidth, sourceHeight, crop, dest, fit, rotate,
    flipH: Boolean(transform.flipH), flipV: Boolean(transform.flipV),
  };
}

function layerTiming(layer, media, loopSeconds, location) {
  const time = layer.time || {};
  const transition = time.transition || {};
  nonnegative(transition.durSec, 'Übergangsdauer', 0, location);
  if (transition.type && transition.type !== 'cut') {
    fail(`Der Übergang „${transition.type}“ wird im Browser-Export noch nicht unterstützt. Bitte einen harten Schnitt wählen oder die Desktop-Fassung verwenden.`, location);
  }
  const startSec = nonnegative(time.startSec, 'Layer-Beginn', 0, location);
  const inSec = nonnegative(time.inSec, 'In-Punkt', 0, location);
  const speed = positive(time.speed, 'Geschwindigkeit', 1, location);
  const isStill = media.kind === 'image';
  if (!isStill && media.kind && media.kind !== 'video') fail(`Der Medientyp „${media.kind}“ wird im Browser-Export nicht unterstützt.`, location);
  const sourceDuration = isStill ? null : positive(media.probe?.durationSec, 'Quelldauer', undefined, location);
  const outSec = time.outSec == null ? sourceDuration : nonnegative(time.outSec, 'Out-Punkt', 0, location);
  if (outSec != null && outSec <= inSec) fail('Der Out-Punkt muss nach dem In-Punkt liegen.', location);
  if (!isStill && (inSec >= sourceDuration || outSec > sourceDuration + EPSILON)) {
    fail('In-/Out-Punkte liegen außerhalb der Quelldauer.', location);
  }
  const loop = Boolean(time.loop);
  // Desktop -stream_loop repeats the whole source and ignores trim points.
  // Reject that ambiguous combination rather than silently changing content.
  if (!isStill && loop && (inSec > 0 || (time.outSec != null && Math.abs(outSec - sourceDuration) > EPSILON))) {
    fail('Loop mit gesetztem In-/Out-Ausschnitt wird noch nicht unterstützt. Für Loop die ganze Quelle verwenden oder Loop ausschalten.', location);
  }
  const endSec = loop || outSec == null ? loopSeconds : Math.min(loopSeconds, startSec + (outSec - inSec) / speed);
  return { startSec, endSec, inSec, outSec, speed, loop, sourceDuration, isStill };
}

/** Build and validate an immutable snapshot suitable for an offline export. */
export function createCompositionPlan({ project, venue, wallId, rangeSec = null } = {}) {
  if (!project || !venue || !Array.isArray(venue.walls)) fail('Projekt oder Venue fehlt.');
  const spec = venue.walls.find((wall) => wall.id === wallId);
  if (!spec) fail(`Die Wand „${wallId || ''}“ ist im Venue nicht vorhanden.`);
  const wall = project.walls?.[wallId];
  if (!wall?.slots || typeof wall.slots !== 'object') fail('Die gewählte Wand fehlt im Projekt.', wallId);
  const width = pixels(spec.width, 'Wandbreite', wallId);
  const height = pixels(spec.height, 'Wandhöhe', wallId);
  if (width % 2 || height % 2) fail(`Das native Raster ${width} × ${height} hat ungerade Kanten. Für MP4 werden gerade Pixelmaße benötigt; das Raster wird nicht automatisch verändert.`, wallId);
  const fps = positive(project.fps ?? venue.fps, 'Bildrate');
  const loopSeconds = positive(project.loopSeconds, 'Looplänge');
  const range = normalizeRange(rangeSec, loopSeconds);
  const requestedDuration = range.endSec - range.startSec;
  const frameCount = Math.max(1, Math.round(requestedDuration * fps) + (range.fullLoop && !project.dropDuplicateEndFrame ? 1 : 0));
  if (!Number.isSafeInteger(frameCount)) fail('Die gewünschte Framezahl ist zu groß.');
  const backgroundValue = project.background ?? '#000000';
  if (typeof backgroundValue !== 'string' || !/^#?[\da-f]{6}$/i.test(backgroundValue)) fail('Die Hintergrundfarbe muss sechs Hex-Ziffern haben, z. B. #000000.');
  const background = `#${backgroundValue.replace(/^#/, '')}`;
  if (!Array.isArray(project.media)) fail('Die Medienbibliothek ist ungültig.');
  const mediaById = new Map();
  for (const media of project.media) {
    if (!media?.id || mediaById.has(media.id)) fail('Die Medienbibliothek enthält fehlende oder doppelte Kennungen.');
    mediaById.set(media.id, media);
  }
  const panels = spec.panels || [];
  const order = ['master', ...panels.map((panel) => panel.id)];
  if (new Set(order).size !== order.length) fail('Das Venue enthält doppelte Panelkennungen.', wallId);
  for (const [id, slot] of Object.entries(wall.slots)) {
    if (!order.includes(id) && slot?.enabled !== false && slot?.layers?.some((layer) => layer?.enabled !== false)) {
      fail(`Slot „${id}“ ist im Venue nicht vorhanden.`, wallId);
    }
  }
  const layers = [];
  const ids = new Set();
  for (const slotId of order) {
    const sourceSlot = wall.slots[slotId];
    if (!sourceSlot || sourceSlot.enabled === false) continue;
    if (!Array.isArray(sourceSlot.layers)) fail('Die Layerliste ist ungültig.', `${wallId}/${slotId}`);
    const slot = {
      id: slotId, x: Math.round(nonnegative(sourceSlot.x, 'Slot-X', 0, slotId)), y: 0,
      width: pixels(sourceSlot.width, 'Slotbreite', slotId), height: pixels(sourceSlot.height, 'Slothöhe', slotId),
    };
    if (slot.x + slot.width > width || slot.height > height) fail('Der Slot liegt außerhalb des nativen Wandrasters.', `${wallId}/${slotId}`);
    const enabled = sourceSlot.layers.filter((layer) => layer && layer.enabled !== false);
    for (const layer of enabled) number(layer.time?.startSec, 'Layer-Beginn', 0, slotId);
    enabled.sort((a, b) => (a.time?.startSec ?? 0) - (b.time?.startSec ?? 0));
    for (const layer of enabled) {
      const location = `${wallId}/${slotId} · ${layer.label || layer.id || 'Layer'}`;
      if (!layer.id || ids.has(layer.id)) fail('Layerkennungen fehlen oder sind doppelt.', location);
      ids.add(layer.id);
      const media = mediaById.get(layer.mediaId);
      if (!media) fail('Die verwendete Mediendatei fehlt in der Bibliothek.', location);
      const timing = layerTiming(layer, media, loopSeconds, location);
      const opacity = layerFilters(layer, location);
      const geometry = sourceGeometry(layer, media, slot, location);
      const dest = geometry.dest;
      if (Math.min(timing.endSec, range.endSec) - Math.max(timing.startSec, range.startSec) <= 1 / (2 * fps) ||
          dest.x >= slot.width || dest.y >= slot.height || dest.x + dest.w <= 0 || dest.y + dest.h <= 0 || opacity === 0) continue;
      layers.push({ layerId: layer.id, sourceKey: layer.id, mediaId: media.id, slot: { ...slot }, opacity, ...timing, ...geometry });
    }
  }
  const plan = {
    wallId, width, height, fps, frameCount, duration: frameCount / fps,
    requestedDuration, startSec: range.startSec, endSec: range.endSec,
    loopSeconds, background, mediaIds: [...new Set(layers.map((layer) => layer.mediaId))], layers,
  };
  for (const layer of layers) { Object.freeze(layer.slot); Object.freeze(layer.crop); Object.freeze(layer.dest); Object.freeze(layer); }
  Object.freeze(plan.layers); Object.freeze(plan.mediaIds);
  return Object.freeze(plan);
}

/** Active layers in drawing order; sourceTime addresses the original file. */
export function frameLayers(plan, frameIndex) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= plan.frameCount) fail('Der Frameindex liegt außerhalb des Exports.');
  const timelineTime = plan.startSec + frameIndex / plan.fps;
  const result = [];
  for (const layer of plan.layers) {
    if (timelineTime + EPSILON < layer.startSec || timelineTime >= layer.endSec - EPSILON) continue;
    const elapsed = Math.max(0, timelineTime - layer.startSec) * layer.speed;
    const sourceTime = layer.isStill ? 0 : layer.loop
      ? ((elapsed % layer.sourceDuration) + layer.sourceDuration) % layer.sourceDuration
      : layer.inSec + elapsed;
    result.push({ ...layer, sourceTime, timelineTime });
  }
  return result;
}

/**
 * sources is Map<mediaId, CanvasImageSource>. For a source used at different
 * times simultaneously, supply Map<descriptor.sourceKey, CanvasImageSource>.
 * Sources must expose their original dimensions (no pre-scaled proxies).
 */
export function drawCompositionFrame(ctx, plan, frameIndex, sources) {
  if (!ctx || typeof ctx.drawImage !== 'function' || !sources || typeof sources.get !== 'function') fail('Canvas oder decodierte Quellen fehlen.');
  const layers = frameLayers(plan, frameIndex);
  const draws = layers.map((layer) => {
    const source = sources.get(layer.sourceKey) ?? sources.get(layer.mediaId);
    if (!source) fail('Für diesen Frame fehlt die decodierte Quelle.', layer.layerId);
    const width = source.naturalWidth || source.videoWidth || source.displayWidth || source.width;
    const height = source.naturalHeight || source.videoHeight || source.displayHeight || source.height;
    if (width !== layer.sourceWidth || height !== layer.sourceHeight) fail('Die decodierte Quelle hat nicht ihre ursprüngliche Auflösung.', layer.layerId);
    return { layer, source };
  });
  if (ctx.canvas && (ctx.canvas.width !== plan.width || ctx.canvas.height !== plan.height)) fail('Das Ausgabecanvas entspricht nicht dem nativen Wandraster.');
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = plan.background;
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const { layer, source } of draws) {
      const { slot, dest, crop } = layer;
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(slot.x, slot.y, slot.width, slot.height);
        ctx.clip();
        ctx.globalAlpha = layer.opacity;
        ctx.translate(slot.x + dest.x + dest.w / 2, slot.y + dest.y + dest.h / 2);
        // FFmpeg rotates the crop first, then flips the oriented result.
        ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
        ctx.rotate(layer.rotate * Math.PI / 180);
        const quarterTurn = layer.rotate === 90 || layer.rotate === 270;
        const w = quarterTurn ? dest.h : dest.w;
        const h = quarterTurn ? dest.w : dest.h;
        ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, -w / 2, -h / 2, w, h);
      } finally { ctx.restore(); }
    }
  } finally { ctx.restore(); }
  return layers;
}
