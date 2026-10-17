'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { detectSecret, luhn } = require('../src/main/secrets');
const { SnippetStore } = require('../src/main/snippets');
const { AppIcons } = require('../src/main/appIcons');
const { MemoryPersistence, EncryptedFilePersistence, StaticKeyProvider } = require('../src/main/persistence');
const { ClipboardMonitor, SENSITIVE_TTL_MS } = require('../src/main/clipboardMonitor');
const { PrivacyManager } = require('../src/main/privacy');
const { PasteCoordinator } = require('../src/main/pasteCoordinator');
const { Settings } = require('../src/main/settings');
const { toListItem } = require('../src/main/preview');
const { textSnap, clip, newStore, FakeClipboard } = require('./helpers');

// ── secrets ──
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

// ── monitor secret handling ──
function monitorWith(mode) {
  const cb = new FakeClipboard(); const store = newStore();
  const settings = new Settings(null); settings.set('secretHandling', mode);
  const monitor = new ClipboardMonitor({ clipboard: cb, store, privacy: new PrivacyManager(settings), apps: { frontmost: async () => ({ bundleId: 'com.test', name: 'T', pid: 1 }) } });
  monitor.last = cb.fingerprint();
  return { cb, store, monitor };
}
const TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`;

test('secrets are skipped by default', async () => {
  const { cb, monitor, store } = monitorWith('skip');
  cb.setText(TOKEN); await monitor.checkNow();
  assert.equal(store.items.length, 0);
});

test('"expire" keeps a hidden, unsearchable item that disappears', async () => {
  const { cb, monitor, store } = monitorWith('expire');
  cb.setText(TOKEN); const item = await monitor.checkNow();
  assert.equal(item.sensitive, true);
  assert.equal(store.search(TOKEN.slice(0, 8)).length, 0);
  const listed = toListItem(item);
  assert.ok(!listed.preview.includes('ghp_'));
  assert.match(listed.preview, /GitHub token/);
  store.applyRetention(Date.now() + SENSITIVE_TTL_MS + 1000);
  assert.equal(store.items.length, 0);
});

test('pinning a sensitive item keeps it', async () => {
  const { cb, monitor, store } = monitorWith('expire');
  cb.setText(TOKEN); const item = await monitor.checkNow();
  store.togglePin(item.id);
  store.applyRetention(Date.now() + SENSITIVE_TTL_MS + 1000);
  assert.equal(store.items.length, 1);
});

test('"off" saves secrets like any other text', async () => {
  const { cb, monitor, store } = monitorWith('off');
  cb.setText(TOKEN); await monitor.checkNow();
  assert.equal(store.items.length, 1);
  assert.ok(!store.items[0].sensitive);
});

// ── snippets ──
test('snippets: create, update, search, delete', async () => {
  const s = new SnippetStore(new MemoryPersistence());
  await s.load();
  const a = s.save({ title: 'Sig', text: 'Best,\nShailesh' });
  assert.equal(a.ok, true);
  assert.equal(s.save({ text: 'Line one\nline two' }).snippet.title, 'Line one');
  assert.equal(s.save({ title: 'x', text: '   ' }).ok, false);
  assert.equal(s.save({ id: 'nope', text: 'x' }).ok, false);
  s.save({ id: a.snippet.id, title: 'Signature', text: 'Regards' });
  assert.equal(s.get(a.snippet.id).title, 'Signature');
  assert.equal(s.search('regards').length, 1);
  assert.equal(s.search('signature regards').length, 1);
  assert.equal(s.search('zzz').length, 0);
  s.delete(a.snippet.id);
  assert.equal(s.items.length, 1);
});

test('snippets persist (encrypted) across relaunch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macclip-sn-')); const keys = new StaticKeyProvider();
  const a = new SnippetStore(new EncryptedFilePersistence(dir, keys)); await a.load();
  a.save({ title: 'T', text: 'SNIPPET-PLAINTEXT-MARKER' });
  await a.persistence.idle();
  const b = new SnippetStore(new EncryptedFilePersistence(dir, keys)); await b.load();
  assert.equal(b.items[0].text, 'SNIPPET-PLAINTEXT-MARKER');
  assert.ok(!fs.readFileSync(path.join(dir, 'snippets.bin')).includes('SNIPPET-PLAINTEXT-MARKER'));
  a.save({ text: 'sync-save' }); a.flushSync();
  const c = new SnippetStore(new EncryptedFilePersistence(dir, keys)); await c.load();
  assert.equal(c.items.length, 2);
});

test('a corrupt snippets file loads as empty', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macclip-sn-'));
  fs.writeFileSync(path.join(dir, 'snippets.bin'), 'garbage garbage garbage garbage garbage garbage');
  const s = new SnippetStore(new EncryptedFilePersistence(dir, new StaticKeyProvider())); await s.load();
  assert.deepEqual(s.items, []);
});

// ── plain-text paste ──
test('plain paste is passed through to the clipboard writer', async () => {
  const cb = new FakeClipboard(); const store = newStore();
  const apps = { frontmost: async () => ({ pid: 1 }) };
  const monitor = new ClipboardMonitor({ clipboard: cb, store, privacy: new PrivacyManager(new Settings(null)), apps });
  const paste = new PasteCoordinator({ clipboard: cb, store, monitor, apps, accessibility: { isTrusted: () => true, prompt() {} }, hidePanel() {}, send: async () => {}, wait: async () => {} });
  const item = store.add(clip(textSnap('rich', { rtf: Buffer.from('{\\rtf1 rich}') })), 1);
  await paste.select(item, 'copyOnly', { pid: 1 }, { plain: true });
  await paste.select(item, 'copyOnly', { pid: 1 });
  assert.equal(cb.written[0].opts.plain, true);
  assert.equal(cb.written[1].opts.plain, false);
});

test('snippet-shaped items can be pasted without being in history', async () => {
  const cb = new FakeClipboard(); const store = newStore();
  const apps = { frontmost: async () => ({ pid: 1 }) };
  const monitor = new ClipboardMonitor({ clipboard: cb, store, privacy: new PrivacyManager(new Settings(null)), apps });
  const paste = new PasteCoordinator({ clipboard: cb, store, monitor, apps, accessibility: { isTrusted: () => true, prompt() {} }, hidePanel() {}, send: async () => {}, wait: async () => {} });
  assert.equal(await paste.select({ id: 'snip', kind: 'text', text: 'hi' }, 'copyAndPaste', { pid: 1 }), 'pasted');
  assert.equal(store.items.length, 0);
});

// ── icons ──
test('app icons are looked up once per bundle id and bad ids are rejected', async () => {
  let lookups = 0;
  const icons = new AppIcons({ findAppPath: async () => { lookups++; return '/Applications/X.app'; }, getIcon: async () => 'data:image/png;base64,AAAA' });
  assert.equal(await icons.get('com.apple.Safari'), 'data:image/png;base64,AAAA');
  await icons.get('com.apple.Safari');
  assert.equal(lookups, 1);
  assert.equal(await icons.get("x'; rm -rf /"), null);
  assert.equal(await icons.get(undefined), null);
});

test('icon lookup failures resolve to null', async () => {
  const icons = new AppIcons({ findAppPath: async () => { throw new Error('boom'); }, getIcon: async () => 'x' });
  assert.equal(await icons.get('com.x.y'), null);
  const missing = new AppIcons({ findAppPath: async () => '', getIcon: async () => 'x' });
  assert.equal(await missing.get('com.x.y'), null);
});

test('list items expose the source bundle id for icons', () => {
  const item = toListItem({ id: '1', kind: 'text', text: 'x', createdAt: 1, isPinned: false, sourceBundleId: 'com.apple.Notes' });
  assert.equal(item.sourceBundleId, 'com.apple.Notes');
});
