/**
 * Theater-Bild-Gelöte — 3D-Buehnensimulation.
 *
 * Zeigt die vier LED-Waende A/B/C/D massstabsgetreu im Buehnenraum (1 Einheit = 1 Meter),
 * inklusive Fahrwegen der vier Panels pro Wand, LED-Anmutung, Naht-/Safe-Area-Overlays und
 * der Durchblick-Pruefung ("wenn D auffaehrt, sieht man dahinter was?").
 *
 * Vertrag (siehe Auftrag):
 *   createStage3D({ canvas, videoPool, onPick })
 *     -> { update(state), tick(timeSec), resize(), setCamera(presetId), screenshot(), dispose() }
 *
 * ---------------------------------------------------------------------------
 * KOORDINATEN — einmal lesen, dann ist der Rest offensichtlich
 * ---------------------------------------------------------------------------
 *   x : Buehnenbreite, 0 = Mitte.
 *   y : Hoehe ueber Buehnenboden, 0 = Boden.
 *   z : Tiefe. Zuschauer sitzt bei negativem z (Presets: z = -12), die Waende
 *       stehen bei venue.walls[].stage.z (A = 0 ... D = 7). Buehnenvorderkante z = -1.
 *
 * Die Kamera schaut also in Richtung +z. Damit liegt WELT-+x fuer den Zuschauer LINKS
 * auf dem Bildschirm. Das gelieferte Bild soll aber mit Pixel x = 0 links erscheinen.
 * Konsequenz, die alles erklaert:
 *
 *   worldX = -( bildX_in_Metern )        // Bild-links  ->  Welt +x
 *   panel.rotation.y = Math.PI           // Plane-Normale zeigt zum Zuschauer (-z)
 *
 * Durch die 180-Grad-Drehung kippt die lokale u-Achse ebenfalls, und zwar genau so,
 * dass u = 0 wieder links auf dem Bildschirm landet. Es ist deshalb KEINE zusaetzliche
 * UV-Spiegelung noetig — beide Vorzeichenwechsel heben sich auf.
 *
 * ---------------------------------------------------------------------------
 * IMPORT-PFAD model.js
 * ---------------------------------------------------------------------------
 * Der Server liefert das gemeinsame Datenmodell unter /shared/model.js aus. Ein
 * relativer Pfad ('../../../shared/model.js') wuerde nur dann stimmen, wenn der
 * Client-Ordner exakt an der Wurzel haengt. Da das eine Annahme ueber fremden Code
 * waere, wird bewusst der absolute Pfad benutzt — der ist durch den Auftrag gedeckt
 * ("im Zweifel /shared/model.js absolut") und aendert sich nicht mit der Verschachtelung.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStageScenery, createReferenceFigure, createDeckTexture } from './stageScenery.js';
import { panelTravelM } from '/shared/model.js';
import { t, register, fmtMeters, onLangChange } from '../i18n.js';

/*
 * ACHTUNG beim Lesen: mehrere Funktionen weiter unten benutzen `t` als lokale
 * Laufvariable (Kamerafahrt, Texturfreigabe). Das verdeckt dort das importierte
 * `t` — an genau diesen Stellen wird auch nichts uebersetzt. Wer dort spaeter
 * Text ausgeben will, muss die lokale Variable vorher umbenennen.
 */

register('en', {
  "{n} Panel · Fahrweg {m}": "{n} panel(s) · travel {m}",
  "Einrasten (Alt hält frei)": "Snapping on (hold Alt to disable)",
  "Panel anfassen": "Grab panel",
  "Panel schieben": "Move panel",
  "Panelposition uebernehmen": "Apply panel position",
  "Buehnen- und Sichtgrenzen aufbauen": "Build stage and sightline boundaries",
  "verdeckt — vom Zuschauerraum aus nicht mehr sichtbar": "masked — no longer visible from the auditorium",
  // Aufbau und Fehler
  'createStage3D: kein canvas uebergeben.': 'createStage3D: no canvas given.',
  '3D-Ansicht laesst sich nicht starten (WebGL): {msg}':
    'The 3D view cannot be started (WebGL): {msg}',
  'Kein Farbraum-Chunk in three gefunden — Ausgabe bleibt linear.':
    'No color space chunk found in three — output stays linear.',
  '3D-Ansicht — {where}: {msg}': '3D view — {where}: {msg}',
  'Video {id} laesst sich nicht oeffnen': 'Cannot open video {id}',
  'Fahrweg {wall}/{panel}': 'Travel {wall}/{panel}',
  'Oeffnung {wall}': 'Opening {wall}',
  'Panel auswaehlen': 'Select panel',
  'Tooltip': 'Tooltip',
  'Videopool-Kopplung': 'Video pool connection',
  'Videostatus': 'Video status',
  'Zeichnen': 'Drawing',
  'Szene aktualisieren': 'Scene update',
  'Inhalt zur Transportzeit aktualisieren': 'Content update at playhead position',
  'Videotexturen auffrischen': 'Video texture refresh',
  'Groesse anpassen': 'Resize',
  'Kamera': 'Camera',
  'Kamera setzen': 'Set camera',
  'Kamerapreset "{id}" gibt es im Venue nicht.':
    'This venue has no camera preset "{id}".',
  'Screenshot': 'Screenshot',
  'Sprachwechsel': 'Language change',
  'TESTBILD': 'TEST PATTERN',
  'Bühnenraum: schematische Vorschau': 'Stage surround: indicative preview',
  '{wall}: {n} Panels verfahren': '{wall}: {n} panels moved',

  // Infokasten unten links
  'Kein Venue geladen.': 'No venue loaded.',
  'Alle Wände geschlossen — durchgehendes Bild.': 'All walls closed — continuous image.',
  '{wall} offen: {gap} frei — dahinter sichtbar: {behind}':
    '{wall} open: {gap} clear — visible behind: {behind}',
  'Wand {id}': 'Wall {id}',
  'nichts': 'nothing',
  'Kamera: {preset} · Helligkeit {brightness} · Schwarzwert +{lift} %':
    'Camera: {preset} · Brightness {brightness} · Black level +{lift} %',

  // Tooltip am Panel
  'Fahrweg {m} nach {dir}': 'Travel {m} to the {dir}',
  'links': 'left',
  'rechts': 'right',
  'geschlossen': 'closed',
  '{wall} · {panel} · {pw} × {ph} px · {m}{travel}':
    '{wall} · {panel} · {pw} × {ph} px · {m}{travel}',

  // Massbeschriftung an den Wandkanten (Sprites)
  '{wall} — {w} × {h} · {pw} × {ph} px': '{wall} — {w} × {h} · {pw} × {ph} px',
  '{panel} · {px} px · {m}': '{panel} · {px} px · {m}',
});

/* ==========================================================================
 * Konstanten
 * ========================================================================== */

const COL_ACCENT = 0x3ee0c6;   // Auswahl / Akzent
const COL_SEAM = 0x59d8ff;     // Panelnaehte
const COL_SAFE = 0xff3b4d;     // Safe-Area
const COL_FRAME = 0x15181c;    // Panelrahmen (Bezel)
const COL_PORTAL = 0x424e5c;   // Portalsaeulen und Sturz
const COL_HOUSE = 0x05070a;    // Zuschauerraum vor der Buehnenkante

const STAGE_FRONT_Z = -1;      // Buehnenvorderkante
const STAGE_BACK_Z = 16;       // hinteres Ende des gezeichneten Bodens
const FLOOR_HALF_W = 30;       // halbe Breite der Bodenflaeche

const CAM_TWEEN_MS = 600;
const PICK_DRAG_TOLERANCE_PX = 5;

/** Standardwerte, falls state.ui.stage (noch) unvollstaendig ist. */
const STAGE_DEFAULTS = {
  cameraPreset: 'audience',
  showFloor: true,
  showFigure: true,
  showScenery: true,
  showReflections: true,
  testPattern: true,
  ledRealism: true,
  bezel: 0.4,        // Zentimeter
  blackLift: 0.02,
  brightness: 1.0,
  ambient: 0.15,
  holoOpacity: 0,    // Holo-Ebene standardmaessig aus
};

const OVERLAY_DEFAULTS = {
  seams: true,
  safeArea: false,
  grid: false,
  ruler: false,
  wireframe: false,
};

/**
 * Ausgabe-Farbraum-Chunk. In three r152+ heisst er colorspace_fragment, davor
 * encodings_fragment. Wir suchen ihn zur Laufzeit, damit ein Versionswechsel der
 * Abhaengigkeit nicht in einem stummen schwarzen Bild endet.
 */
const OUTPUT_COLORSPACE_CHUNK = (() => {
  const chunks = THREE.ShaderChunk || {};
  if (chunks.colorspace_fragment) return '#include <colorspace_fragment>';
  if (chunks.encodings_fragment) return '#include <encodings_fragment>';
  console.warn('[stage3d]', t('Kein Farbraum-Chunk in three gefunden — Ausgabe bleibt linear.'));
  return '';
})();

/* ==========================================================================
 * Kleine Helfer
 * ========================================================================== */

/** Hoehe der Referenzfigur in Metern. */
const FIGURE_HEIGHT_M = 1.8;

/** Beschriftung unter einer Wand: Metermass und Pixelmass. */
function wallLabelText(spec, widthM, heightM) {
  return t('{wall} — {w} × {h} · {pw} × {ph} px', {
    wall: spec.id,
    w: fmtMeters(widthM),
    h: fmtMeters(heightM),
    pw: spec.width,
    ph: spec.height,
  });
}

