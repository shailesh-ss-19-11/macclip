'use strict';
// Generates the menu bar template icons (assets/trayTemplate*.png) without any dependencies.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const OUT = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Shapes in unit coordinates (0..1).
const rrect = (x, y, w, h, r) => (px, py) => {
  const dx = Math.max(Math.abs(px - (x + w / 2)) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(py - (y + h / 2)) - (h / 2 - r), 0);
  return dx * dx + dy * dy <= r * r;
};
const minus = (a, b) => (x, y) => a(x, y) && !b(x, y);
const union = (...s) => (x, y) => s.some((f) => f(x, y));

function render(size, layers, ss = 4) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const layer of layers) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        if (layer.shape((x + (sx + .5) / ss) / size, (y + (sy + .5) / ss) / size)) hit++;
      }
      const cov = hit / (ss * ss);
      if (!cov) continue;
      const col = typeof layer.color === 'function' ? layer.color(x / size, y / size) : layer.color;
      const sa = cov * (col[3] ?? 1);
      const oa = sa + a * (1 - sa);
      r = (col[0] * sa + r * a * (1 - sa)) / oa; g = (col[1] * sa + g * a * (1 - sa)) / oa; b = (col[2] * sa + b * a * (1 - sa)) / oa; a = oa;
    }
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = Math.round(a * 255);
  }
  return png(size, size, buf);
}

// Clipboard glyph, shared by the tray icon and the app icon.
const glyph = (inset = 0, scale = 1) => {
  const t = (v) => 0.5 + (v - 0.5) * scale;
  const s = (v) => v * scale;
  const body = rrect(t(0.2), t(0.16), s(0.6), s(0.72), s(0.1));
  const bodyInner = rrect(t(0.2) + s(0.07), t(0.16) + s(0.07), s(0.6) - s(0.14), s(0.72) - s(0.14), s(0.04));
  const clip = rrect(t(0.36), t(0.08), s(0.28), s(0.16), s(0.06));
  const l1 = rrect(t(0.32), t(0.44), s(0.36), s(0.06), s(0.03));
  const l2 = rrect(t(0.32), t(0.58), s(0.36), s(0.06), s(0.03));
  const l3 = rrect(t(0.32), t(0.72), s(0.22), s(0.06), s(0.03));
  return { frame: minus(body, bodyInner), clip, lines: union(l1, l2, l3), body };
};

// Tray (template: black + alpha)
for (const [name, size] of [['trayTemplate.png', 18], ['trayTemplate@2x.png', 36]]) {
  const g = glyph(0, 0.92);
  fs.writeFileSync(path.join(OUT, name), render(size, [
    { shape: union(g.frame, g.lines), color: [0, 0, 0, 1] },
    { shape: g.clip, color: [0, 0, 0, 1] },
  ], 8));
}

// The app icon (assets/icon.png / icon.icns) is built from assets/icon-source.png by scripts/build-icon.js.
console.log('Tray icons written to', OUT);
