import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { after, test } from 'node:test';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbg-installer-test-'));
const oldHome = process.env.TBG_HOME;
process.env.TBG_HOME = path.join(temp, 'workspace');
const { macBuild, verifySha256, verifyMachO } = await import('../server/cli/install-ffmpeg.js');
after(() => { if (oldHome === undefined) delete process.env.TBG_HOME; else process.env.TBG_HOME = oldHome; fs.rmSync(temp, { recursive: true, force: true }); });

test('macOS chooses native, pinned and checksummed releases for both architectures', () => {
  for (const [arch, upstream] of [['x64', 'amd64'], ['arm64', 'arm64']]) {
    const build = macBuild(arch);
    assert.match(build.base, new RegExp(`^https://ffmpeg\\.martin-riedl\\.de/download/macos/${upstream}/`));
    assert.ok(build.base.includes(build.release));
    assert.match(build.sha256.ffmpeg, /^[a-f0-9]{64}$/);
    assert.match(build.sha256.ffprobe, /^[a-f0-9]{64}$/);
    assert.notEqual(build.sha256.ffmpeg, build.sha256.ffprobe);
  }
  assert.throws(() => macBuild('ia32'), /nicht unterstuetzt/);
});

test('corrupted downloads are rejected before installation', async () => {
  const file = path.join(temp, 'download.zip');
  fs.writeFileSync(file, 'a synthetic verified archive');
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  await verifySha256(file, digest);
  fs.appendFileSync(file, 'corruption');
  await assert.rejects(verifySha256(file, digest), /SHA-256/);
});

test('Mach-O check rejects a valid executable built for the wrong CPU and invalid data', () => {
  const file = path.join(temp, 'ffmpeg');
  for (const [arch, cpu] of [['x64', 0x01000007], ['arm64', 0x0100000c]]) {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf); header.writeUInt32LE(cpu, 4);
    fs.writeFileSync(file, header);
    verifyMachO(file, arch);
    assert.throws(() => verifyMachO(file, arch === 'x64' ? 'arm64' : 'x64'), /kein natives/);
  }
  fs.writeFileSync(file, 'wrong');
  assert.throws(() => verifyMachO(file, 'arm64'), /kein natives/);
});
