'use strict';
const { execFile } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sendCommandV() {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      { timeout: 3000 }, (err) => (err ? reject(err) : resolve()));
  });
}

function activateApp(bundleId) {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-e', `tell application id "${bundleId.replace(/[^A-Za-z0-9.-]/g, '')}" to activate`], { timeout: 3000 }, () => resolve());
  });
}

/**
 * Restores an item to the clipboard and optionally pastes it into the app the user was in.
 * We only ever paste into the app that was frontmost when the panel opened, and only if it is
 * frontmost again after the panel closes.
 */
class PasteCoordinator {
  constructor({ clipboard, store, monitor, apps, accessibility, hidePanel, send = sendCommandV, activate = activateApp, wait = sleep }) {
    Object.assign(this, { clipboard, store, monitor, apps, accessibility, hidePanel, send, activate, wait });
  }

  /**
   * @returns 'copied' | 'pasted' | 'needs-accessibility' | 'target-unavailable'
   */
  async select(item, mode, target, { plain = false } = {}) {
    const image = item.kind === 'image' ? await this.store.readImage(item) : null;
    this.clipboard.write(item, image, { plain });
    this.monitor.markOwnWrite();
    this.store.touch(item.id);
    this.hidePanel();

    if (mode !== 'copyAndPaste') return 'copied';
    if (!this.accessibility.isTrusted()) {
      this.accessibility.prompt();
      return 'needs-accessibility';
    }
    if (!target) return 'target-unavailable';

    if (!(await this._waitForFrontmost(target, 600))) {
      // Focus did not return by itself. Reactivating the app the user came from is safe only when
      // nothing else took focus (no app, or us); if another app is frontmost the user moved on.
      const now = await this.apps.frontmost();
      if (now === null && target.bundleId) {
        await this.activate(target.bundleId);
        if (!(await this._waitForFrontmost(target, 600))) return 'target-unavailable';
      } else {
        return 'target-unavailable';
      }
    }
    await this.wait(40);
    if ((await this.apps.frontmost())?.pid !== target.pid) return 'target-unavailable';
    try { await this.send(); } catch { return 'needs-accessibility'; }
    return 'pasted';
  }

  async _waitForFrontmost(target, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await this.apps.frontmost())?.pid === target.pid) return true;
      if (Date.now() >= deadline) return false;
      await this.wait(40);
    }
  }
}

module.exports = { PasteCoordinator };
