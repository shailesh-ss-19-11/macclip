'use strict';
// `npm run smoke`: exercises the real Electron clipboard / nativeImage / safeStorage paths, then exits.
const { clipboard, nativeImage, safeStorage, globalShortcut } = require('electron');
const assert = require('node:assert');
const { capture } = require('./capture');
const { ClipboardMonitor } = require('./clipboardMonitor');
const { HistoryStore } = require('./historyStore');
const { MemoryPersistence } = require('./persistence');
const { PrivacyManager } = require('./privacy');
const { Settings } = require('./settings');
const { HotKeyManager } = require('./hotkey');

exports.run = async function run(app, sys) {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
  };

  const settings = new Settings(null);
  const store = new HistoryStore(new MemoryPersistence(), { saveDelayMs: 10 });
  const monitor = new ClipboardMonitor({
    clipboard: sys, store, privacy: new PrivacyManager(settings), apps: { frontmost: async () => ({ bundleId: 'com.test.app', name: 'Test', pid: 1 }) },
  });
  clipboard.clear();
  monitor.last = sys.fingerprint();

  await check('text copy is captured', async () => {
    clipboard.writeText('hello from smoke test');
    const item = await monitor.checkNow();
    assert.equal(item?.kind, 'text');
    assert.equal(item.text, 'hello from smoke test');
  });
  await check('url copy is classified as link', async () => {
    clipboard.writeText('https://example.com/path?q=1');
    assert.equal((await monitor.checkNow())?.kind, 'url');
  });
  await check('rich text keeps RTF', async () => {
    clipboard.write({ text: 'bold words', rtf: '{\\rtf1\\ansi {\\b bold} words}', html: '<b>bold</b> words' });
    const item = await monitor.checkNow();
    assert.equal(item?.kind, 'richText');
    assert.ok(item.rtf);
  });
  await check('image copy is captured with thumbnail', async () => {
    const size = 300;
    const buf = Buffer.alloc(size * size * 4, 200);
    clipboard.writeImage(nativeImage.createFromBitmap(buf, { width: size, height: size }));
    const item = await monitor.checkNow();
    assert.equal(item?.kind, 'image');
    const thumb = nativeImage.createFromBuffer(await store.readThumbnail(item));
    assert.ok(thumb.getSize().width <= 192 && thumb.getSize().width > 0);
    assert.ok((await store.readImage(item)).length > 0);
  });
  await check('own write is ignored', async () => {
    const before = store.items.length;
    const item = store.items.find((i) => i.kind === 'text');
    sys.write(item, null);
    monitor.markOwnWrite();
    assert.equal(await monitor.checkNow(), null);
    assert.equal(store.items.length, before);
  });
  await check('concealed marker is detected and skipped', async () => {
    clipboard.write({ text: 'super-secret-token' });
    clipboard.writeBuffer('org.nspasteboard.ConcealedType', Buffer.from('x'));
    assert.ok(sys.formats().includes('org.nspasteboard.ConcealedType'), `formats: ${sys.formats()}`);
    const before = store.items.length;
    assert.equal(await monitor.checkNow(), null);
    assert.equal(store.items.length, before);
  });
  await check('screenshot file bytes become an image item with thumbnail', async () => {
    const png = nativeImage.createFromBitmap(Buffer.alloc(400 * 300 * 4, 120), { width: 400, height: 300 }).toPNG();
    const result = capture({ text: '', rtf: null, html: null, hasFileUrl: false, imageByteLength: png.length, getImage: () => sys.processImage(png) }, { bundleId: 'com.apple.screencaptureui', name: 'Screenshot' });
    assert.equal(result.item.kind, 'image');
    assert.equal(result.item.sourceAppName, 'Screenshot');
    sys.write(result.item, result.image.png);
    assert.equal(clipboard.readImage().getSize().width, 400);
  });
  await check('safeStorage available', async () => { assert.ok(safeStorage.isEncryptionAvailable()); });
  await check('global shortcut registers and conflicts are reported', async () => {
    const hk = new HotKeyManager({ registrar: globalShortcut, onTrigger() {} });
    assert.equal(hk.register('Control+Alt+Shift+F13'), null);
    const second = new HotKeyManager({ registrar: { register: () => false, unregister() {} }, onTrigger() {} });
    assert.ok(second.register('Alt+V'));
    hk.unregister();
  });

  console.log(results.join('\n'));
  clipboard.clear();
  app.exit(process.exitCode ?? 0);
};
