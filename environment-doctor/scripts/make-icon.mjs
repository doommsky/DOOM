// Generates build/icon.png (512×512): accent rounded square with the “pulse” mark. Pure Node, no deps.
import fs from 'node:fs';
import zlib from 'node:zlib';

const S = 512, R = 112;
const bg = [0x8b, 0x9c, 0xff], ink = [0x0b, 0x0e, 0x1f];
const px = Buffer.alloc(S * S * 4);
const pts = [[0.125, 0.5], [0.29, 0.5], [0.395, 0.25], [0.605, 0.75], [0.71, 0.5], [0.875, 0.5]].map(([x, y]) => [x * S, y * S]);
const segDist = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
};
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const cx = Math.min(Math.max(x, R), S - R), cy = Math.min(Math.max(y, R), S - R);
  const d = Math.hypot(x - cx, y - cy);
  const a = Math.max(0, Math.min(1, R - d + 0.5));
  let c = bg;
  let dmin = Infinity;
  for (let i = 0; i < pts.length - 1; i++) dmin = Math.min(dmin, segDist(x + 0.5, y + 0.5, pts[i], pts[i + 1]));
  const k = Math.max(0, Math.min(1, 22 - dmin));
  c = bg.map((v, i) => Math.round(v * (1 - k) + ink[i] * k));
  const o = (y * S + x) * 4;
  px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = Math.round(a * 255);
}
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../build/icon.png', import.meta.url), png);
console.log('build/icon.png', png.length, 'bytes');
