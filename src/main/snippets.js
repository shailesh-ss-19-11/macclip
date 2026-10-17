'use strict';
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const MAX_TITLE = 80;
const MAX_TEXT = 100_000;

/** User-authored reusable text. Separate from history: never expires, never recorded automatically. */
class SnippetStore extends EventEmitter {
  constructor(persistence) {
    super();
    this.persistence = persistence;
    this.items = [];
  }

  async load() {
    const saved = await this.persistence.loadJson('snippets', []);
    this.items = Array.isArray(saved) ? saved.filter((s) => s && typeof s.id === 'string' && typeof s.text === 'string') : [];
    this.emit('change');
  }

  get(id) { return this.items.find((s) => s.id === id) ?? null; }

  /** Creates (no id) or updates (id) a snippet. Returns { ok, snippet } or { ok: false, error }. */
  save({ id, title, text }, now = Date.now()) {
    const cleanText = typeof text === 'string' ? text : '';
    if (!cleanText.trim()) return { ok: false, error: 'Snippet text is empty.' };
    if (cleanText.length > MAX_TEXT) return { ok: false, error: 'Snippet is too long.' };
    const cleanTitle = (typeof title === 'string' && title.trim() ? title.trim() : cleanText.trim().split('\n')[0]).slice(0, MAX_TITLE);

    let snippet = id ? this.get(id) : null;
    if (id && !snippet) return { ok: false, error: 'Snippet not found.' };
    if (snippet) Object.assign(snippet, { title: cleanTitle, text: cleanText, updatedAt: now });
    else {
      snippet = { id: crypto.randomUUID(), title: cleanTitle, text: cleanText, createdAt: now, updatedAt: now };
      this.items.unshift(snippet);
    }
    this._changed();
    return { ok: true, snippet };
  }

  delete(id) {
    const before = this.items.length;
    this.items = this.items.filter((s) => s.id !== id);
    if (this.items.length !== before) this._changed();
  }

  search(query) {
    const terms = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return this.items;
    return this.items.filter((s) => {
      const hay = `${s.title}\n${s.text}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  flushSync() { this.persistence.saveJsonSync('snippets', this.items); }

  _changed() {
    this.persistence.saveJson('snippets', this.items).catch(() => {});
    this.emit('change');
  }
}

module.exports = { SnippetStore, MAX_TITLE, MAX_TEXT };
