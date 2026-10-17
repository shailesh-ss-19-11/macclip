'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.macclip.settings;
  let recording = false;

  async function load() {
    const s = await api.get();
    if (!recording) $('shortcut').textContent = s.hotkeyDisplay;
    $('launch').checked = s.launchAtLogin;
    $('launch-note').hidden = s.packaged;
    $('paste').value = s.pasteBehavior;
    $('limit').value = String(s.historyLimit);
    $('paused').checked = s.paused;
    $('shots').checked = s.copyScreenshots;
    $('ax-row').hidden = s.pasteBehavior !== 'copyAndPaste';
    if (s.hotkeyStatus.state === 'failed' && !recording) showShortcutMessage(s.hotkeyStatus.message, true);
    refreshAccessibility();
  }

  async function refreshAccessibility() {
    const ok = await api.accessibility();
    $('ax-status').textContent = ok ? 'Allowed ✓' : 'Not allowed yet';
    $('ax-btn').hidden = ok;
  }

  function showShortcutMessage(text, isError) {
    const msg = $('shortcut-msg');
    msg.textContent = text;
    msg.classList.toggle('err', !!isError);
  }

  // Shortcut recorder
  const recorder = $('shortcut');
  function stopRecording() { recording = false; recorder.classList.remove('recording'); }
  recorder.addEventListener('click', () => {
    recording = true;
    recorder.classList.add('recording');
    recorder.textContent = 'Press keys…';
    showShortcutMessage('Press the new key combination, or Esc to cancel.');
  });
  recorder.addEventListener('blur', () => { if (recording) { stopRecording(); showShortcutMessage(''); load(); } });
  recorder.addEventListener('keydown', async (e) => {
    if (!recording) return;
    e.preventDefault();
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
    if (e.key === 'Escape') { stopRecording(); showShortcutMessage(''); return load(); }
    const accelerator = window.Accelerator.fromEvent(e);
    if (!accelerator) return showShortcutMessage('That key cannot be used.', true);
    const invalid = window.Accelerator.validate(accelerator);
    if (invalid) return showShortcutMessage(invalid, true);
    const result = await api.setHotkey(accelerator);
    stopRecording();
    if (!result.ok) { showShortcutMessage(result.error, true); return load(); }
    showShortcutMessage('');
    load();
  });

  const bind = (id, key, read) => $(id).addEventListener('change', async () => { await api.set(key, read($(id))); load(); });
  bind('paste', 'pasteBehavior', (e) => e.value);
  bind('limit', 'historyLimit', (e) => Number(e.value));
  bind('paused', 'paused', (e) => e.checked);
  bind('shots', 'copyScreenshots', (e) => e.checked);
  $('launch').addEventListener('change', async () => { $('launch').checked = await api.setLaunchAtLogin($('launch').checked); });
  $('clear-all').addEventListener('click', () => api.clearAll());
  $('ax-btn').addEventListener('click', () => api.requestAccessibility());

  api.onChanged(load);
  window.addEventListener('focus', refreshAccessibility);
  load();
})();
