import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import { deliveryBytesPerPixel, makeLayer, makeMedia, makeProject } from '../shared/model.js';
import { buildWallGraph, graphToCommand } from '../server/ops/filtergraph.js';
import { deliveryArgs } from '../server/ops/deliver.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundled = path.join(root, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffmpeg = process.env.FFMPEG_PATH || (fs.existsSync(bundled) ? bundled : 'ffmpeg');
const available = spawnSync(ffmpeg, ['-version'], { windowsHide: true }).status === 0;
const bundledProbe = path.join(root, 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
const ffprobe = process.env.FFPROBE_PATH || (fs.existsSync(bundledProbe) ? bundledProbe : 'ffprobe');
const probeAvailable = spawnSync(ffprobe, ['-version'], { windowsHide: true }).status === 0;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbg-core-test-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));

function run(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {
    windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, String(result.stderr || result.error));
  return result.stdout;
}

function source(name, expression) {
  const file = path.join(temp, `${name}.mkv`);
  run(['-y', '-f', 'lavfi', '-i', expression, '-c:v', 'ffv1', file]);
  return file;
}

function scene(file, { width = 16, height = 16, sourceWidth = 16, sourceHeight = 16 } = {}) {
  const venue = { id: 'test', fps: 10, walls: [{ id: 'A', width, height, panels: [] }] };
  const project = makeProject(venue, { loopSeconds: 3 });
  const media = makeMedia(file, {
    probe: { width: sourceWidth, height: sourceHeight, durationSec: 1, fps: 10 },
  });
  const layer = makeLayer(media.id);
  project.media.push(media);
  project.walls.A.slots.master.layers.push(layer);
  return { project, venue, layer };
}

function pixels(scene, options = {}) {
  const graph = buildWallGraph(scene.project, scene.venue, 'A', options);
  const args = graphToCommand(graph, { outArgs: ['-f', 'rawvideo', '-pix_fmt', 'rgb24'], outPath: 'pipe:1' });
  return { graph, data: run(args) };
}

test('loop preview at a later timestamp matches the same frame in the full render', { skip: !available }, () => {
  const file = source('motion', "nullsrc=s=16x16:r=10:d=1,geq=lum='16+N*20':cb=128:cr=128");
  const setup = scene(file);
  setup.layer.time.loop = true;
  const full = pixels(setup);
  const sample = pixels(setup, { rangeSec: [1.3, 1.4] });
  const bytesPerFrame = 16 * 16 * 3;
  assert.equal(full.data.length, 30 * bytesPerFrame);
  assert.equal(sample.data.length, bytesPerFrame);
  assert.deepEqual(sample.data, full.data.subarray(13 * bytesPerFrame, 14 * bytesPerFrame));
});

test('native fit scales the content with the preview canvas', { skip: !available }, () => {
  const file = source('white', 'color=c=white:s=4x4:r=10:d=1');
  const setup = scene(file, { sourceWidth: 4, sourceHeight: 4 });
  setup.layer.transform.fit = 'native';
  const { data } = pixels(setup, { scale: 0.5, rangeSec: [0, 0.1] });
  let whitePixels = 0;
  for (let i = 0; i < data.length; i += 3) if (data[i] > 200) whitePixels++;
  assert.equal(data.length, 8 * 8 * 3);
  assert.equal(whitePixels, 4, 'a 4×4 native image becomes 2×2 in a half-size preview');
});

test('source crop preserves odd pixel offsets in subsampled video', { skip: !available }, () => {
  const file = source('ramp', "nullsrc=s=16x16:r=10:d=1,geq=lum='16+X*12':cb=128:cr=128");
  const setup = scene(file, { width: 6, height: 6 });
  setup.layer.transform.crop = { x: 1, y: 1, w: 6, h: 6 };
  const actual = pixels(setup, { rangeSec: [0, 0.1] }).data;
  const expected = run(['-i', file, '-vf', 'format=rgba,crop=6:6:1:1,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']);
  assert.deepEqual(actual, expected);
});

test('transition previews preserve the fade progress of the full render', { skip: !available }, () => {
  const file = source('fade', 'color=c=white:s=16x16:r=10:d=1');
  const setup = scene(file);
  setup.layer.time.loop = true;
  setup.layer.time.transition = { type: 'xfade', durSec: 1 };
  const full = pixels(setup).data;
  const bytesPerFrame = 16 * 16 * 3;
  for (const frame of [5, 15]) {
    const actual = pixels(setup, { rangeSec: [frame / 10, (frame + 1) / 10] }).data;
    assert.ok(actual.equals(full.subarray(frame * bytesPerFrame, (frame + 1) * bytesPerFrame)), `fade frame ${frame} matches`);
  }
});

