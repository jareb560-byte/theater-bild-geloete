/**
 * Theater-Bild-Gelöte — gemeinsames Datenmodell fuer Server und Client.
 *
 * Diese Datei ist reines ESM ohne Abhaengigkeiten und wird von beiden Seiten
 * importiert (Server per node, Client per <script type="module">). Sie ist die
 * einzige Wahrheit darueber, wie ein Projekt aussieht.
 *
 * ---------------------------------------------------------------------------
 * GRUNDIDEE
 * ---------------------------------------------------------------------------
 * Eine Wand (A/B/C/D) besteht aus SLOTS. Es gibt pro Wand:
 *
 *   - einen Slot "master"  -> die ganze Wand, z.B. D = 2736x1224
 *   - je einen Slot pro Panel -> D1 (648x1224), D2 (720x1224), ...
 *
 * Jeder Slot hat LAYERS. Ein Layer verweist auf eine Mediendatei und traegt
 * Transform (Crop/Scale/Position), Filter (Helligkeit, Feather, ...) und Zeit
 * (wann im Loop laeuft er).
 *
 * Damit faellt raeumliches und zeitliches Zusammenfuegen in EIN Modell:
 *
 *   - Vier Clips auf D1..D4, alle bei startSec 0  -> raeumlicher Merge
 *     (vier Einzelvideos werden eine durchgehende Wand)
 *   - Drei Clips auf "master", startSec 0 / 15 / 30 -> zeitlicher Merge
 *     (drei Einzelvideos werden ein durchgehendes Video)
 *   - Beides gleichzeitig ist erlaubt.
 *
 * Gerendert wird immer die ganze Wand in EINEM ffmpeg-Durchlauf: schwarze
 * Basisflaeche in Wandgroesse, darauf alle Layer aller Slots per overlay.
 * Panel-Einzeldateien entstehen daraus per crop.
 * ---------------------------------------------------------------------------
 */

export const SCHEMA_VERSION = 'Theater-Bild-Gelöte/1';

/* ==========================================================================
 * IDs
 * ========================================================================== */

let idCounter = 0;

/** Kurze, stabile, menschenlesbare ID. Nicht kryptographisch. */
export function makeId(prefix = 'id') {
  idCounter = (idCounter + 1) % 0xffff;
  const t = Date.now().toString(36);
  const c = idCounter.toString(36).padStart(3, '0');
  const r = Math.floor(Math.random() * 0xffff).toString(36).padStart(3, '0');
  return `${prefix}_${t}${c}${r}`;
}

/* ==========================================================================
 * Transform — wo landet die Quelle im Ziel-Slot
 * ========================================================================== */

/**
 * fit-Modi:
 *   cover   - Quelle fuellt den Slot, Ueberstand wird beschnitten (Standard)
 *   contain - Quelle passt komplett rein, Rest bleibt schwarz/transparent
 *   stretch - Quelle wird auf Slotgroesse verzerrt
 *   native  - Quelle in Originalpixeln, zentriert
 *   manual  - dest{} wird woertlich benutzt, nichts wird gerechnet
 *
 * WICHTIG: crop ist in QUELL-Pixeln, dest ist in SLOT-Pixeln.
 * Bei fit != 'manual' wird dest beim Rendern aus fit + crop neu berechnet;
 * der Editor schreibt dann trotzdem dest mit, damit die UI etwas anzeigen kann.
 */
export function defaultTransform() {
  return {
    fit: 'cover',
    /** Ausschnitt aus der Quelle, in Quell-Pixeln. null = ganze Quelle. */
    crop: null, // { x, y, w, h }
    /** Zielrechteck im Slot, in Slot-Pixeln. */
    dest: { x: 0, y: 0, w: 0, h: 0 },
    /** Feinjustage in Slot-Pixeln, wird auf dest addiert. */
    offset: { x: 0, y: 0 },
    /** Zusaetzlicher Zoom um den Mittelpunkt von dest. 1 = keiner. */
    zoom: 1,
    /** Nur 0/90/180/270 — alles andere kostet eine zusaetzliche Filterstufe. */
    rotate: 0,
    flipH: false,
    flipV: false,
  };
}

/* ==========================================================================
 * Filter — Bildkorrektur pro Layer
 * ========================================================================== */

