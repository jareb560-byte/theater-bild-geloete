import {
  Input, ALL_FORMATS, BlobSource, CanvasSink, Output, BufferTarget,
  Mp4OutputFormat, CanvasSource, Quality, canEncodeVideo,
} from 'mediabunny';
import { getBrowserMediaFile } from '../api.js';
import { createCompositionPlan, frameLayers, drawCompositionFrame } from './browserComposition.js';

const MAX_BYTES = 256 * 1024 * 1024;
const abortError = () => new DOMException('MP4-Export abgebrochen.', 'AbortError');
const checkAbort = (signal) => { if (signal?.aborted) throw abortError(); };
const yieldUi = () => new Promise((resolve) => setTimeout(resolve, 0));

function outputName(project, wallId) {
  const name = String(project.name || 'Buehne').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100);
  return `${name}_Wand-${String(wallId).replace(/[^a-z0-9_-]/gi, '_')}.mp4`;
}

/** Renders a frozen project from user-selected local files, without network requests. */
export async function renderBrowserMp4({ project, venue, wallId, rangeSec = null, onProgress, signal }) {
  checkAbort(signal);
  const snapshot = structuredClone(project);
  const plan = createCompositionPlan({ project: snapshot, venue: structuredClone(venue), wallId, rangeSec });
  const files = new Map(plan.mediaIds.map((id) => [id, getBrowserMediaFile(id)]));
  const mediaById = new Map(snapshot.media.map((media) => [media.id, media]));
  const missing = [...files].filter(([, file]) => !file).map(([id]) => mediaById.get(id)?.name || id);
  if (missing.length) throw new Error(`Bitte diese Medien in der Bibliothek erneut auswählen: ${missing.join(', ')}`);
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    throw new Error('Dieser Browser unterstützt den MP4-Export nicht. Bitte die Seite in einem aktuellen Chrome oder Edge öffnen.');
  }
  const bitrate = Math.round(Math.min(60_000_000, Math.max(6_000_000, plan.width * plan.height * plan.fps * 0.25)));
  if (bitrate * plan.duration / 8 > MAX_BYTES * 0.8) {
    throw new Error('Dieser Export ist für den Browser zu groß. Bitte einen kürzeren Zeitbereich wählen (MP4 maximal 256 MB) oder die Desktop-Fassung verwenden.');
  }
  const quality = new Quality({ bitrate, bitrateMode: 'variable' });
  const encoding = { codec: 'avc', quality, latencyMode: 'quality', keyFrameInterval: 2 };
  onProgress?.({ progress: 0, phase: 'Medien und MP4-Unterstützung prüfen', frame: 0, totalFrames: plan.frameCount });
  const supported = await canEncodeVideo('avc', {
    width: plan.width, height: plan.height, frameRate: plan.fps, quality, latencyMode: 'quality',
  });
  checkAbort(signal);
  if (!supported) throw new Error(`Dieser Browser kann H.264 mit ${plan.width} × ${plan.height} Pixeln bei ${plan.fps} fps nicht exportieren. Bitte Chrome oder Edge mit aktivierter Hardwarebeschleunigung oder die Desktop-Fassung verwenden.`);

  const inputs = new Map();
  const images = new Map();
  const decoders = new Map();
  let output;
  let completed = false;
  let cancelPromise;
  let canvas;
  const cancel = () => {
    for (const { input } of inputs.values()) input.dispose();
    if (output && !cancelPromise && !completed) cancelPromise = output.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (const [id, file] of files) {
      checkAbort(signal);
      const media = mediaById.get(id);
      if (media.kind === 'image') {
        const bitmap = await createImageBitmap(file);
        images.set(id, bitmap);
        checkAbort(signal);
      } else {
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        const info = { input };
        inputs.set(id, info);
        info.track = await input.getPrimaryVideoTrack();
        if (!info.track || !(await info.track.canDecode())) {
          throw new Error(`„${media.name}“ lässt sich im Browser nicht für den Export lesen. Bitte eine H.264-MP4 verwenden.`);
        }
        info.firstTimestamp = await info.track.getFirstTimestamp();
        checkAbort(signal);
      }
    }
    canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Der Browser konnte die Zeichenfläche für den Export nicht anlegen.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const target = new BufferTarget();
    output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'reserve' }) });
    let encodedBytes = 0;
    const source = new CanvasSource(canvas, {
      ...encoding,
      onEncodedPacket(packet) {
        encodedBytes += packet.byteLength;
        if (encodedBytes > MAX_BYTES) throw new Error('Die MP4 überschreitet 256 MB. Bitte einen kürzeren Zeitbereich exportieren.');
      },
    });
    output.addVideoTrack(source, { frameRate: plan.fps, maximumPacketCount: plan.frameCount });
    await output.start();
    checkAbort(signal);
    for (let frame = 0; frame < plan.frameCount; frame++) {
      checkAbort(signal);
      const sources = new Map();
      for (const layer of frameLayers(plan, frame)) {
        if (images.has(layer.mediaId)) {
          sources.set(layer.sourceKey, images.get(layer.mediaId));
          continue;
        }
        let decoder = decoders.get(layer.sourceKey);
        if (!decoder) {
          const { track, firstTimestamp } = inputs.get(layer.mediaId);
          const sink = new CanvasSink(track, { poolSize: 2, alpha: true });
          // One ordered iterator per layer also supports the same clip at different times.
          function* timestamps() {
            for (let index = frame; index < plan.frameCount; index++) {
              const next = frameLayers(plan, index).find((item) => item.sourceKey === layer.sourceKey);
              if (next) yield firstTimestamp + next.sourceTime;
            }
          }
          decoder = sink.canvasesAtTimestamps(timestamps());
          decoders.set(layer.sourceKey, decoder);
        }
        const result = await decoder.next();
        checkAbort(signal);
        if (result.done || !result.value) throw new Error(`Kein Videobild für „${mediaById.get(layer.mediaId)?.name}“ bei ${layer.sourceTime.toFixed(2)} s. Bitte den Quellclip prüfen.`);
        sources.set(layer.sourceKey, result.value.canvas);
      }
      drawCompositionFrame(ctx, plan, frame, sources);
      await source.add(frame / plan.fps, 1 / plan.fps);
      if (frame % 5 === 0 || frame === plan.frameCount - 1) {
        onProgress?.({ progress: (frame + 1) / plan.frameCount * 0.95, phase: 'Wand als MP4 rendern', frame: frame + 1, totalFrames: plan.frameCount });
        await yieldUi();
      }
    }
    checkAbort(signal);
    source.close();
    onProgress?.({ progress: 0.97, phase: 'MP4 fertigstellen', frame: plan.frameCount, totalFrames: plan.frameCount });
    await output.finalize();
    checkAbort(signal);
    completed = true;
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    onProgress?.({ progress: 1, phase: 'MP4 bereit zum Herunterladen', frame: plan.frameCount, totalFrames: plan.frameCount });
    return { blob, fileName: outputName(snapshot, wallId), width: plan.width, height: plan.height,
      fps: plan.fps, frameCount: plan.frameCount, duration: plan.duration };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    // Dispose inputs first to interrupt any pending reads in a failed/cancelled iterator.
    for (const { input } of inputs.values()) input.dispose();
    for (const iterator of decoders.values()) {
      try { await iterator.return(); } catch { /* Already disposed. */ }
    }
    if (!completed && output) { cancel(); await cancelPromise; }
    for (const bitmap of images.values()) bitmap.close();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}
