// Converts keyboard events to Electron accelerators and validates them. Loaded by both the
// settings renderer (as a global) and the main process / tests (as a module).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Accelerator = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CODE_TO_KEY = {
    Space: 'Space', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace',
  };

  function keyFromCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    return CODE_TO_KEY[code] ?? null;
  }

  /** event: { code, metaKey, ctrlKey, altKey, shiftKey } -> accelerator string or null */
  function fromEvent(event) {
    const key = keyFromCode(event.code);
    if (!key) return null;
    const parts = [];
    if (event.ctrlKey) parts.push('Control');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Command');
    parts.push(key);
    return parts.join('+');
  }

  const SYMBOLS = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', CommandOrControl: '⌘', Cmd: '⌘', Ctrl: '⌃', Option: '⌥', Super: '⌘', Meta: '⌘' };
  const MODIFIERS = new Set(Object.keys(SYMBOLS));

  function parse(accelerator) {
    const parts = String(accelerator).split('+');
    const key = parts.pop();
    return { modifiers: parts, key };
  }

  function display(accelerator) {
    const { modifiers, key } = parse(accelerator);
    const order = ['⌃', '⌥', '⇧', '⌘'];
    const symbols = [...new Set(modifiers.map((m) => SYMBOLS[m] ?? m))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return symbols.join('') + (key === 'Space' ? 'Space' : key.toUpperCase());
  }

  // Shortcuts macOS owns. Written as normalised "mods|key".
  const RESERVED = new Set([
    'Command|Space', 'Command|Tab', 'Command|Q', 'Command|H', 'Alt+Command|Escape',
    'Command+Shift|3', 'Command+Shift|4', 'Command+Shift|5', 'Command+Control|Space', 'Alt+Command|Space',
  ]);

  /** Returns an error message, or null when acceptable. */
  function validate(accelerator) {
    if (typeof accelerator !== 'string' || !accelerator) return 'No shortcut set.';
    const { modifiers, key } = parse(accelerator);
    if (!key || MODIFIERS.has(key)) return 'Press a key together with the modifiers.';
    const norm = new Set(modifiers.map((m) => ({ CommandOrControl: 'Command', Cmd: 'Command', Super: 'Command', Meta: 'Command', Ctrl: 'Control', Option: 'Alt' }[m] ?? m)));
    if (!['Command', 'Control', 'Alt'].some((m) => norm.has(m))) return 'Include at least one of ⌘, ⌥ or ⌃.';
    const signature = `${[...norm].sort().join('+')}|${key}`;
    if (RESERVED.has(signature)) return 'macOS reserves this shortcut. Choose another one.';
    return null;
  }

  return { fromEvent, display, validate, parse };
});
