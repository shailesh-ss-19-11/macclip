# MacClip

Clipboard history for macOS, inspired by Windows `Win + V`. A small menu bar app built with Electron.

Press **⌥V** (Option + V) in any app, pick an item, and it is pasted where you were typing.

## What it does

- Remembers what you copy: text, formatted text, links, images and code
- **⌥V** opens the history next to your cursor. Type to search
- `↑ ↓` to move, `↩` to paste, `⇧↩` to paste as plain text, `Esc` to close
- Pin items you want to keep (`⌘P` or the pin button) and delete items (`⌘⌫` or the trash button)
- Menu bar icon: open history, pause, settings, quit
- Settings: shortcut, copy-and-paste or copy-only, history size (100 / 500 / 1,000), open at login, pause, delete all history

That is the whole app. There is nothing else to configure.

## Privacy

- Everything stays on your Mac. There is no network code and no analytics. Nothing is logged.
- History is stored in `~/Library/Application Support/MacClip/data/` (private folder, owner-only files), encrypted with AES-256-GCM. The key is a file (`history.key`) in the same folder, so this protects against casual reading and file backups, not against someone who has access to your macOS account.
- **Never saved:** copies from password managers (1Password, Bitwarden, KeePassXC, Dashlane, LastPass, Keychain Access, Proton Pass…), content apps mark as concealed/temporary, file copies from Finder, and text that looks like a credential (API keys, tokens, private keys, `password=…` lines, card numbers). Detection is pattern-based, so it can miss things or occasionally skip harmless text.
- **Limitation:** macOS cannot reliably tell what is sensitive. Anything else you copy *is* saved (for example a password copied from a web page). Use **Pause** when working with secrets.
- Link previews are drawn locally (host and path). MacClip never fetches favicons or titles because that would reveal what you copied.

## Install

Download the `.dmg` for your Mac from the [Releases](../../releases) page (**arm64** for Apple Silicon M1–M4, **x64** for Intel), open it and drag **MacClip.app** to **Applications**.

The app is not notarized by Apple, so macOS blocks the first launch: open MacClip once, then System Settings → Privacy & Security → scroll down → **Open Anyway** (macOS 15+; on older versions right-click → Open also works). Or run:

```sh
xattr -dr com.apple.quarantine /Applications/MacClip.app
```

**Automatic paste needs permission.** Allow MacClip under System Settings → Privacy & Security → **Accessibility** (and Automation → System Events if asked). MacClip then presses ⌘V for you, only in the app you were using, and only if it is still in front. Without permission, items are still copied and you press ⌘V yourself.

Requires macOS 12 or later.

## Run from source

```sh
npm install
npm start          # or: npm run dev
```

From source the app is called "Electron" in macOS permission lists, so grant Accessibility to Electron (or your terminal).

## Build

```sh
ARCH=arm64 npm run package && npm run dmg -- arm64    # release/MacClip-<version>-mac-arm64.dmg
ARCH=x64   npm run package && npm run dmg -- x64
```

## Releasing

GitHub Actions (`.github/workflows`) runs the tests on every push and builds + publishes a release when you push a version tag:

```sh
npm version 1.2.0 --no-git-tag-version
git commit -am "Release 1.2.0" && git push
git tag v1.2.0 && git push origin v1.2.0
```

Run the *Release* workflow manually for a dry run that only uploads the build as an artifact. Builds are ad-hoc signed; notarization needs an Apple Developer account.

## How it works

```
src/main/            main process
  main.js              wiring: panel, menu bar, settings window, IPC
  clipboardMonitor.js  polls a clipboard fingerprint every 0.5 s, applies privacy rules, stores new items
  systemClipboard.js   the only file that touches Electron's clipboard / nativeImage
  capture.js           pure: clipboard snapshot → history item (type detection, hashing, size limits)
  historyStore.js      in-memory history: dedupe, pin, delete, search, size limit, debounced saves
  persistence.js       AES-GCM encrypted file store, key-file provider, in-memory test double
  privacy.js, secrets.js   what is never saved
  hotkey.js            global shortcut registration, conflicts, re-register after wake
  pasteCoordinator.js  restore to clipboard, verify the target app, send ⌘V
  appTracker.js        frontmost app via `lsappinfo` (no permission needed)
src/shared/          pure logic used by the UI and tests (date sections, key bindings, shortcut parsing)
src/renderer/        panel + settings (plain HTML/CSS/JS, sandboxed, strict CSP)
test/                node:test unit tests
```

Notes: Electron exposes no clipboard change counter, so the monitor polls a cheap fingerprint. Electron is pinned to 38 because newer versions replaced the synchronous clipboard API this app needs. Items over 1 MB (text) or 30 MB (images) are skipped.

## Tests

```sh
npm test         # 82 unit tests (node:test)
npm run smoke    # drives the real Electron clipboard, nativeImage and globalShortcut
```

Not automated: pressing the real hotkey, pasting into other apps, the menu bar item, launch at login. Use [docs/MANUAL_TEST_PLAN.md](docs/MANUAL_TEST_PLAN.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| macOS blocks MacClip or says it is damaged | Not notarized. System Settings → Privacy & Security → **Open Anyway**, or the `xattr` command above |
| ⌥V does nothing | Another app owns the shortcut (the menu bar shows ⚠︎). Pick another in Settings. Check the menu bar icon exists |
| Item is copied but not pasted | Allow Accessibility (Settings shows its status), then try again. A notification says which case it was |
| Pasting stopped after updating | Remove MacClip from the Accessibility list and add it again |
| Nothing is recorded | Monitoring may be paused, the app may be a password manager, or the text looks like a credential |
| Reset everything | Quit, then delete `~/Library/Application Support/MacClip` |
