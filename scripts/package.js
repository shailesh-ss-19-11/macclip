'use strict';
// Builds dist/MacClip-darwin-<arch>/MacClip.app (menu-bar app, ad-hoc signed).
const { packager } = require('@electron/packager');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

(async () => {
  const arch = process.env.ARCH || process.arch; // arm64 | x64 | universal
  const [appPath] = await packager({
    dir: path.join(__dirname, '..'),
    out: path.join(__dirname, '..', 'dist'),
    name: 'MacClip',
    platform: 'darwin',
    arch,
    overwrite: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.icns'),
    appBundleId: 'com.macclip.app',
    appCategoryType: 'public.app-category.utilities',
    appCopyright: 'MacClip',
    ignore: [/^\/test/, /^\/scripts/, /^\/docs/, /^\/dist/, /^\/release/, /^\/\.git/, /\.md$/],
    extendInfo: {
      LSUIElement: true, // menu bar app: no Dock icon
      NSAppleEventsUsageDescription: 'MacClip sends ⌘V to the app you were using so selected items are pasted for you.',
    },
  });
  const app = path.join(appPath, 'MacClip.app');
  // Ad-hoc signature so macOS will run it and Keychain/Accessibility can identify the app.
  // Set SIGN_IDENTITY to a Developer ID to distribute to other Macs.
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', process.env.SIGN_IDENTITY || '-', app], { stdio: 'inherit' });
  console.log(`\nBuilt ${app}`);
})().catch((e) => { console.error(e); process.exit(1); });
