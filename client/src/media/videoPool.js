/**
 * Theater-Bild-Gelöte — Videopool.
 *
 * Haelt je Medium ein Video oder ein Browser-Bild als Texturquelle. Die Elemente
 * haengen NICHT im DOM; sie werden nur dekodiert und von three bzw. dem
 * Panel-Editor als Textur gelesen.
 *
 * Zeitliche Zuordnung: der Pool kennt die aktuellen Layer ueber eine Funktion,
 * die der Aufrufer per setLayerSource(fn) setzt. fn liefert [{ mediaId, time }].
 * Damit rechnet seek(t) die Position in der Quelle aus:
 *
 *     quelle = (t - time.startSec) * time.speed + time.inSec
 *
 * geklemmt auf [inSec, outSec], bei time.loop umlaufend.
 */


import { t, register } from '../i18n.js';

/* Diese Meldungen erscheinen genau dann, wenn die Vorschau schwarz bleibt —
   also in dem Moment, in dem der Nutzer eine Erklaerung braucht. Sie muessen
   in seiner Sprache kommen. */
register('en', {
  'Für diese Datei gibt es noch keinen Proxy — die Vorschau bleibt schwarz.':
    'There is no proxy for this file yet — the preview stays black.',
  'Der Proxy konnte nicht dekodiert werden.': 'The proxy could not be decoded.',
  'Proxy konnte nicht geladen werden: {msg}': 'The proxy could not be loaded: {msg}',
  'Der Browser blockiert die automatische Wiedergabe — einmal in den Viewport klicken.':
    'The browser is blocking autoplay — click once inside the viewport.',
  'Wiedergabe fehlgeschlagen: {msg}': 'Playback failed: {msg}',
  'Für diese Datei liegt keine abspielbare Quelle vor — Ordner erneut einlesen.':
    'No playable source is available for this file — read the folder in again.',
});
import { proxyUrl } from '../api.js';

