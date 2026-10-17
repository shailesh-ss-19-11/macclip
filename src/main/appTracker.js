'use strict';
const { execFile } = require('node:child_process');

function run(cmd, args, timeout = 1500) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/** Parses `lsappinfo info -only bundleid -only name -only pid` output. */
function parseLsappinfo(out) {
  if (!out) return null;
  const get = (key) => out.match(new RegExp(`"${key}"=("?)([^"\\n]*)\\1`))?.[2];
  const pid = Number(get('pid'));
  const bundleId = get('CFBundleIdentifier');
  if (!pid && !bundleId) return null;
  return { bundleId: bundleId || null, name: get('LSDisplayName') || null, pid: pid || null };
}

/**
 * Identifies the frontmost application with `lsappinfo`, which is fast and needs no permissions.
 * Returns null if MacClip itself is frontmost.
 */
class AppTracker {
  constructor({ ownPid = process.pid, exec = run } = {}) {
    this.ownPid = ownPid;
    this.exec = exec;
  }

  async frontmost() {
    const asn = (await this.exec('/usr/bin/lsappinfo', ['front']))?.trim();
    if (!asn) return null;
    const info = parseLsappinfo(await this.exec('/usr/bin/lsappinfo', ['info', '-only', 'bundleid', '-only', 'name', '-only', 'pid', asn]));
    if (!info || info.pid === this.ownPid) return null;
    return info;
  }
}

module.exports = { AppTracker, parseLsappinfo, run };