/** Beschriftung ueber einem Panel. */
function panelLabelText(panelSpec, widthM) {
  return t('{panel} · {px} px · {m}', {
    panel: panelSpec.id,
    px: panelSpec.width,
    m: fmtMeters(widthM),
  });
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function pick(obj, key, fallback) {
  const v = obj ? obj[key] : undefined;
  return v === undefined || v === null ? fallback : v;
}

/**
 * Aktiver Layer eines Slots zum Zeitpunkt timeSec.
 * Die 3D-Vorschau zeigt bewusst nur EINEN Layer je Slot: das Uebereinanderblenden
 * mehrerer Layer ist Sache des Renders (ffmpeg overlay) und des Panel-Editors.
 */
function resolveSlotLayer(slot, timeSec) {
  if (!slot || slot.enabled === false) return null;
  const layers = (slot.layers || []).filter((l) => l && l.enabled !== false && l.mediaId);
  if (layers.length === 0) return null;
  const sorted = [...layers].sort(
    (a, b) => (a.time?.startSec ?? 0) - (b.time?.startSec ?? 0)
  );
  let active = null;
  for (const l of sorted) {
    if ((l.time?.startSec ?? 0) <= timeSec + 1e-6) active = l;
  }
  return active;
}

/** Wandzustand aus dem Projekt, mit unschaedlichem Ersatz wenn es ihn noch nicht gibt. */
function wallStateOf(project, wallId) {
  const ws = project?.walls?.[wallId];
  if (ws) return ws;
  return { id: wallId, slots: {}, travel: 0, travelMode: '2+2', visible: true, previewGain: 1 };
}

/** Central clear width from actual cabinet intervals, including odd panel counts and manual offsets. */
function effectiveCenterGapM(spec, state) {
  if (!spec.panels?.length) return 0;
  let left = -spec.widthM / 2;
  let right = spec.widthM / 2;
  const metersPerPixel = spec.widthM / spec.width;
  for (let index = 0; index < spec.panels.length; index += 1) {
    const panel = spec.panels[index];
    const start = panel.x * metersPerPixel - spec.widthM / 2 + panelTravelM(spec, state, index);
    const end = start + panel.width * metersPerPixel;
    if (start <= 0.0001 && end >= -0.0001) return 0;
    if (end < 0) left = Math.max(left, end);
    if (start > 0) right = Math.min(right, start);
  }
  return Math.max(0, right - left);
}

/* ==========================================================================
 * Texturen aus dem Canvas — Silhouette, Bodenglanz, Beschriftung
 * ========================================================================== */

/** Diagnostic pattern used only in the preview when an entire slot has no media. */
function makeTestPattern(spec) {
  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = Math.round(canvas.width * spec.height / spec.width);
  const context = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const gradient = context.createLinearGradient(0, h, w, 0);
  gradient.addColorStop(0, '#225f69');
  gradient.addColorStop(0.48, '#162d40');
  gradient.addColorStop(1, '#78562f');
  context.fillStyle = gradient;
  context.fillRect(0, 0, w, h);
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(136,213,229,0.2)';
  const step = w / 24;
  context.beginPath();
  for (let x = 0; x <= w; x += step) { context.moveTo(x, 0); context.lineTo(x, h); }
  for (let y = 0; y <= h; y += step) { context.moveTo(0, y); context.lineTo(w, y); }
  context.stroke();
  context.strokeStyle = 'rgba(116,223,231,0.68)';
  context.lineWidth = 2;
  context.shadowColor = '#66cddb';
  context.shadowBlur = 10;
  context.beginPath();
  context.arc(w / 2, h / 2, Math.min(w, h) * 0.30, 0, Math.PI * 2);
  context.moveTo(w / 2, h * 0.13); context.lineTo(w / 2, h * 0.87);
  context.moveTo(w * 0.12, h / 2); context.lineTo(w * 0.88, h / 2);
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = '#142d3c';
  context.fillRect(w * 0.37, h * 0.32, w * 0.26, h * 0.36);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#dfe7e6';
  context.font = `500 ${Math.round(h * 0.17)}px system-ui,sans-serif`;
  context.fillText(spec.id, w / 2, h * 0.43);
  context.font = `500 ${Math.round(h * 0.025)}px system-ui,sans-serif`;
  context.fillStyle = '#87acb7';
  context.fillText(t('TESTBILD'), w / 2, h * 0.565);
  context.fillStyle = '#bdcbd0';
  context.fillText(`${spec.width} × ${spec.height} px`, w / 2, h * 0.62);
  for (let index = 0; index < 6; index += 1) {
    context.fillStyle = ['#e2e9e5', '#e6bc72', '#67c8cf', '#699dbc', '#496b85', '#273c50'][index];
    context.fillRect(w * 0.38 + index * w * 0.04, h * 0.83, w * 0.04, h * 0.028);
  }
  for (const p of spec.panels || []) {
    const x = (p.x + p.width / 2) / spec.width * w;
    context.fillStyle = '#a6bbc3';
    context.font = `500 ${Math.max(14, Math.round(h * 0.025))}px system-ui,sans-serif`;
    context.fillText(p.id, x, h * 0.92);
    context.fillStyle = '#caac73';
    context.fillRect(p.x / spec.width * w + 4, 4, p.width / spec.width * w - 8, 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Textur mit dem Beschriftungstext. Getrennt von makeLabelSprite, weil beim
 * Sprachwechsel nur die Textur neu erzeugt werden muss — ein Sprite-Text ist
 * ein Bild, er aendert sich nicht von selbst mit.
 */
function makeLabelTexture(text, colorCss) {
  const pad = 8;
  const fontPx = 34;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `600 ${fontPx}px system-ui, sans-serif`;
  const w = Math.ceil(probe.measureText(text).width) + pad * 2;
  const h = fontPx + pad * 2;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.font = `600 ${fontPx}px system-ui, sans-serif`;
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(6,9,12,0.72)';
  g.fillRect(0, 0, w, h);
  g.fillStyle = colorCss;
  g.fillText(text, pad, h / 2 + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { tex, w, h, fontPx };
}

/** Bildgroesse -> Sprite-Groesse in Metern. 34 px Schrift ~ 0,17 m in der Szene. */
function applyLabelScale(sprite, w, h, fontPx) {
  const scaleY = 0.17 * (h / fontPx);
  sprite.scale.set(scaleY * (w / h), scaleY, 1);
}

/** Kleiner Text als Sprite — fuer die Massbeschriftung an den Wandkanten. */
function makeLabelSprite(text, colorCss = '#8ea2b4') {
  const { tex, w, h, fontPx } = makeLabelTexture(text, colorCss);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.userData.labelColor = colorCss;
  applyLabelScale(sprite, w, h, fontPx);
  sprite.renderOrder = 20;
  return sprite;
}

/**
 * Beschriftung eines bestehenden Sprites austauschen. Liefert die alte Textur
 * zurueck — sie ist bereits freigegeben, der Aufrufer muss sie nur noch aus
 * seiner Buchfuehrung nehmen.
 */
function setLabelText(sprite, text, colorCss) {
  if (!sprite || !sprite.material) return null;
  const color = colorCss || sprite.userData.labelColor || '#8ea2b4';
  const { tex, w, h, fontPx } = makeLabelTexture(text, color);
  const old = sprite.material.map;
  sprite.material.map = tex;
  sprite.material.needsUpdate = true;
  sprite.userData.labelColor = color;
  applyLabelScale(sprite, w, h, fontPx);
  if (old && old !== tex) old.dispose();
  return old;
}

/* ==========================================================================
 * LED-Material
 * ==========================================================================
 * Bewusste Entscheidung: eigener ShaderMaterial statt MeshBasicMaterial +
 * onBeforeCompile.
 *
 *   - LED leuchtet selbst, es wird also ohnehin keine Beleuchtungsrechnung gebraucht.
 *     Der komplette Shader passt in 30 Zeilen und ist damit kuerzer und robuster als
 *     ein String-Ersetzungs-Eingriff in three-interne Chunk-Namen, die sich zwischen
 *     Versionen umbenennen (output_fragment -> opaque_fragment -> ...).
 *   - Schwarzwert-Anhebung, Vorschau-Gain, Helligkeit und Pixelraster liegen so in
 *     einer einzigen, lesbaren Rechnung statt verteilt auf mehrere Meshes.
 *   - Das Pixelraster braucht fwidth(), um bei zu kleiner Darstellung von selbst
 *     auszublenden. Mit einem zweiten additiven Mesh waere das nicht moeglich —
 *     es wuerde ueber die ganze Wand moirieren.
 *
 * Farbraum: Eingangstexturen werden auf SRGBColorSpace gesetzt (three sampelt sie
 * dann per sRGB-Texturformat linear), am Ende konvertiert der Chunk zurueck.
 */
function createLedMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uHasMap: { value: 0 },
      uTestMap: { value: null },
      uShowTest: { value: 0 },
      uTestSlice: { value: new THREE.Vector2(0, 1) },
      // Quellausschnitt (u0, v0, uWidth, vHeight) in Textur-UV.
      // ACHTUNG: texture.offset/repeat wirken hier NICHT — three wendet die
      // Texturmatrix nur an, wenn der Shader die uv-Chunks einbindet und die
      // Textur an material.map haengt. Dieser Shader sampelt direkt, also muss
      // der Ausschnitt ueber ein Uniform kommen.
      uSlice: { value: new THREE.Vector4(0, 0, 1, 1) },
      // Zielrechteck im Panel (x, y, w, h) in Panel-UV, y von unten.
      // Damit wird transform.dest/offset/zoom sichtbar: liegt das Motiv nur auf
      // einem Teil des Panels, bleibt der Rest dunkel statt gedehnt.
      uDest: { value: new THREE.Vector4(0, 0, 1, 1) },
      uEmptyColor: { value: new THREE.Color(0x080b0e) },
      uBrightness: { value: 1 },
      uGain: { value: 1 },
      uBlackLift: { value: 0.02 },
      uAmbient: { value: 0.15 },
      uGridStrength: { value: 1 },
      uPixels: { value: new THREE.Vector2(648, 1224) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uHasMap;
      uniform sampler2D uTestMap;
      uniform float uShowTest;
      uniform vec2 uTestSlice;
      uniform vec4  uSlice;
      uniform vec4  uDest;
      uniform vec3  uEmptyColor;
      uniform float uBrightness;
      uniform float uGain;
      uniform float uBlackLift;
      uniform float uAmbient;
      uniform float uGridStrength;
      uniform vec2  uPixels;
      varying vec2 vUv;

      void main() {
        vec3 col = uEmptyColor;
        if (uHasMap < 0.5 && uShowTest > 0.5) {
          col = texture2D(uTestMap, vec2(uTestSlice.x + vUv.x * uTestSlice.y, vUv.y)).rgb;
        }

        // Wo im Panel liegt das Motiv? Ausserhalb von uDest bleibt die Flaeche
        // leer — sonst wuerde ein Motiv, das im Editor nur einen Teil des
        // Panels belegt, hier ueber das ganze Panel gedehnt und die Ansicht
        // waere keine gueltige Vorschau des Renders mehr.
        vec2 t = ( vUv - uDest.xy ) / max( uDest.zw, vec2( 1e-6 ) );

        if ( uHasMap > 0.5 &&
             t.x >= 0.0 && t.x <= 1.0 &&
             t.y >= 0.0 && t.y <= 1.0 ) {

          col = texture2D( uMap, uSlice.xy + t * uSlice.zw ).rgb;

          // sRGB -> linear von Hand.
          //
          // three laedt eine VideoTexture IMMER mit linearem Internalformat,
          // texture.colorSpace = SRGBColorSpace bewirkt bei Video also KEINE
          // Dekodierung durch die Hardware. Ausgeglichen wird das sonst ueber
          // das Define DECODE_VIDEO_TEXTURE - aber nur, wenn die Textur an
          // material.map haengt. Hier liegt sie in uMap eines eigenen
          // ShaderMaterial, also greift es nicht.
          //
          // Ohne diese Zeilen werden sRGB-Werte als linear gelesen und am Ende
          // noch einmal nach sRGB kodiert: die Flaeche wird sichtbar zu hell
          // und flau. Genau die Beurteilung von Helligkeit, Schwarzwert und
          // blackLift, wofuer diese Ansicht da ist, waere damit wertlos.
          col = mix(
            pow( ( col + 0.055 ) / 1.055, vec3( 2.4 ) ),
            col / 12.92,
            vec3( lessThanEqual( col, vec3( 0.04045 ) ) )
          );
        }

        // Preview black-level control maps the range to [blackLift, 1].
        col = uBlackLift + col * ( 1.0 - uBlackLift );

        col *= uBrightness * uGain;

        // Streulicht im Saal legt sich minimal auf die Flaeche.
        col += uAmbient * 0.045;

        // Pixelraster in den tatsächlichen Pixelmaßen der jeweiligen Wand.
        // fwidth() sagt uns, wie gross ein LED-Pixel gerade auf dem Bildschirm ist.
        // Sobald er unter etwa zwei Bildschirmpixel faellt, wird das Raster ausgeblendet,
        // sonst moiriert es. Damit ist die Distanzausblendung analytisch statt geraten.
        if ( uGridStrength > 0.001 ) {
          vec2 p = vUv * uPixels;
          vec2 w = fwidth( p );
          float legible = 1.0 - smoothstep( 0.15, 0.45, max( w.x, w.y ) );
          if ( legible > 0.001 ) {
            vec2 d = abs( fract( p ) - 0.5 );
            float line = smoothstep( 0.34, 0.5, max( d.x, d.y ) );
            col *= 1.0 - line * 0.32 * uGridStrength * legible;
          }
        }

        gl_FragColor = vec4( col, 1.0 );
        ${OUTPUT_COLORSPACE_CHUNK}
      }
    `,
    side: THREE.FrontSide,
    transparent: false,
    depthWrite: true,
  });
}

/** Soft image spill on painted decking, a visual cue rather than a photometric simulation. */
function createFloorSpillMaterial(sourceUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...sourceUniforms, uSpillStrength: { value: 0.55 } },
    vertexShader: `varying vec2 vUv; void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform sampler2D uTestMap;
      uniform float uHasMap;
      uniform float uShowTest;
      uniform vec2 uTestSlice;
      uniform vec4 uSlice;
      uniform vec4 uDest;
      uniform float uBrightness;
      uniform float uGain;
      uniform float uSpillStrength;
      varying vec2 vUv;
      vec3 sampleLight(vec2 uv) {
        if (uHasMap > 0.5) {
          vec2 source = (uv - uDest.xy) / max(uDest.zw, vec2(0.00001));
          if (min(source.x, source.y) < 0.0 || max(source.x, source.y) > 1.0) return vec3(0.0);
          vec3 c = texture2D(uMap, uSlice.xy + source * uSlice.zw).rgb;
          return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, vec3(lessThanEqual(c, vec3(0.04045))));
        }
        if (uShowTest > 0.5) return texture2D(uTestMap, vec2(uTestSlice.x + uv.x * uTestSlice.y, uv.y)).rgb;
        return vec3(0.0);
      }
      void main() {
        vec2 uv = vec2(1.0 - vUv.x, vUv.y);
        float blur = 0.018 + uv.y * 0.07;
        vec3 color = sampleLight(uv) * 0.4;
        color += sampleLight(uv + vec2(blur, 0.012)) * 0.3;
        color += sampleLight(uv - vec2(blur, 0.012)) * 0.3;
        float edge = smoothstep(0.0, 0.045, vUv.x) * smoothstep(0.0, 0.045, 1.0 - vUv.x);
        float alpha = pow(1.0 - vUv.y, 2.5) * edge * uSpillStrength;
        gl_FragColor = vec4(color * uBrightness * uGain, alpha);
        ${OUTPUT_COLORSPACE_CHUNK}
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/* ==========================================================================
 * Hauptfunktion
 * ========================================================================== */

export function createStage3D({ canvas, videoPool, onPick, onPanelMove } = {}) {
  if (!canvas) throw new Error(t('createStage3D: kein canvas uebergeben.'));

  /**
   * Aktuell ausgewaehlte Panels als "wandId/panelId".
   *
   * Die Auswahl ist reiner Anzeigezustand und wird von main.js ueber
   * update(state).ui.selectedPanels gesetzt. Sie bestimmt, welche Teile beim
   * Ziehen gemeinsam fahren — damit lassen sich beliebige Gruppen bilden,
   * etwa nur die beiden inneren Teile oder drei von vier.
   */
  const selectedPanels = new Set();

  /* ---------------- Renderer, Szene, Kamera ---------------- */

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    throw new Error(t('3D-Ansicht laesst sich nicht starten (WebGL): {msg}', { msg: err.message }));
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x070b12, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  camera.position.set(0, 1.2, -12);

  const ambientLight = new THREE.HemisphereLight(0xb2c9e2, 0x29201a, 0.6);
  scene.add(ambientLight);
  const keyLight = new THREE.DirectionalLight(0xffe1b7, 2.2);
  keyLight.position.set(-4, 10, -5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -14;
  keyLight.shadow.camera.right = 14;
  keyLight.shadow.camera.top = 12;
  keyLight.shadow.camera.bottom = -8;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 45;
  keyLight.shadow.normalBias = 0.035;
  keyLight.shadow.bias = -0.0001;
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x83b4e5, 1.8);
  rimLight.position.set(8, 6, -7);
  scene.add(rimLight);
  const apronLight = new THREE.SpotLight(0xffd8a1, 100, 22, 0.55, 0.8, 2);
  apronLight.position.set(-2.8, 6, -1.7);
  apronLight.target.position.set(-2.8, 0, -0.55);
  scene.add(apronLight, apronLight.target);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.screenSpacePanning = true;
  controls.minDistance = 2.5;
  controls.maxDistance = 70;
  controls.minPolarAngle = 0.001;
  // Audience presets look UP at the stage. Limiting to PI/2 silently raised every eye position.
  controls.maxPolarAngle = Math.PI * 0.72;
  controls.target.set(0, 2.5, 3.5);
  controls.update();

  /* ---------------- HTML-Overlay ---------------- */

  const host = canvas.parentElement || document.body;
  // Das Overlay muss absolut ueber dem Canvas liegen. Wenn der Eltern-Container noch
  // 'static' positioniert ist, kann es nicht anders funktionieren — deshalb wird das
  // hier einmalig korrigiert. Andere Layout-Eigenschaften bleiben unangetastet.
  if (host !== document.body && getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
  }

  const overlay = document.createElement('div');
  overlay.className = 'Theater-Bild-Gelöte-stage3d-overlay';
  overlay.style.cssText = [
    'position:absolute', 'inset:0', 'pointer-events:none', 'overflow:hidden',
    'font:12px/1.45 system-ui,sans-serif', 'color:#c8d6e2',
  ].join(';');

  const tipEl = document.createElement('div');
  tipEl.style.cssText = [
    'position:absolute', 'left:0', 'top:0', 'display:none', 'white-space:nowrap',
    'padding:5px 9px', 'border-radius:6px', 'background:rgba(6,10,14,0.9)',
    'border:1px solid rgba(62,224,198,0.35)', 'color:#e6f2fa',
    'box-shadow:0 4px 18px rgba(0,0,0,0.55)', 'transform:translate(12px,12px)',
  ].join(';');
  overlay.appendChild(tipEl);

  const infoEl = document.createElement('div');
  infoEl.style.cssText = [
    'position:absolute', 'right:18px', 'top:18px', 'max-width:44%',
    'padding:7px 10px', 'border-radius:7px', 'background:rgba(6,10,14,0.7)',
    'border:1px solid rgba(255,255,255,0.06)', 'white-space:pre-line',
    'font-size:10px', 'color:#91a5b4', 'text-align:right',
  ].join(';');
  overlay.appendChild(infoEl);

  /* Zeigt waehrend des Ziehens, wie weit gefahren wird. Oben mittig, damit es
     nicht unter dem Mauszeiger klebt. */
  const dragInfoEl = document.createElement('div');
  dragInfoEl.style.cssText = [
    'position:absolute', 'left:50%', 'top:12px', 'display:none', 'white-space:nowrap',
    'padding:6px 12px', 'border-radius:7px', 'background:rgba(6,10,14,0.92)',
    'border:1px solid rgba(255,46,136,0.55)', 'color:#ffd9e8',
    'transform:translateX(-50%)', 'font-weight:600',
    'box-shadow:0 4px 18px rgba(0,0,0,0.55)',
  ].join(';');
  overlay.appendChild(dragInfoEl);

  const errEl = document.createElement('div');
  errEl.style.cssText = [
    'position:absolute', 'left:12px', 'top:12px', 'right:12px', 'display:none',
    'padding:8px 11px', 'border-radius:7px', 'background:rgba(48,8,12,0.92)',
    'border:1px solid rgba(255,59,77,0.5)', 'color:#ffd7dc', 'white-space:pre-line',
  ].join(';');
  overlay.appendChild(errEl);

  host.appendChild(overlay);

  /**
   * Fehler sind nie still: Konsole plus sichtbarer Text im Overlay.
   *
   * Gespeichert wird der DEUTSCHE Schluessel samt Platzhalterwerten, nicht der
   * fertige Satz — sonst stuende nach einem Sprachwechsel die alte Sprache im
   * Kasten.
   */
  const errorEntries = [];

  function renderErrors() {
    errEl.textContent = errorEntries
      .map((e) => t('3D-Ansicht — {where}: {msg}', { where: t(e.whereKey, e.vars), msg: e.msg }))
      .join('\n');
    errEl.style.display = errorEntries.length ? 'block' : 'none';
  }

  function reportError(whereKey, err, vars) {
    const msg = err && err.message ? err.message : String(err);
    console.error(`[stage3d] ${t(whereKey, vars)}:`, err);
    const id = `${whereKey}|${JSON.stringify(vars || null)}|${msg}`;
    if (!errorEntries.some((e) => e.id === id)) {
      errorEntries.push({ id, whereKey, vars, msg });
      if (errorEntries.length > 4) errorEntries.shift();
    }
    renderErrors();
  }

  /* ---------------- Szenen-Grundgeruest (venue-unabhaengig) ---------------- */

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  const disposables = { geometries: new Set(), materials: new Set(), textures: new Set() };
  function track(obj) {
    if (!obj) return obj;
    if (obj.isBufferGeometry) disposables.geometries.add(obj);
    else if (obj.isMaterial) disposables.materials.add(obj);
    else if (obj.isTexture) disposables.textures.add(obj);
    return obj;
  }

  // --- Boden -------------------------------------------------------------
  const floorGroup = new THREE.Group();
  worldGroup.add(floorGroup);

  const stageFloorGeo = track(new THREE.PlaneGeometry(FLOOR_HALF_W * 2, STAGE_BACK_Z - STAGE_FRONT_Z));
  const deckTexture = track(createDeckTexture());
  deckTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const stageFloorMat = track(new THREE.MeshStandardMaterial({
    color: 0x526273, map: deckTexture, roughness: 0.5, metalness: 0.15,
    bumpMap: deckTexture, bumpScale: 0.002,
  }));
  const stageFloor = new THREE.Mesh(stageFloorGeo, stageFloorMat);
  stageFloor.rotation.x = -Math.PI / 2;
  stageFloor.position.set(0, 0, (STAGE_FRONT_Z + STAGE_BACK_Z) / 2);
  stageFloor.receiveShadow = true;
  floorGroup.add(stageFloor);

  const houseFloorGeo = track(new THREE.PlaneGeometry(FLOOR_HALF_W * 2, 40));
  const houseFloorMat = track(new THREE.MeshStandardMaterial({
    color: COL_HOUSE, roughness: 1.0, metalness: 0.0,
  }));
  const houseFloor = new THREE.Mesh(houseFloorGeo, houseFloorMat);
  houseFloor.rotation.x = -Math.PI / 2;
  houseFloor.position.set(0, -0.44, STAGE_FRONT_Z - 20);
  floorGroup.add(houseFloor);

  // Buehnenvorderkante bei z = -1
  const edgeGeo = track(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-FLOOR_HALF_W, 0.012, STAGE_FRONT_Z),
    new THREE.Vector3(FLOOR_HALF_W, 0.012, STAGE_FRONT_Z),
  ]));
  const edgeMat = track(new THREE.LineBasicMaterial({ color: 0x4a5560 }));
  const oldFloorEdge = new THREE.Line(edgeGeo, edgeMat);
  oldFloorEdge.visible = false;
  floorGroup.add(oldFloorEdge);

  // 1-m-Raster (dezent) und 5-m-Raster (heller)
  const gridFine = new THREE.GridHelper(60, 60, 0x1c242c, 0x161c22);
  gridFine.position.set(0, 0.004, 5);
  gridFine.material.transparent = true;
  gridFine.material.opacity = 0.35;
  track(gridFine.geometry);
  track(gridFine.material);
  floorGroup.add(gridFine);

  const gridCoarse = new THREE.GridHelper(60, 12, 0x2f3d49, 0x2a3742);
  gridCoarse.position.set(0, 0.006, 5);
  gridCoarse.material.transparent = true;
  gridCoarse.material.opacity = 0.55;
  track(gridCoarse.geometry);
  track(gridCoarse.material);
  floorGroup.add(gridCoarse);

  // --- Portalrahmen ------------------------------------------------------
  const portalGroup = new THREE.Group();
  worldGroup.add(portalGroup);
  const portalMat = track(new THREE.MeshStandardMaterial({
    color: COL_PORTAL, roughness: 0.85, metalness: 0.1,
  }));
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));

  function addPortalPart(sx, sy, sz, px, py, pz) {
    const m = new THREE.Mesh(unitBox, portalMat);
    m.scale.set(sx, sy, sz);
    m.position.set(px, py, pz);
    portalGroup.add(m);
    return m;
  }
  const portalLeft = addPortalPart(0.55, 8.4, 0.7, -7.2, 4.2, STAGE_FRONT_Z - 0.4);
  const portalRight = addPortalPart(0.55, 8.4, 0.7, 7.2, 4.2, STAGE_FRONT_Z - 0.4);
  const portalLintel = addPortalPart(15, 0.7, 0.7, 0, 8.75, STAGE_FRONT_Z - 0.4);
  let scenery = null;

  /* ==========================================================================
   * Haus: Buehnenkante, Portaloeffnung, Sichtgrenzen
   *
   * Ein aufgefahrenes Panel verschwindet irgendwann hinter dem Portal — fuer
   * den Zuschauer ist es dann weg, egal wo es technisch steht. Diese Grenze
   * sichtbar zu machen ist der eigentliche Zweck der 3D-Ansicht beim Planen
   * der Fahrwege.
   *
   * Gerechnet wird flach von oben. Sichtbar ist, was von JEDEM Platz aus durch
   * die Portaloeffnung zu sehen ist — die konservative Auslegung. Der Strahl
   * geht vom aeussersten Platz einer Seite durch die Portalkante DERSELBEN
   * Seite; wer weiter aussen sitzt, sieht auf seiner Seite weniger.
   * ========================================================================== */

  const HOUSE_DEFAULT = {
    prosceniumWidthM: 12, prosceniumHeightM: 7, prosceniumZ: -0.8,
    stageWidthM: 24, stageDepthM: 11, stageFrontZ: -1,
    audienceFrontZ: -3.5, audienceBackZ: -19, audienceHalfWidthM: 8.5,
    eyeHeightM: 1.15, verified: false,
  };
  let house = { ...HOUSE_DEFAULT };
  let sichtGrenzeAktiv = true;

  function readHouse(venue) {
    const h = venue?.house || {};
    const out = { ...HOUSE_DEFAULT };
    for (const k of Object.keys(HOUSE_DEFAULT)) {
      if (typeof h[k] === 'number' && Number.isFinite(h[k])) out[k] = h[k];
    }
    out.verified = h.verified === true;
    for (const k of ['prosceniumWidthM', 'prosceniumHeightM', 'stageWidthM', 'stageDepthM', 'audienceHalfWidthM']) {
      if (!(out[k] > 0)) out[k] = HOUSE_DEFAULT[k];
    }
    // Ohne Angabe: die Oeffnung muss mindestens die breiteste Wand fassen.
    if (typeof h.prosceniumWidthM !== 'number') {
      const breiteste = Math.max(0, ...(venue?.walls || []).map((w) => w.widthM || 0));
      if (breiteste > 0) out.prosceniumWidthM = breiteste + 1.2;
    }
    if (typeof h.prosceniumHeightM !== 'number') {
      const tallest = Math.max(0, ...(venue?.walls || []).map((w) => (w.heightM || 0) + (w.stage?.floorOffsetM || 0)));
      out.prosceniumHeightM = Math.max(out.prosceniumHeightM, tallest + 0.65);
    }
    return out;
  }

  /**
   * Sichtbarer x-Bereich in der Tiefe z, in Weltkoordinaten.
   * Liefert { min, max } — alles ausserhalb ist fuer mindestens einen
   * Zuschauer vom Portal verdeckt.
   */
  function sichtbarerBereich(z) {
    const p = house.prosceniumWidthM / 2;
    const pz = house.prosceniumZ;
    const tiefe = z - pz;
    if (tiefe <= 0.001) return { min: -p, max: p };

    let min = -Infinity;
    let max = Infinity;
    // Beide Extremplaetze und die Mitte pruefen; die engste Grenze gewinnt.
    for (const sx of [-house.audienceHalfWidthM, 0, house.audienceHalfWidthM]) {
      for (const sz of [house.audienceFrontZ, house.audienceBackZ]) {
        if (Math.abs(pz - sz) < 0.01) continue;
        const f = (z - sz) / (pz - sz);   // Strahlverlaengerung bis Tiefe z
        min = Math.max(min, sx + (-p - sx) * f);
        max = Math.min(max, sx + (p - sx) * f);
      }
    }
    return { min, max };
  }

  /** Ist von diesem Panel noch etwas zu sehen? */
  function panelSichtbar(wall, pan) {
    const z = wall.spec?.stage?.z ?? 0;
    const { min, max } = sichtbarerBereich(z);
    const mitte = pan.group.position.x;
    const links = mitte - pan.widthM / 2;
    const rechts = mitte + pan.widthM / 2;
    // Auch ein Streifen von 10 cm zaehlt noch als sichtbar.
    return rechts > min + 0.1 && links < max - 0.1;
  }

  /* --- Zeichnung: Buehnenkante und Sichtlinien --- */

  const houseGroup = new THREE.Group();
  worldGroup.add(houseGroup);

  const stageEdgeMat = track(new THREE.LineBasicMaterial({ color: 0x4a5a68, transparent: true, opacity: 0.85 }));
  const sightMat = track(new THREE.LineBasicMaterial({ color: 0xff2e88, transparent: true, opacity: 0.5 }));
  let stageEdgeLine = null;
  const sightLines = [];

  function rebuildHouse(venue) {
    house = readHouse(venue);
    if (scenery) {
      worldGroup.remove(scenery);
      disposeObject3D(scenery);
    }
    scenery = createStageScenery(house);
    worldGroup.add(scenery);
    stageFloor.scale.set(house.stageWidthM / (FLOOR_HALF_W * 2), house.stageDepthM / (STAGE_BACK_Z - STAGE_FRONT_Z), 1);
    stageFloor.position.z = house.stageFrontZ + house.stageDepthM / 2;
    deckTexture.repeat.set(house.stageWidthM / 2, house.stageDepthM / 2);
    houseFloor.position.z = house.stageFrontZ - 20;
    // The performer belongs on the apron, in front of the downstage LED surface.
    const downstage = Math.min(...(venue?.walls || []).map((w) => w.stage?.z ?? 0), 0);
    figure.position.set(-house.prosceniumWidthM * 0.28, 0, Math.max(house.stageFrontZ + 0.28, downstage - 0.45));
    figureLabel.position.set(figure.position.x - 0.48, 1.9, figure.position.z);
    apronLight.position.set(figure.position.x, Math.max(4, house.prosceniumHeightM - 1), house.stageFrontZ - 0.7);
    apronLight.target.position.set(figure.position.x, 0, figure.position.z);

    // Portal auf die Hausmasse bringen.
    const ph = house.prosceniumWidthM / 2;
    const pH = house.prosceniumHeightM;
    const pz = house.prosceniumZ;
    portalLeft.scale.set(0.55, pH, 0.7);
    portalLeft.position.set(-ph - 0.275, pH / 2, pz);
    portalRight.scale.set(0.55, pH, 0.7);
    portalRight.position.set(ph + 0.275, pH / 2, pz);
    portalLintel.scale.set(house.prosceniumWidthM + 1.1, 0.7, 0.7);
    portalLintel.position.set(0, pH + 0.35, pz);

    // Alte Linien weg.
    for (const l of [stageEdgeLine, ...sightLines]) {
      if (!l) continue;
      houseGroup.remove(l);
      l.geometry.dispose();
      disposables.geometries.delete(l.geometry);
    }
    sightLines.length = 0;

    // Buehnenumriss: wo die Buehne aufhoert.
    const sw = house.stageWidthM / 2;
    const z0 = house.stageFrontZ;
    const z1 = house.stageFrontZ + house.stageDepthM;
    const y = 0.02;
    stageEdgeLine = new THREE.LineLoop(
      track(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-sw, y, z0), new THREE.Vector3(sw, y, z0),
        new THREE.Vector3(sw, y, z1), new THREE.Vector3(-sw, y, z1),
      ])),
      stageEdgeMat
    );
    houseGroup.add(stageEdgeLine);

    // Sichtgrenzen: fuer jede Wandtiefe die beiden Randpunkte, zu einem
    // Linienzug verbunden. So sieht man den sich verengenden Blickkegel.
    const tiefen = [];
    for (let z = z0; z <= z1 + 0.001; z += 0.5) tiefen.push(z);
    const linkeKante = [];
    const rechteKante = [];
    for (const z of tiefen) {
      const b = sichtbarerBereich(z);
      linkeKante.push(new THREE.Vector3(b.min, y, z));
      rechteKante.push(new THREE.Vector3(b.max, y, z));
    }
    for (const punkte of [linkeKante, rechteKante]) {
      const l = new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(punkte)), sightMat);
      houseGroup.add(l);
      sightLines.push(l);
    }
  }

  // --- Referenzfigur 1,80 m ---------------------------------------------
  const figure = createReferenceFigure();
  figure.traverse((object) => {
    if (object.geometry) track(object.geometry);
    if (object.material) track(object.material);
  });
  worldGroup.add(figure);

  const figureLabel = makeLabelSprite(fmtMeters(FIGURE_HEIGHT_M), '#7f93a5');
  track(figureLabel.material.map);
  track(figureLabel.material);
  figureLabel.position.set(0.6, 1.85, 1.5);
  worldGroup.add(figureLabel);

  /* ---------------- Wandaufbau ---------------- */

  /** Alles, was beim Venue-Wechsel neu gebaut wird, haengt hier drunter. */
  const wallsRoot = new THREE.Group();
  worldGroup.add(wallsRoot);

  /** @type {Array} Aufgebaute Waende. */
  let walls = [];
  /** @type {Array} Alle anklickbaren Meshes. */
  let pickables = [];
  /** Holo-Ebene. */
  let holoMesh = null;

  /** Video-Texturen, key -> THREE.VideoTexture. */
  const textureCache = new Map();
  /** Aktuell benoetigte mediaIds, damit release() korrekt laeuft. */
  let usedMediaIds = new Set();

  let geometrySig = '';
  let contentSig = '';

  function disposeObject3D(root) {
    // Geometrien und Materialien werden geteilt (planeGeo haengt an drei Meshes),
    // deshalb merken wir uns, was schon weg ist.
    const seen = new Set();
    root.traverse((o) => {
      if (o.geometry && !disposables.geometries.has(o.geometry) && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (disposables.materials.has(m) || seen.has(m)) continue;
          seen.add(m);
          const maps = [m.map, ...Object.values(m.uniforms || {}).map((uniform) => uniform.value)];
          for (const texture of maps) {
            if (texture?.isCanvasTexture && !disposables.textures.has(texture) && !seen.has(texture)) {
              seen.add(texture);
              texture.dispose();
            }
          }
          m.dispose();
        }
      }
    });
  }

  function clearWalls() {
    for (const child of [...wallsRoot.children]) {
      wallsRoot.remove(child);
      disposeObject3D(child);
    }
    walls = [];
    pickables = [];
    holoMesh = null;
  }

  function sigOfVenue(venue) {
    if (!venue) return '';
    const parts = [venue.id, venue.pixelPitchMm, JSON.stringify(venue.house || {}), JSON.stringify(venue.camera || {})];
    for (const w of venue.walls || []) {
      parts.push(w.id, w.label, w.width, w.height, w.widthM, w.heightM,
        w.stage?.z, w.stage?.floorOffsetM, w.centerSeamX, w.safeAreaPct);
      for (const p of w.panels || []) parts.push(p.id, p.x, p.width);
    }
    if (venue.holo) {
      parts.push('holo', venue.holo.stage?.z, venue.holo.stage?.widthM, venue.holo.stage?.heightM);
    }
    return parts.join('|');
  }

  /**
   * Geometrie einer Wand aufbauen. Wird NUR bei Venue-Wechsel gerufen —
   * Fahrwege, Texturen und Regler laufen ueber update() ohne Neuaufbau.
   */
  function buildWall(wallSpec) {
    const widthM = wallSpec.widthM;
    const heightM = wallSpec.heightM;
    const mPerPx = widthM / wallSpec.width;
    const zBase = wallSpec.stage?.z ?? 0;
    const yBase = wallSpec.stage?.floorOffsetM ?? 0;
    const yCenter = yBase + heightM / 2;

    const wallGroup = new THREE.Group();
    wallGroup.name = `wall-${wallSpec.id}`;
    wallsRoot.add(wallGroup);

    const rec = {
      id: wallSpec.id,
      spec: wallSpec,
      group: wallGroup,
      panels: [],
      labels: [],
      widthM, heightM, mPerPx, zBase, yBase, yCenter,
      testTexture: makeTestPattern(wallSpec),
    };

    // Wandbeschriftung (ruler): Gesamtmass unter der Wand.
    const wallLabel = makeLabelSprite(wallLabelText(wallSpec, widthM, heightM), '#9db2c4');
    wallLabel.position.set(0, yBase - 0.42, zBase - 0.1);
    wallGroup.add(wallLabel);
    rec.labels.push(wallLabel);

    const panels = wallSpec.panels || [];
    const safePct = wallSpec.safeAreaPct ?? 0.15;
    const safeLeftEnd = safePct * wallSpec.width;             // Wand-Pixel
    const safeRightStart = (1 - safePct) * wallSpec.width;
    const seamX = wallSpec.centerSeamX ?? wallSpec.width / 2;
    const seamZoneHalf = wallSpec.width * 0.03;               // Sperrzone um die Mittelnaht

    panels.forEach((p, index) => {
      const pWidthM = p.width * mPerPx;
      // Bild-x der Panelmitte in Metern, 0 = Wandmitte, positiv = bild-rechts.
      const xImageM = (p.x + p.width / 2) * mPerPx - widthM / 2;

      const pg = new THREE.Group();
      pg.name = `panel-${wallSpec.id}-${p.id}`;
      wallGroup.add(pg);

      // Rahmen/Bezel + Rueckseite in einem: dunkler Kasten hinter der Leuchtflaeche.
      // Ueber scale steuerbar, damit ein Bezel-Regler keine neue Geometrie braucht.
      const frameMat = new THREE.MeshStandardMaterial({
      color: COL_FRAME, roughness: 0.55, metalness: 0.35,
      });
      const frame = new THREE.Mesh(unitBox, frameMat);
      frame.position.set(0, yCenter, zBase + 0.08);
      frame.castShadow = true;
      frame.receiveShadow = true;
      pg.add(frame);

      const planeGeo = new THREE.PlaneGeometry(pWidthM, heightM);

      // Master-Ebene: zeigt den Ausschnitt des Wand-Masters, der auf diesem Panel liegt.
      const masterMat = createLedMaterial();
      masterMat.uniforms.uPixels.value.set(p.width, wallSpec.height);
      masterMat.uniforms.uTestMap.value = rec.testTexture;
      masterMat.uniforms.uTestSlice.value.set(p.x / wallSpec.width, p.width / wallSpec.width);
      const masterMesh = new THREE.Mesh(planeGeo, masterMat);
      masterMesh.rotation.y = Math.PI;  // Leuchtflaeche zeigt zum Zuschauer
      masterMesh.position.set(0, yCenter, zBase);
      masterMesh.userData.pick = { wallId: wallSpec.id, slotId: p.id };
      pg.add(masterMesh);

      // Panel-Ebene: eigener Inhalt dieses Panels, liegt UEBER dem Master.
      // Umsetzung als zweites Mesh mit minimalem z-Versatz (4 mm) statt polygonOffset:
      // im Kamerabild nicht unterscheidbar, aber ohne Tiefenkonflikte bei flachen
      // Blickwinkeln und ohne Sonderfaelle im Shader.
      const panelMat = createLedMaterial();
      panelMat.uniforms.uPixels.value.set(p.width, wallSpec.height);
      const panelMesh = new THREE.Mesh(planeGeo, panelMat);
      panelMesh.rotation.y = Math.PI;
      panelMesh.position.set(0, yCenter, zBase - 0.004);
      panelMesh.renderOrder = 2;
      panelMesh.visible = false;
      panelMesh.userData.pick = { wallId: wallSpec.id, slotId: p.id };
      pg.add(panelMesh);

      const spillDepth = Math.min(3.6, heightM * 0.7);
      const spill = new THREE.Mesh(new THREE.PlaneGeometry(pWidthM, spillDepth), createFloorSpillMaterial(masterMat.uniforms));
      spill.rotation.x = -Math.PI / 2;
      spill.position.set(0, 0.008 + index * 0.0001, zBase - spillDepth / 2);
      spill.renderOrder = 1;
      pg.add(spill);

      // Auswahlrahmen
      const outlineGeo = new THREE.EdgesGeometry(planeGeo);
      const outlineMat = new THREE.LineBasicMaterial({
        color: COL_ACCENT, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false,
      });
      const outline = new THREE.LineSegments(outlineGeo, outlineMat);
      outline.position.set(0, yCenter, zBase - 0.02);
      outline.renderOrder = 12;
      outline.visible = false;
      pg.add(outline);

      // Naehte: senkrechte Leuchtlinien an den Panelkanten.
      const halfW = pWidthM / 2;
      const seamPts = [
        new THREE.Vector3(-halfW, yBase, 0), new THREE.Vector3(-halfW, yBase + heightM, 0),
        new THREE.Vector3(halfW, yBase, 0), new THREE.Vector3(halfW, yBase + heightM, 0),
      ];
      const seamGeo = new THREE.BufferGeometry().setFromPoints(seamPts);
      const seamMat = new THREE.LineBasicMaterial({
        color: COL_SEAM, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const seam = new THREE.LineSegments(seamGeo, seamMat);
      seam.position.set(0, 0, zBase - 0.012);
      seam.renderOrder = 10;
      pg.add(seam);

      // Safe-Area: aeussere 15 % je Wand plus Mittelnaht-Sperrzone,
      // jeweils auf den Bereich dieses Panels zugeschnitten.
      const safeMeshes = [];
      const zones = [
        [0, safeLeftEnd],
        [safeRightStart, wallSpec.width],
        [seamX - seamZoneHalf, seamX + seamZoneHalf],
      ];
      for (const [zs, ze] of zones) {
        const from = Math.max(zs, p.x);
        const to = Math.min(ze, p.x + p.width);
        if (to - from <= 0.5) continue;
        const zw = (to - from) * mPerPx;
        // Lokales x im Panel: bild-links liegt bei lokal +x (siehe Kopfkommentar).
        const centerImage = ((from + to) / 2 - (p.x + p.width / 2)) * mPerPx;
        const zoneGeo = new THREE.PlaneGeometry(zw, heightM);
        const zoneMat = new THREE.MeshBasicMaterial({
          color: COL_SAFE, transparent: true, opacity: 0.2,
          depthWrite: false, side: THREE.DoubleSide,
        });
        const zone = new THREE.Mesh(zoneGeo, zoneMat);
        zone.position.set(-centerImage, yCenter, zBase - 0.03);
        zone.renderOrder = 11;
        zone.visible = false;
        pg.add(zone);
        safeMeshes.push(zone);
      }

      // Massbeschriftung des Panels (ruler)
      const label = makeLabelSprite(panelLabelText(p, pWidthM), '#7f93a5');
      label.position.set(0, yBase + heightM + 0.32, zBase - 0.1);
      pg.add(label);

      rec.panels.push({
        index,
        id: p.id,
        spec: p,
        group: pg,
        frame,
        spill,
        spillDepth,
        masterMesh,
        panelMesh,
        outline,
        seam,
        safeMeshes,
        label,
        widthM: pWidthM,
        xImageM,
        travelM: 0,
      });

      pickables.push(masterMesh, panelMesh);
    });

    // Sprite-Texte sind Bilder — bei Sprachwechsel muessen sie neu gezeichnet
    // werden, sonst bleibt die alte Sprache stehen.
    rec.relabel = () => {
      setLabelText(wallLabel, wallLabelText(wallSpec, widthM, heightM));
      for (const pan of rec.panels) setLabelText(pan.label, panelLabelText(pan.spec, pan.widthM));
      const previous = rec.testTexture;
      rec.testTexture = makeTestPattern(wallSpec);
      for (const pan of rec.panels) pan.masterMesh.material.uniforms.uTestMap.value = rec.testTexture;
      previous.dispose();
    };

    walls.push(rec);
    return rec;
  }

  function buildHolo(venue) {
    if (!venue.holo) return;
    const h = venue.holo;
    const wM = h.stage?.widthM ?? 7.65;
    const hM = h.stage?.heightM ?? 4.78;
    const z = h.stage?.z ?? -1.5;
    const yOff = h.stage?.floorOffsetM ?? 0;

    const geo = new THREE.PlaneGeometry(wM, hM);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7fd4ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    holoMesh = new THREE.Mesh(geo, mat);
    holoMesh.rotation.y = Math.PI;
    holoMesh.position.set(0, yOff + hM / 2, z);
    holoMesh.renderOrder = 6;
    holoMesh.visible = false;
    wallsRoot.add(holoMesh);
  }

  function rebuildGeometry(venue) {
    clearWalls();
    if (!venue) return;
    for (const w of venue.walls || []) buildWall(w);
    buildHolo(venue);
    // Portal, Buehnenkante und Sichtgrenzen haengen am Venue, nicht am Projekt.
    try {
      rebuildHouse(venue);
    } catch (err) {
      reportError('Buehnen- und Sichtgrenzen aufbauen', err);
    }
  }

  /* ---------------- Texturen ---------------- */

  /**
   * One upload per source. Panel crops are uniforms, so all slices can safely
   * share the same VideoTexture instead of uploading a video sixteen times.
   */
  function getTexture(mediaId) {
    const cacheKey = mediaId;
    const existing = textureCache.get(cacheKey);
    let el;
    try {
      el = videoPool.acquire(mediaId);
    } catch (err) {
      reportError('Video {id} laesst sich nicht oeffnen', err, { id: mediaId });
      return null;
    }
    if (!el) return null;
    if (existing?.image === el) return existing;
    if (existing) existing.dispose();
    const isImage = el.tagName === 'IMG';
    const tex = isImage ? new THREE.Texture(el) : new THREE.VideoTexture(el);
    // Both LED and floor shaders decode sRGB explicitly. Image textures must
    // therefore keep their encoded values, as video textures already do.
    tex.colorSpace = isImage ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (isImage && videoPool.isReady(mediaId)) tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    textureCache.set(cacheKey, tex);
    return tex;
  }

  /**
   * Setzt repeat/offset so, dass der Bereich [fracX, fracX+fracW] des SLOTS
   * auf der Textur landet. Ein gesetzter Crop im Layer verkleinert den Quellbereich
   * zusaetzlich — damit sieht die 3D-Ansicht denselben Ausschnitt wie der Editor.
   *
   * Genau hier entsteht der Effekt, um den es geht: bei einem Master-Layer bekommt
   * jedes Panel seinen Streifen. Faehrt die Wand auf, reisst das Bild sichtbar.
   */
  /**
   * Rechnet aus einem Layer das Zielrechteck im Slot (in Slot-Pixeln) und den
   * sichtbaren Quellausschnitt (in Quell-Pixeln) aus.
   *
   * Die fit-Modi verhalten sich wie in shared/model.js beschrieben und muessen
   * mit dem uebereinstimmen, was server/ops/filtergraph.js spaeter rendert —
   * sonst zeigt die Buehnenansicht etwas anderes als die Lieferdatei.
   *
   *   cover   Slot wird gefuellt, Ueberstand faellt weg -> veraendert den
   *           QUELLAUSSCHNITT, nicht das Zielrechteck
   *   contain Motiv passt ganz hinein, Rest bleibt leer
   *   stretch auf Slotgroesse verzerrt
   *   native  Originalpixel, zentriert
   *   manual  transform.dest woertlich
   */
  function layerPlacement(layer, media, slotW, slotH) {
    const tr = layer?.transform || {};
    const pw = Number(media?.probe?.width) || 0;
    const ph = Number(media?.probe?.height) || 0;

    // Quellausschnitt in Quellpixeln.
    let sx = 0;
    let sy = 0;
    let sw = pw;
    let sh = ph;
    const crop = tr.crop;
    if (crop && pw > 0 && ph > 0) {
      sx = clamp(Number(crop.x) || 0, 0, pw - 1);
      sy = clamp(Number(crop.y) || 0, 0, ph - 1);
      sw = clamp(Number(crop.w) || pw, 1, pw - sx);
      sh = clamp(Number(crop.h) || ph, 1, ph - sy);
    }

    // Ohne bekannte Quellmasse laesst sich nichts rechnen: dann formatfuellend.
    if (!(sw > 0 && sh > 0)) {
      return {
        dest: { x: 0, y: 0, w: slotW, h: slotH },
        slice: { u0: 0, v0: 0, uw: 1, vh: 1 },
      };
    }

    let dest = { x: 0, y: 0, w: slotW, h: slotH };
    let vis = { x: sx, y: sy, w: sw, h: sh };

    const srcAR = sw / sh;
    const slotAR = slotW / slotH;
    const fit = tr.fit || 'cover';

    if (fit === 'cover') {
      if (srcAR > slotAR) {
        const nw = sh * slotAR;
        vis = { x: sx + (sw - nw) / 2, y: sy, w: nw, h: sh };
      } else if (srcAR < slotAR) {
        const nh = sw / slotAR;
        vis = { x: sx, y: sy + (sh - nh) / 2, w: sw, h: nh };
      }
    } else if (fit === 'contain') {
      let w = slotW;
      let h = slotW / srcAR;
      if (h > slotH) {
        h = slotH;
        w = slotH * srcAR;
      }
      dest = { x: (slotW - w) / 2, y: (slotH - h) / 2, w, h };
    } else if (fit === 'native') {
      dest = { x: (slotW - sw) / 2, y: (slotH - sh) / 2, w: sw, h: sh };
    } else if (fit === 'manual') {
      const d = tr.dest || {};
      dest = {
        x: Number(d.x) || 0,
        y: Number(d.y) || 0,
        w: Number(d.w) || slotW,
        h: Number(d.h) || slotH,
      };
    }
    // 'stretch': dest bleibt der ganze Slot.

    const zoom = Number(tr.zoom) || 1;
    if (zoom !== 1 && zoom > 0) {
      const cx = dest.x + dest.w / 2;
      const cy = dest.y + dest.h / 2;
      dest = { x: cx - (dest.w * zoom) / 2, y: cy - (dest.h * zoom) / 2, w: dest.w * zoom, h: dest.h * zoom };
    }
    dest.x += Number(tr.offset?.x) || 0;
    dest.y += Number(tr.offset?.y) || 0;

    return {
      dest,
      slice: {
        u0: vis.x / pw,
        uw: vis.w / pw,
        // Texturen sind mit flipY geladen: v = 0 ist unten, crop.y zaehlt von oben.
        v0: 1 - (vis.y + vis.h) / ph,
        vh: vis.h / ph,
      },
    };
  }

  /**
   * Setzt uSlice und uDest eines Panel-Materials.
   *
   * slotW/slotH  Masse des Slots, auf den sich der Layer bezieht
   *              (Master-Layer -> ganze Wand, Panel-Layer -> das Panel)
   * windowX/W    der Ausschnitt der Slotbreite, den DIESES Panel zeigt.
   *              Genau hier entsteht der Effekt, um den es geht: ein Bild auf
   *              dem Master-Slot wird auf die vier Panels aufgeteilt, und beim
   *              Auffahren sieht man, dass es reisst.
   */
  function applyPlacement(uniforms, layer, media, slotW, slotH, windowX, windowW) {
    if (!uniforms) return;
    const { dest, slice } = layerPlacement(layer, media, slotW, slotH);

    uniforms.uSlice.value.set(slice.u0, slice.v0, slice.uw, slice.vh);
    uniforms.uDest.value.set(
      (dest.x - windowX) / windowW,
      1 - (dest.y + dest.h) / slotH,
      dest.w / windowW,
      dest.h / slotH
    );
  }

  /**
   * Weist jedem Panel seine Textur zu. Nur bei Wechsel des Inhalts noetig,
   * nicht bei jeder Fahrwegs-Aenderung.
   */
  function rebuildContent(venue, project, timeSec) {
    const nextUsed = new Set();
    const wantedKeys = new Set();

    for (const wall of walls) {
      const ws = wallStateOf(project, wall.id);
      const masterLayer = resolveSlotLayer(ws.slots?.master, timeSec);
      const masterMedia = masterLayer
        ? (project?.media || []).find((m) => m.id === masterLayer.mediaId) || null
        : null;

      for (const pan of wall.panels) {
        // --- Master-Streifen ---------------------------------------------
        const mUni = pan.masterMesh.material.uniforms;
        if (masterLayer) {
          const tex = getTexture(masterLayer.mediaId);
          if (tex) {
            // Master-Layer: Slot ist die GANZE Wand, dieses Panel zeigt davon
            // nur den Streifen [pan.spec.x, +pan.spec.width].
            applyPlacement(
              mUni, masterLayer, masterMedia,
              wall.spec.width, wall.spec.height,
              pan.spec.x, pan.spec.width
            );
            mUni.uMap.value = tex;
            mUni.uHasMap.value = 1;
            nextUsed.add(masterLayer.mediaId);
            wantedKeys.add(masterLayer.mediaId);
          } else {
            mUni.uMap.value = null;
            mUni.uHasMap.value = 0;
          }
        } else {
          mUni.uMap.value = null;
          mUni.uHasMap.value = 0;
        }

        // --- Eigener Panel-Inhalt ----------------------------------------
        const panelLayer = resolveSlotLayer(ws.slots?.[pan.id], timeSec);
        const pUni = pan.panelMesh.material.uniforms;
        if (panelLayer) {
          const tex = getTexture(panelLayer.mediaId);
          if (tex) {
            const media = (project?.media || []).find((m) => m.id === panelLayer.mediaId) || null;
            // Panel-Layer: Slot IST das Panel, also volles Fenster.
            applyPlacement(
              pUni, panelLayer, media,
              pan.spec.width, wall.spec.height,
              0, pan.spec.width
            );
            pUni.uMap.value = tex;
            pUni.uHasMap.value = 1;
            pan.panelMesh.visible = true;
            nextUsed.add(panelLayer.mediaId);
            wantedKeys.add(panelLayer.mediaId);
          } else {
            pan.panelMesh.visible = false;
          }
        } else {
          pUni.uMap.value = null;
          pUni.uHasMap.value = 0;
          pan.panelMesh.visible = false;
        }
        const spillSource = pan.panelMesh.visible ? pUni : mUni;
        for (const key of Object.keys(spillSource)) pan.spill.material.uniforms[key] = spillSource[key];
      }
    }

    // Nicht mehr gebrauchte Texturen wegwerfen.
    for (const [key, tex] of [...textureCache.entries()]) {
      if (!wantedKeys.has(key)) {
        tex.dispose();
        textureCache.delete(key);
      }
    }
    // Die Lebensdauer der <video>-Elemente gehoert ALLEIN main.js. Hier wird
    // nur Buch gefuehrt, nichts freigegeben.
    //
    // Frueher stand hier ein videoPool.release() fuer alles, was diese Ansicht
    // nicht mehr braucht. Der Pool ist aber geteilt: main.js haelt Elemente
    // fuer alle aktiven Layer aller Waende, und der Panel-Editor greift auf
    // dieselben zu. release() macht removeAttribute('src') + load() — scrubbt
    // man ueber die Grenze zwischen zwei Layern eines Slots, wurde der Proxy
    // komplett neu geladen und der Editor zeigte solange nur den Platzhalter.
    usedMediaIds = nextUsed;
  }

  /**
   * Signatur des dargestellten Inhalts. Aendert sie sich, wird rebuildContent
   * gerufen.
   *
   * Das Transform MUSS mit hinein: uSlice und uDest werden ausschliesslich in
   * rebuildContent gesetzt. Ohne das Transform in der Signatur zieht man im
   * Panel-Editor den Ausschnitt und die Buehnenansicht bleibt auf dem alten
   * Bild stehen — zwei Ansichten desselben Projekts zeigen dann dauerhaft
   * Verschiedenes.
   */
  function sigOfLayer(l) {
    if (!l) return '-';
    const tr = l.transform || {};
    const c = tr.crop;
    const d = tr.dest;
    return [
      l.mediaId,
      l.id,
      tr.fit || 'cover',
      c ? `${c.x},${c.y},${c.w},${c.h}` : '_',
      tr.fit === 'manual' && d ? `${d.x},${d.y},${d.w},${d.h}` : '_',
      `${tr.offset?.x || 0},${tr.offset?.y || 0}`,
      tr.zoom ?? 1,
    ].join(':');
  }

  function sigOfContent(venue, project, timeSec) {
    if (!venue) return '';
    const parts = [];
    for (const w of venue.walls || []) {
      const ws = wallStateOf(project, w.id);
      parts.push(`${w.id}:m=${sigOfLayer(resolveSlotLayer(ws.slots?.master, timeSec))}`);
      for (const p of w.panels || []) {
        parts.push(`${p.id}=${sigOfLayer(resolveSlotLayer(ws.slots?.[p.id], timeSec))}`);
      }
    }
    return parts.join('|');
  }

  /* ---------------- Zustand & Aktualisierung ---------------- */

  let currentState = null;
  let dirty = true;
  let disposed = false;

  function markDirty() {
    dirty = true;
  }

  controls.addEventListener('change', markDirty);

  /** Kamerafahrt. */
  let camTween = null;
  let trackedPreset = null;
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3();

  function framedFov(preset, position, target) {
    cameraForward.subVectors(target, position).normalize();
    cameraRight.crossVectors(cameraForward, Math.abs(cameraForward.dot(camera.up)) > 0.999
      ? new THREE.Vector3(0, 0, -1) : camera.up).normalize();
    cameraUp.crossVectors(cameraRight, cameraForward).normalize();
    const isPlan = preset.id === 'plan';
    const dressed = currentState?.ui?.stage?.showScenery !== false;
    const halfWidth = isPlan ? house.stageWidthM / 2 : house.prosceniumWidthM / 2 + (dressed ? 2.1 : 0.4);
    const top = house.prosceniumHeightM + (dressed ? 1.3 : 0.2);
    const front = house.stageFrontZ - (dressed ? 1.2 : 0);
    const back = house.stageFrontZ + house.stageDepthM;
    let tangent = Math.tan(THREE.MathUtils.degToRad(preset.fov || 40) / 2);
    for (const x of [-halfWidth, halfWidth]) {
      for (const y of [-0.45, top]) {
        for (const z of [front, back]) {
          cameraOffset.set(x, y, z).sub(position);
          const distance = cameraOffset.dot(cameraForward);
          if (distance <= 0.1) continue;
          tangent = Math.max(tangent,
            Math.abs(cameraOffset.dot(cameraUp)) / distance * 1.07,
            Math.abs(cameraOffset.dot(cameraRight)) / distance / Math.max(0.3, camera.aspect) * 1.07);
        }
      }
    }
    return clamp(THREE.MathUtils.radToDeg(2 * Math.atan(tangent)), 20, 115);
  }

  function stopPresetTracking() { trackedPreset = null; }
  controls.addEventListener('start', stopPresetTracking);

  function applyPreset(preset, immediate) {
    if (!preset) return;
    trackedPreset = preset;
    const toPos = new THREE.Vector3().fromArray(preset.pos || [0, 1.2, -12]);
    const toTarget = new THREE.Vector3().fromArray(preset.target || [0, 2.5, 3.5]);
    const toFov = framedFov(preset, toPos, toTarget);
    immediate ||= window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (immediate) {
      camera.position.copy(toPos);
      controls.target.copy(toTarget);
      camera.fov = toFov;
      camera.updateProjectionMatrix();
      controls.update();
      camTween = null;
      controls.enabled = true;
      markDirty();
      return;
    }
    camTween = {
      t0: performance.now(),
      dur: CAM_TWEEN_MS,
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
      fromFov: camera.fov,
      toFov,
    };
    controls.enabled = false;
    startPump();
    markDirty();
  }

  function stepCamTween(now) {
    if (!camTween) return false;
    const t = clamp((now - camTween.t0) / camTween.dur, 0, 1);
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
    camera.fov = camTween.fromFov + (camTween.toFov - camTween.fromFov) * e;
    camera.updateProjectionMatrix();
    if (t >= 1) {
      camTween = null;
      controls.enabled = true;
    }
    return true;
  }

  /**
   * Fahrwege und alle Regler anwenden. Baut bewusst nichts neu auf —
   * das ist der Pfad, der beim Ziehen am Travel-Regler jeden Frame laeuft.
   */
  function applyDynamic(state) {
    const venue = state.venue;
    const project = state.project;
    const ui = state.ui || {};
    const stageUi = { ...STAGE_DEFAULTS, ...(ui.stage || {}) };
    const ov = { ...OVERLAY_DEFAULTS, ...(ui.overlays || {}) };
    const bezelM = Math.max(0, stageUi.bezel || 0) / 100;

    const environment = clamp(stageUi.ambient, 0, 2);
    ambientLight.intensity = 0.48 + environment * 2;
    keyLight.intensity = 3 + environment * 3;
    rimLight.intensity = 2.3 + environment * 2;
    apronLight.intensity = stageUi.showScenery !== false ? 70 + environment * 150 : 0;

    floorGroup.visible = stageUi.showFloor !== false;
    gridFine.visible = !!ov.grid;
    gridCoarse.visible = !!ov.grid;
    gridFine.material.opacity = 0.3;
    gridCoarse.material.opacity = 0.5;
    if (scenery) scenery.visible = stageUi.showScenery !== false;
    portalGroup.visible = stageUi.showScenery !== false;
    if (scenery) scenery.traverse((object) => {
      if (object.material?.isMeshStandardMaterial) object.material.wireframe = !!ov.wireframe;
    });
    figure.visible = stageUi.showFigure !== false;
    figureLabel.visible = stageUi.showFigure !== false && !!ov.ruler;

    stageFloorMat.wireframe = !!ov.wireframe;
    houseFloorMat.wireframe = !!ov.wireframe;
    portalMat.wireframe = !!ov.wireframe;

    const activeWallId = ui.activeWallId || null;
    const activeSlotId = ui.activeSlotId || null;

    for (const wall of walls) {
      const ws = wallStateOf(project, wall.id);
      wall.group.visible = ws.visible !== false;
      const gain = clamp(ws.previewGain ?? 1, 0, 4);

      for (const pan of wall.panels) {
        const slotHasContent = (slot) => slot?.enabled !== false &&
          (slot?.layers || []).some((layer) => layer?.enabled !== false && layer?.mediaId);
        const isEmpty = !slotHasContent(ws.slots?.master) && !slotHasContent(ws.slots?.[pan.id]);
        let travel = 0;
        try {
          travel = panelTravelM(wall.spec, ws, pan.index) || 0;
        } catch (err) {
          reportError('Fahrweg {wall}/{panel}', err, { wall: wall.id, panel: pan.id });
        }
        pan.travelM = travel;
        // Bild-x -> Welt-x: Vorzeichen drehen (siehe Kopfkommentar).
        pan.group.position.x = -(pan.xImageM + travel);

        pan.frame.scale.set(
          pan.widthM + 2 * bezelM,
          wall.heightM + 2 * bezelM,
          0.14
        );
        pan.frame.material.wireframe = !!ov.wireframe;

        for (const mesh of [pan.masterMesh, pan.panelMesh]) {
          const u = mesh.material.uniforms;
          u.uBrightness.value = clamp(stageUi.brightness, 0, 4);
          u.uGain.value = gain;
          u.uBlackLift.value = stageUi.ledRealism ? clamp(stageUi.blackLift, 0, 0.4) : 0;
          u.uAmbient.value = clamp(stageUi.ambient, 0, 2);
          u.uShowTest.value = stageUi.testPattern !== false && isEmpty ? 1 : 0;
          // Bei leerem Slot bleibt das Raster an, damit die Flaeche sichtbar ist.
          u.uGridStrength.value = stageUi.ledRealism ? 1 : (u.uHasMap.value > 0.5 ? 0 : 0.6);
          mesh.material.wireframe = !!ov.wireframe;
        }

        pan.seam.visible = !!ov.seams;
        pan.spill.visible = stageUi.showFloor !== false && stageUi.showReflections !== false && !ov.wireframe;
        const spillDepth = Math.max(0.01, Math.min(pan.spillDepth, wall.zBase - house.stageFrontZ));
        pan.spill.scale.y = spillDepth / pan.spillDepth;
        pan.spill.position.z = wall.zBase - spillDepth / 2;
        const spillSource = pan.panelMesh.visible ? pan.panelMesh.material.uniforms : pan.masterMesh.material.uniforms;
        for (const key of Object.keys(spillSource)) pan.spill.material.uniforms[key] = spillSource[key];
        for (const z of pan.safeMeshes) z.visible = !!ov.safeArea;
        pan.label.visible = !!ov.ruler;

        // Umrandung zeigt zweierlei: den Slot, der im Inspektor bearbeitet
        // wird, UND die Auswahl fuers gemeinsame Schieben.
        const imInspektor = activeWallId === wall.id &&
          (activeSlotId === pan.id || activeSlotId === 'master');
        const inAuswahl = selectedPanels.has(`${wall.id}/${pan.id}`);
        pan.outline.visible = imInspektor || inAuswahl;
        if (pan.outline.material) {
          pan.outline.material.depthTest = !ov.wireframe;
          // Ausgewaehlte Teile kraeftig, der Inspektor-Slot dezent.
          pan.outline.material.opacity = inAuswahl ? 1 : 0.45;
          pan.outline.material.color.set(inAuswahl ? 0xff2e88 : 0x3ee0c6);
        }

        // Verdeckt der Zuschauerblick dieses Teil? Dann abdunkeln — so sieht
        // man sofort, ab wann ein Panel aus dem Portal gefahren ist.
        const verdeckt = sichtGrenzeAktiv && !panelSichtbar(wall, pan);
        // Sightline evaluation is diagnostic. It must not alter content luminance
        // or turn opaque cabinets transparent in the visual preview.
        pan.label.material.opacity = verdeckt ? 0.4 : 1;
      }

      for (const l of wall.labels) l.visible = !!ov.ruler;
    }

    if (holoMesh) {
      const op = clamp(stageUi.holoOpacity ?? 0, 0, 1);
      holoMesh.visible = op > 0.001;
      holoMesh.material.opacity = op * 0.6;
      holoMesh.material.wireframe = !!ov.wireframe;
    }

    updateInfoOverlay(venue, project, ui);
  }

  /* ---------------- Durchblick-Pruefung ---------------- */

  /**
   * Was steht hinter der Oeffnung dieser Wand? Betrachtet werden nur Waende, die
   * weiter upstage stehen, sichtbar sind und die Oeffnung tatsaechlich zustellen —
   * also selbst weniger weit aufgefahren sind.
   */
  function wallBehind(venue, project, wall, gap) {
    const zSelf = wall.spec.stage?.z ?? 0;
    const candidates = (venue.walls || [])
      .filter((w) => (w.stage?.z ?? 0) > zSelf)
      .sort((a, b) => (a.stage?.z ?? 0) - (b.stage?.z ?? 0));
    for (const cand of candidates) {
      const ws = wallStateOf(project, cand.id);
      if (ws.visible === false) continue;
      let candGap = 0;
      try {
        candGap = effectiveCenterGapM(cand, ws);
      } catch (err) {
        reportError('Oeffnung {wall}', err, { wall: cand.id });
      }
      if (candGap < gap - 0.01) return cand;
    }
    return null;
  }

  function updateInfoOverlay(venue, project, ui) {
    if (!venue) {
      infoEl.textContent = t('Kein Venue geladen.');
      return;
    }
    const lines = [];
    for (const wall of walls) {
      const ws = wallStateOf(project, wall.id);
      if (ws.visible === false) continue;
      let gap = 0;
      try {
        gap = effectiveCenterGapM(wall.spec, ws);
      } catch (err) {
        reportError('Oeffnung {wall}', err, { wall: wall.id });
        continue;
      }
      if (gap <= 0.005) {
        const moved = wall.panels.filter((panel) => Math.abs(panel.travelM) > 0.005).length;
        if (moved) lines.push(t('{wall}: {n} Panels verfahren', { wall: wall.id, n: moved }));
        continue;
      }
      const behind = wallBehind(venue, project, wall, gap);
      lines.push(t('{wall} offen: {gap} frei — dahinter sichtbar: {behind}', {
        wall: wall.id,
        gap: fmtMeters(gap),
        behind: behind ? t('Wand {id}', { id: behind.id }) : t('nichts'),
      }));
    }
    if (lines.length === 0) {
      lines.push(t('Alle Wände geschlossen — durchgehendes Bild.'));
    }
    const stageUi = { ...STAGE_DEFAULTS, ...((ui && ui.stage) || {}) };
    if (stageUi.showScenery !== false && !house.verified) lines.push(t('Bühnenraum: schematische Vorschau'));
    infoEl.textContent = lines.join('\n');
  }

  /* ---------------- Maus: Auswahl und Tooltip ---------------- */

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let downX = 0;
  let downY = 0;
  let pointerDown = false;

  function ndcFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointerNdc.y = -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    return rect;
  }

  /** Sichtbar heisst: das Mesh UND jeder Vorfahr bis zur Szene. */
  function isTrulyVisible(obj) {
    let o = obj;
    while (o) {
      if (o.visible === false) return false;
      o = o.parent;
    }
    return true;
  }

  function hitAt(ev) {
    ndcFromEvent(ev);
    scene.updateMatrixWorld();
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(pickables.filter(isTrulyVisible), false);
    if (!hits.length) return null;
    const occluders = [
      ...(scenery?.visible ? scenery.children : []),
      ...(portalGroup.visible ? portalGroup.children : []),
      ...(figure.visible ? figure.children : []),
    ];
    const blocked = raycaster.intersectObjects(occluders, false)[0];
    return blocked && blocked.distance < hits[0].distance - 0.01 ? null : hits[0];
  }

  function findPanelRecord(wallId, slotId) {
    const wall = walls.find((w) => w.id === wallId);
    if (!wall) return null;
    return wall.panels.find((p) => p.id === slotId) || null;
  }

  /* ==========================================================================
   * Panels von Hand schieben
   *
   * Echte Waende haengen an Traversen und lassen sich einzeln fahren — nicht
   * nur symmetrisch als 2+2 oder 4x. Deshalb kann hier jedes Panel angefasst
   * und beliebig verschoben werden, und mehrere ausgewaehlte Panels bewegen
   * sich gemeinsam.
   *
   * Gezogen wird in der Ebene, in der die Wand steht (z = Wandtiefe). Der
   * Schnittpunkt des Mauszeigerstrahls mit dieser Ebene liefert die Weltposition
   * direkt in Metern — kein Umrechnen ueber Bildschirmpixel, kein Verrutschen
   * bei gedrehter Kamera.
   *
   * ACHTUNG Vorzeichen: Bild-x laeuft nach rechts, Welt-x nach links
   * (pan.group.position.x = -(xImageM + travel)). Ein Zug um +d in der Welt ist
   * also ein Fahrweg von -d.
   * ========================================================================== */

  const SNAP_TOLERANZ_M = 0.06;
  const dragPlane = new THREE.Plane();
  const dragPoint = new THREE.Vector3();
  const wallWorld = new THREE.Vector3();

  let drag = null; // { wallId, startWorldX, panels:[{pan, startTravelM}], moved }

  /** Weltposition x des Zeigers in der Ebene der Wand. */
  function pointerWorldX(ev, wall) {
    ndcFromEvent(ev);
    raycaster.setFromCamera(pointerNdc, camera);
    wall.group.getWorldPosition(wallWorld);
    dragPlane.set(new THREE.Vector3(0, 0, 1), -(wallWorld.z + wall.zBase));
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return null;
    return dragPoint.x;
  }

  /**
   * Rastpunkte fuer den Fahrweg eines Panels: geschlossen, Kante an
   * Buehnenmitte, und Kante an Kante mit jedem anderen Panel derselben Wand.
   * Alles in Fahrweg-Metern.
   */
  function snapKandidaten(wall, pan) {
    const halbe = pan.widthM / 2;
    // Umrechnung: gewuenschte Weltmitte -> Fahrweg.
    // pan.group.position.x = -(xImageM + travel)  =>  travel = -weltMitte - xImageM
    const ausWeltMitte = (m) => -m - pan.xImageM;

    const out = [0];                       // geschlossen
    out.push(ausWeltMitte(halbe));         // linke Kante auf Buehnenmitte
    out.push(ausWeltMitte(-halbe));        // rechte Kante auf Buehnenmitte
    out.push(ausWeltMitte(0));             // mittig auf der Buehnenmitte

    for (const other of wall.panels) {
      if (other === pan) continue;
      const oMitte = other.group.position.x;
      const oLinks = oMitte - other.widthM / 2;
      const oRechts = oMitte + other.widthM / 2;
      out.push(ausWeltMitte(oRechts + halbe));  // buendig rechts daneben
      out.push(ausWeltMitte(oLinks - halbe));   // buendig links daneben
    }

    // Genau an der Sichtgrenze: der Punkt, ab dem der Zuschauer nichts mehr
    // sieht. Beim Planen der Fahrwege der wichtigste Anschlag ueberhaupt.
    const z = wall.spec?.stage?.z ?? 0;
    const b = sichtbarerBereich(z);
    out.push(ausWeltMitte(b.min - halbe));   // gerade eben verschwunden, links
    out.push(ausWeltMitte(b.min + halbe));   // gerade noch ganz drin, links
    out.push(ausWeltMitte(b.max + halbe));   // gerade eben verschwunden, rechts
    out.push(ausWeltMitte(b.max - halbe));   // gerade noch ganz drin, rechts

    return out.filter((n) => Number.isFinite(n));
  }

  function snappe(wert, kandidaten) {
    let best = wert;
    let bestAbstand = SNAP_TOLERANZ_M;
    for (const k of kandidaten) {
      const d = Math.abs(k - wert);
      if (d < bestAbstand) { bestAbstand = d; best = k; }
    }
    return best;
  }

  function onPointerDown(ev) {
    if (camTween) return;
    pointerDown = true;
    downX = ev.clientX;
    downY = ev.clientY;
    drag = null;

    // Nur die linke Taste zieht Panels; alles andere bleibt Kamerabedienung.
    if (ev.button !== 0) return;

    try {
      const hit = hitAt(ev);
      const payload = hit?.object?.userData?.pick;
      if (!payload) return;

      const wall = walls.find((w) => w.id === payload.wallId);
      const pan = findPanelRecord(payload.wallId, payload.slotId);
      if (!wall || !pan) return;

      // Welche Panels bewegen sich mit? Ist das angefasste Teil Teil der
      // Auswahl, faehrt die ganze Auswahl. Sonst faehrt nur dieses Teil.
      const key = `${payload.wallId}/${payload.slotId}`;
      const inAuswahl = selectedPanels.has(key);
      const mitfahrer = [];
      if (inAuswahl) {
        for (const w of walls) {
          for (const p of w.panels) {
            if (selectedPanels.has(`${w.id}/${p.id}`)) mitfahrer.push({ wall: w, pan: p });
          }
        }
      } else {
        mitfahrer.push({ wall, pan });
      }
      // The grabbed cabinet drives snapping even when several walls are selected.
      mitfahrer.sort((a, b) => Number(b.pan === pan) - Number(a.pan === pan));

      const startX = pointerWorldX(ev, wall);
      if (startX == null) return;

      drag = {
        wall,
        startWorldX: startX,
        panels: mitfahrer.map((m) => ({ ...m, startTravelM: m.pan.travelM || 0 })),
        moved: false,
      };
      controls.enabled = false;
      canvas.setPointerCapture?.(ev.pointerId);
    } catch (err) {
      reportError('Panel anfassen', err);
      drag = null;
    }
  }

  function onPointerUp(ev) {
    if (!pointerDown) return;
    pointerDown = false;
    if (ev.button !== 0) return;
    const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);

    if (drag) {
      const gezogen = drag.moved;
      const ergebnis = drag.panels.map((p) => ({
        wallId: p.wall.id,
        panelId: p.pan.id,
        offsetM: Math.round((p.pan.travelM || 0) * 1000) / 1000,
      }));
      controls.enabled = !camTween;
      drag = null;
      if (canvas.hasPointerCapture?.(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
      dragInfoEl.style.display = 'none';
      if (gezogen) {
        // Erst beim Loslassen in das Projekt schreiben — waehrend des Ziehens
        // wuerde jeder Frame einen Speichervorgang ausloesen.
        if (typeof onPanelMove === 'function') {
          try {
            onPanelMove(ergebnis);
          } catch (err) {
            reportError('Panelposition uebernehmen', err);
          }
        }
        return;
      }
    }

    if (moved > PICK_DRAG_TOLERANCE_PX) return;   // war ein Orbit-Zug, keine Auswahl
    try {
      const hit = hitAt(ev);
      if (!hit) {
        // Klick ins Leere hebt die Auswahl auf.
        if (typeof onPick === 'function') onPick({ wallId: null, slotId: null, additive: false, range: false });
        return;
      }
      const payload = hit.object.userData?.pick;
      if (payload && typeof onPick === 'function') {
        onPick({
          ...payload,
          additive: ev.ctrlKey || ev.metaKey,
          range: ev.shiftKey,
        });
      }
    } catch (err) {
      // reportError bekommt IMMER den deutschen Schluessel, nie t(...) —
      // sonst laesst sich der Kasten beim Sprachwechsel nicht neu beschriften.
      reportError('Panel auswaehlen', err);
    }
  }

  /** Waehrend des Ziehens: Positionen live setzen, ohne den Store anzufassen. */
  function handleDragMove(ev) {
    if (!drag.moved && Math.hypot(ev.clientX - downX, ev.clientY - downY) <= PICK_DRAG_TOLERANCE_PX) return;
    const x = pointerWorldX(ev, drag.wall);
    if (x == null) return;
    const deltaWelt = x - drag.startWorldX;
    if (Math.abs(deltaWelt) > 0.001) drag.moved = true;

    // Welt-Delta -> Fahrweg-Delta (Vorzeichen dreht sich).
    let deltaTravel = -deltaWelt;

    // Einrasten am ANGEFASSTEN Panel, die uebrigen folgen starr — sonst
    // wuerde jedes Teil einzeln einrasten und die Gruppe auseinanderfallen.
    if (!ev.altKey && drag.panels.length > 0) {
      const fuehrend = drag.panels[0];
      const roh = fuehrend.startTravelM + deltaTravel;
      const gerastet = snappe(roh, snapKandidaten(drag.wall, fuehrend.pan));
      deltaTravel += gerastet - roh;
    }

    for (const p of drag.panels) {
      const ziel = p.startTravelM + deltaTravel;
      p.pan.travelM = ziel;
      p.pan.group.position.x = -(p.pan.xImageM + ziel);
    }
    markDirty();
    startPump();

    // Anzeige, wie weit gefahren wurde.
    const f = drag.panels[0];
    const betrag = f.pan.travelM;
    dragInfoEl.textContent = t('{n} Panel · Fahrweg {m}', {
      n: drag.panels.length,
      m: `${betrag >= 0 ? '+' : '−'}${fmtMeters(Math.abs(betrag))}`,
    }) + (ev.altKey ? '' : ` · ${t('Einrasten (Alt hält frei)')}`);
    dragInfoEl.style.display = 'block';
  }

  function onPointerMove(ev) {
    if (drag) {
      tipEl.style.display = 'none';
      try {
        handleDragMove(ev);
      } catch (err) {
        reportError('Panel schieben', err);
      }
      return;
    }
    if (pointerDown) {
      tipEl.style.display = 'none';
      return;
    }
    try {
      const rect = ndcFromEvent(ev);
      const hit = hitAt(ev);
      if (!hit) {
        tipEl.style.display = 'none';
        return;
      }
      const { wallId, slotId } = hit.object.userData.pick;
      const wall = walls.find((w) => w.id === wallId);
      const pan = findPanelRecord(wallId, slotId);
      if (!wall || !pan) {
        tipEl.style.display = 'none';
        return;
      }
      const dir = pan.travelM < -0.005 ? t('links') : pan.travelM > 0.005 ? t('rechts') : null;
      const travelTxt = dir
        ? ` · ${t('Fahrweg {m} nach {dir}', { m: fmtMeters(Math.abs(pan.travelM)), dir })}`
        : ` · ${t('geschlossen')}`;
      tipEl.textContent = t('{wall} · {panel} · {pw} × {ph} px · {m}{travel}', {
        // wall.spec.label kommt aus der Venue-Datei und ist Anwenderdatei, kein Programmtext.
        wall: wall.spec.label || t('Wand {id}', { id: wallId }),
        panel: pan.id,
        pw: pan.spec.width,
        ph: wall.spec.height,
        m: fmtMeters(pan.widthM),
        travel: travelTxt,
      });
      tipEl.style.display = 'block';
      const x = clamp(ev.clientX - rect.left, 0, rect.width - 20);
      const y = clamp(ev.clientY - rect.top, 0, rect.height - 20);
      tipEl.style.left = `${x}px`;
      tipEl.style.top = `${y}px`;
    } catch (err) {
      tipEl.style.display = 'none';
      reportError('Tooltip', err);
    }
  }

  function onPointerLeave() {
    if (!drag) pointerDown = false;
    tipEl.style.display = 'none';
  }

  function onPointerCancel() {
    pointerDown = false;
    if (drag) {
      drag = null;
      if (currentState?.venue) applyDynamic(currentState);
      markDirty();
      startPump();
    }
    controls.enabled = !camTween;
    dragInfoEl.style.display = 'none';
    tipEl.style.display = 'none';
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('lostpointercapture', onPointerCancel);

  /* ---------------- Videopool-Kopplung ---------------- */

  let unsubscribeReady = null;
  if (videoPool && typeof videoPool.onReady === 'function') {
    try {
      unsubscribeReady = videoPool.onReady(() => {
        // A reselected folder can replace the source element while layer IDs
        // stay unchanged. Rebind its texture on the next update/tick.
        contentSig = '';
        for (const tex of textureCache.values()) tex.needsUpdate = true;
        markDirty();
      });
    } catch (err) {
      reportError('Videopool-Kopplung', err);
    }
  }

  /** Laeuft gerade irgendein Video? Dann muss jeder Frame neu gezeichnet werden. */
  function anyVideoPlaying() {
    if (!videoPool || typeof videoPool.all !== 'function') return false;
    try {
      for (const texture of textureCache.values()) {
        const el = texture.image;
        if (el && !el.paused && !el.ended && el.readyState >= 2) return true;
      }
    } catch (err) {
      reportError('Videostatus', err);
    }
    return false;
  }

  /* ---------------- Zeichnen ---------------- */

  function renderFrame() {
    renderer.render(scene, camera);
  }

  let needsAnotherFrame = false;
  function renderIfNeeded() {
    if (disposed) return;
    const now = performance.now();
    let moving = false;
    if (stepCamTween(now)) moving = true;
    // update() muss auch waehrend einer Kamerafahrt laufen (controls.enabled steuert
    // nur die Eingabe, nicht die Ausrichtung) und liefert true, solange sich etwas
    // bewegt — Daempfung wie Kamerafahrt.
    if (controls.update()) moving = true;
    needsAnotherFrame = moving;
    if (moving) dirty = true;
    if (!dirty && !anyVideoPlaying()) return;
    dirty = false;
    try {
      renderFrame();
    } catch (err) {
      reportError('Zeichnen', err);
    }
  }

  /**
   * Eigene rAF-Schleife, die NUR laeuft, solange etwas nachlaeuft (Kamerafahrt oder
   * Orbit-Daempfung). Im Ruhezustand steht sie still — die GPU wird nicht wachgehalten.
   * Der normale Zeichenweg ist tick() aus der Renderschleife des Hosts.
   */
  let pumpId = 0;
  function pumpStep() {
    pumpId = 0;
    if (disposed) return;
    renderIfNeeded();
    if (camTween || dirty || needsAnotherFrame) startPump();
  }
  function startPump() {
    if (pumpId || disposed) return;
    pumpId = requestAnimationFrame(pumpStep);
  }

  /* ---------------- Sprachwechsel ---------------- */

  /**
   * Alles neu beschriften. Die Sprite-Texte sind Texturen: ohne Neuerzeugung
   * bliebe an den Wandkanten die alte Sprache und das alte Zahlenformat stehen.
   */
  function relabelAll() {
    const oldMap = setLabelText(figureLabel, fmtMeters(FIGURE_HEIGHT_M));
    if (oldMap) disposables.textures.delete(oldMap);
    track(figureLabel.material.map);
    for (const wall of walls) {
      if (typeof wall.relabel === 'function') wall.relabel();
    }
  }

  const offLangChange = onLangChange(() => {
    if (disposed) return;
    try {
      relabelAll();
      // Der Tooltip haelt eine fertige Zeile — beim naechsten Ueberfahren
      // entsteht sie in der neuen Sprache neu.
      tipEl.style.display = 'none';
      renderErrors();
      if (currentState && currentState.venue) {
        updateInfoOverlay(currentState.venue, currentState.project, currentState.ui || {});
      } else {
        infoEl.textContent = t('Kein Venue geladen.');
      }
      markDirty();
      startPump();
    } catch (err) {
      reportError('Sprachwechsel', err);
    }
  });

  /* ---------------- Oeffentliche API ---------------- */

  function update(state) {
    if (disposed || !state) return;
    try {
      currentState = state;
      const venue = state.venue || null;
      worldGroup.visible = !!venue;
      const project = state.project || null;
      const timeSec = state.ui?.transport?.timeSec ?? 0;

      // Auswahl uebernehmen. Sie kommt aus main.js und entscheidet, welche
      // Panels beim Ziehen gemeinsam fahren.
      selectedPanels.clear();
      for (const k of state.ui?.selectedPanels || []) selectedPanels.add(k);

      // Sichtgrenzen ein-/ausblendbar wie die uebrigen Ueberlagerungen.
      sichtGrenzeAktiv = state.ui?.overlays?.sightlines !== false;
      houseGroup.visible = sichtGrenzeAktiv;

      const gSig = sigOfVenue(venue);
      if (gSig !== geometrySig) {
        geometrySig = gSig;
        contentSig = '';
        rebuildGeometry(venue);
        // Nach einem Venue-Wechsel steht die Kamera auf dem Hauspreset.
        const presets = venue?.camera?.presets || [];
        const wanted = state.ui?.stage?.cameraPreset || venue?.camera?.default;
        applyPreset(presets.find((p) => p.id === wanted) || presets[0], true);
      }

      if (venue) {
        const cSig = sigOfContent(venue, project, timeSec);
        if (cSig !== contentSig) {
          contentSig = cSig;
          rebuildContent(venue, project, timeSec);
        }
        applyDynamic(state);
      } else {
        infoEl.textContent = t('Kein Venue geladen.');
      }
      markDirty();
      startPump();
    } catch (err) {
      reportError('Szene aktualisieren', err);
    }
  }

  function tick(timeSec) {
    if (disposed) return;

    // Den Zeitstand HIER auswerten und nicht auf update(state) warten.
    //
    // main.js schreibt die Transportzeit waehrend der Wiedergabe mit
    // { silent: true } in den Store — es gibt also keine Benachrichtigung und
    // damit keinen update()-Aufruf. Verliesse man sich darauf, bliebe die
    // Slot-Aufloesung auf dem Layer stehen, der beim Druecken von Play aktiv
    // war: drei Clips auf 'master' bei 0/15/30 s wuerden beim Abspielen nie
    // umschalten. Beim Scrubben fiel das nicht auf, weil der Scrubber nicht
    // silent setzt.
    if (currentState && Number.isFinite(timeSec)) {
      try {
        const venue = currentState.venue;
        if (venue) {
          const cSig = sigOfContent(venue, currentState.project, timeSec);
          if (cSig !== contentSig) {
            contentSig = cSig;
            rebuildContent(venue, currentState.project, timeSec);
            markDirty();
          }
        }
      } catch (err) {
        reportError('Inhalt zur Transportzeit aktualisieren', err);
      }
    }

    // VideoTexture schedules uploads on decoded frames; paused videos need no repeated upload.
    renderIfNeeded();
  }

  function resize() {
    if (disposed) return;
    try {
      const w = Math.max(1, canvas.clientWidth || canvas.width || 1);
      const h = Math.max(1, canvas.clientHeight || canvas.height || 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      if (trackedPreset && camTween) camTween.toFov = framedFov(trackedPreset, camTween.toPos, camTween.toTarget);
      if (trackedPreset && !camTween) camera.fov = framedFov(trackedPreset, camera.position, controls.target);
      camera.updateProjectionMatrix();
      markDirty();
      startPump();
    } catch (err) {
      reportError('Groesse anpassen', err);
    }
  }

  function setCamera(presetId) {
    if (disposed) return;
    try {
      const presets = currentState?.venue?.camera?.presets || [];
      const preset = presets.find((p) => p.id === presetId);
      if (!preset) {
        reportError('Kamera', new Error(
          t('Kamerapreset "{id}" gibt es im Venue nicht.', { id: presetId })
        ));
        return;
      }
      applyPreset(preset, false);
    } catch (err) {
      reportError('Kamera setzen', err);
    }
  }

  function screenshot() {
    if (disposed) return '';
    try {
      renderFrame();                       // frischer Frame, dann sofort auslesen
      return canvas.toDataURL('image/png');
    } catch (err) {
      reportError('Screenshot', err);
      return '';
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (pumpId) cancelAnimationFrame(pumpId);
    pumpId = 0;

    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('lostpointercapture', onPointerCancel);
    controls.removeEventListener('change', markDirty);
    controls.removeEventListener('start', stopPresetTracking);

    if (typeof unsubscribeReady === 'function') {
      try {
        unsubscribeReady();
      } catch (err) {
        console.error('[stage3d] onReady abmelden:', err);
      }
    }

    if (typeof offLangChange === 'function') {
      try {
        offLangChange();
      } catch (err) {
        console.error('[stage3d] onLangChange abmelden:', err);
      }
    }

    // Auch hier NICHT freigeben: der Pool wird geteilt (Panel-Editor, main.js).
    // Beim Ansichtswechsel wuerde sonst jedes Video neu geladen.
    usedMediaIds = new Set();

    for (const tex of textureCache.values()) tex.dispose();
    textureCache.clear();

    clearWalls();
    if (scenery) disposeObject3D(scenery);
    for (const g of disposables.geometries) g.dispose();
    for (const m of disposables.materials) m.dispose();
    for (const t of disposables.textures) t.dispose();
    disposables.geometries.clear();
    disposables.materials.clear();
    disposables.textures.clear();

    scene.clear();
    controls.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();

    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }

  // Erster Aufbau der Groesse, damit die Ansicht auch ohne resize()-Aufruf stimmt.
  resize();

  /**
   * Auskunft ueber den Zustand der Szene — fuer die Fehlersuche.
   *
   * Wenn ein Klick kein Panel trifft, ist die Frage immer dieselbe: gibt es
   * anklickbare Flaechen, sind sie sichtbar, und wo liegen sie? Genau das
   * beantwortet diese Funktion, ohne dass jemand im Modul herumstochern muss.
   */
  function debugInfo(clientX, clientY) {
    const sichtbar = pickables.filter(isTrulyVisible);
    const info = {
      pickables: pickables.length,
      davonSichtbar: sichtbar.length,
      waende: walls.map((w) => ({
        id: w.id,
        gruppeSichtbar: w.group.visible,
        panels: w.panels.map((p) => ({
          id: p.id,
          x: Math.round(p.group.position.x * 100) / 100,
          travelM: Math.round((p.travelM || 0) * 100) / 100,
          master: p.masterMesh.visible,
          panel: p.panelMesh.visible,
        })),
      })),
      kamera: { pos: camera.position.toArray().map((n) => Math.round(n * 10) / 10) },
      renderer: { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
        videoTextures: textureCache.size, fov: camera.fov, autoFraming: !!trackedPreset },
      auswahl: [...selectedPanels],
    };
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      const rect = canvas.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(sichtbar, false);
      info.strahl = {
        ndc: [Math.round(pointerNdc.x * 100) / 100, Math.round(pointerNdc.y * 100) / 100],
        canvasRect: { w: Math.round(rect.width), h: Math.round(rect.height) },
        treffer: hits.length,
        erster: hits[0]?.object?.userData?.pick || null,
      };
    }
    return info;
  }

  return { update, tick, resize, setCamera, screenshot, dispose, debugInfo };
}
