import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const bin = path.join(process.env.TBG_HOME, 'bin');
const suffix = process.platform === 'win32' ? '.exe' : '';
for (const name of ['ffmpeg', 'ffprobe']) {
  const file = path.join(bin, name + suffix);
  const result = spawnSync(file, ['-version'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${file}: ${result.error || result.stderr}`);
  console.log(result.stdout.split('\n')[0]);
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `${name.toUpperCase()}_PATH=${file}\n`);
}
if (process.env.GITHUB_PATH) fs.appendFileSync(process.env.GITHUB_PATH, `${bin}\n`);