export function defaultFilters() {
  return {
    opacity: 1,       // 0..1
    brightness: 0,    // -1..1   (ffmpeg eq=brightness)
    contrast: 1,      // 0..3    (ffmpeg eq=contrast)
    saturation: 1,    // 0..3    (ffmpeg eq=saturation)
    gamma: 1,         // 0.1..3  (ffmpeg eq=gamma)
    hueDeg: 0,        // -180..180
    blurPx: 0,        // 0 = aus
    /** Weiche Kante pro Seite in Slot-Pixeln — fuer Naht-Uebergaenge. */
    feather: { l: 0, r: 0, t: 0, b: 0 },
    /** Schwarzwert anheben/absenken, simuliert LED-Verhalten. -0.1..0.1 */
    blackLift: 0,
    /** Dithering gegen Banding in Gradienten. */
    dither: false,
  };
}

/* ==========================================================================
 * Zeit — wann laeuft der Layer im Loop
 * ========================================================================== */

export function defaultTime() {
  return {
    /** Startzeit im Loop, Sekunden. */
    startSec: 0,
    /** In-/Out-Punkt in der QUELLE, Sekunden. outSec null = bis Ende. */
    inSec: 0,
    outSec: null,
    /** Quelle wiederholen, bis der Layer-Slot voll ist. */
    loop: false,
    /** Uebergang zum vorherigen Layer im selben Slot. */
    transition: { type: 'cut', durSec: 0 }, // 'cut' | 'xfade' | 'fadeblack' | 'dissolve'
    /** Zeitdehnung. 1 = original. Wird als setpts umgesetzt. */
    speed: 1,
  };
}

/* ==========================================================================
 * Layer
 * ========================================================================== */

export function makeLayer(mediaId, patch = {}) {
  return {
    id: makeId('lay'),
    mediaId,
    label: '',
    enabled: true,
    /** 'normal' | 'add' | 'screen' | 'multiply' — 'add' fuer Neon/Holo. */
    blend: 'normal',
    transform: defaultTransform(),
    filters: defaultFilters(),
    time: defaultTime(),
    ...patch,
  };
}

/* ==========================================================================
 * Slot
 * ========================================================================== */

export function makeSlot(id, width, height, x = 0) {
  return {
    id,          // 'master' | 'D1' | 'D2' | ...
    x,           // Offset in der Wand, Wand-Pixel (master = 0)
    width,
    height,
    layers: [],
    /** Slot komplett stummschalten, ohne Layer zu loeschen. */
    enabled: true,
    /** Nur fuer die 3D-Ansicht: manueller Fahrweg-Ueberschrieb in Metern. */
    travelOverrideM: null,
  };
}

/* ==========================================================================
 * Wand
 * ========================================================================== */

export function makeWallState(wallSpec) {
  const slots = {
    master: makeSlot('master', wallSpec.width, wallSpec.height, 0),
  };
  for (const p of wallSpec.panels) {
    slots[p.id] = makeSlot(p.id, p.width, wallSpec.height, p.x);
  }
  return {
    id: wallSpec.id,
    slots,
    /** 0 = geschlossen, 1 = ganz aufgefahren. */
    travel: 0,
    /** '2+2' = zwei Haelften fahren zusammen, '4x' = jedes Teil einzeln. */
    travelMode: '2+2',
    visible: true,
    /** Nur Anzeige-Helligkeit in der 3D-Ansicht, nicht im Render. */
    previewGain: 1,
  };
}

/* ==========================================================================
 * Media — eine geprobte Quelldatei
 * ========================================================================== */

export function makeMedia(absPath, patch = {}) {
  return {
    id: makeId('med'),
    absPath,
    /** Pfad relativ zur Projektdatei — DAS kommt ins Git, nicht absPath. */
    relPath: null,
    name: absPath.split(/[\\/]/).pop(),
    /** 'video' | 'image' | 'sequence' */
    kind: 'video',
    probe: null,     // siehe probeShape() unten
    proxy: null,     // { path, width, height, ready }
    thumb: null,     // { path, ready }
    /** Vom Tool erkannte Abweichungen vom Zielraster. */
    issues: [],
    addedAt: new Date().toISOString(),
    ...patch,
  };
}

