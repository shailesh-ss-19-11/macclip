'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ScreenshotWatcher, NAME } = require('../src/main/screenshotWatcher');

test('recognises macOS screenshot file names', () => {
  assert.ok(NAME.test('Screenshot 2026-10-17 at 3.28.37 PM.png'));
  assert.ok(NAME.test('Screen Shot 2020-01-01 at 1.00.00 PM.png'));
  assert.ok(!NAME.test('.Screenshot 2026.png'));
  assert.ok(!NAME.test('holiday.png'));
});

test('hands a new screenshot file to the callback exactly once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const got = [];
  const w = new ScreenshotWatcher({ dir: async () => dir, onScreenshot: (b) => got.push(b), wait: (ms) => new Promise((r) => setTimeout(r, ms / 10)) });
  await w.start();
  fs.writeFileSync(path.join(dir, 'holiday.png'), 'ignored');
  fs.writeFileSync(path.join(dir, 'Screenshot 2026-10-17 at 3.28.37 PM.png'), 'pixels');
  await new Promise((r) => setTimeout(r, 600));
  w.stop();
  fs.rmSync(dir, { recursive: true });
  assert.equal(got.length, 1);
  assert.equal(got[0].toString(), 'pixels');
});
