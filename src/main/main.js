'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const {
  app, BrowserWindow, Tray, Menu, globalShortcut, screen, ipcMain, nativeTheme, powerMonitor,
  dialog, systemPreferences, safeStorage, Notification, shell, nativeImage,
} = require('electron');

app.setPath('userData', process.env.MACCLIP_DATA_DIR || path.join(app.getPath('appData'), 'MacClip'));
app.setName('MacClip');

const { Settings } = require('./settings');
const { HistoryStore } = require('./historyStore');
const { EncryptedFilePersistence, SafeStorageKeyProvider, MemoryPersistence } = require('./persistence');
const { PrivacyManager } = require('./privacy');
const { ClipboardMonitor } = require('./clipboardMonitor');
const { AppTracker } = require('./appTracker');
const { PasteCoordinator } = require('./pasteCoordinator');
const { HotKeyManager } = require('./hotkey');
const { SnippetStore } = require('./snippets');
const { AppIcons } = require('./appIcons');
const { ScreenshotWatcher, resolveScreenshotDir } = require('./screenshotWatcher');
const { capture } = require('./capture');
const { panelPosition } = require('./positioner');
const { toListItem } = require('./preview');
const Accelerator = require('../shared/accelerator');
const systemClipboard = require('./systemClipboard');

const PANEL_SIZE = { width: 420, height: 540 };
const MAX_LISTED = 300;
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');

let screenshots = null;
let settings, store, snippets, appIcons, privacy, monitor, apps, paste, hotkeys, tray;
let panel = null;
let settingsWindow = null;
let targetApp = null;
let storageWarning = null;
let retentionTimer = null;

if (process.env.MACCLIP_SMOKE === '1') {
  app.whenReady().then(() => require('./smoke').run(app, systemClipboard)).catch((e) => { console.error(e); app.exit(1); });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel());
  app.whenReady().then(start);
}

// Keep running with no windows: this is a menu bar app.
app.on('window-all-closed', () => {});

async function start() {
  // Menu bar app: no Dock icon when installed. From source, keep the Dock icon so it is obvious the app is running.
  if (app.isPackaged) app.dock?.hide();
  const firstRun = !fs.existsSync(path.join(app.getPath('userData'), 'settings.json'));
  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  nativeTheme.themeSource = settings.get('appearance');

  const persistence = createPersistence();
  store = new HistoryStore(persistence, { maxItems: settings.get('historyLimit'), maxAgeDays: settings.get('retentionDays') });
  await store.load();
  store.applyRetention();
  snippets = new SnippetStore(persistence);
  await snippets.load();
  appIcons = new AppIcons({
    findAppPath: appPathFor,
    getIcon: async (p) => (await app.getFileIcon(p, { size: 'normal' })).resize({ width: 32, height: 32 }).toDataURL(),
  });

  apps = new AppTracker();
  privacy = new PrivacyManager(settings, ['com.macclip.app', 'com.github.Electron']);
  monitor = new ClipboardMonitor({ clipboard: systemClipboard, store, privacy, apps });
  paste = new PasteCoordinator({
    clipboard: systemClipboard, store, monitor, apps,
    accessibility: {
      isTrusted: () => systemPreferences.isTrustedAccessibilityClient(false),
      prompt: () => systemPreferences.isTrustedAccessibilityClient(true),
    },
    hidePanel,
  });
  hotkeys = new HotKeyManager({ registrar: globalShortcut, onTrigger: showPanel });

  createPanel();
  createTray();
  registerIpc();

  const error = hotkeys.register(settings.get('hotkey'));
  if (error) notify('Shortcut unavailable', `${error} Open Settings to choose another shortcut.`);
  else notify('MacClip is running', `Press ${Accelerator.display(settings.get('hotkey'))} to open clipboard history, or use the clipboard icon in the menu bar.`);
  monitor.start();
  updateScreenshotWatcher();
  if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
  if (firstRun || !app.isPackaged) openSettings(); // make the first launch visible

  store.on('change', () => { panel?.webContents.send('history:changed'); });
  snippets.on('change', () => { panel?.webContents.send('history:changed'); settingsWindow?.webContents.send('settings:changed'); });
  settings.on('change', onSettingChanged);
  powerMonitor.on('resume', () => hotkeys.reregister());
  retentionTimer = setInterval(() => store.applyRetention(), 15 * 1000); // also expires sensitive items
  retentionTimer.unref();
}

