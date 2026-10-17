'use strict';
const crypto = require('node:crypto');
const { capture } = require('./capture');

const SENSITIVE_TTL_MS = 2 * 60 * 1000;

/**
 * Watches the system clipboard. Electron exposes no pasteboard change counter, so this polls a cheap
 * fingerprint (format list + text + hash of raw image bytes) and only does real work when it changes.
 *
 * `clipboard` adapter: { fingerprint(), snapshot(), formats() }.
 */
class ClipboardMonitor {
  constructor({ clipboard, store, privacy, apps, intervalMs = 500, limits, onCapture }) {
    this.clipboard = clipboard;
    this.store = store;
    this.privacy = privacy;
    this.apps = apps;
    this.intervalMs = intervalMs;
    this.limits = limits;
    this.onCapture = onCapture;
    this.last = null;
    this.timer = null;
    this.busy = Promise.resolve();
  }

  start() {
    if (this.timer) return;
    this.last = this.clipboard.fingerprint(); // content copied before launch is not imported
    this.timer = setInterval(() => { this.busy = this.busy.then(() => this.checkNow()); }, this.intervalMs);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  /** Call right after MacClip writes to the clipboard so the write is not recorded as a new copy. */
  markOwnWrite() { this.last = this.clipboard.fingerprint(); }

  /** One detection pass. Returns the stored item, or null. */
  async checkNow() {
    const fp = this.clipboard.fingerprint();
    if (fp === this.last) return null;
    this.last = fp;

    const formats = this.clipboard.formats();
    const source = await this.apps.frontmost();
    const decision = this.privacy.evaluate({ sourceBundleId: source?.bundleId, formats });
    if (!decision.record) return null;

    const result = capture(this.clipboard.snapshot(), source, { limits: this.limits });
    if (!result.item) return null;
    const secret = result.item.text ? this.privacy.detectSecret(result.item.text) : null;
    if (secret) {
      if (this.privacy.secretMode() === 'skip') return null;
      // 'expire': keep it pasteable for a short time, masked in the UI, and never searchable.
      Object.assign(result.item, { sensitive: true, secretLabel: secret, expiresAt: Date.now() + SENSITIVE_TTL_MS, searchText: 'sensitive' });
    }
    const item = this.store.add(result);
    this.onCapture?.(item);
    return item;
  }
}

const hashBuffer = (buf) => crypto.createHash('md5').update(buf).digest('hex');

module.exports = { ClipboardMonitor, hashBuffer, SENSITIVE_TTL_MS };
