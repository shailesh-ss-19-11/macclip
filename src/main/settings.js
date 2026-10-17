'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const DEFAULTS = Object.freeze({
  hotkey: 'Alt+V',
  pasteBehavior: 'copyAndPaste', // 'copyOnly' | 'copyAndPaste'
  appearance: 'system',          // 'system' | 'light' | 'dark'
  historyLimit: 500,
  retentionDays: 30,             // 0 = keep until the item limit removes them
  paused: false,
  excludedApps: [],
  excludePasswordManagers: true,
  captureScreenshots: true,      // import screenshot files into history
  screenshotsToClipboard: true,  // and copy them to the clipboard
  secretHandling: 'skip',        // 'skip' | 'expire' | 'off'
});

const VALIDATORS = {
  hotkey: (v) => typeof v === 'string' && v.length > 0,
  pasteBehavior: (v) => ['copyOnly', 'copyAndPaste'].includes(v),
  appearance: (v) => ['system', 'light', 'dark'].includes(v),
  historyLimit: (v) => Number.isInteger(v) && v >= 10 && v <= 100_000,
  retentionDays: (v) => Number.isInteger(v) && v >= 0 && v <= 3650,
  paused: (v) => typeof v === 'boolean',
  excludedApps: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
  excludePasswordManagers: (v) => typeof v === 'boolean',
  captureScreenshots: (v) => typeof v === 'boolean',
  screenshotsToClipboard: (v) => typeof v === 'boolean',
  secretHandling: (v) => ['skip', 'expire', 'off'].includes(v),
};

/** Preferences in a small JSON file. Never contains clipboard content. */
class Settings extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.values = { ...DEFAULTS, excludedApps: [] };
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const key of Object.keys(DEFAULTS)) if (key in saved && VALIDATORS[key](saved[key])) this.values[key] = saved[key];
    } catch { /* first run or unreadable: use defaults */ }
  }

  get(key) { return this.values[key]; }
  all() { return { ...this.values }; }

  set(key, value) {
    if (!(key in DEFAULTS) || !VALIDATORS[key](value)) throw new Error(`Invalid setting: ${key}`);
    this.values[key] = value;
    this._write();
    this.emit('change', key, value);
  }

  _write() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
  }
}

module.exports = { Settings, DEFAULTS };
