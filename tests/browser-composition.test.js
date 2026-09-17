import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeLayer, makeMedia, makeProject } from '../shared/model.js';
import { buildWallGraph } from '../server/ops/filtergraph.js';
import { createCompositionPlan, frameLayers, drawCompositionFrame } from '../client/src/export/browserComposition.js';

function fixture({ width = 800, height = 400, sourceWidth = 200, sourceHeight = 100, kind = 'video' } = {}) {
  const venue = { id: 'test', fps: 10, walls: [{ id: 'A', width, height, panels: [
    { id: 'A1', x: 0, width: width / 2 }, { id: 'A2', x: width / 2, width: width / 2 },
  ] }] };
  const project = makeProject(venue, { loopSeconds: 4 });
  const media = makeMedia('example.mp4', { kind, probe: { width: sourceWidth, height: sourceHeight, durationSec: 8, fps: 10 } });
  const layer = makeLayer(media.id);
  project.media.push(media);
  project.walls.A.slots.master.layers.push(layer);
  return { venue, project, media, layer, wallId: 'A' };
}

function recordingContext(plan) {
  const calls = [];
  const ctx = { canvas: { width: plan.width, height: plan.height }, calls };
  for (const method of ['save', 'restore', 'setTransform', 'fillRect', 'beginPath', 'rect', 'clip', 'translate', 'scale', 'rotate', 'drawImage']) {
    ctx[method] = (...args) => calls.push({ method, args, alpha: ctx.globalAlpha });
  }
  return ctx;
}

test('plan keeps the native raster and matches desktop frame counts for whole-loop and ranged renders', () => {
  const setup = fixture();
  for (const rangeSec of [null, [1.25, 2.05], { startSec: 1.25, durationSec: 0.8 }, 2]) {
    const plan = createCompositionPlan({ ...setup, rangeSec });
    const desktop = buildWallGraph(setup.project, setup.venue, 'A', { rangeSec });
    assert.equal(plan.width, desktop.meta.width);
    assert.equal(plan.height, desktop.meta.height);
    assert.equal(plan.frameCount, desktop.frames);
    assert.equal(plan.duration, plan.frameCount / plan.fps);
  }
  setup.project.dropDuplicateEndFrame = false;
  assert.equal(createCompositionPlan(setup).frameCount, 41);
  assert.equal(createCompositionPlan({ ...setup, rangeSec: [1, 2] }).frameCount, 10);
});

test('master layers draw first in temporal order, then panel overlays in venue order', () => {
  const setup = fixture();
  const later = makeLayer(setup.media.id);
  later.time.startSec = 1;
  const left = makeLayer(setup.media.id);
  const right = makeLayer(setup.media.id);
  setup.project.walls.A.slots.master.layers.unshift(later);
  setup.project.walls.A.slots.A2.layers.push(right);
  setup.project.walls.A.slots.A1.layers.push(left);
  const plan = createCompositionPlan(setup);
  assert.deepEqual(frameLayers(plan, 15).map((layer) => layer.layerId), [setup.layer.id, later.id, left.id, right.id]);
  assert.deepEqual(plan.mediaIds, [setup.media.id]);
  assert.deepEqual(frameLayers(plan, 0).map((layer) => layer.layerId), [setup.layer.id, left.id, right.id]);
  setup.project.walls.A.slots.A1.enabled = false;
  right.enabled = false;
  assert.deepEqual(createCompositionPlan(setup).layers.map((layer) => layer.layerId), [setup.layer.id, later.id]);
});

test('cover, contain, stretch and native fit calculate centered slot rectangles', () => {
  const setup = fixture({ sourceWidth: 200, sourceHeight: 200 });
  const expected = {
    cover: { x: 0, y: -200, w: 800, h: 800 },
    contain: { x: 200, y: 0, w: 400, h: 400 },
    stretch: { x: 0, y: 0, w: 800, h: 400 },
    native: { x: 300, y: 100, w: 200, h: 200 },
  };
  for (const [fit, dest] of Object.entries(expected)) {
    setup.layer.transform.fit = fit;
    assert.deepEqual(createCompositionPlan(setup).layers[0].dest, dest, fit);
  }
});

test('manual geometry rounds before center-based zoom and offsets, then uses desktop even scaling', () => {
  const setup = fixture();
  Object.assign(setup.layer.transform, { fit: 'manual', dest: { x: 10.4, y: 20.6, w: 101.4, h: 51.4 }, zoom: 1.5, offset: { x: 3.6, y: -2.6 } });
  const descriptor = createCompositionPlan(setup).layers[0];
  assert.deepEqual(descriptor.dest, { x: -11, y: 5, w: 152, h: 78 });
  const desktop = buildWallGraph(setup.project, setup.venue, 'A');
  assert.match(desktop.filterComplex, /scale=152:78/);
  assert.match(desktop.filterComplex, /crop=141:78:11:0/);
  assert.match(desktop.filterComplex, /overlay=x=0:y=5/);
});

