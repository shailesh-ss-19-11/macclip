'use strict';
const fs = require('node:fs');
const path = require('node:path');

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.heic']);

/** True for files macOS creates for screenshots ("Screenshot 2025-… .png", legacy "Screen Shot …"). */
function isScreenshotName(name, prefixes = ['Screenshot', 'Screen Shot']) {
  if (name.startsWith('.')) return false; // macOS writes a hidden temp file first
  if (!EXTENSIONS.has(path.extname(name).toLowerCase())) return false;
  return prefixes.some((p) => name.startsWith(p));
}

/**
 * Watches the screenshot folder and reports each new screenshot file once, after it has finished
 * writing. Only files that appear after start() are reported.
 */
class ScreenshotWatcher {
  constructor({ directory, prefixes, onScreenshot, onError, pollMs = 150, settleMs = 6000 }) {
    Object.assign(this, { directory, prefixes, onScreenshot, onError, pollMs, settleMs });
    this.watcher = null;
    this.seen = new Set();
    this.pending = new Set();
  }

  start() {
    if (this.watcher) return;
    try {
      this.seen = new Set(fs.readdirSync(this.directory)); // pre-existing files are ignored
      this.watcher = fs.watch(this.directory, (_event, name) => { if (name) this._consider(String(name)); });
      this.watcher.on('error', (e) => this.onError?.(e));
    } catch (e) {
      this.watcher = null;
      this.onError?.(e);
    }
  }

  stop() { this.watcher?.close(); this.watcher = null; }

  async _consider(name) {
    if (this.seen.has(name) || this.pending.has(name) || !isScreenshotName(name, this.prefixes)) return;
    const file = path.join(this.directory, name);
    this.pending.add(name);
    try {
      // Wait until the file exists and its size stops changing.
      let last = -1;
      let stable = 0;
      const deadline = Date.now() + this.settleMs;
      for (;;) {
        let size = -1;
        try { size = fs.statSync(file).size; } catch { /* not there yet */ }
        stable = size > 0 && size === last ? stable + 1 : 0;
        if (stable >= 2) break; // unchanged across two consecutive checks
        last = size;
        if (Date.now() > deadline) return;
        await new Promise((r) => setTimeout(r, this.pollMs));
      }
      this.seen.add(name);
      await this.onScreenshot(file);
    } catch (e) {
      this.onError?.(e);
    } finally {
      this.pending.delete(name);
    }
  }
}

/** The folder macOS saves screenshots to, given the value of `defaults read com.apple.screencapture location`. */
function resolveScreenshotDir(defaultsLocation, home) {
  const loc = (defaultsLocation || '').trim();
  if (!loc) return path.join(home, 'Desktop');
  return loc.startsWith('~') ? path.join(home, loc.slice(1)) : loc;
}

module.exports = { ScreenshotWatcher, isScreenshotName, resolveScreenshotDir };
