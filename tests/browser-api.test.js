import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import * as model from '../shared/model.js';

const venue = JSON.parse(await fs.readFile(new URL('../config/venues/mein-schiff-theater.json', import.meta.url), 'utf8'));
let fixtureIndex = 0;

async function browserApi(saved = model.makeProject(venue)) {
  const storage = new Map([['tbg.project', JSON.stringify(saved)]]);
  const filesByUrl = new Map();
  const revoked = [];
  const fixture = {
    model,
    selected: [],
    pickerCalls: 0,
    writes: [],
    t: (text) => text,
    register() {},
    console: { warn() {}, error() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    navigator: { storage: {} },
    document: { baseURI: 'https://example.test/studio/' },
    fetch: async (url) => ({ ok: true, json: async () => url.endsWith('index.json') ? { venues: ['theater.json'] } : venue }),
    setTimeout: () => 1,
    clearTimeout() {},
    store: { isDirty: () => false, flushSave: async () => true },
  };
  fixture.window = {
    showOpenFilePicker: async () => {
      fixture.pickerCalls++;
      return fixture.selected.map((file) => ({ getFile: async () => file }));
    },
    showSaveFilePicker: async () => ({ name: 'saved.tbg.json', createWritable: async () => ({
      write: async (text) => fixture.writes.push(text), close: async () => {},
    }) }),
  };
  fixture.URL = class extends URL {
    static createObjectURL(file) { const url = `blob:fixture-${filesByUrl.size}`; filesByUrl.set(url, file); return url; }
    static revokeObjectURL(url) { revoked.push(url); }
  };
  fixture.Image = class {
    naturalWidth = 640;
    naturalHeight = 480;
    set src(url) { queueMicrotask(() => filesByUrl.get(url)?.unreadable ? this.onerror?.() : this.onload?.()); }
  };
  const key = `__browserApiFixture${++fixtureIndex}`;
  globalThis[key] = fixture;
  let source = await fs.readFile(new URL('../client/src/api-browser.js', import.meta.url), 'utf8');
  source = source
    .replace(/^import \{ t, register \} from .*;$/m, 'const { t, register } = fixture;')
    .replace(/^import \{[\s\S]*?\} from '\/shared\/model.js';/m,
      'const { makeId, makeMedia, makeProject, validateProject: validateProjectModel, SCHEMA_VERSION } = fixture.model;')
    .replaceAll('import.meta.url', JSON.stringify('https://example.test/studio/src/api.js'))
    .replaceAll("await import('./store.js')", 'await Promise.resolve(fixture.store)');
  const prelude = `const fixture=globalThis[${JSON.stringify(key)}]; const { window, document, navigator, localStorage, URL, Image, console, fetch, setTimeout, clearTimeout }=fixture;\n`;
  try {
    const api = await import(`data:text/javascript;base64,${Buffer.from(prelude + source).toString('base64')}`);
    return { api, fixture, storage, revoked };
  } finally {
    delete globalThis[key];
  }
}

const image = (name = 'scene.png', size = 2048) => ({ name, size, lastModified: 1234 });
const importedMedia = (id = 'desktop-original') => model.makeMedia('D:/Show/visuals/scene.png', {
  id, kind: 'image', probe: { width: 640, height: 480, sizeBytes: 2048 },
  proxy: { ready: true, path: 'D:/Show/proxies/scene.mp4' }, thumb: { ready: true },
});

test('reselecting a desktop project image preserves its layer ID and source path', async () => {
  const project = model.makeProject(venue);
  project.media = [importedMedia()];
  project.walls.D.slots.master.layers = [model.makeLayer('desktop-original')];
  const { api, fixture } = await browserApi(project);
  fixture.selected = [image()];
  const result = await api.addMedia();
  assert.equal(result.media[0].id, 'desktop-original');
  assert.equal(result.media[0].absPath, 'D:/Show/visuals/scene.png');
  assert.ok(api.proxyUrl('desktop-original').startsWith('blob:'));
  await api.putProject({ ...project, media: result.media });
  const restored = await api.getProject();
  assert.equal(restored.walls.D.slots.master.layers[0].mediaId, restored.media[0].id);
  assert.equal(restored.media[0].proxy.ready, true);
});

test('folder relinking preserves IDs even after the source file was revised', async () => {
  const project = model.makeProject(venue);
  project.media = [importedMedia()];
  const { api, fixture } = await browserApi(project);
  fixture.window.showDirectoryPicker = async () => ({ name: 'visuals',
    async *entries() { yield ['scene.png', { kind: 'file', getFile: async () => image('scene.png', 4096) }]; },
  });
  const { jobId } = await api.scanLibrary([], true);
  for (let n = 0; n < 40 && (await api.getJob(jobId)).status !== 'done'; n++) await Promise.resolve();
  const job = await api.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.media[0].id, 'desktop-original');
  assert.equal(job.result.media[0].probe.sizeBytes, 4096);
});

