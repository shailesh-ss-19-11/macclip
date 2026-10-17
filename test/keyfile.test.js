'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { FileKeyProvider, EncryptedFilePersistence } = require('../src/main/persistence');
const { HistoryStore } = require('../src/main/historyStore');
const { textSnap, clip } = require('./helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'macclip-key-'));

test('creates a private 256-bit key file and reuses it', () => {
  const dir = tmp(); const file = path.join(dir, 'sub', 'history.key');
  const a = new FileKeyProvider(file).getKey();
  assert.equal(a.length, 32);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(new FileKeyProvider(file).getKey(), a);
});

test('a damaged key file is replaced rather than crashing', () => {
  const file = path.join(tmp(), 'history.key');
  fs.writeFileSync(file, 'not-hex');
  assert.equal(new FileKeyProvider(file).getKey().length, 32);
  assert.equal(Buffer.from(fs.readFileSync(file, 'utf8'), 'hex').length, 32);
});

test('migrates a legacy key and keeps it for later launches', () => {
  const file = path.join(tmp(), 'history.key');
  const legacy = crypto.randomBytes(32);
  assert.deepEqual(new FileKeyProvider(file, { legacyKey: () => legacy }).getKey(), legacy);
  assert.deepEqual(new FileKeyProvider(file).getKey(), legacy); // no legacy source needed now
});

test('a failing or invalid legacy source falls back to a new key', () => {
  const a = new FileKeyProvider(path.join(tmp(), 'k1'), { legacyKey: () => { throw new Error('keychain denied'); } }).getKey();
  const b = new FileKeyProvider(path.join(tmp(), 'k2'), { legacyKey: () => Buffer.from('short') }).getKey();
  assert.equal(a.length, 32); assert.equal(b.length, 32);
});

test('history written with a legacy key opens after migration', async () => {
  const dir = tmp(); const legacy = crypto.randomBytes(32);
  const old = new HistoryStore(new EncryptedFilePersistence(dir, { getKey: () => legacy }), { saveDelayMs: 1 });
  await old.load(); old.add(clip(textSnap('from the old version')), 1); await old.flush();

  const keys = new FileKeyProvider(path.join(dir, 'history.key'), { legacyKey: () => legacy });
  const upgraded = new HistoryStore(new EncryptedFilePersistence(dir, keys), { saveDelayMs: 1 });
  await upgraded.load();
  assert.equal(upgraded.items[0].text, 'from the old version');
  assert.equal(upgraded.loadIssue, null);
});

test('full restart round trip with the key file only', async () => {
  const dir = tmp(); const keyFile = path.join(dir, 'history.key');
  const a = new HistoryStore(new EncryptedFilePersistence(dir, new FileKeyProvider(keyFile)), { saveDelayMs: 1 });
  await a.load(); a.add(clip(textSnap('still here')), 1); await a.flush();
  const b = new HistoryStore(new EncryptedFilePersistence(dir, new FileKeyProvider(keyFile)), { saveDelayMs: 1 });
  await b.load();
  assert.deepEqual(b.items.map((i) => i.text), ['still here']);
});
