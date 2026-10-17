'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('macclip', {
  list: invoke('history:list'),
  thumbnail: invoke('history:thumbnail'),
  select: invoke('history:select'),
  togglePin: invoke('history:togglePin'),
  remove: invoke('history:delete'),
  clearUnpinned: invoke('history:clearUnpinned'),
  hide: invoke('panel:hide'),
  openSettings: invoke('panel:openSettings'),
  onShown: on('panel:shown'),
  onChanged: on('history:changed'),
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
    setHotkey: invoke('settings:setHotkey'),
    setLaunchAtLogin: invoke('settings:setLaunchAtLogin'),
    clearAll: invoke('settings:clearAll'),
    accessibility: invoke('settings:accessibility'),
    requestAccessibility: invoke('settings:requestAccessibility'),
    onChanged: on('settings:changed'),
  },
});
