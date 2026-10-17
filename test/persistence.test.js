'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EncryptedFilePersistence, StaticKeyProvider } = require('../src/main/persistence');
const { HistoryStore } = require('../src/main/historyStore');
const { textSnap, imageSnap, clip } = require('./helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'macclip-'));
const open = (dir, keys) => new HistoryStore(new EncryptedFilePersistence(dir, keys), { saveDelayMs: 1 });

test('history and images survive a relaunch', async () => {
  const dir = tmp(); const keys = new StaticKeyProvider();
  const a = open(dir, keys);
  await a.load();
  a.add(clip(textSnap('persist me')), 1000);
  const img = a.add(clip(imageSnap(7)), 2000);
  a.togglePin(img.id);
  await a.flush();

  const b = open(dir, keys);
  await b.load();
  assert.deepEqual(b.items.map((i) => i.kind), ['image', 'text']);
  assert.equal(b.items[0].isPinned, true);
  assert.deepEqual(await b.readImage(b.items[0]), Buffer.from('png-bytes-7'));
  assert.deepEqual(await b.readThumbnail(b.items[0]), Buffer.from('thumb-7'));
});

test('nothing is stored in plaintext', async () => {
  const dir = tmp();
  const s = open(dir, new StaticKeyProvider());
  await s.load();
  s.add(clip(textSnap('TOP-SECRET-PLAINTEXT-MARKER')), 1);
  s.add(clip(imageSnap(3)), 2);
  await s.flush();
  const files = [path.join(dir, 'history.bin'), ...fs.readdirSync(path.join(dir, 'blobs')).map((f) => path.join(dir, 'blobs', f))];
  assert.ok(files.length >= 3);
  for (const f of files) {
    const bytes = fs.readFileSync(f);
    assert.ok(!bytes.includes('TOP-SECRET-PLAINTEXT-MARKER'));
    assert.ok(!bytes.includes('png-bytes-3'));
  }
});

test('corrupted history is quarantined and the app starts empty', async () => {
  const dir = tmp(); const keys = new StaticKeyProvider();
  const a = open(dir, keys); await a.load();
  a.add(clip(textSnap('x')), 1); await a.flush();
  fs.writeFileSync(path.join(dir, 'history.bin'), Buffer.from('garbage garbage garbage garbage garbage'));

  const b = open(dir, keys);
  await b.load();
  assert.equal(b.items.length, 0);
  assert.match(b.loadIssue, /set aside/);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('history.corrupt-')));
  b.add(clip(textSnap('works again')), 2);
  await b.flush();
});

test('a wrong key is treated as unreadable, not a crash', async () => {
  const dir = tmp();
  const a = open(dir, new StaticKeyProvider()); await a.load();
  a.add(clip(textSnap('x')), 1); await a.flush();
  const b = open(dir, new StaticKeyProvider());
  await b.load();
  assert.equal(b.items.length, 0);
  assert.ok(b.loadIssue);
});

test('orphaned blobs are pruned on load', async () => {
  const dir = tmp(); const keys = new StaticKeyProvider();
  const p = new EncryptedFilePersistence(dir, keys);
  await p.writeBlob('orphan.png', Buffer.from('x'));
  const s = new HistoryStore(p); await s.load();
  assert.deepEqual(fs.readdirSync(path.join(dir, 'blobs')), []);
});

test('blob names cannot escape the blob directory', () => {
  const p = new EncryptedFilePersistence(tmp(), new StaticKeyProvider());
  assert.throws(() => p.writeBlob('../evil', Buffer.from('x')));
});

test('clearAll removes every file', async () => {
  const dir = tmp();
  const s = open(dir, new StaticKeyProvider()); await s.load();
  s.add(clip(imageSnap(1)), 1); await s.flush();
  await s.clearAll();
  assert.ok(!fs.existsSync(path.join(dir, 'history.bin')));
  assert.ok(!fs.existsSync(path.join(dir, 'blobs')));
});
