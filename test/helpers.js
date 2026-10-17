'use strict';
const { capture } = require('../src/main/capture');
const { HistoryStore } = require('../src/main/historyStore');
const { MemoryPersistence } = require('../src/main/persistence');

const fakePng = (n = 1) => Buffer.from(`png-bytes-${n}`);
const textSnap = (text, extra = {}) => ({ text, rtf: null, html: null, hasFileUrl: false, imageByteLength: 0, getImage: () => null, ...extra });
const imageSnap = (n = 1, size = [100, 50]) => ({
  text: '', rtf: null, html: null, hasFileUrl: false, imageByteLength: 10,
  getImage: () => ({ png: fakePng(n), thumb: Buffer.from(`thumb-${n}`), width: size[0], height: size[1] }),
});
const clip = (snap, source = { bundleId: 'com.test', name: 'Test' }, opts) => capture(snap, source, opts);
const newStore = (opts = {}) => new HistoryStore(new MemoryPersistence(), { saveDelayMs: 1, ...opts });

/** In-memory stand-in for the system clipboard adapter. */
class FakeClipboard {
  constructor() { this.state = { text: '', formats: [], image: null, rtf: null, fileUrl: false }; this.counter = 0; this.written = []; }
  setText(text, formats = ['text/plain']) { this.state = { ...this.state, text, formats, image: null, rtf: null, fileUrl: false }; this.counter++; }
  setImage(n) { this.state = { text: '', formats: ['image/png'], image: n, rtf: null, fileUrl: false }; this.counter++; }
  setFileUrl() { this.state = { text: 'report.pdf', formats: ['text/plain', 'text/uri-list'], image: null, rtf: null, fileUrl: true }; this.counter++; }
  fingerprint() { return `${this.counter}`; }
  formats() { return this.state.formats; }
  snapshot() {
    const s = this.state;
    return {
      ...(s.image ? imageSnap(s.image) : textSnap(s.text)),
      hasFileUrl: s.fileUrl,
    };
  }
  write(item, image, opts = {}) { this.written.push({ item, image, opts }); this.counter++; this.state = { ...this.state, text: item.text ?? '' }; }
}

module.exports = { fakePng, textSnap, imageSnap, clip, newStore, FakeClipboard };
