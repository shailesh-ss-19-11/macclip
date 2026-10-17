'use strict';
const Accelerator = require('../shared/accelerator');

/**
 * Registers the global shortcut. `registrar` is Electron's globalShortcut (or a fake):
 * { register(acc, cb): boolean, unregister(acc), isRegistered(acc) }.
 * A failed change never drops the working shortcut.
 */
class HotKeyManager {
  constructor({ registrar, onTrigger }) {
    this.registrar = registrar;
    this.onTrigger = onTrigger;
    this.current = null;
    this.status = { state: 'unregistered' };
  }

  /** Returns null on success or an error message. */
  register(accelerator) {
    const invalid = Accelerator.validate(accelerator);
    if (invalid) return this._fail(invalid);
    if (accelerator === this.current) return null;

    let ok = false;
    try { ok = this.registrar.register(accelerator, () => this.onTrigger()); } catch { ok = false; }
    if (!ok) return this._fail('Another app is already using this shortcut, or it is not allowed. Choose another one.');

    if (this.current) this.registrar.unregister(this.current);
    this.current = accelerator;
    this.status = { state: 'registered', accelerator };
    return null;
  }

  /** Re-asserts the registration (after sleep/wake). */
  reregister() {
    const accelerator = this.current;
    if (!accelerator) return null;
    this.registrar.unregister(accelerator);
    this.current = null;
    const error = this.register(accelerator);
    return error;
  }

  unregister() {
    if (this.current) this.registrar.unregister(this.current);
    this.current = null;
    this.status = { state: 'unregistered' };
  }

  _fail(message) {
    if (!this.current) this.status = { state: 'failed', message };
    return message;
  }
}

module.exports = { HotKeyManager };
