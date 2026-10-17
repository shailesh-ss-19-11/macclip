'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PasteCoordinator } = require('../src/main/pasteCoordinator');
const { ClipboardMonitor } = require('../src/main/clipboardMonitor');
const { PrivacyManager } = require('../src/main/privacy');
const { Settings } = require('../src/main/settings');
const { textSnap, imageSnap, clip, newStore, FakeClipboard } = require('./helpers');

const SAFARI = { bundleId: 'com.apple.Safari', name: 'Safari', pid: 100 };
const CHROME = { bundleId: 'com.google.Chrome', name: 'Chrome', pid: 200 };

function setup({ trusted = true, front = SAFARI } = {}) {
  const cb = new FakeClipboard();
  const store = newStore();
  const state = { front, sent: 0, hidden: 0, prompts: 0, activated: [] };
  const apps = { frontmost: async () => state.front };
  const monitor = new ClipboardMonitor({ clipboard: cb, store, privacy: new PrivacyManager(new Settings(null)), apps });
  const paste = new PasteCoordinator({
    clipboard: cb, store, monitor, apps,
    accessibility: { isTrusted: () => trusted, prompt: () => state.prompts++ },
    hidePanel: () => state.hidden++,
    send: async () => { state.sent++; },
    activate: async (id) => { state.activated.push(id); state.front = SAFARI; },
    wait: async () => {},
  });
  return { cb, store, monitor, paste, state };
}

test('copy-only restores to the clipboard and closes the panel without pasting', async () => {
  const { store, paste, cb, state } = setup();
  const item = store.add(clip(textSnap('hello')), 1);
  assert.equal(await paste.select(item, 'copyOnly', SAFARI), 'copied');
  assert.equal(cb.written[0].item.id, item.id);
  assert.equal(state.hidden, 1);
  assert.equal(state.sent, 0);
});

test('copy-and-paste pastes into the original app', async () => {
  const { store, paste, state } = setup();
  const item = store.add(clip(textSnap('hello')), 1);
  assert.equal(await paste.select(item, 'copyAndPaste', SAFARI), 'pasted');
  assert.equal(state.sent, 1);
});

test('does not paste into a different app than the target', async () => {
  const { store, paste, state } = setup({ front: CHROME });
  const item = store.add(clip(textSnap('hello')), 1);
  assert.equal(await paste.select(item, 'copyAndPaste', SAFARI), 'target-unavailable');
  assert.equal(state.sent, 0);
  assert.deepEqual(state.activated, []); // never steals focus from a third app
});

test('switching apps between open and select is respected', async () => {
  const { store, paste, state } = setup();
  const item = store.add(clip(textSnap('x')), 1);
  state.front = CHROME;
  assert.equal(await paste.select(item, 'copyAndPaste', SAFARI), 'target-unavailable');
  assert.equal(state.sent, 0);
});

test('re-activates the original app only when focus is left with nobody', async () => {
  const { store, paste, state } = setup({ front: null });
  const item = store.add(clip(textSnap('x')), 1);
  assert.equal(await paste.select(item, 'copyAndPaste', SAFARI), 'pasted');
  assert.deepEqual(state.activated, ['com.apple.Safari']);
});

test('without Accessibility permission it copies, prompts, and does not paste', async () => {
  const { store, paste, state } = setup({ trusted: false });
  const item = store.add(clip(textSnap('x')), 1);
  assert.equal(await paste.select(item, 'copyAndPaste', SAFARI), 'needs-accessibility');
  assert.equal(state.prompts, 1);
  assert.equal(state.sent, 0);
});

test('no known target app means copy only', async () => {
  const { store, paste } = setup();
  const item = store.add(clip(textSnap('x')), 1);
  assert.equal(await paste.select(item, 'copyAndPaste', null), 'target-unavailable');
});

test('selecting an item moves it to the top and is not re-recorded', async () => {
  const { store, paste, monitor, cb } = setup();
  const a = store.add(clip(textSnap('a')), 1); store.add(clip(textSnap('b')), 2);
  await paste.select(a, 'copyOnly', SAFARI);
  assert.equal(store.items[0].id, a.id);
  assert.equal(await monitor.checkNow(), null);
  assert.equal(store.items.length, 2);
  assert.equal(cb.written.length, 1);
});

test('images are restored from their stored blob', async () => {
  const { store, paste, cb } = setup();
  const item = store.add(clip(imageSnap(9)), 1);
  await paste.select(item, 'copyOnly', SAFARI);
  assert.deepEqual(cb.written[0].image, Buffer.from('png-bytes-9'));
});

test('a failing keystroke is reported, not thrown', async () => {
  const { store, paste } = setup();
  paste.send = async () => { throw new Error('not allowed'); };
  const item = store.add(clip(textSnap('x')), 1);
  assert.equal(await paste.select(item, 'copyAndPaste', SAFARI), 'needs-accessibility');
});
