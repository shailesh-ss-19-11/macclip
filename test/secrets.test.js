'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectSecret, luhn } = require('../src/main/secrets');
const { ClipboardMonitor } = require('../src/main/clipboardMonitor');
const { PrivacyManager } = require('../src/main/privacy');
const { PasteCoordinator } = require('../src/main/pasteCoordinator');
const { Settings } = require('../src/main/settings');
const { textSnap, clip, newStore, FakeClipboard } = require('./helpers');

test('detects common credential formats', () => {
  const samples = {
    'AWS access key': 'AKIAIOSFODNN7EXAMPLE',
    'GitHub token': `ghp_${'a1B2c3D4e5'.repeat(4)}`,
    'Slack token': 'xoxb-1234567890-abcdefghij',
    'Stripe key': `sk_live_${'x'.repeat(24)}`,
    'API key': `sk-${'A1b2'.repeat(8)}`,
    'JSON web token': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r',
    'Private key': '-----BEGIN RSA PRIVATE KEY-----\nMIIE',
    'Bearer token': 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
    'Credential assignment': 'DB_PASSWORD=hunter2hunter2',
    'Card number': '4111 1111 1111 1111',
  };
  for (const [label, text] of Object.entries(samples)) assert.equal(detectSecret(text), label, label);
});

test('ordinary content is not flagged', () => {
  for (const text of [
    'hello world', 'https://example.com/a/b?c=d', 'function add(a, b) {\n  return a + b;\n}',
    'da39a3ee5e6b4b0d3255bfef95601890afd80709', 'Meeting at 10:30, room 4', '1234 5678 9012 3456',
    'the password is something we will discuss', 'token = getToken()', '2025-06-15', 'Call me on 555 123 4567',
  ]) assert.equal(detectSecret(text), null, text);
  assert.equal(luhn('4111111111111111'), true);
  assert.equal(luhn('4111111111111112'), false);
});

test('likely secrets are never saved; normal text still is', async () => {
  const cb = new FakeClipboard(); const store = newStore();
  const monitor = new ClipboardMonitor({ clipboard: cb, store, privacy: new PrivacyManager(new Settings(null)), apps: { frontmost: async () => ({ bundleId: 'com.test', name: 'T', pid: 1 }) } });
  monitor.last = cb.fingerprint();
  cb.setText(`ghp_${'a1B2c3D4e5'.repeat(4)}`); await monitor.checkNow();
  assert.equal(store.items.length, 0);
  cb.setText('a normal note'); await monitor.checkNow();
  assert.equal(store.items.length, 1);
});

function pasteSetup() {
  const cb = new FakeClipboard(); const store = newStore();
  const apps = { frontmost: async () => ({ pid: 1 }) };
  const monitor = new ClipboardMonitor({ clipboard: cb, store, privacy: new PrivacyManager(new Settings(null)), apps });
  const paste = new PasteCoordinator({ clipboard: cb, store, monitor, apps, accessibility: { isTrusted: () => true, prompt() {} }, hidePanel() {}, send: async () => {}, wait: async () => {} });
  return { cb, store, paste };
}

test('plain paste is passed through to the clipboard writer', async () => {
  const { cb, store, paste } = pasteSetup();
  const item = store.add(clip(textSnap('rich', { rtf: Buffer.from('{\\rtf1 rich}') })), 1);
  await paste.select(item, 'copyOnly', { pid: 1 }, { plain: true });
  await paste.select(item, 'copyOnly', { pid: 1 });
  assert.equal(cb.written[0].opts.plain, true);
  assert.equal(cb.written[1].opts.plain, false);
});
