import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import * as model from '../shared/model.js';

let fixtureId = 0;

async function panelEditor({ sourceWidth = 200, sourceHeight = 200 } = {}) {
  const venue = { id: 'test', fps: 30, walls: [{ id: 'A', width: 800, height: 400, panels: [] }] };
  const project = model.makeProject(venue);
  const media = model.makeMedia('image.png', { kind: 'image', probe: { width: sourceWidth, height: sourceHeight } });
  const layer = model.makeLayer(media.id);
  project.media.push(media);
  project.walls.A.slots.master.layers.push(layer);
  const state = { venue, project, ui: { activeWallId: 'A', selectedLayerId: null, overlays: { ruler: false, safeArea: false } } };
  const image = { naturalWidth: sourceWidth, naturalHeight: sourceHeight };
  const errors = [];
  function canvasElement() {
    const canvas = { width: 0, height: 0, clientWidth: 880, clientHeight: 602, style: {}, addEventListener() {}, removeEventListener() {} };
    let operations = [], stack = [];
    const ctx = { canvas, draws: [],
      setTransform(...args) { operations = [['setTransform', ...args]]; },
      save() { stack.push([...operations]); },
      restore() { operations = stack.pop() || []; },
      translate(...args) { operations.push(['translate', ...args]); },
      scale(...args) { operations.push(['scale', ...args]); },
      rotate(...args) { operations.push(['rotate', ...args]); },
      drawImage(...args) { ctx.draws.push({ args, operations: [...operations] }); },
      measureText(text) { return { width: String(text).length * 6 }; },
      createPattern() { return {}; }, createLinearGradient() { return { addColorStop() {} }; },
    };
    for (const name of ['beginPath', 'clearRect', 'clip', 'closePath', 'fill', 'fillRect', 'fillText', 'lineTo', 'moveTo', 'quadraticCurveTo', 'rect', 'setLineDash', 'stroke', 'strokeRect']) ctx[name] = () => {};
    canvas.getContext = () => ctx;
    canvas.ctx = ctx;
    return canvas;
  }
  const fixture = {
    model,
    t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_match, key) => vars[key] ?? ''),
    register() {}, fmtNum: String, fmtMeters: String, onLangChange: () => () => {},
    window: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
    document: { createElement: canvasElement },
    console: { warn: (...args) => errors.push(args), error: (...args) => errors.push(args) },
  };
  const key = `__panelEditorFixture${++fixtureId}`;
  globalThis[key] = fixture;
  let code = await fs.readFile(new URL('../client/src/editor/panelEditor.js', import.meta.url), 'utf8');
  code = code.replace(/^import \{([\s\S]*?)\} from '\/shared\/model.js';/m, 'const {$1} = fixture.model;')
    .replace(/^import \{([^\n]+)\} from '\.\.\/i18n.js';/m, 'const {$1} = fixture;');
  const prelude = `const fixture=globalThis[${JSON.stringify(key)}]; const { window, document, console }=fixture;\n`;
  try {
    const { createPanelEditor } = await import(`data:text/javascript;base64,${Buffer.from(prelude + code).toString('base64')}`);
    const canvas = canvasElement();
    const editor = createPanelEditor({ canvas, videoPool: { acquire: () => image, isReady: () => true }, onChange() {} });
    function draw() {
      canvas.ctx.draws = [];
      editor.update(state);
      editor.tick(0);
      assert.deepEqual(errors, []);
      assert.equal(canvas.ctx.draws.length, 1);
      return canvas.ctx.draws[0];
    }
    return { layer, draw, editor };
  } finally { delete globalThis[key]; }
}

test('2D editor switches manual to contain/native/cover without stale destination geometry', async () => {
  const { layer, draw, editor } = await panelEditor();
  try {
    layer.transform.fit = 'manual';
    layer.transform.dest = { x: 20, y: 30, w: 30, h: 40 };
    assert.deepEqual(draw().args.slice(5), [-15, -20, 30, 40]);
    for (const [fit, dimensions, center] of [
      ['contain', [400, 400], [440, 292]],
      ['native', [200, 200], [440, 292]],
      ['cover', [800, 800], [440, 292]],
    ]) {
      layer.transform.fit = fit;
      const output = draw();
      assert.deepEqual(output.args.slice(7), dimensions, fit);
      assert.deepEqual(output.operations.find(([name]) => name === 'translate').slice(1), center, fit);
      assert.deepEqual(layer.transform.dest, { x: 20, y: 30, w: 30, h: 40 }, 'preview must not mutate the project');
    }
  } finally { editor.dispose(); }
});

test('2D editor uses the rotated aspect ratio and flips the oriented image like export', async () => {
  const { layer, draw, editor } = await panelEditor({ sourceWidth: 200, sourceHeight: 100 });
  try {
    Object.assign(layer.transform, { fit: 'contain', rotate: 90, flipH: true, dest: { x: 7, y: 8, w: 20, h: 30 } });
    const output = draw();
    // A 200×100 source becomes 100×200: contain yields a 200×400 target.
    // Canvas receives the pre-rotation 400×200 rectangle.
    assert.deepEqual(output.args.slice(5), [-200, -100, 400, 200]);
    const transforms = output.operations.filter(([name]) => ['translate', 'scale', 'rotate'].includes(name));
    assert.deepEqual(transforms, [['translate', 440, 292], ['scale', -1, 1], ['rotate', Math.PI / 2]]);
    layer.transform.rotate = 270;
    layer.transform.flipH = false;
    layer.transform.flipV = true;
    const other = draw();
    assert.deepEqual(other.operations.slice(-2), [['scale', 1, -1], ['rotate', Math.PI * 1.5]]);
  } finally { editor.dispose(); }
});
