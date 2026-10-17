# MacClip

Clipboard history for macOS, inspired by Windows `Win + V`. A menu bar app built with Electron.

Press **⌥V** (Option + V) from any app to open the history, pick an item, and it is copied and (optionally) pasted into the app you were using.

## Features

- Global shortcut (default **⌥V**, configurable, conflict detection, re-registered after sleep/wake)
- Records text, rich text (RTF/HTML kept), links, images and code snippets with timestamp, type and source app
- Floating panel opens next to the cursor on the right display: search, date sections, thumbnails, link host/path preview, pin, delete, clear unpinned
- Keyboard: `↑ ↓` move · `↩` select · **`⇧↩` paste as plain text** · `Esc` close · `⌘P` pin · `⌘⌫` delete (empty search) · `⌘1`–`⌘9` quick select · `⇥` switch History/Snippets · `⌘S` save item as snippet
- **Snippets:** reusable text that never expires, managed in Settings or saved from history with `⌘S`, pasted from the Snippets tab
- **Screenshots:** screenshots saved by macOS (⌘⇧3 / ⌘⇧4 / ⌘⇧5) are added to history and also copied to the clipboard (both toggleable). ⌃⌘⇧4 screenshots already go to the clipboard and are captured like any image
- **App icons:** each row shows the icon of the app it was copied from
- **Secret detection:** text that looks like an API key, token, private key, password assignment or card number (Luhn-checked) is not saved by default; alternatively saved hidden for 2 minutes, or saved normally
- "Copy to Clipboard" or "Copy and Paste" behaviour
- Menu bar item: show history, pause/resume, clear unpinned, settings, quit
- History persists across launches; limits of 100 / 500 / 1,000 items and automatic deletion after 1 / 7 / 30 / 90 days. Pinned items are never removed automatically
- Privacy: encrypted at rest, local only, pause, excluded apps, password-manager exclusion, retention, delete-all
- Light / dark / system appearance, launch at login

## Requirements

- macOS 12 or newer (Apple Silicon or Intel), Node.js 20+ (developed on Node 22)

## Run from source

```sh
npm install
npm start
```

The clipboard icon appears in the menu bar (no Dock icon). Quit from the menu bar menu.

> When running from source the app is "Electron", so macOS Accessibility permission must be granted to **Electron** (or your terminal/IDE) rather than MacClip.

## App icon

The icon is built from `assets/icon-source.png`: `npx electron scripts/build-icon.js assets/icon-source.png` makes the transparent `assets/icon.png` and `assets/icon.icns`. Menu bar icons come from `npm run icons`.

## Build the `.app`

```sh
npm run package            # dist/MacClip-darwin-<your arch>/MacClip.app
ARCH=x64 npm run package   # or arm64 / universal
```

Drag `MacClip.app` into `/Applications`, then open it. It is signed ad-hoc, so on first launch macOS may require **right-click → Open** (or System Settings → Privacy & Security → Open Anyway). To distribute to other Macs, sign and notarize with a Developer ID: `SIGN_IDENTITY="Developer ID Application: …" npm run package`, then notarize with `xcrun notarytool`.

"Launch at login" only works from the installed app.

## Permissions

| Permission | Why | If missing |
|---|---|---|
| **Accessibility** (System Settings → Privacy & Security → Accessibility) | To send ⌘V to the app you were using | Items are still copied; press ⌘V yourself |
| **Automation → System Events** (prompted on first paste) | Pasting is done by asking System Events to press ⌘V | Same as above |
| **Files & Folders** (prompted once) | To watch your screenshot folder (usually Desktop) for new screenshots | Screenshots saved as files are not imported; clipboard screenshots still work |
| Keychain access (prompted once) | Stores the key that encrypts your history | History is kept in memory only |

MacClip only pastes into the app that was frontmost when you opened the panel, and only if it is frontmost again afterwards. If you switched apps, it copies and tells you instead of pasting somewhere unexpected. It never activates a third app.

Enable it in Settings → General → Accessibility → *Grant Access…*. After rebuilding the app, macOS treats it as a new app: remove the old entry from the Accessibility list and add it again.

## Privacy and security

- Everything stays on your Mac. There is no network code and no analytics.
- History is encrypted with AES-256-GCM. The random data key is wrapped with Electron `safeStorage` (backed by the login Keychain). Files live in `~/Library/Application Support/MacClip/data/`; each image is a separate encrypted blob.
- Clipboard content is never logged.
- Skipped automatically: copies made while an **excluded app** is frontmost, a built-in list of password managers (toggleable), content marked concealed/transient/auto-generated via the `org.nspasteboard.*` markers, file copies from Finder, and copies made while monitoring is **paused**.
- Secret detection is pattern-based (AWS, GitHub, Slack, Stripe, Google, `sk-` keys, JWTs, private keys, bearer tokens, `password=…` lines, card numbers). It will miss secrets that don't match, and can occasionally flag harmless text; change Settings → Privacy → *Likely secrets*.
- **Limitation:** macOS cannot reliably tell that something is sensitive. Anything copied from a non-excluded app that does not set those markers *is* saved (e.g. a password copied from a web page). Pause monitoring or exclude apps that handle secrets.
- The source app is identified when the change is *detected* (polled every 0.5 s), so if you switch apps within that window it can be misattributed.
- Link previews are rendered locally (host + path). MacClip does not fetch favicons or page titles because that would reveal what you copied.
- Unreadable history is renamed `history.corrupt-<time>.bin` and the app starts empty. If secure storage is unavailable, history is kept in memory only and the menu shows a warning.

