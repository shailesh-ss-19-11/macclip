'use strict';

/** Caches app icons (as data URLs) by bundle identifier. Lookups are injected so this stays testable. */
class AppIcons {
  constructor({ findAppPath, getIcon }) {
    this.findAppPath = findAppPath;
    this.getIcon = getIcon;
    this.cache = new Map();
  }

  get(bundleId) {
    if (typeof bundleId !== 'string' || !/^[A-Za-z0-9.-]{1,200}$/.test(bundleId)) return Promise.resolve(null);
    if (!this.cache.has(bundleId)) {
      this.cache.set(bundleId, (async () => {
        try {
          const appPath = await this.findAppPath(bundleId);
          return appPath ? await this.getIcon(appPath) : null;
        } catch { return null; }
      })());
    }
    return this.cache.get(bundleId);
  }
}

module.exports = { AppIcons };
