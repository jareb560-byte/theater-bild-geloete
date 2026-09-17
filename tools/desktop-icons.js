// Original app icon, generated as PNG without a graphics dependency.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const size = 1024;
const rows = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  let c = [15, 20, 28, 255];
  if ((x < 120 && y < 120 && Math.hypot(x - 120, y - 120) > 120) || (x > 903 && y < 120 && Math.hypot(x - 903, y - 120) > 120) || (x < 120 && y > 903 && Math.hypot(x - 120, y - 903) > 120) || (x > 903 && y > 903 && Math.hypot(x - 903, y - 903) > 120)) c = [0, 0, 0, 0];
  if (y > 232 && y < 701 && x > 178 && x < 846) {
    const panel = Math.floor((x - 178) / 232);
    if ((x - 178) % 232 < 204) c = panel === 1 ? [248, 239, 220, 255] : [255, 55 + Math.floor(y / 12), 129, 255];
    if (y % 27 < 3 || x % 27 < 3) c = [25, 30, 40, 255];
  }
  if (y > 761 && y < 784 && x > 136 && x < 888) c = [190, 169, 136, 255];
  const off = y * (size * 4 + 1) + 1 + x * 4;
  rows.set(c, off);
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const out = path.join(root, '.cache', 'desktop-icons'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
