'use strict';
const { EventEmitter } = require('node:events');
const { CorruptedError } = require('./persistence');

const DAY_MS = 86_400_000;

/** In-memory history (newest first) with debounced, off-thread-friendly persistence. */
class HistoryStore extends EventEmitter {
  constructor(persistence, { maxItems = 500, maxAgeDays = 0, saveDelayMs = 500 } = {}) {
    super();
    this.persistence = persistence;
    this.maxItems = maxItems;
    this.maxAgeDays = maxAgeDays;
    this.saveDelayMs = saveDelayMs;
    this.items = [];
    this.loadIssue = null;
    this._timer = null;
  }

  async load() {
    try {
      this.items = (await this.persistence.load()).sort((a, b) => b.createdAt - a.createdAt);
      const keep = new Set();
      for (const i of this.items) if (i.hasImage) { keep.add(`${i.id}.png`); keep.add(`${i.id}.thumb.png`); }
      await this.persistence.pruneBlobs(keep);
    } catch (err) {
      this.items = [];
      this.loadIssue = err instanceof CorruptedError
        ? 'Saved history could not be read and was set aside. Starting with an empty history.'
        : 'Saved history is unavailable.';
    }
    this.emit('change');
  }

  setRetention({ maxItems, maxAgeDays }) {
    if (maxItems !== undefined) this.maxItems = maxItems;
    if (maxAgeDays !== undefined) this.maxAgeDays = maxAgeDays;
    this.applyRetention();
  }

  get(id) { return this.items.find((i) => i.id === id) ?? null; }

  /** Adds a clip; identical content is moved to the top instead of duplicated. */
  add(clip, now = Date.now()) {
    const existing = this.items.findIndex((i) => i.contentHash === clip.item.contentHash);
    if (existing !== -1) {
      const [item] = this.items.splice(existing, 1);
      item.createdAt = now;
      if (clip.item.sourceAppName) { item.sourceAppName = clip.item.sourceAppName; item.sourceBundleId = clip.item.sourceBundleId; }
      this.items.unshift(item);
      this._changed();
      return item;
    }
    const item = { ...clip.item, createdAt: now };
    if (clip.image) {
      this.persistence.writeBlob(`${item.id}.png`, clip.image.png).catch(() => {});
      this.persistence.writeBlob(`${item.id}.thumb.png`, clip.image.thumb).catch(() => {});
    }
    this.items.unshift(item);
    this._applyRetention(now);
    this._changed();
    return item;
  }

  touch(id, now = Date.now()) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i === -1) return;
    const [item] = this.items.splice(i, 1);
    item.createdAt = now;
    this.items.unshift(item);
    this._changed();
  }

  delete(id) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i === -1) return;
    this._dropBlobs(this.items.splice(i, 1)[0]);
    this._changed();
  }

  togglePin(id) {
    const item = this.get(id);
    if (!item) return;
    item.isPinned = !item.isPinned;
    if (item.isPinned) delete item.expiresAt; // pinning keeps a sensitive item
    this._changed();
  }

  clearUnpinned() {
    const removed = this.items.filter((i) => !i.isPinned);
    if (!removed.length) return;
    this.items = this.items.filter((i) => i.isPinned);
    removed.forEach((i) => this._dropBlobs(i));
    this._changed();
  }

  async clearAll() {
    this.items = [];
    clearTimeout(this._timer);
    await this.persistence.deleteAll();
    this.emit('change');
  }

  applyRetention(now = Date.now()) {
    if (this._applyRetention(now)) this._changed();
  }

  _applyRetention(now) {
    const before = this.items.length;
    let keptUnpinned = 0;
    const cutoff = this.maxAgeDays > 0 ? now - this.maxAgeDays * DAY_MS : null;
    const removed = [];
    this.items = this.items.filter((i) => {
      if (i.isPinned) return true; // pinned items are never removed automatically
      if (i.expiresAt && i.expiresAt <= now) { removed.push(i); return false; }
      const expired = cutoff !== null && i.createdAt < cutoff;
      if (expired || keptUnpinned >= this.maxItems) { removed.push(i); return false; }
      keptUnpinned++;
      return true;
    });
    removed.forEach((i) => this._dropBlobs(i));
    return this.items.length !== before;
  }

  /** All whitespace-separated terms must match text, source app or kind. */
  search(query) {
    const terms = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return this.items;
    return this.items.filter((i) => terms.every((t) => i.searchText.includes(t)));
  }

  readImage(item) { return item.hasImage ? this.persistence.readBlob(`${item.id}.png`) : Promise.resolve(null); }
  readThumbnail(item) { return item.hasImage ? this.persistence.readBlob(`${item.id}.thumb.png`) : Promise.resolve(null); }

  /** Writes pending changes immediately (call on quit). */
  flushSync() {
    clearTimeout(this._timer);
    this._timer = null;
    this.persistence.saveSync(this.items);
  }

  async flush() {
    clearTimeout(this._timer);
    this._timer = null;
    await this.persistence.save(this.items);
    await this.persistence.idle();
  }

  _dropBlobs(item) {
    if (!item.hasImage) return;
    this.persistence.deleteBlob(`${item.id}.png`).catch(() => {});
    this.persistence.deleteBlob(`${item.id}.thumb.png`).catch(() => {});
  }

  _changed() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; this.persistence.save(this.items).catch(() => {}); }, this.saveDelayMs);
    this._timer.unref?.();
    this.emit('change');
  }
}

module.exports = { HistoryStore };
