'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/shared/historyView');
const { panelPosition } = require('../src/main/positioner');
const { toListItem, preview } = require('../src/main/preview');
const { parseLsappinfo, AppTracker } = require('../src/main/appTracker');
const { Settings, DEFAULTS } = require('../src/main/settings');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const NOW = new Date(2025, 5, 15, 12).getTime();
const at = (daysAgo, hour = 10) => new Date(2025, 5, 15 - daysAgo, hour).getTime();
const mk = (id, createdAt, isPinned = false) => ({ id, createdAt, isPinned, kind: 'text' });

test('sections: pinned first, then Today / Yesterday / dated, newest first', () => {
  const items = [mk('a', at(0, 11)), mk('b', at(0, 9)), mk('p', at(5), true), mk('c', at(1)), mk('d', at(9))];
  const sections = V.buildSections(items, NOW, 'en-US');
  assert.deepEqual(sections.map((s) => s.title), ['Pinned', 'Today', 'Yesterday', sections[3].title]);
  assert.match(sections[3].title, /Jun 6/);
  assert.deepEqual(V.flatten(sections).map((i) => i.id), ['p', 'a', 'b', 'c', 'd']);
});

test('keyboard navigation clamps at both ends', () => {
  const flat = [mk('a', 3), mk('b', 2), mk('c', 1)];
  assert.equal(V.moveSelection(flat, 'a', 1), 'b');
  assert.equal(V.moveSelection(flat, 'c', 1), 'c');
  assert.equal(V.moveSelection(flat, 'a', -1), 'a');
  assert.equal(V.moveSelection(flat, null, 1), 'a');
  assert.equal(V.moveSelection([], null, 1), null);
});

test('selection after delete prefers next then previous', () => {
  const flat = [mk('a', 3), mk('b', 2), mk('c', 1)];
  assert.equal(V.selectionAfterDelete(flat, 'b'), 'c');
  assert.equal(V.selectionAfterDelete(flat, 'c'), 'b');
  assert.equal(V.selectionAfterDelete([mk('a', 1)], 'a'), null);
});

test('key bindings', () => {
  const k = (key, mods = {}) => V.commandForKey({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  assert.deepEqual(k('ArrowDown'), { type: 'move', delta: 1 });
  assert.deepEqual(k('ArrowUp'), { type: 'move', delta: -1 });
  assert.deepEqual(k('Enter'), { type: 'activate', plain: false });
  assert.deepEqual(k('Enter', { shiftKey: true }), { type: 'activate', plain: true });
  assert.deepEqual(k('Tab'), { type: 'switchMode' });
  assert.deepEqual(k('s', { metaKey: true }), { type: 'saveSnippet' });
  assert.deepEqual(k('Escape'), { type: 'close' });
  assert.deepEqual(k('p', { metaKey: true }), { type: 'togglePin' });
  assert.deepEqual(k('3', { metaKey: true }), { type: 'quick', position: 3 });
  assert.deepEqual(k('Backspace', { metaKey: true }), { type: 'delete' });
  assert.equal(k('a'), null);
  assert.equal(V.commandForKey({ key: 'Backspace', metaKey: true }, { searchEmpty: false }), null);
});

test('panel is placed near the cursor and stays on the cursor’s display', () => {
  const size = { width: 420, height: 540 };
  const displays = [{ x: 0, y: 25, width: 1440, height: 875 }, { x: 1440, y: 0, width: 1920, height: 1080 }];
  assert.deepEqual(panelPosition(size, { x: 500, y: 200 }, displays), { x: 484, y: 208 });
  const edge = panelPosition(size, { x: 1430, y: 880 }, displays);
  assert.ok(edge.x + 420 <= 1440 && edge.y + 540 <= 900);
  const second = panelPosition(size, { x: 3300, y: 1070 }, displays);
  assert.ok(second.x >= 1440 && second.x + 420 <= 3360 && second.y + 540 <= 1080);
});

test('list items are truncated and urls split into host/path', () => {
  const long = { id: '1', kind: 'text', text: `${'word '.repeat(200)}`, createdAt: 1, isPinned: false };
  assert.ok(toListItem(long).preview.length <= 300);
  const url = toListItem({ id: '2', kind: 'url', text: 'https://www.example.com/docs/page?x=1', createdAt: 1, isPinned: false });
  assert.equal(url.urlHost, 'example.com');
  assert.equal(url.urlPath, '/docs/page?x=1');
  assert.equal(preview({ kind: 'code', text: 'a\nb\nc\nd\ne\nf' }), 'a\nb\nc\nd');
  assert.equal(toListItem({ id: '3', kind: 'text', text: 'x', rtf: 'SECRET', createdAt: 1 }).rtf, undefined);
});

test('lsappinfo output is parsed', () => {
  assert.deepEqual(parseLsappinfo('"CFBundleIdentifier"="com.apple.Safari"\n"LSDisplayName"="Safari"\n"pid"=123 \n'), { bundleId: 'com.apple.Safari', name: 'Safari', pid: 123 });
  assert.equal(parseLsappinfo(''), null);
});

test('tracker returns null when MacClip itself is frontmost', async () => {
  const outputs = ['ASN:0x0-0x1:\n', '"CFBundleIdentifier"="x"\n"LSDisplayName"="Me"\n"pid"=42\n'];
  const t = new AppTracker({ ownPid: 42, exec: async () => outputs.shift() });
  assert.equal(await t.frontmost(), null);
});

test('settings persist across relaunch and reject invalid values', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'macclip-s-')), 's.json');
  const a = new Settings(file);
  assert.equal(a.get('hotkey'), 'Alt+V');
  a.set('historyLimit', 1000); a.set('excludedApps', ['com.x']);
  assert.throws(() => a.set('historyLimit', 3));
  assert.throws(() => a.set('nope', 1));
  const b = new Settings(file);
  assert.equal(b.get('historyLimit'), 1000);
  assert.deepEqual(b.get('excludedApps'), ['com.x']);
  assert.equal(b.get('retentionDays'), DEFAULTS.retentionDays);
});

test('corrupt settings file falls back to defaults', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'macclip-s-')), 's.json');
  fs.writeFileSync(file, '{not json');
  assert.equal(new Settings(file).get('historyLimit'), 500);
});
