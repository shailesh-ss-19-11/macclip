'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { textSnap, imageSnap, clip, newStore } = require('./helpers');

const DAY = 86_400_000;
const addText = (store, text, now) => store.add(clip(textSnap(text)), now);

test('newest item is first', () => {
  const s = newStore();
  addText(s, 'one', 1000); addText(s, 'two', 2000);
  assert.deepEqual(s.items.map((i) => i.text), ['two', 'one']);
});

test('duplicate consecutive copies do not create a second entry', () => {
  const s = newStore();
  addText(s, 'same', 1000); addText(s, 'same', 2000);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].createdAt, 2000);
});

test('re-copying an older item moves it to the top and keeps its pin', () => {
  const s = newStore();
  const a = addText(s, 'a', 1000); addText(s, 'b', 2000);
  s.togglePin(a.id);
  addText(s, 'a', 3000);
  assert.deepEqual(s.items.map((i) => i.text), ['a', 'b']);
  assert.equal(s.items[0].isPinned, true);
});

test('search matches text, source app and kind, all terms required', () => {
  const s = newStore();
  s.add(clip(textSnap('Quarterly report'), { bundleId: 'x', name: 'Notes' }), 1);
  s.add(clip(textSnap('https://example.com'), { bundleId: 'y', name: 'Safari' }), 2);
  s.add(clip(imageSnap(1), { bundleId: 'z', name: 'Preview' }), 3);
  assert.equal(s.search('quarterly').length, 1);
  assert.equal(s.search('REPORT notes').length, 1);
  assert.equal(s.search('report safari').length, 0);
  assert.equal(s.search('safari')[0].kind, 'url');
  assert.equal(s.search('link').length, 1);
  assert.equal(s.search('image').length, 1);
  assert.equal(s.search('').length, 3);
});

test('pinning and deleting', () => {
  const s = newStore();
  const a = addText(s, 'a', 1); const b = addText(s, 'b', 2);
  s.togglePin(a.id);
  assert.equal(s.get(a.id).isPinned, true);
  s.togglePin(a.id);
  assert.equal(s.get(a.id).isPinned, false);
  s.delete(b.id);
  assert.deepEqual(s.items.map((i) => i.id), [a.id]);
});

test('clearUnpinned keeps pinned items', () => {
  const s = newStore();
  const a = addText(s, 'a', 1); addText(s, 'b', 2);
  s.togglePin(a.id);
  s.clearUnpinned();
  assert.deepEqual(s.items.map((i) => i.text), ['a']);
});

test('item limit drops oldest unpinned only; pinned do not count', () => {
  const s = newStore({ maxItems: 2 });
  const old = addText(s, 'old', 1);
  s.togglePin(old.id);
  addText(s, 'a', 2); addText(s, 'b', 3); addText(s, 'c', 4);
  assert.deepEqual(s.items.map((i) => i.text), ['c', 'b', 'old']);
});

test('age retention removes old unpinned items, never pinned', () => {
  const s = newStore({ maxAgeDays: 7 });
  const now = 100 * DAY;
  const oldPinned = addText(s, 'old pinned', now - 30 * DAY);
  s.togglePin(oldPinned.id);
  addText(s, 'old', now - 10 * DAY);
  addText(s, 'fresh', now - DAY);
  s.applyRetention(now);
  assert.deepEqual(s.items.map((i) => i.text).sort(), ['fresh', 'old pinned']);
});

test('deleting an image removes its blobs', async () => {
  const s = newStore();
  const item = s.add(clip(imageSnap(1)), 1);
  await s.persistence.idle();
  assert.ok(await s.readImage(item));
  s.delete(item.id);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await s.persistence.readBlob(`${item.id}.png`), null);
  assert.equal(await s.persistence.readBlob(`${item.id}.thumb.png`), null);
});

test('changes are persisted after the debounce and on flush', async () => {
  const s = newStore();
  addText(s, 'saved', 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.persistence.items.length, 1);
  addText(s, 'flushed', 2);
  s.flushSync();
  assert.equal(s.persistence.items.length, 2);
});

test('change event fires', () => {
  const s = newStore();
  let n = 0;
  s.on('change', () => n++);
  addText(s, 'a', 1);
  assert.ok(n >= 1);
});
