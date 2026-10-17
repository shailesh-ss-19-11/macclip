'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const NAME = /^(Screenshot|Screen Shot|Screen Recording)\b.*\.(png|jpe?g)$/i;
const FRESH_MS = 15_000;

function screenshotDir() {
  return new Promise((resolve) => {
    execFile('/usr/bin/defaults', ['read', 'com.apple.screencapture', 'location'], { timeout: 1500 }, (err, out) => {
      const configured = err ? '' : out.trim().replace(/^~/, process.env.HOME || '');
      resolve(configured && fs.existsSync(configured) ? configured : path.join(process.env.HOME || '', 'Desktop'));
    });
  });
}

/**
 * macOS saves ⌘⇧3/4/5 screenshots to a file, not the clipboard. This watches the screenshot folder and
 * hands each new screenshot to `onScreenshot(buffer)` so it can be copied (and so land in history).
 */
class ScreenshotWatcher {
  constructor({ onScreenshot, dir = screenshotDir, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    Object.assign(this, { onScreenshot, dir, wait });
    this.watcher = null;
    this.seen = new Set();
  }

  async start() {
    if (this.watcher) return;
    const dir = await this.dir();
    try {
      this.watcher = fs.watch(dir, (_event, name) => { if (name && NAME.test(name)) this._handle(path.join(dir, name)); });
      this.watcher.on('error', () => this.stop());
    } catch { /* folder missing or not readable: nothing to watch */ }
  }

  stop() { this.watcher?.close(); this.watcher = null; }

  async _handle(file) {
    if (this.seen.has(file)) return;
    // The file appears before it is fully written: wait until the size stops changing.
    let size = -1;
    for (let i = 0; i < 60; i++) {
      let st;
      try { st = fs.statSync(file); } catch { return; } // renamed away or deleted
      if (Date.now() - st.birthtimeMs > FRESH_MS) return; // an old file that was merely touched or moved in
      if (st.size > 0 && st.size === size) break;
      size = st.size;
      await this.wait(50);
    }
    if (this.seen.has(file)) return;
    this.seen.add(file);
    if (this.seen.size > 50) this.seen.delete(this.seen.values().next().value);
    try { this.onScreenshot(fs.readFileSync(file)); } catch { /* unreadable (e.g. no Desktop access) */ }
  }
}

module.exports = { ScreenshotWatcher, NAME };
