import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { makeLayer, makeMedia, makeProject } from '../shared/model.js';
import * as composition from '../client/src/export/browserComposition.js';

let fixtureId = 0;

function scene() {
  const venue = { id: 'test', fps: 10, walls: [{ id: 'A', width: 64, height: 32, panels: [{ id: 'A1', x: 0, width: 32 }] }] };
  const project = makeProject(venue, { name: 'Bühnenprobe', loopSeconds: 0.3 });
  const media = makeMedia('clip.mp4', { probe: { width: 64, height: 32, durationSec: 2 } });
  const layer = makeLayer(media.id);
  project.media.push(media);
  project.walls.A.slots.master.layers.push(layer);
  const file = { name: 'clip.mp4', width: 64, height: 32 };
  return { project, venue, media, layer, wallId: 'A', file };
}

async function engine(setup, options = {}) {
  const state = {
    files: new Map([[setup.media.id, setup.file]]), fileLookups: [], inputs: [], bitmaps: [],
    outputs: [], canvases: [], sources: [], sinks: [], packets: [], supportCalls: [],
  };
  class Input {
    constructor({ source }) {
      this.file = source.file;
      this.disposeCalls = 0;
      state.inputs.push(this);
      this.track = {
        file: this.file,
        canDecode: async () => options.canDecode !== false,
        getFirstTimestamp: async () => options.firstTimestamp ?? 0,
      };
    }
    async getPrimaryVideoTrack() { await options.onReadTrack?.(this, state); return this.track; }
    dispose() { this.disposeCalls++; }
  }
  class CanvasSink {
    constructor(track, config) { this.track = track; this.config = config; this.times = []; this.returnCalls = 0; state.sinks.push(this); }
    canvasesAtTimestamps(timestamps) {
      return {
        next: async () => {
          const next = timestamps.next();
          if (next.done) return next;
          this.times.push(next.value);
          await options.onDecode?.(this, state);
          return { done: false, value: options.missingFrame ? null : { canvas: {
            width: this.track.file.width, height: this.track.file.height, file: this.track.file, timestamp: next.value,
          } } };
        },
        return: async () => { this.returnCalls++; return { done: true }; },
      };
    }
  }
  class Output {
    constructor({ target, format }) { Object.assign(this, { target, format, cancelCalls: 0, finalizeCalls: 0 }); state.outputs.push(this); }
    addVideoTrack(source, config) { this.source = source; this.trackConfig = config; }
    async start() { await options.onStart?.(this, state); }
    async finalize() { this.finalizeCalls++; await options.onFinalize?.(this, state); this.target.buffer = new Uint8Array([1, 2, 3]).buffer; }
    async cancel() { this.cancelCalls++; }
  }
  class CanvasSource {
    constructor(canvas, config) { Object.assign(this, { canvas, config, closeCalls: 0 }); state.sources.push(this); }
    async add(timestamp, duration) {
      state.packets.push({ timestamp, duration, draws: [...this.canvas.ctx.draws] });
      await options.onAdd?.(this, state);
      this.config.onEncodedPacket?.({ byteLength: options.packetBytes ?? 100 });
    }
    close() { this.closeCalls++; }
  }
  const fixture = {
    composition,
    bunny: { Input, CanvasSink, Output, CanvasSource,
      ALL_FORMATS: ['test'], BlobSource: class { constructor(file) { this.file = file; } },
      Quality: class { constructor(config) { Object.assign(this, config); } },
      BufferTarget: class {}, Mp4OutputFormat: class { constructor(config) { this.config = config; } },
      canEncodeVideo: async (codec, config) => { state.supportCalls.push({ codec, config }); await options.onSupport?.(state); return options.supported !== false; },
    },
    getBrowserMediaFile: (id) => { state.fileLookups.push(id); return state.files.get(id) ?? null; },
    VideoEncoder: options.webCodecs === false ? undefined : class {},
    VideoDecoder: options.webCodecs === false ? undefined : class {},
    setTimeout: (callback) => { queueMicrotask(callback); return 1; },
    createImageBitmap: async (file) => {
      const bitmap = { ...file, closeCalls: 0, close() { this.closeCalls++; } };
      state.bitmaps.push(bitmap);
      await options.onBitmap?.(bitmap, state);
      return bitmap;
    },
    document: { createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0 };
      const ctx = { canvas, draws: [], fillRect() { this.draws = []; }, drawImage(source, ...args) { this.draws.push({ source, args }); } };
      for (const name of ['save', 'restore', 'setTransform', 'beginPath', 'rect', 'clip', 'translate', 'scale', 'rotate']) ctx[name] = () => {};
      canvas.ctx = ctx;
      canvas.getContext = () => ctx;
      state.canvases.push(canvas);
      return canvas;
    } },
  };
  const key = `__browserMp4Fixture${++fixtureId}`;
  globalThis[key] = fixture;
  let code = await fs.readFile(new URL('../client/src/export/browserMp4.js', import.meta.url), 'utf8');
  code = code
    .replace(/^import \{([\s\S]*?)\} from 'mediabunny';/m, 'const {$1} = fixture.bunny;')
    .replace(/^import \{ getBrowserMediaFile \} from .*;$/m, 'const { getBrowserMediaFile } = fixture;')
    .replace(/^import \{ createCompositionPlan, frameLayers, drawCompositionFrame \} from .*;$/m,
      'const { createCompositionPlan, frameLayers, drawCompositionFrame } = fixture.composition;');
  const prelude = `const fixture=globalThis[${JSON.stringify(key)}]; const { document, VideoEncoder, VideoDecoder, createImageBitmap, setTimeout }=fixture;\n`;
  try {
    const api = await import(`data:text/javascript;base64,${Buffer.from(prelude + code).toString('base64')}`);
    return { render: api.renderBrowserMp4, state };
  } finally { delete globalThis[key]; }
}