/**
 * Form, die probe.js liefern MUSS. Dokumentation, kein Runtime-Zwang.
 */
export function probeShape() {
  return {
    width: 0,
    height: 0,
    fps: 0,             // als Zahl, z.B. 29.97 oder 30
    fpsExact: '30/1',   // r_frame_rate wie ffprobe es liefert
    durationSec: 0,
    frames: 0,          // nb_frames, sonst gerechnet
    codec: '',
    pixFmt: '',
    hasAlpha: false,
    colorRange: '',     // 'tv' | 'pc' | ''
    colorSpace: '',
    bitrate: 0,
    sizeBytes: 0,
    container: '',
    audioStreams: 0,
  };
}

/* ==========================================================================
 * Projekt
 * ========================================================================== */

export function makeProject(venue, patch = {}) {
  const walls = {};
  for (const w of venue.walls) walls[w.id] = makeWallState(w);

  return {
    schema: SCHEMA_VERSION,
    name: 'Unbenannt',
    venueId: venue.id,
    fps: venue.fps,
    /** Zielaenge des Loops in Sekunden. Bestimmt die Framezahl im Render. */
    loopSeconds: 20,
    /** Rendern nur bis zum letzten NEUEN Frame — kein doppelter Schlussframe. */
    dropDuplicateEndFrame: true,
    /** Hintergrundfarbe der Wand unter allen Layern. */
    background: '#000000',
    media: [],
    walls,
    holo: null,   // optional: makeWallState-aehnlich fuer die Gaze
    /** Freitextnotizen, landen im Delivery-Report. */
    notes: '',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    ...patch,
  };
}

/* ==========================================================================
 * Helfer
 * ========================================================================== */

export function getWallSpec(venue, wallId) {
  const w = venue.walls.find((x) => x.id === wallId);
  if (!w) throw new Error(`Wand ${wallId} gibt es im Venue ${venue.id} nicht`);
  return w;
}

export function getPanelSpec(venue, wallId, panelId) {
  const w = getWallSpec(venue, wallId);
  const p = w.panels.find((x) => x.id === panelId);
  if (!p) throw new Error(`Panel ${panelId} gibt es auf Wand ${wallId} nicht`);
  return p;
}

export function findMedia(project, mediaId) {
  return project.media.find((m) => m.id === mediaId) || null;
}

/** Alle Layer einer Wand, in Renderreihenfolge: erst master, dann Panels. */
export function wallLayersInOrder(wallState, wallSpec) {
  const out = [];
  const order = ['master', ...wallSpec.panels.map((p) => p.id)];
  for (const slotId of order) {
    const slot = wallState.slots[slotId];
    if (!slot || !slot.enabled) continue;
    const sorted = [...slot.layers].sort(
      (a, b) => (a.time?.startSec ?? 0) - (b.time?.startSec ?? 0)
    );
    for (const layer of sorted) {
      if (layer.enabled) out.push({ slot, layer });
    }
  }
  return out;
}

/** Framezahl, die der Render haben MUSS. */
export function targetFrameCount(project) {
  const n = Math.round(project.loopSeconds * project.fps);
  return project.dropDuplicateEndFrame ? n : n + 1;
}

/**
 * Fahrweg eines Panels in Metern bei gegebenem travel-Wert.
 * Negativ = nach links, positiv = nach rechts.
 *
 * Die Teile fahren nach AUSSEN auf: die linke Haelfte nach links,
 * die rechte nach rechts. Damit wird die Mitte frei und gibt den Blick
 * auf die dahinterliegende Wand frei.
 */
export function panelTravelM(wallSpec, wallState, panelIndex) {
  const slotId = wallSpec.panels[panelIndex].id;
  const slot = wallState.slots[slotId];
  if (slot && slot.travelOverrideM != null) return slot.travelOverrideM;

  const t = wallState.travel ?? 0;
  const max = wallSpec.stage?.travelMaxM ?? wallSpec.widthM / 2;
  const n = wallSpec.panels.length;
  const isLeft = panelIndex < n / 2;
  const dir = isLeft ? -1 : 1;

  if (wallState.travelMode === '4x') {
    // Aussenteile fahren weiter als Innenteile, sonst kollidieren sie.
    const distFromCenter = isLeft ? n / 2 - panelIndex : panelIndex - (n / 2 - 1);
    return dir * t * max * (distFromCenter / (n / 2));
  }
  // '2+2': beide Teile einer Haelfte fahren gleich weit.
  return dir * t * max;
}