## Architecture

```
src/main/            main process (no UI)
  main.js            wiring, panel/tray/settings windows, IPC
  clipboardMonitor.js  polls a fingerprint, applies privacy, captures, stores
  systemClipboard.js   the only file that touches Electron's clipboard/nativeImage
  capture.js         pure: snapshot → item (type detection, hashing, limits)
  historyStore.js    in-memory history: dedupe, pin, delete, search, retention, debounced saves
  persistence.js     AES-GCM encrypted file store + safeStorage key provider + in-memory test double
  privacy.js         exclusions, pause, concealed types
  hotkey.js          global shortcut registration, conflicts, wake re-register
  pasteCoordinator.js  restore to clipboard, verify target app, send ⌘V
  appTracker.js      frontmost app via `lsappinfo` (no permissions needed)
  settings.js        validated JSON preferences
  positioner.js      panel placement across displays
src/shared/          pure logic used by both renderer and tests (sections, key bindings, accelerators)
src/renderer/        panel + settings UI (plain HTML/CSS/JS, sandboxed, contextIsolation, strict CSP)
test/                node:test unit tests
```

Design notes:

- **Polling:** Electron exposes no pasteboard change counter, so the monitor polls a cheap fingerprint every 500 ms (format list + text + hash of raw image bytes) and does real work only on change. Idle cost is small; while a very large image sits on the clipboard each poll hashes its bytes.
- **Electron version is pinned to 38.** Electron 44 replaced the synchronous clipboard API with an async web-style one that cannot read pasteboard formats such as `public.png` or the `org.nspasteboard` markers MacClip relies on.
- **Thumbnails** are separate encrypted blobs loaded lazily (IntersectionObserver); full images are only read when restored. Image decode/resize runs on the main process.
- Items larger than 1 MB (text/rich text) or 30 MB (images) are skipped.

## Releasing

Releases are automated with GitHub Actions (`.github/workflows`):

- **CI** runs `npm test` on every push to `main` and on pull requests.
- **Release** builds the arm64 and x64 packages and publishes a GitHub release when you push a version tag:

```sh
npm version 1.1.0 --no-git-tag-version   # bump package.json (and the lockfile)
git commit -am "Release 1.1.0" && git push
git tag v1.1.0 && git push origin v1.1.0
```

The tag must match the version in `package.json`. To try the build without publishing, run the *Release* workflow manually from the Actions tab; it uploads the zips as a build artifact. Builds are ad-hoc signed; add Developer ID signing and notarization if you get an Apple Developer account. Note: macOS runners on private repositories use GitHub's paid-minute multiplier (10×).

## Tests

```sh
npm test         # 92 unit tests (node:test)
npm run smoke    # drives the real Electron clipboard, nativeImage, safeStorage and globalShortcut
```

Unit tests cover change detection, text/URL/image/code capture, duplicates, search and sorting, pinning and deletion, retention, persistence across relaunch (including encryption, corruption and wrong key), shortcut registration/conflicts/wake, privacy exclusions, paste behaviour when switching apps, and keyboard navigation logic.

Not automated: the physical hotkey press, real pastes into other apps, the tray menu, sleep/wake, launch at login and VoiceOver. Use [docs/MANUAL_TEST_PLAN.md](docs/MANUAL_TEST_PLAN.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| ⌥V does nothing | Another app owns the shortcut (a ⚠︎ appears in the menu bar menu). Pick a new one in Settings. Also check the menu bar icon exists |
| Item is copied but not pasted | Grant Accessibility (and Automation → System Events), then reopen the panel. You will get a notification explaining which case it was |
| Pasting stopped working after a rebuild | Remove MacClip from the Accessibility list and add it again |
| Keychain prompt on every launch | Click **Always Allow**. Rebuilt ad-hoc builds are seen as a new app |
| Nothing is recorded | Monitoring may be paused (menu bar), the source app may be excluded, or the app marks its content as concealed |
| Items from a password manager appear | Add that app under Settings → Privacy → Excluded apps |
| History empty after update | See `history.corrupt-*.bin` in the data folder; the key may have been reset in Keychain |
| Reset everything | Quit, then delete `~/Library/Application Support/MacClip` and the "MacClip Safe Storage" Keychain item |
