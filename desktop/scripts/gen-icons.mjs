// Generates the desktop icons from the Muxora mark (converging model routes
// around a central decision point) without image dependencies — pure-Node PNG
// encoding (zlib IDAT + hand-rolled CRC32), 4x supersampled.
//
// Outputs:
//   assets/trayTemplate.png      16x16  black-on-transparent (macOS template)
//   assets/trayTemplate@2x.png   32x32
//   assets/appicon_1024.png      full-color app icon (icns built via iconutil)
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(__dirname, '../assets');
fs.mkdirSync(assets, { recursive: true });

// ── PNG encoder ────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── rasterizer ─────────────────────────────────────────────────────────────
// Renders with 4x supersampling. `shapes` is an ordered list painted
// back-to-front; each returns coverage [0..1] at a sample point plus a color.
function render(size, shapes) {
  const SS = 4;
  const S = size * SS;
  const img = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) / S; // normalized [0,1]
          const y = (py * SS + sy + 0.5) / S;
          // composite shapes front-to-back at this sample
          let sr = 0, sg = 0, sb = 0, sa = 0;
          for (const sh of shapes) {
            const cov = sh.cover(x, y);
            if (cov <= 0) continue;
            const [cr, cg, cb, ca] = sh.color;
            const srcA = ca * cov;
            sr = cr * srcA + sr * (1 - srcA);
            sg = cg * srcA + sg * (1 - srcA);
            sb = cb * srcA + sb * (1 - srcA);
            sa = srcA + sa * (1 - srcA);
          }
          r += sr; g += sg; b += sb; a += sa;
        }
      }
      const n = SS * SS;
      const idx = (py * size + px) * 4;
      const alpha = a / n;
      img[idx] = alpha > 0 ? Math.round((r / n / alpha) * 255) : 0;
      img[idx + 1] = alpha > 0 ? Math.round((g / n / alpha) * 255) : 0;
      img[idx + 2] = alpha > 0 ? Math.round((b / n / alpha) * 255) : 0;
      img[idx + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(img, size, size);
}

const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy);

// Ring with a gap. gapCenter/gapWidth in degrees, standard math orientation.
function ringCover(x, y, cx, cy, radius, stroke, gapCenterDeg, gapWidthDeg) {
  const d = Math.abs(dist(x, y, cx, cy) - radius);
  if (d > stroke / 2) return 0;
  let ang = (Math.atan2(cy - y, x - cx) * 180) / Math.PI; // y-flip: screen→math
  let delta = Math.abs(((ang - gapCenterDeg + 540) % 360) - 180);
  return delta < gapWidthDeg / 2 ? 0 : 1;
}

const circle = (cx, cy, r, color) => ({
  color,
  cover: (x, y) => (dist(x, y, cx, cy) <= r ? 1 : 0),
});
const ring = (cx, cy, r, stroke, gapC, gapW, color) => ({
  color,
  cover: (x, y) => ringCover(x, y, cx, cy, r, stroke, gapC, gapW),
});
const capsule = (x1, y1, x2, y2, width, color) => ({
  color,
  cover: (x, y) => {
    const dx = x2 - x1, dy = y2 - y1;
    const length2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length2));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= width / 2 ? 1 : 0;
  },
});
const roundedRect = (x0, y0, x1, y1, rad, color) => ({
  color,
  cover: (x, y) => {
    const qx = Math.max(x0 + rad - x, 0, x - (x1 - rad));
    const qy = Math.max(y0 + rad - y, 0, y - (y1 - rad));
    if (x < x0 || x > x1 || y < y0 || y > y1) return 0;
    return Math.hypot(qx, qy) <= rad ? 1 : 0;
  },
});

// ── Muxora route mark ─────────────────────────────────────────────────────
function routeMark(color, width = 0.09) {
  return [
    capsule(0.2, 0.31, 0.37, 0.31, width, color),
    capsule(0.37, 0.31, 0.5, 0.5, width, color),
    capsule(0.8, 0.31, 0.63, 0.31, width, color),
    capsule(0.63, 0.31, 0.5, 0.5, width, color),
    capsule(0.2, 0.69, 0.37, 0.69, width, color),
    capsule(0.37, 0.69, 0.5, 0.5, width, color),
    capsule(0.8, 0.69, 0.63, 0.69, width, color),
    capsule(0.63, 0.69, 0.5, 0.5, width, color),
    circle(0.5, 0.5, width * 0.85, color),
  ];
}

// ── tray template (black on transparent; macOS tints it) ──────────────────
const BLACK = [0, 0, 0, 1];
const trayShapes = routeMark(BLACK, 0.105);
fs.writeFileSync(path.join(assets, 'trayTemplate.png'), render(16, trayShapes));
fs.writeFileSync(path.join(assets, 'trayTemplate@2x.png'), render(32, trayShapes));

// ── app icon (HIG grid: art occupies ~824/1024 rounded rect) ──────────────
const BG = [0x4f / 255, 0x46 / 255, 0xe5 / 255, 1]; // indigo-600
const FG = [1, 1, 1, 1];
const inset = 100 / 1024, rectR = 180 / 1024;
function appIcon(size) {
  return render(size, [
    roundedRect(inset, inset, 1 - inset, 1 - inset, rectR, BG),
    ...routeMark(FG, 0.055),
  ]);
}
const appPng = appIcon(1024);
fs.writeFileSync(path.join(assets, 'appicon_1024.png'), appPng);

// A dependency-free ICNS containing modern PNG-backed icon representations.
// Keeping it generated from the same geometry prevents the macOS app and web
// dashboard from drifting into two brands.
const icnsParts = [
  ['ic07', appIcon(128)],
  ['ic08', appIcon(256)],
  ['ic09', appIcon(512)],
  ['ic10', appPng],
].map(([type, png]) => {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(8 + png.length, 4);
  return Buffer.concat([header, png]);
});
const icnsLength = 8 + icnsParts.reduce((sum, part) => sum + part.length, 0);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 4, 'ascii');
icnsHeader.writeUInt32BE(icnsLength, 4);
fs.writeFileSync(path.join(assets, 'icon.icns'), Buffer.concat([icnsHeader, ...icnsParts]));

console.log('Muxora icons written to', assets);