/** Sichtbare Oeffnung in der Wandmitte, in Metern. */
export function centerGapM(wallSpec, wallState) {
  const n = wallSpec.panels.length;
  const left = panelTravelM(wallSpec, wallState, n / 2 - 1);
  const right = panelTravelM(wallSpec, wallState, n / 2);
  return Math.max(0, right - left);
}

/* ==========================================================================
 * Datenmengen-Rechner
 * ========================================================================== */

export function estimateSize(width, height, fps, seconds, bytesPerPixel) {
  const perFrame = width * height * bytesPerPixel;
  const perSec = perFrame * fps;
  return {
    bytesPerFrame: perFrame,
    bytesPerSec: perSec,
    totalBytes: perSec * seconds,
    mbPerSec: perSec / 1e6,
    gbTotal: (perSec * seconds) / 1e9,
  };
}

/**
 * Textur-Datenmenge vor der optionalen Snappy-Kompression. HAP verwendet
 * DXT1 (0,5 Byte/Pixel), HAP Q und Alpha DXT5 (1 Byte/Pixel). Aus den echten
 * Encoder-Argumenten ableiten, damit alte Venue-Dateien mit falschem HAP-Q-
 * Schaetzwert nicht weiterhin die Haelfte der benoetigten Datenrate anzeigen.
 */
export function deliveryBytesPerPixel(preset) {
  const args = Array.isArray(preset?.args) ? preset.args : [];
  const value = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? null : args[i + 1];
  };
  if ((value('-c:v') || value('-vcodec') || value('-codec:v')) === 'hap') {
    const format = value('-format') || 'hap';
    if (format === 'hap' || format === '11') return 0.5;
    if (['hap_q', 'hap_alpha', '15', '14'].includes(format)) return 1;
  }
  const configured = Number(preset?.bytesPerPixel);
  return Number.isFinite(configured) && configured > 0 ? configured : 0;
}

