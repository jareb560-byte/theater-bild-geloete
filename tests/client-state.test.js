import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

let fixtureNumber = 0;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

async function loadClient(relativeFile, options = {}) {
  let timerId = 0;
  const timers = new Map();
  const fixture = {
    Node: class {}, register() {}, getLang: () => 'de', t: (text) => text,
    fetch: (...args) => globalThis.fetch(...args),
    console: { error() {}, warn() {} },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    ...options,
  };
  const key = `__tbgClientFixture${++fixtureNumber}`;
  globalThis[key] = fixture;
  let code = await fs.readFile(new URL(relativeFile, import.meta.url), 'utf8');
  code = code
    .replace(/^import \{ makeLayer \} from .*;$/m, 'const makeLayer = () => ({});')
    .replace(/^import \{ putProject \} from .*;$/m, 'const putProject = (...args) => fixture.putProject(...args);')
    .replace(/^import \{ proxyUrl \} from .*;$/m, 'const proxyUrl = (id) => fixture.urls.get(id) ?? null;')
    .replaceAll("await import('./store.js')", 'await Promise.resolve(fixture.store)')
    .replace(/^import \{ t, register(?:, getLang)? \} from .*;$/m, 'const { t, register, getLang } = fixture;');
  const prelude = `const fixture = globalThis[${JSON.stringify(key)}]; const { Node, document, console, setTimeout, clearTimeout } = fixture; const fetch = (...args) => fixture.fetch(...args);\n`;
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(prelude + code).toString('base64')}`);
    return { module, timers, fixture };
  } finally {
    delete globalThis[key];
  }
}

test('moving a layer to another wall master uses the explicitly selected wall', async () => {
  const { module: state } = await loadClient('../client/src/store.js', { putProject: async () => ({}) });
  const layer = { id: 'layer-1', mediaId: 'media-1', transform: { fit: 'cover' } };
  state.store.set({ project: { media: [], walls: {
    A: { slots: { master: { width: 100, height: 200, layers: [layer] } } },
    D: { slots: { master: { width: 300, height: 200, layers: [] } } },
  } } });
  state.moveLayer('layer-1', 'master', 'D');
  const moved = state.store.get();
  assert.equal(moved.project.walls.A.slots.master.layers.length, 0);
  assert.equal(moved.project.walls.D.slots.master.layers[0].id, 'layer-1');
  assert.equal(moved.ui.activeWallId, 'D');
  assert.equal(moved.ui.activeSlotId, 'master');
  state.moveLayer('layer-1', 'master', 'missing-wall');
  assert.equal(state.store.get().project.walls.D.slots.master.layers.length, 1, 'invalid target leaves the layer intact');
});

test('flushSave waits for the in-flight request and saves edits made while it was pending', async () => {
  const requests = [];
  const { module: state } = await loadClient('../client/src/store.js', {
    putProject(project) { const pending = deferred(); requests.push({ ...pending, project }); return pending.promise; },
  });
  state.store.set({ project: { name: 'First', media: [], walls: {} } });
  state.markDirty();
  const firstSave = state.flushSave();
  state.updateProject({ name: 'Second' });
  let completed = false;
  const secondSave = state.flushSave().then((value) => { completed = true; return value; });
  assert.equal(requests.length, 1, 'only one PUT may be active');
  assert.equal(state.isDirty(), true, 'unload must warn while a PUT is active');
  requests[0].resolve({});
  await settle();
  assert.equal(completed, false);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].project.name, 'Second');
  requests[1].resolve({});
  assert.equal(await firstSave, true);
  assert.equal(await secondSave, true);
  assert.equal(state.isDirty(), false);
});

test('autosave failures remain dirty and retry with increasing delay', async () => {
  let calls = 0;
  const { module: state, timers, fixture } = await loadClient('../client/src/store.js', {
    putProject: async () => { calls++; throw new Error('offline'); },
  });
  state.store.set({ project: { name: 'Unsaved', media: [], walls: {} } });
  state.markDirty();
  assert.equal(await state.flushSave(), false);
  assert.equal(state.isDirty(), true);
  const firstDelay = [...timers.values()][0].delay;
  assert.ok(firstDelay >= 1_900, 'first retry waits about two seconds');
  assert.equal(calls, 1);
  const retry = [...timers.values()][0];
  await retry.fn();
  const secondDelay = [...timers.values()][0].delay;
  assert.ok(secondDelay > firstDelay);
  assert.ok(secondDelay <= 30_000);
  fixture.putProject = async () => ({});
  assert.equal(await state.flushSave(), true, 'manual retry remains immediate');
  assert.equal(state.isDirty(), false);
  assert.equal(timers.size, 0);
});

class FakeVideo extends EventTarget {
  constructor() {
    super();
    Object.assign(this, { style: {}, paused: true, duration: 10, currentTime: 0, playbackRate: 1, readyState: 0, playCalls: 0, loadCalls: 0 });
  }
  play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() { this.loadCalls++; }
  removeAttribute(name) { delete this[name]; }
  ready() { this.readyState = 2; this.dispatchEvent(new Event('loadeddata')); }
}

async function videoPool() {
  const videos = [];
  const urls = new Map([['media', 'blob:media']]);
  const { module, fixture } = await loadClient('../client/src/media/videoPool.js', {
    urls, document: { createElement: () => { const video = new FakeVideo(); videos.push(video); return video; } },
  });
  return { pool: module.createVideoPool(), videos, urls, fixture };
}

test('browser images become ready without video playback and reload when their source changes', async () => {
  class FakeImage extends EventTarget {
    constructor() { super(); Object.assign(this, { style: {}, complete: false, naturalWidth: 0 }); }
    removeAttribute(name) { delete this[name]; }
    ready() { this.complete = true; this.naturalWidth = 640; this.dispatchEvent(new Event('load')); }
  }
  const urls = new Map([['image', 'blob:first-image']]);
  const { module } = await loadClient('../client/src/media/videoPool.js', {
    urls,
    document: { createElement(tag) { assert.equal(tag, 'img'); return new FakeImage(); } },
  });
  const pool = module.createVideoPool({ sourceKind: () => 'image' });
  const ready = [];
  pool.onReady((id) => ready.push(id));
  pool.setLayerSource(() => [{ mediaId: 'image', time: { startSec: 0, loop: true } }]);
  const first = pool.acquire('image');
  assert.equal(pool.isReady('image'), false);
  first.ready();
  assert.equal(pool.isReady('image'), true);
  pool.play();
  pool.seek(7);
  pool.pause();
  assert.equal('currentTime' in first, false, 'images must never be treated as a video timeline');
  urls.set('image', 'blob:replacement-image');
  const second = pool.acquire('image');
  assert.notEqual(second, first);
  assert.equal(first.src, undefined, 'the old image source is released');
  first.ready();
  assert.deepEqual(ready, ['image'], 'late events from a released image are ignored');
  second.ready();
  assert.deepEqual(ready, ['image', 'image']);
  pool.dispose();
  assert.equal(second.src, undefined);
});

test('looping media stays paused before its layer start and unreferenced media stays paused', async () => {
  const { pool } = await videoPool();
  pool.setLayerSource(() => [{ mediaId: 'media', time: { startSec: 5, loop: true } }]);
  const video = pool.acquire('media');
  video.ready();
  pool.seek(2);
  pool.play();
  assert.equal(video.playCalls, 0);
  assert.equal(video.currentTime, 0);
  pool.seek(5.5);
  assert.equal(video.playCalls, 1);
  assert.equal(video.currentTime, 0.5);
  pool.setLayerSource(() => []);
  pool.play();
  assert.equal(video.paused, true);
  pool.dispose();
});

test('late-loading video seeks to the paused playhead and selects the active repeated layer', async () => {
  const { pool } = await videoPool();
  pool.setLayerSource(() => [
    { mediaId: 'media', time: { startSec: 0, outSec: 1 } },
    { mediaId: 'media', time: { startSec: 5, inSec: 2, outSec: 8 } },
  ]);
  pool.seek(6);
  const video = pool.acquire('media');
  video.ready();
  assert.equal(video.currentTime, 3);
  assert.equal(video.paused, true);
  pool.dispose();
});

test('proxy replacement releases old listeners and ignores late events after disposal', async () => {
  const { pool, urls } = await videoPool();
  const errors = [];
  const ready = [];
  pool.onError((error) => errors.push(error));
  pool.onReady((id) => ready.push(id));
  const first = pool.acquire('media');
  urls.set('media', 'blob:replacement');
  const second = pool.acquire('media');
  assert.notEqual(second, first);
  assert.equal(first.src, undefined);
  first.dispatchEvent(new Event('error'));
  first.ready();
  assert.equal(errors.length, 0);
  assert.equal(ready.length, 0);
  pool.play();
  pool.dispose();
  second.ready();
  assert.equal(second.playCalls, 0);
  assert.equal(pool.playing, false);
});

test('autoplay rejection is reported once until an explicit playback retry', async () => {
  const { pool } = await videoPool();
  pool.setLayerSource(() => [{ mediaId: 'media', time: { loop: true } }]);
  const errors = [];
  pool.onError((error) => errors.push(error));
  const video = pool.acquire('media');
  video.play = () => {
    video.playCalls++;
    return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  };
  video.ready();
  pool.play();
  await settle();
  for (let frame = 0; frame < 20; frame++) pool.seek(frame / 30);
  await settle();
  assert.equal(video.playCalls, 1);
  assert.equal(errors.length, 1);
  pool.play();
  await settle();
  assert.equal(video.playCalls, 2);
  pool.dispose();
});

test('a newly generated local proxy is retried even when its URL has not changed', async () => {
  const { pool, urls, fixture } = await videoPool();
  urls.set('media', '/api/media/media/proxy');
  fixture.fetch = async () => ({ status: 404, ok: false });
  const video = pool.acquire('media');
  video.dispatchEvent(new Event('error'));
  await settle();
  assert.deepEqual(pool.missingProxies(), ['media']);
  fixture.fetch = async () => ({ status: 200, ok: true });
  assert.equal(pool.acquire('media'), video);
  await settle();
  assert.equal(video.loadCalls, 2);
  assert.deepEqual(pool.missingProxies(), []);
  pool.dispose();
});

test('preview, render, slice, conform and QC requests wait for saving and stop on save failure', async () => {
  const requests = [];
  const { module: api, fixture } = await loadClient('../client/src/api.js', {
    store: { isDirty: () => true, flushSave: null },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, text: async () => JSON.stringify({ jobId: 'job' }) };
    },
  });
  const operations = [
    ['previewFiltergraph', '/api/preview/filtergraph', 'A'],
    ['renderWall', '/api/render/wall', { wallId: 'A' }],
    ['renderPanels', '/api/render/panels', { wallId: 'A' }],
    ['renderAll', '/api/render/all', { walls: ['A'] }],
    ['renderStill', '/api/render/still', { wallId: 'A', atSec: 1 }],
    ['conform', '/api/conform', { mediaIds: ['media'] }],
    ['runQc', '/api/qc/run', { wallId: 'A' }],
  ];
  for (const [name, endpoint, body] of operations) {
    requests.length = 0;
    const save = deferred();
    fixture.store.flushSave = () => save.promise;
    const operation = api[name](body);
    await settle();
    assert.equal(requests.length, 0, `${name} cannot run before its save completes`);
    save.resolve(true);
    await operation;
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, endpoint);
    assert.deepEqual(JSON.parse(requests[0].options.body), name === 'previewFiltergraph' ? { wallId: body } : body);

    requests.length = 0;
    fixture.store.flushSave = async () => false;
    await assert.rejects(api[name](body), /Projekt konnte nicht gespeichert werden/);
    assert.equal(requests.length, 0, `${name} cannot run against an unsaved project`);
  }
  // putProject is the save itself; guarding it would recursively call flushSave.
  fixture.store.flushSave = () => { throw new Error('recursive save'); };
  await api.putProject({ name: 'Saved directly' });
  assert.equal(requests[0].url, '/api/project');
});
