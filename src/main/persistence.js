'use strict';
// Encrypted on-disk history. Everything is AES-256-GCM sealed; nothing is written in plaintext.
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

class CorruptedError extends Error {}

function seal(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]); // 12 + 16 + n
}

function open(sealed, key) {
  if (sealed.length < 28) throw new CorruptedError('too short');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

/**
 * Keeps the random 256-bit data key in a private file (mode 0600) in the data folder. This needs no
 * Keychain access, so it cannot fail because of signing or permissions. It protects against casual
 * reading and file backups, not against someone who already has access to this macOS account.
 *
 * `legacyKey` (optional) returns a key from an older storage scheme (the Keychain-wrapped key used by
 * version 1.0.1 and earlier) so existing history can still be opened; it is migrated to the key file.
 */
class FileKeyProvider {
  constructor(keyFile, { legacyKey = null } = {}) {
    this.keyFile = keyFile;
    this.legacyKey = legacyKey;
    this.cached = null;
  }

  getKey() {
    if (this.cached) return this.cached;
    let key = null;
    if (fs.existsSync(this.keyFile)) {
      const raw = Buffer.from(fs.readFileSync(this.keyFile, 'utf8').trim(), 'hex');
      if (raw.length === 32) key = raw;
    }
    if (!key && this.legacyKey) {
      try { key = this.legacyKey(); } catch { key = null; }
      if (key && key.length !== 32) key = null;
    }
    if (!key) key = crypto.randomBytes(32);
    if (!fs.existsSync(this.keyFile) || !this._matches(key)) this._write(key);
    this.cached = key;
    return key;
  }

  _matches(key) {
    try { return Buffer.from(fs.readFileSync(this.keyFile, 'utf8').trim(), 'hex').equals(key); } catch { return false; }
  }

  _write(key) {
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.keyFile, key.toString('hex'), { mode: 0o600 });
  }
}

class StaticKeyProvider {
  constructor(key = crypto.randomBytes(32)) { this.key = key; }
  getKey() { return this.key; }
}

class EncryptedFilePersistence {
  constructor(directory, keyProvider) {
    this.dir = directory;
    this.blobs = path.join(directory, 'blobs');
    this.historyFile = path.join(directory, 'history.bin');
    this.keys = keyProvider;
    this.chain = Promise.resolve(); // serialises async writes
  }

  _ensure() { fs.mkdirSync(this.blobs, { recursive: true, mode: 0o700 }); }

  _quarantine() {
    try { fs.renameSync(this.historyFile, path.join(this.dir, `history.corrupt-${Date.now()}.bin`)); } catch { /* ignore */ }
  }

  async load() {
    if (!fs.existsSync(this.historyFile)) return [];
    const key = this.keys.getKey(); // key errors propagate; they are not corruption
    try {
      return JSON.parse(open(await fsp.readFile(this.historyFile), key).toString('utf8'));
    } catch {
      this._quarantine();
      throw new CorruptedError('History file unreadable');
    }
  }

  _queue(fn) {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => {});
    return run;
  }

  async _atomicWrite(file, data) {
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, data, { mode: 0o600 });
    await fsp.rename(tmp, file);
  }

  save(items) {
    const payload = seal(Buffer.from(JSON.stringify(items)), this.keys.getKey());
    return this._queue(async () => { this._ensure(); await this._atomicWrite(this.historyFile, payload); });
  }

  /** Blocking save used when quitting. */
  saveSync(items) {
    this._ensure();
    const tmp = `${this.historyFile}.tmp`;
    fs.writeFileSync(tmp, seal(Buffer.from(JSON.stringify(items)), this.keys.getKey()), { mode: 0o600 });
    fs.renameSync(tmp, this.historyFile);
  }

  _blobPath(name) {
    if (!name || name.includes('/') || name.startsWith('.')) throw new Error('Invalid blob name');
    return path.join(this.blobs, name);
  }

  writeBlob(name, buffer) {
    const file = this._blobPath(name);
    const payload = seal(buffer, this.keys.getKey());
    return this._queue(async () => { this._ensure(); await this._atomicWrite(file, payload); });
  }

  async readBlob(name) {
    await this.chain; // let queued writes land first
    const file = this._blobPath(name);
    if (!fs.existsSync(file)) return null;
    return open(await fsp.readFile(file), this.keys.getKey());
  }

  deleteBlob(name) {
    const file = this._blobPath(name);
    return this._queue(() => fsp.rm(file, { force: true }));
  }

  pruneBlobs(keep) {
    return this._queue(async () => {
      let files = [];
      try { files = await fsp.readdir(this.blobs); } catch { return; }
      await Promise.all(files.filter((f) => !keep.has(f)).map((f) => fsp.rm(path.join(this.blobs, f), { force: true })));
    });
  }

  deleteAll() {
    return this._queue(async () => {
      await fsp.rm(this.historyFile, { force: true });
      await fsp.rm(this.blobs, { recursive: true, force: true });
    });
  }

  _jsonFile(name) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid document name');
    return path.join(this.dir, `${name}.bin`);
  }

  async loadJson(name, fallback) {
    const file = this._jsonFile(name);
    if (!fs.existsSync(file)) return fallback;
    const key = this.keys.getKey();
    try { return JSON.parse(open(await fsp.readFile(file), key).toString('utf8')); } catch { return fallback; }
  }

  saveJson(name, value) {
    const file = this._jsonFile(name);
    const payload = seal(Buffer.from(JSON.stringify(value)), this.keys.getKey());
    return this._queue(async () => { this._ensure(); await this._atomicWrite(file, payload); });
  }

  saveJsonSync(name, value) {
    this._ensure();
    const file = this._jsonFile(name);
    fs.writeFileSync(`${file}.tmp`, seal(Buffer.from(JSON.stringify(value)), this.keys.getKey()), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }

  idle() { return this.chain; }
}

/** Non-persistent fallback (and test double). */
class MemoryPersistence {
  constructor() { this.items = []; this.blobMap = new Map(); this.saves = 0; this.docs = new Map(); }
  async loadJson(name, fallback) { return this.docs.has(name) ? structuredClone(this.docs.get(name)) : fallback; }
  async saveJson(name, value) { this.docs.set(name, structuredClone(value)); }
  saveJsonSync(name, value) { this.docs.set(name, structuredClone(value)); }
  async load() { return structuredClone(this.items); }
  async save(items) { this.items = structuredClone(items); this.saves++; }
  saveSync(items) { this.items = structuredClone(items); this.saves++; }
  async writeBlob(name, buf) { this.blobMap.set(name, Buffer.from(buf)); }
  async readBlob(name) { return this.blobMap.get(name) ?? null; }
  async deleteBlob(name) { this.blobMap.delete(name); }
  async pruneBlobs(keep) { for (const k of [...this.blobMap.keys()]) if (!keep.has(k)) this.blobMap.delete(k); }
  async deleteAll() { this.items = []; this.blobMap.clear(); }
  async idle() {}
}

module.exports = { EncryptedFilePersistence, FileKeyProvider, StaticKeyProvider, MemoryPersistence, CorruptedError, seal, open };