export function formatBytes(n) {
  if (!isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

/* ==========================================================================
 * Delivery-Dateinamen
 * ========================================================================== */

export function deliveryName(venue, wallOrPanelId, width, height, presetId) {
  const preset = venue.delivery.presets.find((p) => p.id === presetId);
  if (!preset) throw new Error(`Delivery-Preset ${presetId} unbekannt`);
  const base = (venue.delivery.namePattern || '{WALL}_{W}x{H}_{FPS}p_{CODEC}')
    .replace('{WALL}', wallOrPanelId)
    .replace('{W}', String(width))
    .replace('{H}', String(height))
    .replace('{FPS}', String(venue.fps))
    .replace('{CODEC}', preset.codecTag);
  return `${base}.${preset.ext}`;
}

/* ==========================================================================
 * Validierung — was das Tool an einem Projekt bemaengelt
 * ========================================================================== */

export function validateProject(project, venue) {
  const problems = [];
  const add = (level, where, msg, hint) => problems.push({ level, where, msg, hint });

  if (project.schema !== SCHEMA_VERSION) {
    add('warn', 'projekt', `Schema ${project.schema} statt ${SCHEMA_VERSION}`,
        'Projekt wurde mit einer anderen Version geschrieben.');
  }
  if (project.fps !== venue.fps) {
    add('error', 'projekt', `Projekt laeuft auf ${project.fps} fps, das Haus verlangt ${venue.fps} fps`,
        'fps im Projekt auf den Venue-Wert setzen.');
  }
  if (project.loopSeconds <= 0) {
    add('error', 'projekt', 'Looplaenge ist 0', 'Looplaenge in Sekunden setzen.');
  }

  for (const m of project.media) {
    if (!m.probe) {
      add('warn', m.name, 'Datei wurde noch nicht analysiert', 'Bibliothek neu einlesen.');
      continue;
    }
    if (m.kind === 'video' && Math.abs(m.probe.fps - venue.fps) > 0.01) {
      add('warn', m.name, `${m.probe.fps} fps statt ${venue.fps} fps`,
          'Im Reiter Conform auf Zielrate angleichen — sonst rechnet ffmpeg beim Render stumm um.');
    }
  }

  for (const wallSpec of venue.walls) {
    const ws = project.walls[wallSpec.id];
    if (!ws) { add('error', wallSpec.id, 'Wand fehlt im Projekt'); continue; }

    const used = wallLayersInOrder(ws, wallSpec);
    if (used.length === 0) {
      add('info', wallSpec.id, 'Wand ist leer', 'Kein Content — rendert schwarz.');
    }

    const hasMaster = (ws.slots.master?.layers || []).some((l) => l.enabled);
    const hasPanels = wallSpec.panels.some(
      (p) => (ws.slots[p.id]?.layers || []).some((l) => l.enabled)
    );
    if (hasMaster && hasPanels) {
      add('info', wallSpec.id, 'Master- und Panel-Layer gleichzeitig belegt',
          'Panel-Layer liegen ueber dem Master. Wenn das nicht gewollt ist, einen der beiden abschalten.');
    }

    for (const { slot, layer } of used) {
      const media = findMedia(project, layer.mediaId);
      if (!media) {
        add('error', `${wallSpec.id}/${slot.id}`, 'Layer verweist auf eine Datei, die es nicht mehr gibt',
            'Layer loeschen oder Datei neu verknuepfen.');
        continue;
      }
      const end = layerEndSec(layer, media, project);
      if (end > project.loopSeconds + 1e-6) {
        add('warn', `${wallSpec.id}/${slot.id}/${media.name}`,
            `Layer laeuft bis ${end.toFixed(2)}s, der Loop ist nur ${project.loopSeconds}s lang`,
            'Wird beim Render abgeschnitten.');
      }
    }
  }

  // --- Verwaiste Inhalte ---------------------------------------------------
  //
  // Die Schleife oben laeuft ueber das VENUE. Wird im Venue-Editor eine Wand
  // oder ein Panel entfernt, waehrend das Projekt sie noch bespielt, faellt
  // dieser Inhalt aus jeder Pruefung UND aus jedem Render — er ist einfach
  // weg, ohne dass irgendwo etwas steht. Deshalb hier der Gegenlauf ueber das
  // PROJEKT.
  const venueWallIds = new Set(venue.walls.map((w) => w.id));
  for (const wallId of Object.keys(project.walls || {})) {
    if (!venueWallIds.has(wallId)) {
      const ws = project.walls[wallId];
      const n = Object.values(ws?.slots || {}).reduce((a, s) => a + (s.layers?.length || 0), 0);
      add('error', wallId,
          `Das Projekt bespielt Wand ${wallId}, die es im Venue "${venue.id}" nicht (mehr) gibt`,
          n > 0
            ? `${n} Layer haengen daran und werden NICHT gerendert. Wand im Venue wieder anlegen oder die Layer umhaengen.`
            : 'Die Wand ist leer und kann aus dem Projekt entfernt werden.');
      continue;
    }
    // Wand gibt es — aber vielleicht nicht mehr alle ihre Panels.
    const spec = venue.walls.find((w) => w.id === wallId);
    const gueltig = new Set(['master', ...spec.panels.map((p) => p.id)]);
    for (const [slotId, slot] of Object.entries(project.walls[wallId].slots || {})) {
      if (gueltig.has(slotId)) continue;
      const n = slot.layers?.length || 0;
      add(n > 0 ? 'error' : 'warn', `${wallId}/${slotId}`,
          `Slot ${slotId} gibt es auf Wand ${wallId} nicht (mehr)`,
          n > 0
            ? `${n} Layer darauf werden NICHT gerendert. Panelaufteilung im Venue pruefen.`
            : 'Leerer Slot aus einer frueheren Panelaufteilung.');
    }
  }

  return problems;
}

/** Endzeit eines Layers im Loop, Sekunden. */
export function layerEndSec(layer, media, project) {
  const t = layer.time || defaultTime();
  const srcDur = media?.probe?.durationSec ?? 0;
  const outSec = t.outSec == null ? srcDur : t.outSec;
  const used = Math.max(0, (outSec - (t.inSec || 0)) / (t.speed || 1));
  if (t.loop) return project.loopSeconds;
  return (t.startSec || 0) + used;
}
