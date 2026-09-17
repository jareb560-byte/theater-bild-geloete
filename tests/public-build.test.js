import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('public build excludes private assets and self-hosts the MP4 module with its license and source', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tbg-public-build-'));
  try {
    const copy = (relative) => {
      const target = path.join(fixture, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(root, relative), target, { recursive: true });
    };
    for (const relative of [
      'tools/build-web.js', 'package.json', 'client', 'shared/model.js', 'config/venues',
      'server/ops/filtergraph.js', 'node_modules/three/build/three.module.js',
      'node_modules/three/examples/jsm/controls/OrbitControls.js',
      'node_modules/mediabunny/dist/bundles/mediabunny.mjs', 'node_modules/mediabunny/LICENSE',
      'node_modules/mediabunny/package.json', 'node_modules/mediabunny/src',
    ]) copy(relative);

    fs.mkdirSync(path.join(fixture, 'client/assets'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'client/assets/production-private.pdf'), 'PRIVATE-ASSET-CANARY');
    fs.writeFileSync(path.join(fixture, 'client/assets/production-private.jpg'), 'PRIVATE-ASSET-CANARY');
    fs.writeFileSync(path.join(fixture, 'client/src/private-notes.txt'), 'PRIVATE-NOTES-CANARY');
    fs.writeFileSync(path.join(fixture, 'config/venues/private-show.json'), '{"name":"PRIVATE-VENUE-CANARY"}');
    const venuePath = path.join(fixture, 'config/venues/mein-schiff-theater.json');
    const venue = JSON.parse(fs.readFileSync(venuePath, 'utf8'));
    venue.contacts = [{ name: 'PRIVATE-CONTACT-CANARY', email: 'private@example.invalid' }];
    venue.internalSource = 'C:\\Users\\PRIVATE-PATH-CANARY\\production.pdf';
    fs.writeFileSync(venuePath, JSON.stringify(venue));

    const build = spawnSync(process.execPath, ['tools/build-web.js', '--out', 'public', '--strict'], {
      cwd: fixture, encoding: 'utf8', windowsHide: true,
    });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const output = path.join(fixture, 'public');
    const files = fs.readdirSync(output, { recursive: true }).filter((file) => fs.statSync(path.join(output, file)).isFile());
    const text = files.map((file) => fs.readFileSync(path.join(output, file), 'utf8')).join('\n');
    assert.doesNotMatch(text, /PRIVATE-(?:ASSET|NOTES|VENUE|CONTACT|PATH)-CANARY|private@example\.invalid/);
    assert.equal(files.some((file) => /\.(pdf|jpg|png|mp4|mov)$/i.test(file)), false);
    assert.equal(files.some((file) => /private-show|private-notes/.test(file)), false);
    const publishedVenue = JSON.parse(fs.readFileSync(path.join(output, 'config/venues/mein-schiff-theater.json')));
    assert.deepEqual(publishedVenue.walls, venue.walls, 'authorized venue dimensions and assumptions remain intact');
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /href=["'][^"']*github\.com[^"']*\/releases/);
    assert.match(html, /kein bestätigtes Hausaufmaß/);
    assert.match(html, /Desktop-Fassung auf dem eigenen Rechner/);
    assert.match(html, /als MP4 exportieren/);
    assert.match(html, /ohne Server-Upload/);
    assert.doesNotMatch(html, /html\[data-mode="browser"\]\s+#viewSwitch\s+\[data-view="render"\][^{]*\{\s*display\s*:\s*none/i);
    assert.match(html, /html\[data-mode="browser"\]\s+#viewSwitch\s+\[data-view="qc"\]\s*\{display:none\}/);
    const importMap = JSON.parse(html.match(/<script\b[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/i)[1]);
    assert.equal(importMap.imports.mediabunny, './vendor/mediabunny.mjs');
    assert.equal(fs.existsSync(path.join(output, importMap.imports.mediabunny)), true);
    assert.ok(fs.statSync(path.join(output, 'vendor/mediabunny.LICENSE')).size > 100);
    const bundlePath = path.join(output, importMap.imports.mediabunny);
    assert.deepEqual(fs.readFileSync(bundlePath), fs.readFileSync(path.join(root, 'node_modules/mediabunny/dist/bundles/mediabunny.mjs')));
    const mediaModule = await import(pathToFileURL(bundlePath).href);
    assert.equal(typeof mediaModule.Input, 'function');
    assert.equal(typeof mediaModule.Output, 'function');
    assert.equal(typeof mediaModule.Mp4OutputFormat, 'function');
    assert.equal(typeof mediaModule.CanvasSource, 'function');
    const sourceIndex = JSON.parse(fs.readFileSync(path.join(output, 'vendor/mediabunny-source/index.json'), 'utf8'));
    assert.equal(sourceIndex.license, 'MPL-2.0');
    assert.ok(sourceIndex.files.includes('src/index.ts'));
    for (const file of sourceIndex.files) assert.equal(fs.existsSync(path.join(output, 'vendor/mediabunny-source', file)), true);

    const protectedBuild = spawnSync(process.execPath, ['tools/build-web.js', '--out', 'client'], {
      cwd: fixture, encoding: 'utf8', windowsHide: true,
    });
    assert.notEqual(protectedBuild.status, 0);
    assert.equal(fs.existsSync(path.join(fixture, 'client/index.html')), true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