test('missing local files fail before codec checks or resource allocation', async () => {
  const setup = scene();
  const { render, state } = await engine(setup);
  state.files.clear();
  await assert.rejects(render(setup), /clip\.mp4.*|erneut auswählen/);
  assert.equal(state.supportCalls.length, 0);
  assert.equal(state.inputs.length, 0);
  assert.equal(state.outputs.length, 0);
});

test('odd raster and unavailable H.264 dimensions fail without opening decoders', async () => {
  const odd = scene();
  odd.venue.walls[0].width = 63;
  const first = await engine(odd);
  await assert.rejects(first.render(odd), /ungerade/);
  assert.equal(first.state.fileLookups.length, 0);
  const setup = scene();
  const { render, state } = await engine(setup, { supported: false });
  await assert.rejects(render(setup), /64 × 32.*10 fps/);
  assert.equal(state.supportCalls[0].codec, 'avc');
  assert.equal(state.inputs.length, 0);
  const unsupported = await engine(setup, { webCodecs: false });
  await assert.rejects(unsupported.render(setup), /Chrome oder Edge/);
  assert.equal(unsupported.state.supportCalls.length, 0);
});

test('successful export uses native dimensions, exact frames and timestamps and releases resources', async () => {
  const setup = scene();
  const { render, state } = await engine(setup);
  const progress = [];
  const result = await render({ ...setup, onProgress: (value) => progress.push(value) });
  assert.equal(result.blob.type, 'video/mp4');
  assert.equal(result.blob.size, 3);
  assert.equal(result.fileName, 'Bühnenprobe_Wand-A.mp4');
  assert.deepEqual([result.width, result.height, result.frameCount, result.duration], [64, 32, 3, 0.3]);
  assert.deepEqual(state.packets.map(({ timestamp, duration }) => [timestamp, duration]), [[0, 0.1], [0.1, 0.1], [0.2, 0.1]]);
  assert.equal(state.outputs[0].trackConfig.maximumPacketCount, 3);
  assert.equal(state.outputs[0].finalizeCalls, 1);
  assert.equal(state.outputs[0].cancelCalls, 0);
  assert.ok(state.inputs[0].disposeCalls > 0);
  assert.equal(state.sinks[0].returnCalls, 1);
  assert.equal(state.sources[0].closeCalls, 1);
  assert.deepEqual([state.canvases[0].width, state.canvases[0].height], [1, 1]);
  assert.equal(progress.at(-1).progress, 1);
});

test('separate layer decoders preserve different times of the same clip and track timestamp offset', async () => {
  const setup = scene();
  const panel = makeLayer(setup.media.id);
  panel.time.inSec = 0.8;
  setup.project.walls.A.slots.A1.layers.push(panel);
  const { render, state } = await engine(setup, { firstTimestamp: 0.5 });
  await render(setup);
  assert.equal(state.inputs.length, 1);
  assert.equal(state.sinks.length, 2);
  assert.deepEqual(state.sinks[0].times, [0.5, 0.6, 0.7]);
  assert.deepEqual(state.sinks[1].times, [1.3, 1.4, 1.5]);
  assert.deepEqual(state.packets[0].draws.map((draw) => draw.source.timestamp), [0.5, 1.3]);
});

