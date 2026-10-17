'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.macclip.settings;
  let recording = false;

  async function load() {
    const s = await api.get();
    $('shortcut').textContent = s.hotkeyDisplay;
    $('launch').checked = s.launchAtLogin;
    $('launch-note').hidden = s.packaged;
    $('paste').value = s.pasteBehavior;
    $('appearance').value = s.appearance;
    $('limit').value = String(s.historyLimit);
    $('retention').value = String(s.retentionDays);
    $('paused').checked = s.paused;
    $('pm').checked = s.excludePasswordManagers;
    $('secrets').value = s.secretHandling;
    $('shots').checked = s.captureScreenshots;
    $('shots-clip').checked = s.screenshotsToClipboard;
    $('shots-clip').disabled = !s.captureScreenshots;
    $('ax-row').hidden = s.pasteBehavior !== 'copyAndPaste';
    if (s.hotkeyStatus.state === 'failed' && !recording) showShortcutMessage(s.hotkeyStatus.message, true);

    const list = $('excluded');
    list.replaceChildren();
    if (!s.excludedAppNames.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'No apps excluded';
      list.append(li);
    }
    for (const app of s.excludedAppNames) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = app.name;
      if (app.name !== app.id) { const id = document.createElement('small'); id.textContent = app.id; name.append(id); }
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${app.name}`);
      remove.addEventListener('click', async () => { await api.removeExcludedApp(app.id); load(); });
      li.append(name, remove);
      list.append(li);
    }
    refreshAccessibility();
  }

  async function refreshAccessibility() {
    const ok = await api.accessibility();
    $('ax-status').textContent = ok ? 'Granted ✓' : 'Not granted';
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
    recorder.textContent = 'Press shortcut…';
    showShortcutMessage('Press the new key combination, or Esc to cancel.');
  });
  recorder.addEventListener('blur', () => { if (recording) { stopRecording(); load(); } });
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
  bind('appearance', 'appearance', (e) => e.value);
  bind('limit', 'historyLimit', (e) => Number(e.value));
  bind('retention', 'retentionDays', (e) => Number(e.value));
  bind('paused', 'paused', (e) => e.checked);
  bind('pm', 'excludePasswordManagers', (e) => e.checked);
  bind('secrets', 'secretHandling', (e) => e.value);
  bind('shots', 'captureScreenshots', (e) => e.checked);
  bind('shots-clip', 'screenshotsToClipboard', (e) => e.checked);

  // Snippets
  let editingId = null;
  async function loadSnippets() {
    const items = await api.listSnippets();
    const list = $('snippet-list');
    list.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'No snippets yet';
      list.append(li);
    }
    for (const s of items) {
      const li = document.createElement('li');
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = s.title;
      const acts = document.createElement('span');
      acts.className = 'acts';
      const edit = document.createElement('button');
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit ${s.title}`);
      edit.addEventListener('click', () => {
        editingId = s.id;
        $('snippet-title').value = s.title;
        $('snippet-text').value = s.text;
        $('snippet-save').textContent = 'Save Changes';
        $('snippet-cancel').hidden = false;
        $('snippet-text').focus();
      });
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.setAttribute('aria-label', `Delete ${s.title}`);
      del.addEventListener('click', async () => { await api.deleteSnippet(s.id); if (editingId === s.id) resetSnippetForm(); loadSnippets(); });
      acts.append(edit, del);
      li.append(t, acts);
      list.append(li);
    }
  }
  function resetSnippetForm() {
    editingId = null;
    $('snippet-title').value = '';
    $('snippet-text').value = '';
    $('snippet-msg').textContent = '';
    $('snippet-save').textContent = 'Add Snippet';
    $('snippet-cancel').hidden = true;
  }
  $('snippet-cancel').addEventListener('click', resetSnippetForm);
  $('snippet-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api.saveSnippet({ id: editingId, title: $('snippet-title').value, text: $('snippet-text').value });
    if (!r.ok) { $('snippet-msg').textContent = r.error; return; }
    resetSnippetForm();
    loadSnippets();
  });
  loadSnippets();
  $('launch').addEventListener('change', async () => { $('launch').checked = await api.setLaunchAtLogin($('launch').checked); });
  $('add-app').addEventListener('click', async () => {
    const r = await api.addExcludedApp();
    if (r.error) alertInline(r.error);
    load();
  });
  $('clear-all').addEventListener('click', async () => { await api.clearAll(); });
  $('ax-btn').addEventListener('click', () => api.requestAccessibility());
  function alertInline(text) { showShortcutMessage(text, true); }

  api.onChanged(() => { load(); loadSnippets(); });
  window.addEventListener('focus', refreshAccessibility);
  load();
})();
