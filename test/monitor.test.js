'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ClipboardMonitor } = require('../src/main/clipboardMonitor');
const { PrivacyManager, CONCEALED_TYPES } = require('../src/main/privacy');
const { Settings } = require('../src/main/settings');
const { newStore, FakeClipboard } = require('./helpers');

function setup({ front = { bundleId: 'com.test.app', name: 'Test', pid: 10 }, settings = {} } = {}) {
  const cb = new FakeClipboard();
  const store = newStore();
  const s = new Settings(null);
  for (const [k, v] of Object.entries(settings)) s.set(k, v);
  const state = { front };
  const monitor = new ClipboardMonitor({ clipboard: cb, store, privacy: new PrivacyManager(s, ['com.macclip.app']), apps: { frontmost: async () => state.front } });
  monitor.last = cb.fingerprint();
  return { cb, store, monitor, s, state };
}

test('no change means nothing is read or stored', async () => {
  const { monitor, store } = setup();
  assert.equal(await monitor.checkNow(), null);
  assert.equal(store.items.length, 0);
});

test('detects text, url and image changes', async () => {
  const { cb, monitor, store } = setup();
  cb.setText('plain'); await monitor.checkNow();
  cb.setText('https://example.com'); await monitor.checkNow();
  cb.setImage(1); await monitor.checkNow();
  assert.deepEqual(store.items.map((i) => i.kind), ['image', 'url', 'text']);
});

test('records the source application', async () => {
  const { cb, monitor, store } = setup({ front: { bundleId: 'com.apple.Safari', name: 'Safari', pid: 5 } });
  cb.setText('from safari'); await monitor.checkNow();
  assert.equal(store.items[0].sourceAppName, 'Safari');
});

test('copying the same thing twice does not duplicate', async () => {
  const { cb, monitor, store } = setup();
  cb.setText('dup'); await monitor.checkNow();
  cb.setText('dup'); await monitor.checkNow();
  assert.equal(store.items.length, 1);
});

test('own writes are not recorded', async () => {
  const { cb, monitor, store } = setup();
  cb.setText('original'); await monitor.checkNow();
  cb.write(store.items[0], null);
  monitor.markOwnWrite();
  assert.equal(await monitor.checkNow(), null);
  assert.equal(store.items.length, 1);
});

test('paused monitoring records nothing, and resuming does not import stale content', async () => {
  const { cb, monitor, store, s } = setup({ settings: { paused: true } });
  cb.setText('while paused'); await monitor.checkNow();
  assert.equal(store.items.length, 0);
  s.set('paused', false);
  assert.equal(await monitor.checkNow(), null);
  cb.setText('after resume'); await monitor.checkNow();
  assert.deepEqual(store.items.map((i) => i.text), ['after resume']);
});

test('password managers are not recorded', async () => {
  const { cb, monitor, store, state } = setup();
  state.front = { bundleId: 'com.1password.1password', name: '1Password', pid: 2 };
  cb.setText('password'); await monitor.checkNow();
  state.front = { bundleId: 'org.keepassxc.keepassxc', name: 'KeePassXC', pid: 4 };
  cb.setText('another'); await monitor.checkNow();
  assert.equal(store.items.length, 0);
  state.front = { bundleId: 'com.apple.Notes', name: 'Notes', pid: 3 };
  cb.setText('fine'); await monitor.checkNow();
  assert.equal(store.items.length, 1);
});

test('concealed / transient pasteboard types are skipped', async () => {
  for (const type of CONCEALED_TYPES) {
    const { cb, monitor, store } = setup();
    cb.setText('s3cret', ['text/plain', type]); await monitor.checkNow();
    assert.equal(store.items.length, 0, type);
  }
});

test('file copies are ignored', async () => {
  const { cb, monitor, store } = setup();
  cb.setFileUrl(); await monitor.checkNow();
  assert.equal(store.items.length, 0);
});

test('rapid changes collapse into the latest content', async () => {
  const { cb, monitor, store } = setup();
  cb.setText('first'); cb.setText('second'); cb.setText('third');
  await monitor.checkNow();
  assert.deepEqual(store.items.map((i) => i.text), ['third']);
});

test('start/stop manage the timer', () => {
  const { monitor } = setup();
  monitor.start(); assert.ok(monitor.timer);
  monitor.stop(); assert.equal(monitor.timer, null);
});

test('privacy decisions never include the clipboard content', () => {
  const p = new PrivacyManager(new Settings(null), ['com.macclip.app']);
  assert.deepEqual(p.evaluate({ sourceBundleId: 'com.macclip.app', formats: [] }), { record: false, reason: 'own-app' });
});