test('project, venue, range and file selection stay fixed while asynchronous codec checks run', async () => {
  const setup = scene();
  const rangeSec = [0.1, 0.3];
  const originalFile = setup.file;
  const { render, state } = await engine(setup, { onSupport(state) {
    setup.project.name = 'Changed';
    setup.project.loopSeconds = 2;
    setup.layer.time.inSec = 1;
    setup.venue.walls[0].width = 128;
    rangeSec[0] = 0;
    state.files.set(setup.media.id, { name: 'replacement.mp4', width: 64, height: 32 });
  } });
  const result = await render({ ...setup, rangeSec });
  assert.equal(result.fileName, 'Bühnenprobe_Wand-A.mp4');
  assert.equal(result.width, 64);
  assert.equal(result.frameCount, 2);
  assert.equal(state.inputs[0].file, originalFile);
  assert.deepEqual(state.sinks[0].times, [0.1, 0.2]);
  assert.deepEqual(state.fileLookups, [setup.media.id]);
});

test('abort before rendering allocates nothing', async () => {
  const setup = scene();
  const controller = new AbortController();
  controller.abort();
  const { render, state } = await engine(setup);
  await assert.rejects(render({ ...setup, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(state.fileLookups.length, 0);
  assert.equal(state.inputs.length, 0);
});

test('abort while decoding cancels output, disposes input, returns iterators and closes loaded images', async () => {
  const setup = scene();
  const still = makeMedia('still.png', { kind: 'image', probe: { width: 64, height: 32 } });
  setup.project.media.unshift(still);
  setup.project.walls.A.slots.master.layers.unshift(makeLayer(still.id));
  const controller = new AbortController();
  const { render, state } = await engine(setup, { onDecode() { controller.abort(); } });
  state.files.set(still.id, { name: 'still.png', width: 64, height: 32 });
  await assert.rejects(render({ ...setup, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(state.packets.length, 0);
  assert.ok(state.inputs[0].disposeCalls > 0);
  assert.equal(state.outputs[0].cancelCalls, 1);
  assert.equal(state.outputs[0].finalizeCalls, 0);
  assert.equal(state.sinks[0].returnCalls, 1);
  assert.equal(state.bitmaps[0].closeCalls, 1);
  assert.deepEqual([state.canvases[0].width, state.canvases[0].height], [1, 1]);
});

test('abort immediately after image decoding closes the late bitmap', async () => {
  const setup = scene();
  setup.media.kind = 'image';
  const controller = new AbortController();
  const { render, state } = await engine(setup, { onBitmap() { controller.abort(); } });
  await assert.rejects(render({ ...setup, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(state.bitmaps[0].closeCalls, 1);
  assert.equal(state.outputs.length, 0);
});

test('decode and encoder failures clean up instead of returning a partial MP4', async () => {
  for (const options of [
    { missingFrame: true },
    { onAdd() { throw new Error('encoder failed'); } },
    { onFinalize() { throw new Error('muxer failed'); } },
    { packetBytes: 257 * 1024 * 1024 },
  ]) {
    const setup = scene();
    const { render, state } = await engine(setup, options);
    await assert.rejects(render(setup), /Kein Videobild|encoder failed|muxer failed|256 MB/);
    assert.ok(state.inputs[0].disposeCalls > 0);
    assert.equal(state.outputs[0].cancelCalls, 1);
    assert.equal(state.sinks[0].returnCalls, 1);
    assert.equal(state.canvases[0].width, 1);
  }
});

test('undecodable input and oversized export stop before output allocation', async () => {
  const setup = scene();
  const failed = await engine(setup, { canDecode: false });
  await assert.rejects(failed.render(setup), /H\.264-MP4/);
  assert.ok(failed.state.inputs[0].disposeCalls > 0);
  assert.equal(failed.state.outputs.length, 0);
  setup.project.loopSeconds = 1000;
  setup.layer.time.loop = true;
  const large = await engine(setup);
  await assert.rejects(large.render(setup), /kürzeren Zeitbereich/);
  assert.equal(large.state.supportCalls.length, 0);
  assert.equal(large.state.inputs.length, 0);
});
