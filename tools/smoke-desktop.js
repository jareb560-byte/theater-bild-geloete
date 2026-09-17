// Start the real packaged app invisibly with an isolated workspace.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const binary = process.argv[2];
if (!binary) throw new Error('Pfad zur gebauten Desktop-App fehlt.');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbg-desktop-smoke-'));
const report = path.join(temp, 'report.json');
try {
  const child = spawn(path.resolve(binary), [], { windowsHide: true, stdio: 'inherit', env: { ...process.env, TBG_DESKTOP_SMOKE: report, TBG_HOME: path.join(temp, 'workspace') } });
  const timer = setTimeout(() => child.kill(), 90_000);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  clearTimeout(timer);
  const result = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : null;
  console.log(JSON.stringify(result, null, 2));
  if (code !== 0 || !result?.ok || result.nodeInRenderer || !result.hasApp) throw new Error(`Desktop-Smoke-Test fehlgeschlagen (Exit ${code}).`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