test('HAP Q bandwidth is derived from the codec instead of stale venue estimates', () => {
  assert.equal(deliveryBytesPerPixel({ args: ['-c:v', 'hap', '-format', 'hap_q'], bytesPerPixel: 0.5 }), 1);
  assert.equal(deliveryBytesPerPixel({ args: ['-c:v', 'hap', '-format', 'hap'] }), 0.5);
  assert.equal(deliveryBytesPerPixel({ args: ['-c:v', 'hap', '-format', 'hap_alpha'] }), 1);
  assert.equal(deliveryBytesPerPixel({ args: ['-c:v', 'prores_ks'], bytesPerPixel: 0.62 }), 0.62);
});

test('delivery encoders retain wall/panel dimensions and exact frame counts', { skip: !available || !probeAvailable }, () => {
  const file = source('delivery', 'testsrc2=s=32x32:r=30:d=1');
  const presets = [
    { id: 'hap_q', args: ['-c:v', 'hap', '-format', 'hap_q'], codec: 'hap' },
    { id: 'prores', args: ['-c:v', 'prores_ks', '-profile:v', '2'], codec: 'prores' },
    { id: 'mpeg2', args: ['-c:v', 'mpeg2video', '-pix_fmt', 'yuv420p'], codec: 'mpeg2video' },
  ];
  const venue = {
    id: 'delivery', fps: 30, delivery: { presets },
    walls: [{ id: 'A', width: 32, height: 32, panels: [
      { id: 'A1', x: 0, width: 16 }, { id: 'A2', x: 16, width: 16 },
    ] }],
  };
  const project = makeProject(venue, { loopSeconds: 0.1 });
  const media = makeMedia(file, { probe: { width: 32, height: 32, durationSec: 1, fps: 30 } });
  project.media.push(media);
  project.walls.A.slots.master.layers.push(makeLayer(media.id));
  const graph = buildWallGraph(project, venue, 'A', { forPanels: true });
  for (const preset of presets) {
    const wallPath = path.join(temp, `${preset.id}-wall.mov`);
    const extraOutputs = graph.panelMaps.map((panel) => ({
      map: panel.label, args: deliveryArgs(venue, preset.id, panel), path: path.join(temp, `${preset.id}-${panel.id}.mov`),
    }));
    run(graphToCommand(graph, {
      outArgs: deliveryArgs(venue, preset.id, graph.meta), outPath: wallPath, extraOutputs,
    }));
    for (const [file, width] of [[wallPath, 32], ...extraOutputs.map((output) => [output.path, 16])]) {
      const result = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
        '-show_entries', 'stream=width,height,codec_name,nb_read_frames', '-of', 'json', file], { windowsHide: true });
      assert.equal(result.status, 0, String(result.stderr || result.error));
      const stream = JSON.parse(result.stdout).streams[0];
      assert.equal(stream.width, width);
      assert.equal(stream.height, 32);
      assert.equal(stream.codec_name, preset.codec);
      assert.equal(Number(stream.nb_read_frames), 3);
    }
  }
});

test('queued renders retain the project selected when the render was requested', async () => {
  const previousHome = process.env.TBG_HOME;
  process.env.TBG_HOME = path.join(temp, 'workspace');
  const [{ app }, projects, venues, jobs] = await Promise.all([
    import('../server/index.js'), import('../server/project.js'), import('../server/venues.js'), import('../server/jobs.js'),
  ]);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const venue = venues.base();
  const project = makeProject(venue, { loopSeconds: 3 });
  projects.setCurrent(project, null);
  const unblock = [];
  const blockers = [1, 2].map(() => jobs.start(jobs.createJob(), () => new Promise((resolve) => unblock.push(resolve))));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/render/wall`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallId: venue.walls[0].id, dryRun: true }),
    });
    assert.equal(response.status, 200);
    const { jobId } = await response.json();
    assert.equal(jobs.get(jobId).status, 'queued');
    // Simulate both edits to the original object and opening a different project.
    project.loopSeconds = 7;
    projects.setCurrent(makeProject(venue, { loopSeconds: 9 }), null);
    const complete = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { jobs.bus.off('job', done); reject(new Error('queued render timed out')); }, 5000);
      const done = (job) => {
        if (job.id === jobId && ['done', 'error', 'cancelled'].includes(job.status)) {
          clearTimeout(timeout);
          jobs.bus.off('job', done);
          resolve(job);
        }
      };
      jobs.bus.on('job', done);
    });
    unblock.forEach((release) => release());
    const rendered = await complete;
    assert.equal(rendered.status, 'done', rendered.error);
    assert.equal(rendered.result.frames, 3 * venue.fps);
  } finally {
    unblock.forEach((release) => release());
    await Promise.all(blockers);
    projects.autosaveNow();
    await new Promise((resolve) => server.close(resolve));
    if (previousHome === undefined) delete process.env.TBG_HOME;
    else process.env.TBG_HOME = previousHome;
  }
});