test('ambiguous duplicate filenames never silently replace an existing layer source', async () => {
  const project = model.makeProject(venue);
  project.media = [importedMedia('left'), { ...importedMedia('right'), absPath: 'D:/Other/scene.png' }];
  const { api, fixture } = await browserApi(project);
  fixture.selected = [image()];
  const { media } = await api.addMedia();
  assert.notEqual(media[0].id, 'left');
  assert.notEqual(media[0].id, 'right');
  assert.equal(api.proxyUrl('left'), null);
  assert.equal(api.proxyUrl('right'), null);
});

test('a page reload reports missing files and never persists transient blob paths', async () => {
  const { api, fixture, storage } = await browserApi();
  fixture.selected = [image()];
  const { media } = await api.addMedia();
  media[0].thumb.path = api.thumbUrl(media[0].id);
  const project = model.makeProject(venue, { media });
  await api.putProject(project);
  const saved = JSON.parse(storage.get('tbg.project'));
  assert.equal(saved.media[0].thumb.path, null);
  const reload = await browserApi(saved);
  const restored = await reload.api.getProject();
  assert.equal(restored.media[0].proxy.ready, false);
  assert.equal(restored.media[0].thumb.ready, false);
  assert.ok((await reload.api.validateProject()).some((issue) => issue.msg === 'Mediendatei erneut auswählen'));
});

test('replacing a readable image with a broken one clears its old thumbnail', async () => {
  const { api, fixture, revoked } = await browserApi();
  fixture.selected = [image()];
  const first = await api.addMedia();
  await api.putProject(model.makeProject(venue, { media: first.media }));
  const previous = api.thumbUrl(first.media[0].id);
  fixture.selected = [{ ...image(), unreadable: true }];
  const second = await api.addMedia();
  assert.equal(second.media[0].id, first.media[0].id);
  assert.equal(second.media[0].proxy.ready, false);
  assert.ok(revoked.includes(previous));
  assert.notEqual(api.thumbUrl(first.media[0].id), previous);
});

test('a malformed imported project cannot overwrite the saved project', async () => {
  const { api, fixture, storage } = await browserApi();
  const previous = storage.get('tbg.project');
  fixture.selected = [{ name: 'broken.json', text: async () => JSON.stringify({ schema: model.SCHEMA_VERSION }) }];
  await assert.rejects(api.openProject(), /unvollständig|beschädigt/);
  assert.equal(storage.get('tbg.project'), previous);
});

test('opening the local project list entry does not launch an unrelated file picker', async () => {
  const { api, fixture } = await browserApi();
  const project = await api.openProject('localStorage:tbg.project');
  assert.equal(project.venueId, venue.id);
  assert.equal(fixture.pickerCalls, 0);
});

test('project download flushes pending edits before writing the JSON file', async () => {
  const { api, fixture } = await browserApi();
  fixture.store = { isDirty: () => true, flushSave: async () => {
    await api.putProject(model.makeProject(venue, { name: 'Latest edit' }));
    return true;
  } };
  await api.saveProject();
  assert.equal(JSON.parse(fixture.writes[0]).name, 'Latest edit');
});
