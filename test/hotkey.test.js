'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { HotKeyManager } = require('../src/main/hotkey');
const Accelerator = require('../src/shared/accelerator');

class FakeRegistrar {
  constructor() { this.taken = new Set(); this.active = new Map(); this.calls = []; }
  register(acc, cb) { this.calls.push(['register', acc]); if (this.taken.has(acc)) return false; this.active.set(acc, cb); return true; }
  unregister(acc) { this.calls.push(['unregister', acc]); this.active.delete(acc); }
}

test('registers the default shortcut and fires the handler', () => {
  const r = new FakeRegistrar(); let fired = 0;
  const m = new HotKeyManager({ registrar: r, onTrigger: () => fired++ });
  assert.equal(m.register('Alt+V'), null);
  r.active.get('Alt+V')();
  assert.equal(fired, 1);
  assert.deepEqual(m.status, { state: 'registered', accelerator: 'Alt+V' });
});

test('conflict is reported and the previous shortcut stays active', () => {
  const r = new FakeRegistrar();
  const m = new HotKeyManager({ registrar: r, onTrigger() {} });
  m.register('Alt+V');
  r.taken.add('Control+Shift+V');
  assert.match(m.register('Control+Shift+V'), /already using/);
  assert.equal(m.current, 'Alt+V');
  assert.ok(r.active.has('Alt+V'));
});

test('startup failure is recorded in status', () => {
  const r = new FakeRegistrar(); r.taken.add('Alt+V');
  const m = new HotKeyManager({ registrar: r, onTrigger() {} });
  assert.ok(m.register('Alt+V'));
  assert.equal(m.status.state, 'failed');
});

test('changing shortcut unregisters the old one', () => {
  const r = new FakeRegistrar();
  const m = new HotKeyManager({ registrar: r, onTrigger() {} });
  m.register('Alt+V'); m.register('Control+Alt+V');
  assert.deepEqual([...r.active.keys()], ['Control+Alt+V']);
});

test('invalid shortcuts are rejected before reaching the OS', () => {
  const r = new FakeRegistrar();
  const m = new HotKeyManager({ registrar: r, onTrigger() {} });
  assert.match(m.register('V'), /at least one/);
  assert.match(m.register('Shift+V'), /at least one/);
  assert.match(m.register('Command+Space'), /reserves/);
  assert.equal(r.calls.length, 0);
});

test('reregister after wake restores the shortcut', () => {
  const r = new FakeRegistrar();
  const m = new HotKeyManager({ registrar: r, onTrigger() {} });
  m.register('Alt+V');
  r.active.clear(); // simulate lost registration
  assert.equal(m.reregister(), null);
  assert.ok(r.active.has('Alt+V'));
});

test('reregister that now conflicts reports failure', () => {
  const r = new FakeRegistrar();
  const m = new HotKeyManager({ registrar: r, onTrigger() {} });
  m.register('Alt+V');
  r.taken.add('Alt+V');
  assert.ok(m.reregister());
  assert.equal(m.status.state, 'failed');
});

test('a registrar that throws is handled', () => {
  const m = new HotKeyManager({ registrar: { register() { throw new Error('boom'); }, unregister() {} }, onTrigger() {} });
  assert.ok(m.register('Alt+V'));
});

test('accelerator conversion and display', () => {
  assert.equal(Accelerator.fromEvent({ code: 'KeyV', altKey: true }), 'Alt+V');
  assert.equal(Accelerator.fromEvent({ code: 'Digit1', metaKey: true, shiftKey: true }), 'Shift+Command+1');
  assert.equal(Accelerator.fromEvent({ code: 'ShiftLeft', shiftKey: true }), null);
  assert.equal(Accelerator.display('Alt+V'), '⌥V');
  assert.equal(Accelerator.display('Control+Alt+Shift+Command+Space'), '⌃⌥⇧⌘Space');
});
