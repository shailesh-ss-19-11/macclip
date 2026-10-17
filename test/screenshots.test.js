'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ScreenshotWatcher, isScreenshotName, resolveScreenshotDir } = require('../src/main/screenshotWatcher');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'macclip-shots-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('screenshot file names', () => {
  assert.equal(isScreenshotName('Screenshot 2025-06-15 at 10.30.00.png'), true);
  assert.equal(isScreenshotName('Screen Shot 2019-01-01 at 1.00.00 PM.png'), true);
  assert.equal(isScreenshotName('Screenshot 2025.JPG'), true);
  assert.equal(isScreenshotName('.Screenshot 2025.png'), false);      // macOS temp file
  assert.equal(isScreenshotName('Screenshot 2025.mov'), false);       // recordings
  assert.equal(isScreenshotName('holiday.png'), false);
  assert.equal(isScreenshotName('Mine 1.png', ['Mine']), true);
});

test('screenshot folder resolution', () => {
  assert.equal(resolveScreenshotDir('', '/Users/a'), '/Users/a/Desktop');
  assert.equal(resolveScreenshotDir('~/Pictures/Shots', '/Users/a'), '/Users/a/Pictures/Shots');
  assert.equal(resolveScreenshotDir('/tmp/x\n', '/Users/a'), '/tmp/x');
});

test('reports a new screenshot once, after it is fully written', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'Screenshot old.png'), 'old');   // pre-existing: ignored
  const got = [];
  const w = new ScreenshotWatcher({ directory: dir, pollMs: 50, onScreenshot: async (f) => { got.push([path.basename(f), fs.readFileSync(f, 'utf8')]); } });
  w.start();
  fs.writeFileSync(path.join(dir, '.Screenshot new.png'), 'tmp');          // hidden temp: ignored
  fs.writeFileSync(path.join(dir, 'notes.png'), 'x');                       // not a screenshot
  const final = path.join(dir, 'Screenshot new.png');
  fs.writeFileSync(final, 'part');
  await wait(20);
  fs.appendFileSync(final, '-complete');                                    // still growing
  await wait(1000);
  w.stop();
  assert.deepEqual(got, [['Screenshot new.png', 'part-complete']]);
});

test('an unreadable folder reports an error instead of throwing', () => {
  let error = null;
  const w = new ScreenshotWatcher({ directory: '/definitely/not/here', onScreenshot() {}, onError: (e) => { error = e; } });
  w.start();
  assert.ok(error);
});

test('settings for screenshots have safe defaults and validation', () => {
  const { Settings } = require('../src/main/settings');
  const s = new Settings(null);
  assert.equal(s.get('captureScreenshots'), true);
  assert.equal(s.get('screenshotsToClipboard'), true);
  assert.throws(() => s.set('captureScreenshots', 'yes'));
});