function createPersistence() {
  const dir = path.join(app.getPath('userData'), 'data');
  try {
    const keys = new SafeStorageKeyProvider(safeStorage, path.join(dir, 'key.bin'));
    if (keys.isAvailable()) { keys.getKey(); return new EncryptedFilePersistence(dir, keys); }
  } catch { /* fall through */ }
  storageWarning = 'Secure storage is unavailable, so history will not be saved between launches.';
  return new MemoryPersistence();
}

// ───────────────────────────── panel ─────────────────────────────

function createPanel() {
  panel = new BrowserWindow({
    ...PANEL_SIZE, show: false, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: true,
    vibrancy: 'popover', visualEffectState: 'active', roundedCorners: true, type: 'panel',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  panel.setAlwaysOnTop(true, 'pop-up-menu');
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panel.loadFile(path.join(RENDERER, 'panel.html'));
  panel.on('blur', () => { if (panel.isVisible()) hidePanel(); });
  panel.webContents.on('will-navigate', (e) => e.preventDefault());
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

async function showPanel() {
  if (!panel) return;
  if (panel.isVisible()) return hidePanel();
  // Capture the app the user is in *before* we take focus; this is the paste target.
  targetApp = await apps.frontmost();
  const cursor = screen.getCursorScreenPoint();
  const pos = panelPosition(PANEL_SIZE, cursor, screen.getAllDisplays().map((d) => d.workArea));
  panel.setPosition(pos.x, pos.y);
  panel.webContents.send('panel:shown');
  panel.show();
}

function hidePanel() {
  if (!panel?.isVisible()) return;
  panel.hide();
  // Hiding the app hands keyboard focus back to the previously active app.
  if (!settingsWindow?.isVisible()) app.hide();
}

// ───────────────────────────── tray ─────────────────────────────

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('MacClip');
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const label = Accelerator.display(settings.get('hotkey'));
  const items = [
    { label: `Show Clipboard History   ${label}`, click: () => showPanel() },
    { type: 'separator' },
    { label: 'Pause Monitoring', type: 'checkbox', checked: settings.get('paused'), click: (m) => settings.set('paused', m.checked) },
    { label: 'Clear Unpinned History…', click: confirmClearUnpinned },
    { type: 'separator' },
    { label: 'Settings…', accelerator: 'Command+,', click: openSettings },
    { label: 'Quit MacClip', accelerator: 'Command+Q', click: () => app.quit() },
  ];
  if (hotkeys.status.state === 'failed') items.unshift({ label: '⚠︎ Shortcut unavailable – open Settings', click: openSettings }, { type: 'separator' });
  if (storageWarning) items.unshift({ label: '⚠︎ History is not being saved', enabled: false }, { type: 'separator' });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(settings.get('paused') ? 'MacClip (paused)' : 'MacClip');
}

async function confirmClearUnpinned() {
  const { response } = await dialog.showMessageBox({
    type: 'warning', message: 'Clear all unpinned clipboard history?', detail: 'Pinned items are kept. This cannot be undone.',
    buttons: ['Clear', 'Cancel'], defaultId: 1, cancelId: 1,
  });
  if (response === 0) store.clearUnpinned();
}

// ───────────────────────────── settings window ─────────────────────────────

function openSettings() {
  hidePanelQuiet();
  if (settingsWindow) { settingsWindow.show(); settingsWindow.focus(); app.focus({ steal: true }); return; }
  settingsWindow = new BrowserWindow({
    width: 600, height: 640, title: 'MacClip Settings', resizable: false, minimizable: false, maximizable: false,
    fullscreenable: false, titleBarStyle: 'hiddenInset', vibrancy: 'window', visualEffectState: 'followsWindowActiveState',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  settingsWindow.loadFile(path.join(RENDERER, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('x-apple.systempreferences:')) shell.openExternal(url); return { action: 'deny' }; });
  app.focus({ steal: true });
}

function hidePanelQuiet() { if (panel?.isVisible()) panel.hide(); }

// ───────────────────────────── settings side effects ─────────────────────────────

function onSettingChanged(key) {
  if (key === 'appearance') nativeTheme.themeSource = settings.get('appearance');
  if (key === 'historyLimit' || key === 'retentionDays') store.setRetention({ maxItems: settings.get('historyLimit'), maxAgeDays: settings.get('retentionDays') });
  if (key === 'hotkey' || key === 'paused') refreshTray();
  if (key === 'captureScreenshots') updateScreenshotWatcher();
  settingsWindow?.webContents.send('settings:changed');
  panel?.webContents.send('history:changed');
}

// ───────────────────────────── screenshots ─────────────────────────────

let screenshotWarned = false;

function readDefault(key) {
  return new Promise((resolve) => {
    execFile('/usr/bin/defaults', ['read', 'com.apple.screencapture', key], { timeout: 2000 }, (err, out) => resolve(err ? '' : out.trim()));
  });
}

async function updateScreenshotWatcher() {
  screenshots?.stop();
  screenshots = null;
  if (!settings.get('captureScreenshots')) return;
  const directory = resolveScreenshotDir(await readDefault('location'), app.getPath('home'));
  const custom = await readDefault('name');
  screenshots = new ScreenshotWatcher({
    directory,
    prefixes: ['Screenshot', 'Screen Shot', ...(custom ? [custom] : [])],
    onScreenshot: importScreenshot,
    onError: () => {
      if (screenshotWarned) return;
      screenshotWarned = true;
      notify('Screenshots not captured', 'MacClip cannot read your screenshot folder. Allow access under System Settings → Privacy & Security → Files & Folders.');
    },
  });
  screenshots.start();
}

/** Adds a new screenshot file to history and (optionally) puts it on the clipboard. */
async function importScreenshot(file) {
  if (settings.get('paused')) return;
  const buffer = await fs.promises.readFile(file);
  const result = capture({
    text: '', rtf: null, html: null, hasFileUrl: false, imageByteLength: buffer.length,
    getImage: () => systemClipboard.processImage(buffer),
  }, { bundleId: 'com.apple.screencaptureui', name: 'Screenshot' });
  if (!result.item) return;
  const item = store.add(result);
  if (settings.get('screenshotsToClipboard') && result.image) {
    systemClipboard.write(item, result.image.png);
    monitor.markOwnWrite(); // already in history; do not record it again
  }
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

// ───────────────────────────── IPC ─────────────────────────────

function registerIpc() {
  ipcMain.handle('history:list', (_e, query, mode) => {
    const inSnippets = mode === 'snippets';
    const matches = inSnippets ? snippets.search(String(query ?? '')) : store.search(String(query ?? ''));
    return {
      mode: inSnippets ? 'snippets' : 'history',
      items: matches.slice(0, MAX_LISTED).map(inSnippets ? snippetToListItem : toListItem),
      matched: matches.length,
      total: inSnippets ? snippets.items.length : store.items.length,
      unpinned: store.items.filter((i) => !i.isPinned).length,
      paused: settings.get('paused'),
      hotkey: Accelerator.display(settings.get('hotkey')),
      pasteBehavior: settings.get('pasteBehavior'),
      loadIssue: store.loadIssue,
      storageWarning,
    };
  });

  ipcMain.handle('history:thumbnail', async (_e, id) => {
    const item = store.get(String(id));
    const buf = item ? await store.readThumbnail(item) : null;
    return buf ? `data:image/png;base64,${buf.toString('base64')}` : null;
  });

  ipcMain.handle('history:select', async (_e, id, opts = {}) => {
    const snippet = opts.snippet ? snippets.get(String(id)) : null;
    const item = snippet ? { id: snippet.id, kind: 'text', text: snippet.text } : store.get(String(id));
    if (!item) return 'missing';
    const result = await paste.select(item, settings.get('pasteBehavior'), targetApp, { plain: !!opts.plain });
    if (result === 'needs-accessibility') notify('Copied to clipboard', 'Allow MacClip under System Settings → Privacy & Security → Accessibility to paste automatically.');
    if (result === 'target-unavailable') notify('Copied to clipboard', 'The original app is no longer in front, so MacClip did not paste. Press ⌘V to paste.');
    return result;
  });

  ipcMain.handle('history:togglePin', (_e, id) => store.togglePin(String(id)));
  ipcMain.handle('history:delete', (_e, id) => store.delete(String(id)));
  ipcMain.handle('history:clearUnpinned', () => confirmClearUnpinned());
  ipcMain.handle('snippets:fromItem', (_e, id) => {
    const item = store.get(String(id));
    if (!item?.text || item.sensitive) return { ok: false };
    const r = snippets.save({ text: item.text });
    if (r.ok) notify('Saved as snippet', r.snippet.title);
    return { ok: r.ok };
  });
  ipcMain.handle('snippets:delete', (_e, id) => snippets.delete(String(id)));
  ipcMain.handle('snippets:list', () => snippets.items);
  ipcMain.handle('snippets:save', (_e, data) => snippets.save({ id: data?.id, title: data?.title, text: data?.text }));
  ipcMain.handle('app:icon', (_e, bundleId) => appIcons.get(bundleId));
  ipcMain.handle('panel:hide', () => hidePanel());
  ipcMain.handle('panel:openSettings', () => openSettings());

  ipcMain.handle('settings:get', async () => ({
    ...settings.all(),
    hotkeyDisplay: Accelerator.display(settings.get('hotkey')),
    hotkeyStatus: hotkeys.status,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    packaged: app.isPackaged,
    excludedAppNames: await Promise.all(settings.get('excludedApps').map(async (id) => ({ id, name: await appNameFor(id) }))),
    storageWarning,
  }));

  ipcMain.handle('settings:set', (_e, key, value) => {
    if (key === 'hotkey') return { ok: false, error: 'Use setHotkey.' };
    try { settings.set(key, value); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('settings:setHotkey', (_e, accelerator) => {
    const error = hotkeys.register(String(accelerator));
    if (error) return { ok: false, error };
    settings.set('hotkey', accelerator);
    return { ok: true, display: Accelerator.display(accelerator) };
  });

  ipcMain.handle('settings:setLaunchAtLogin', (_e, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('settings:addExcludedApp', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow, {
      title: 'Choose an app to exclude', defaultPath: '/Applications', properties: ['openFile'],
      filters: [{ name: 'Applications', extensions: ['app'] }],
    });
    if (canceled || !filePaths[0]) return { ok: false };
    const id = await bundleIdOf(filePaths[0]);
    if (!id) return { ok: false, error: 'Could not read that app’s identifier.' };
    const list = settings.get('excludedApps');
    if (!list.includes(id)) settings.set('excludedApps', [...list, id]);
    return { ok: true };
  });

  ipcMain.handle('settings:removeExcludedApp', (_e, id) => {
    settings.set('excludedApps', settings.get('excludedApps').filter((x) => x !== id));
  });

  ipcMain.handle('settings:clearAll', async () => {
    const { response } = await dialog.showMessageBox(settingsWindow, {
      type: 'warning', message: 'Delete all clipboard history?', detail: 'This removes every item, including pinned ones, from this Mac. It cannot be undone.',
      buttons: ['Delete Everything', 'Cancel'], defaultId: 1, cancelId: 1,
    });
    if (response !== 0) return false;
    await store.clearAll();
    return true;
  });

  ipcMain.handle('settings:accessibility', () => systemPreferences.isTrustedAccessibilityClient(false));
  ipcMain.handle('settings:requestAccessibility', () => {
    systemPreferences.isTrustedAccessibilityClient(true);
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  });
}

function snippetToListItem(s) {
  return { id: s.id, kind: 'snippet', title: s.title, createdAt: s.createdAt, isPinned: false,
    preview: s.text.slice(0, 400).split(/\s+/).filter(Boolean).join(' ').slice(0, 200) };
}

function appPathFor(bundleId) {
  return new Promise((resolve) => {
    execFile('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${bundleId.replace(/[^A-Za-z0-9.-]/g, '')}'`], { timeout: 3000 }, (err, out) => resolve(err ? '' : out.split('\n')[0]));
  });
}

const nameCache = new Map();
async function appNameFor(bundleId) {
  if (nameCache.has(bundleId)) return nameCache.get(bundleId);
  const found = await appPathFor(bundleId);
  const name = found ? path.basename(found, '.app') : bundleId;
  nameCache.set(bundleId, name);
  return name;
}

function bundleIdOf(appPath) {
  return new Promise((resolve) => {
    execFile('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')], { timeout: 3000 }, (err, out) => resolve(err ? null : out.trim()));
  });
}

app.on('before-quit', () => {
  monitor?.stop();
  screenshots?.stop();
  clearInterval(retentionTimer);
  globalShortcut.unregisterAll();
  try { snippets?.flushSync(); } catch { /* ignore */ }
  try { store?.flushSync(); } catch { /* nothing more to do while quitting */ }
});