test('source crop clips to original bounds and rotation changes fit aspect', () => {
  const setup = fixture();
  Object.assign(setup.layer.transform, { crop: { x: 151.4, y: 21.6, w: 100, h: 80 }, rotate: -90, fit: 'contain' });
  const layer = createCompositionPlan(setup).layers[0];
  assert.deepEqual(layer.crop, { x: 151, y: 22, w: 49, h: 78 });
  assert.equal(layer.rotate, 270);
  assert.deepEqual(layer.dest, { x: 81, y: 0, w: 638, h: 400 });
});

test('trim, start, speed, gaps and end-exclusion address the original media time', () => {
  const setup = fixture();
  Object.assign(setup.layer.time, { startSec: 1, inSec: 2, outSec: 5, speed: 2 });
  const plan = createCompositionPlan(setup);
  assert.deepEqual(frameLayers(plan, 9), []);
  assert.equal(frameLayers(plan, 10)[0].sourceTime, 2);
  assert.equal(frameLayers(plan, 15)[0].sourceTime, 3);
  assert.equal(frameLayers(plan, 24)[0].sourceTime, 4.8);
  assert.deepEqual(frameLayers(plan, 25), []);
  const range = createCompositionPlan({ ...setup, rangeSec: [1.5, 2.5] });
  assert.equal(frameLayers(range, 0)[0].sourceTime, 3);
  assert.equal(frameLayers(range, 0)[0].timelineTime, 1.5);
});

test('loops wrap source time after speed adjustment and stills remain time-independent', () => {
  const setup = fixture();
  setup.media.probe.durationSec = 1;
  Object.assign(setup.layer.time, { startSec: 0.5, loop: true, speed: 2 });
  const plan = createCompositionPlan(setup);
  assert.ok(Math.abs(frameLayers(plan, 18)[0].sourceTime - 0.6) < 1e-8);
  const still = fixture({ kind: 'image' });
  delete still.media.probe.durationSec;
  still.layer.time.inSec = 2;
  assert.equal(frameLayers(createCompositionPlan(still), 39)[0].sourceTime, 0);
});

test('same media can be used simultaneously at different source times with distinct source keys', () => {
  const setup = fixture();
  const second = makeLayer(setup.media.id);
  second.time.inSec = 2;
  setup.project.walls.A.slots.A1.layers.push(second);
  const plan = createCompositionPlan(setup);
  const layers = frameLayers(plan, 10);
  assert.deepEqual(layers.map((layer) => layer.sourceTime), [1, 3]);
  const a = { width: 200, height: 100 };
  const b = { width: 200, height: 100 };
  const ctx = recordingContext(plan);
  drawCompositionFrame(ctx, plan, 10, new Map([[setup.layer.id, a], [second.id, b]]));
  assert.deepEqual(ctx.calls.filter((call) => call.method === 'drawImage').map((call) => call.args[0]), [a, b]);
});

