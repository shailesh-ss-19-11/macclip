'use strict';
// Usage: npx electron scripts/build-icon.js assets/icon-source.png
// Turns a square icon with an opaque white backdrop into a transparent-cornered 1024px
// assets/icon.png and assets/icon.icns.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const OUT = path.join(__dirname, '..', 'assets');
const SIZE = 1024;

function cutBackground(img) {
  const { width: w, height: h } = img.getSize();
  const px = Buffer.from(img.toBitmap()); // BGRA
  const minChan = (i) => Math.min(px[i], px[i + 1], px[i + 2]);
  const isWhite = (i) => minChan(i) >= 244;

  // 1. Flood-fill near-white pixels reachable from the border.
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => { const p = y * w + x; if (!bg[p] && isWhite(p * 4)) { bg[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop(); const x = p % w; const y = (p / w) | 0;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }

  // 2. Within 4px of the background, turn "whiteness" into alpha and un-mix the white.
  const near = (x, y) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && bg[ny * w + nx]) return true;
    }
    return false;
  };
  const INTERIOR_MIN = 60; // typical min channel of the icon's saturated edge colours
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; const i = p * 4;
    if (bg[p]) { px[i + 3] = 0; px[i] = px[i + 1] = px[i + 2] = 0; continue; }
    if (!near(x, y)) continue;
    const a = Math.min(1, Math.max(0, (255 - minChan(i)) / (255 - INTERIOR_MIN)));
    if (a >= 1) continue;
    for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, Math.round((px[i + c] - 255 * (1 - a)) / Math.max(a, 0.05))));
    px[i + 3] = Math.round(a * 255);
  }
  return nativeImage.createFromBitmap(px, { width: w, height: h });
}

app.whenReady().then(() => {
  const src = nativeImage.createFromPath(path.resolve(process.argv[process.argv.length - 1]));
  if (src.isEmpty()) throw new Error('Could not read source image');
  const base = cutBackground(src).resize({ width: SIZE, height: SIZE, quality: 'best' });
  fs.writeFileSync(path.join(OUT, 'icon.png'), base.toPNG());

  const set = path.join(OUT, 'icon.iconset');
  fs.rmSync(set, { recursive: true, force: true });
  fs.mkdirSync(set);
  for (const [name, px] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]]) {
    fs.writeFileSync(path.join(set, `icon_${name}.png`), base.resize({ width: px, height: px, quality: 'best' }).toPNG());
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', path.join(OUT, 'icon.icns')]);
  fs.rmSync(set, { recursive: true, force: true });
  console.log('Wrote assets/icon.png and assets/icon.icns');
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