export function createVideoPool({ sourceKind = () => 'video' } = {}) {
  /** mediaId -> { el, ready, errorReported, missingProxy } */
  const entries = new Map();
  const readyCallbacks = new Set();
  const errorCallbacks = new Set();

  let getLayers = () => [];
  let rate = 1;
  let playing = false;
  let lastTime = 0;

  /* ---------------------------------------------------------------- intern */

  function emitReady(mediaId, el) {
    for (const fn of [...readyCallbacks]) {
      try { fn(mediaId, el); } catch (e) { console.error('[videoPool] onReady-Rueckruf hat geworfen:', e); }
    }
  }

  function emitError(payload) {
    console.warn('[videoPool]', payload.message);
    for (const fn of [...errorCallbacks]) {
      try { fn(payload); } catch (e) { console.error('[videoPool] onError-Rueckruf hat geworfen:', e); }
    }
  }

  async function classifyError(mediaId, entry) {
    if (entry.errorReported) return;
    entry.errorReported = true;
    let missing = false;
    const url = proxyUrl(mediaId);
    // blob:-URLs beantworten laut Fetch-Spezifikation nur GET. Ein HEAD darauf
    // scheitert IMMER und wuerde jeden Fehler als "nicht dekodierbar" ausgeben,
    // auch wenn die Datei schlicht fehlt. Fehlt die URL ganz, ist die Sache
    // ohnehin klar.
    if (!url) {
      missing = true;
    } else if (!url.startsWith('blob:')) {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        missing = res.status === 404;
      } catch {
        missing = false;
      }
    }
    if (entries.get(mediaId) !== entry) return;
    entry.missingProxy = missing;
    emitError({
      mediaId,
      kind: missing ? 'noProxy' : 'decode',
      message: missing
        ? t('Für diese Datei gibt es noch keinen Proxy — die Vorschau bleibt schwarz.')
        : t('Der Proxy konnte nicht dekodiert werden.'),
    });
  }

  async function retryMissingProxy(mediaId, entry) {
    // Lokale Proxy-URLs bleiben nach dem Erzeugen unveraendert. Fehlende
    // Quellen gelegentlich leise erneut pruefen, statt einen 404 fuer immer
    // zu cachen oder bei jedem UI-Update erneut ein Video zu laden.
    if (!entry.missingProxy || !entry.src || entry.src.startsWith('blob:') ||
        entry.retryPending || Date.now() < (entry.retryAfter || 0)) return;
    entry.retryPending = true;
    entry.retryAfter = Date.now() + 5_000;
    try {
      const response = await fetch(entry.src, { method: 'HEAD' });
      if (entries.get(mediaId) !== entry || !response.ok) return;
      entry.missingProxy = false;
      entry.errorReported = false;
      entry.el.load();
    } catch {
      // Der urspruengliche Fehler ist bereits sichtbar. Kein Meldungssturm.
    } finally {
      entry.retryPending = false;
    }
  }

  /* ---------------------------------------------------------------- API */

  function acquire(mediaId) {
    if (!mediaId) return null;
    const src = proxyUrl(mediaId);
    const kind = sourceKind(mediaId) === 'image' ? 'image' : 'video';
    const found = entries.get(mediaId);
    if (found && found.src === src && found.kind === kind) {
      retryMissingProxy(mediaId, found);
      return found.el;
    }
    if (found) release(mediaId); // neu erzeugter Proxy / erneut verknuepfte Datei

    const el = document.createElement(kind === 'image' ? 'img' : 'video');
    el.crossOrigin = 'anonymous';
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.loop = false;
    el.autoplay = false;
    el.controls = false;
    // Nicht ins DOM haengen — das Element ist reine Texturquelle.
    el.style.display = 'none';

    const entry = { el, src, kind, ready: false, errorReported: false, missingProxy: false, playPending: false, playBlocked: false, cleanup: null };
    entries.set(mediaId, entry);

    // In der Browser-Fassung liefert proxyUrl() null, wenn die Datei nicht
    // (mehr) vorliegt. el.src = null setzt das Attribut auf die Zeichenkette
    // "null", der Browser laedt dann <basis>/null, bekommt 404 und meldet
    // einen Fehler, der wie ein kaputtes Video aussieht. Also vorher pruefen.
    if (!src) {
      entry.errorReported = true;
      entry.missingProxy = true;
      emitError({
        mediaId,
        kind: 'noProxy',
        message: t('Für diese Datei liegt keine abspielbare Quelle vor — Ordner erneut einlesen.'),
      });
      return el;
    }
    const onCanPlay = () => {
      if (entry.ready || entries.get(mediaId) !== entry) return;
      entry.ready = true;
      seek(lastTime); // auch beim pausierten Scrub die richtige Quellposition zeigen
      emitReady(mediaId, el);
    };
    const onError = () => { classifyError(mediaId, entry); };
    el.addEventListener('load', onCanPlay);
    el.addEventListener('loadeddata', onCanPlay);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('error', onError);
    entry.cleanup = () => {
      el.removeEventListener('load', onCanPlay);
      el.removeEventListener('loadeddata', onCanPlay);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('error', onError);
    };

    el.src = src;
    try { el.load?.(); } catch (e) { emitError({ mediaId, kind: 'load', message: t('Proxy konnte nicht geladen werden: {msg}', { msg: e.message }) }); }
    return el;
  }

  function release(mediaId) {
    const entry = entries.get(mediaId);
    if (!entry) return;
    entries.delete(mediaId);
    entry.cleanup?.();
    try {
      entry.el.pause?.();
      entry.el.removeAttribute('src');
      entry.el.load?.();
    } catch (e) {
      console.warn('[videoPool] Freigeben fehlgeschlagen:', e);
    }
  }

  function safePlay(el, mediaId) {
    const entry = entries.get(mediaId);
    if (!entry || entry.el !== el || entry.playPending || entry.playBlocked) return;
    entry.playPending = true;
    const failed = (e) => {
      if (entries.get(mediaId) !== entry) return;
      if (e?.name !== 'AbortError') entry.playBlocked = true;
      // Autoplay-Sperre ist kein Absturz: melden, nicht werfen.
      if (e && e.name === 'NotAllowedError') {
        emitError({
          mediaId,
          kind: 'autoplay',
          message: t('Der Browser blockiert die automatische Wiedergabe — einmal in den Viewport klicken.'),
        });
      } else if (e && e.name !== 'AbortError') {
        emitError({ mediaId, kind: 'play', message: t('Wiedergabe fehlgeschlagen: {msg}', { msg: e.message }) });
      }
    };
    try {
      Promise.resolve(el.play()).catch(failed).finally(() => { entry.playPending = false; });
    } catch (e) {
      entry.playPending = false;
      failed(e);
    }
  }

  function positionFor(layer, el, timeSec) {
    const timing = layer.time || {};
    const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const startSec = Math.max(0, finite(timing.startSec, 0));
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Infinity;
    const inSec = Math.min(duration, Math.max(0, finite(timing.inSec, 0)));
    const sourceSpeed = finite(timing.speed, 1);
    const speed = sourceSpeed > 0 ? sourceSpeed : 1;
    const outSec = Math.max(inSec, Math.min(duration,
      timing.outSec == null ? duration : finite(timing.outSec, duration)));
    const span = outSec - inSec;
    const elapsed = (timeSec - startSec) * speed;
    const active = elapsed >= 0 && span > 0 && (timing.loop || elapsed < span);
    let target = inSec + Math.max(0, elapsed);
    if (timing.loop && span > 0 && Number.isFinite(span) && elapsed >= 0) target = inSec + elapsed % span;
    if (Number.isFinite(outSec)) target = Math.min(target, Math.max(inSec, outSec - 0.001));
    return { target, speed, active };
  }

  /**
   * Setzt alle Elemente auf die Zeitleistenposition. Darf jeden Frame gerufen
   * werden: geschrieben wird nur, wenn die Abweichung ueber der Toleranz liegt.
   */
  function seek(timeSec) {
    timeSec = Number.isFinite(Number(timeSec)) ? Math.max(0, Number(timeSec)) : 0;
    lastTime = timeSec;
    const layers = safeLayers();
    const seen = new Set();
    const tol = playing ? 0.18 : 0.012;

    // Dasselbe Medium kann mehrmals nacheinander auf der Zeitleiste liegen.
    // Der gerade aktive Layer muss gewinnen, nicht immer dessen erster Einsatz.
    const chosen = new Map();
    for (const layer of layers) {
      const entry = entries.get(layer.mediaId);
      if (!entry || !entry.ready || entry.kind === 'image') continue;
      const position = positionFor(layer, entry.el, timeSec);
      if (!chosen.has(layer.mediaId) || (!chosen.get(layer.mediaId).active && position.active)) {
        chosen.set(layer.mediaId, position);
      }
    }

    for (const [mediaId, { target, speed, active }] of chosen) {
      const entry = entries.get(mediaId);
      seen.add(mediaId);
      const el = entry.el;

      const wanted = clampRate(rate * speed);
      if (Math.abs(el.playbackRate - wanted) > 1e-3) {
        try { el.playbackRate = wanted; } catch { /* Browser mag den Wert nicht */ }
      }

      if (Math.abs(el.currentTime - target) > tol) {
        try { el.currentTime = target; } catch (e) { console.warn('[videoPool] currentTime:', e.message); }
      }

      if (playing && active) {
        if (el.paused) safePlay(el, mediaId);
      } else if (!el.paused) {
        el.pause();
      }
    }

    // Elemente ohne Layer stillstellen.
    for (const [mediaId, entry] of entries) {
      if (entry.kind === 'image' || seen.has(mediaId) || entry.el.paused) continue;
      entry.el.pause();
    }
  }

  function safeLayers() {
    try {
      const list = getLayers();
      return Array.isArray(list) ? list.filter((l) => l && l.mediaId) : [];
    } catch (e) {
      console.error('[videoPool] getLayers hat geworfen:', e);
      return [];
    }
  }

  function clampRate(r) {
    if (!isFinite(r) || r <= 0) return 1;
    return Math.min(16, Math.max(0.0625, r));
  }

  function play() {
    playing = true;
    for (const entry of entries.values()) entry.playBlocked = false;
    seek(lastTime);
  }

  function pause() {
    playing = false;
    for (const entry of entries.values()) {
      if (entry.kind !== 'image' && !entry.el.paused) entry.el.pause();
    }
  }

  function setRate(r) {
    rate = clampRate(r);
    seek(lastTime);
  }

  function isReady(mediaId) {
    const entry = entries.get(mediaId);
    return !!entry && (entry.kind === 'image'
      ? entry.ready && entry.el.complete && entry.el.naturalWidth > 0
      : entry.el.readyState >= 2);
  }

  function all() {
    const map = new Map();
    for (const [mediaId, entry] of entries) map.set(mediaId, entry.el);
    return map;
  }

  function onReady(fn) {
    readyCallbacks.add(fn);
    return () => readyCallbacks.delete(fn);
  }

  /** Meldet fehlende Proxies, Dekodierfehler und die Autoplay-Sperre. */
  function onError(fn) {
    errorCallbacks.add(fn);
    return () => errorCallbacks.delete(fn);
  }

  /** fn liefert die aktuell relevanten Layer als [{ mediaId, time }]. */
  function setLayerSource(fn) {
    getLayers = typeof fn === 'function' ? fn : () => [];
  }

  /** Medien, deren Proxy fehlt — die Oberflaeche bietet dann "Proxy erzeugen" an. */
  function missingProxies() {
    return [...entries.entries()].filter(([, e]) => e.missingProxy).map(([id]) => id);
  }

  /** Elemente, die nicht mehr gebraucht werden, freigeben. */
  function retain(mediaIds) {
    const keep = new Set(mediaIds || []);
    for (const mediaId of [...entries.keys()]) {
      if (!keep.has(mediaId)) release(mediaId);
    }
  }

  function dispose() {
    playing = false;
    for (const mediaId of [...entries.keys()]) release(mediaId);
    readyCallbacks.clear();
    errorCallbacks.clear();
  }

  return {
    acquire, release, seek, play, pause, setRate, isReady, all, onReady,
    onError, setLayerSource, missingProxies, retain, dispose,
    get playing() { return playing; },
  };
}
