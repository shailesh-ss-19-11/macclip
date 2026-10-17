'use strict';
const path = require('node:path');
const fs = require('node:fs');
const {
  app, BrowserWindow, Tray, Menu, globalShortcut, screen, ipcMain, powerMonitor,
  dialog, systemPreferences, safeStorage, Notification, shell, nativeImage,
} = require('electron');

app.setPath('userData', process.env.MACCLIP_DATA_DIR || path.join(app.getPath('appData'), 'MacClip'));
app.setName('MacClip');

const { Settings } = require('./settings');
const { HistoryStore } = require('./historyStore');
const { EncryptedFilePersistence, FileKeyProvider, MemoryPersistence } = require('./persistence');
const { PrivacyManager } = require('./privacy');
const { ClipboardMonitor } = require('./clipboardMonitor');
const { AppTracker } = require('./appTracker');
const { PasteCoordinator } = require('./pasteCoordinator');
const { HotKeyManager } = require('./hotkey');
const { panelPosition } = require('./positioner');
const { toListItem } = require('./preview');
const Accelerator = require('../shared/accelerator');
const systemClipboard = require('./systemClipboard');

const PANEL_SIZE = { width: 420, height: 540 };
const MAX_LISTED = 300;
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');

let settings, store, privacy, monitor, apps, paste, hotkeys, tray;
let panel = null;
let settingsWindow = null;
let targetApp = null;
let storageWarning = null;

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
  // Menu bar app: no Dock icon when installed. From source, keep it so it is obvious the app is running.
  if (app.isPackaged) app.dock?.hide();
  else app.dock?.setIcon(path.join(__dirname, '..', '..', 'assets', 'icon.png'));

  const firstRun = !fs.existsSync(path.join(app.getPath('userData'), 'settings.json'));
  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));

  store = new HistoryStore(createPersistence(), { maxItems: settings.get('historyLimit') });
  await store.load();
  store.applyRetention();

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
  if (firstRun) openSettings(); // make the very first launch visible

  store.on('change', () => { panel?.webContents.send('history:changed'); });
  settings.on('change', onSettingChanged);
  powerMonitor.on('resume', () => hotkeys.reregister());
}

function createPersistence() {
  const dir = path.join(app.getPath('userData'), 'data');
  try {
    const keys = new FileKeyProvider(path.join(dir, 'history.key'), { legacyKey: legacyKeychainKey(dir) });
    keys.getKey(); // create the key file now so a disk problem shows up immediately
    return new EncryptedFilePersistence(dir, keys);
  } catch {
    storageWarning = 'MacClip could not write to its data folder, so history will not be saved between launches.';
    return new MemoryPersistence();
  }
}

/** Versions up to 1.0.1 wrapped the data key with the Keychain (safeStorage). Reuse it if it still works. */
function legacyKeychainKey(dir) {
  const legacyFile = path.join(dir, 'key.bin');
  return () => {
    if (!fs.existsSync(legacyFile) || !safeStorage.isEncryptionAvailable()) return null;
    return Buffer.from(safeStorage.decryptString(fs.readFileSync(legacyFile)), 'hex');
  };
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
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const label = Accelerator.display(settings.get('hotkey'));
  const items = [
    { label: `Show Clipboard History   ${label}`, click: () => showPanel() },
    { label: 'Pause', type: 'checkbox', checked: settings.get('paused'), click: (m) => settings.set('paused', m.checked) },
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
  if (panel?.isVisible()) panel.hide();
  if (settingsWindow) { settingsWindow.show(); settingsWindow.focus(); app.focus({ steal: true }); return; }
  settingsWindow = new BrowserWindow({
    width: 480, height: 470, title: 'MacClip Settings', resizable: false, minimizable: false, maximizable: false,
    fullscreenable: false, titleBarStyle: 'hiddenInset', vibrancy: 'window', visualEffectState: 'followsWindowActiveState',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  settingsWindow.loadFile(path.join(RENDERER, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  app.focus({ steal: true });
}

function onSettingChanged(key) {
  if (key === 'historyLimit') store.setRetention({ maxItems: settings.get('historyLimit') });
  if (key === 'hotkey' || key === 'paused') refreshTray();
  settingsWindow?.webContents.send('settings:changed');
  panel?.webContents.send('history:changed');
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

// ───────────────────────────── IPC ─────────────────────────────

function registerIpc() {
  ipcMain.handle('history:list', (_e, query) => {
    const matches = store.search(String(query ?? ''));
    return {
      items: matches.slice(0, MAX_LISTED).map(toListItem),
      matched: matches.length,
      total: store.items.length,
      unpinned: store.items.filter((i) => !i.isPinned).length,
      paused: settings.get('paused'),
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
    const item = store.get(String(id));
    if (!item) return 'missing';
    const result = await paste.select(item, settings.get('pasteBehavior'), targetApp, { plain: !!opts.plain });
    if (result === 'needs-accessibility') notify('Copied to clipboard', 'Allow MacClip under System Settings → Privacy & Security → Accessibility to paste automatically.');
    if (result === 'target-unavailable') notify('Copied to clipboard', 'The original app is no longer in front, so MacClip did not paste. Press ⌘V to paste.');
    return result;
  });

  ipcMain.handle('history:togglePin', (_e, id) => store.togglePin(String(id)));
  ipcMain.handle('history:delete', (_e, id) => store.delete(String(id)));
  ipcMain.handle('history:clearUnpinned', () => confirmClearUnpinned());
  ipcMain.handle('panel:hide', () => hidePanel());
  ipcMain.handle('panel:openSettings', () => openSettings());

  ipcMain.handle('settings:get', () => ({
    ...settings.all(),
    hotkeyDisplay: Accelerator.display(settings.get('hotkey')),
    hotkeyStatus: hotkeys.status,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    packaged: app.isPackaged,
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

app.on('before-quit', () => {
  monitor?.stop();
  globalShortcut.unregisterAll();
  try { store?.flushSync(); } catch { /* nothing more to do while quitting */ }
});