test('draw paints opaque background, clips each panel, and rotates before oriented flips', () => {
  const setup = fixture();
  setup.project.walls.A.slots.master.layers = [];
  setup.project.walls.A.slots.A2.layers.push(setup.layer);
  Object.assign(setup.layer.transform, { rotate: 90, flipH: true, crop: { x: 5, y: 7, w: 160, h: 80 }, fit: 'stretch' });
  setup.layer.filters.opacity = 0.4;
  const plan = createCompositionPlan(setup);
  const ctx = recordingContext(plan);
  const source = { width: 200, height: 100 };
  drawCompositionFrame(ctx, plan, 0, new Map([[setup.media.id, source]]));
  const call = (method) => ctx.calls.find((entry) => entry.method === method);
  assert.deepEqual(call('setTransform').args, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(call('fillRect').args, [0, 0, 800, 400]);
  assert.equal(call('fillRect').alpha, 1);
  assert.deepEqual(call('rect').args, [400, 0, 400, 400]);
  assert.deepEqual(call('translate').args, [600, 200]);
  assert.deepEqual(call('scale').args, [-1, 1]);
  assert.deepEqual(call('rotate').args, [Math.PI / 2]);
  assert.ok(ctx.calls.indexOf(call('scale')) < ctx.calls.indexOf(call('rotate')));
  assert.deepEqual(call('drawImage').args, [source, 5, 7, 160, 80, -200, -200, 400, 400]);
  assert.equal(call('drawImage').alpha, 0.4);
  assert.equal(ctx.calls.filter((entry) => entry.method === 'restore').length, 2);
});

test('quarter-turn destination dimensions swap before drawing and out-of-slot content remains clipped', () => {
  const setup = fixture();
  Object.assign(setup.layer.transform, { rotate: 90, fit: 'manual', dest: { x: -20, y: -10, w: 300, h: 100 } });
  const plan = createCompositionPlan(setup);
  const ctx = recordingContext(plan);
  drawCompositionFrame(ctx, plan, 0, new Map([[setup.media.id, { width: 200, height: 100 }]]));
  assert.deepEqual(ctx.calls.find((call) => call.method === 'drawImage').args.slice(5), [-50, -150, 100, 300]);
  assert.deepEqual(ctx.calls.find((call) => call.method === 'rect').args, [0, 0, 800, 400]);
});

test('unsupported processing fails in preflight with an actionable German message', () => {
  for (const mutate of [
    (layer) => { layer.filters.brightness = 0.1; },
    (layer) => { layer.filters.feather.l = 2; },
    (layer) => { layer.filters.dither = true; },
    (layer) => { layer.time.transition = { type: 'xfade', durSec: 1 }; },
    (layer) => { layer.blend = 'screen'; },
    (layer) => { layer.time.loop = true; layer.time.inSec = 1; },
  ]) {
    const setup = fixture();
    mutate(setup.layer);
    assert.throws(() => createCompositionPlan(setup), /MP4-Export.*noch nicht unterstützt/);
  }
});

test('invalid project media, raster, geometry and times cannot silently become a render', () => {
  const cases = [
    (setup) => { setup.project.media = []; },
    (setup) => { setup.venue.walls[0].width = 799; },
    (setup) => { setup.project.fps = Infinity; },
    (setup) => { setup.project.loopSeconds = NaN; },
    (setup) => { setup.layer.time.inSec = -1; },
    (setup) => { setup.layer.time.speed = 0; },
    (setup) => { setup.layer.time.outSec = 9; },
    (setup) => { setup.layer.transform.rotate = 45; },
    (setup) => { setup.layer.transform.crop = { x: 500, y: 0, w: 10, h: 10 }; },
    (setup) => { setup.media.probe.width = 0; },
    (setup) => { setup.layer.transform.zoom = Infinity; },
    (setup) => { setup.layer.transform.fit = 'unknown'; },
  ];
  for (const mutate of cases) {
    const setup = fixture();
    mutate(setup);
    assert.throws(() => createCompositionPlan(setup), /MP4-Export/);
  }
  for (const rangeSec of [[2, 1], [NaN, 1], [0, Infinity], [-1, 2]]) {
    assert.throws(() => createCompositionPlan({ ...fixture(), rangeSec }), /MP4-Export/);
  }
});

test('plan is a frozen snapshot and omits invisible, disabled or out-of-range layers', () => {
  const setup = fixture();
  const original = createCompositionPlan(setup);
  setup.layer.transform.crop = { x: 0, y: 0, w: 10, h: 10 };
  setup.layer.time.startSec = 10;
  assert.deepEqual(original.layers[0].crop, { x: 0, y: 0, w: 200, h: 100 });
  assert.equal(frameLayers(original, 10).length, 1);
  assert.equal(createCompositionPlan(setup).layers.length, 0);
  assert.ok(Object.isFrozen(original) && Object.isFrozen(original.layers[0].dest));
  setup.layer.time.startSec = 0;
  setup.layer.filters.opacity = 0;
  assert.equal(createCompositionPlan(setup).layers.length, 0);
  setup.layer.filters.opacity = 1;
  setup.layer.transform.offset.x = 10000;
  assert.equal(createCompositionPlan(setup).layers.length, 0);
});

test('missing sources, scaled proxies, wrong canvases and invalid frame indices fail before drawing', () => {
  const setup = fixture();
  const plan = createCompositionPlan(setup);
  const ctx = recordingContext(plan);
  assert.throws(() => drawCompositionFrame(ctx, plan, 0, new Map()), /decodierte Quelle/);
  assert.throws(() => drawCompositionFrame(ctx, plan, 0, new Map([[setup.media.id, { width: 100, height: 50 }]])), /ursprüngliche Auflösung/);
  assert.equal(ctx.calls.length, 0);
  ctx.canvas.width = 400;
  assert.throws(() => drawCompositionFrame(ctx, plan, 0, new Map([[setup.media.id, { width: 200, height: 100 }]])), /nativen Wandraster/);
  for (const index of [-1, 40, 0.5, NaN]) assert.throws(() => frameLayers(plan, index), /Frameindex/);
});

test('canvas state is restored when a draw fails', () => {
  const setup = fixture();
  const plan = createCompositionPlan(setup);
  const ctx = recordingContext(plan);
  ctx.drawImage = () => { throw new Error('decoder frame expired'); };
  assert.throws(() => drawCompositionFrame(ctx, plan, 0, new Map([[setup.media.id, { width: 200, height: 100 }]])), /decoder frame expired/);
  assert.equal(ctx.calls.filter((call) => call.method === 'save').length, 2);
  assert.equal(ctx.calls.filter((call) => call.method === 'restore').length, 2);
});
