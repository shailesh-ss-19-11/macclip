# Manual test plan

Prerequisites: install `MacClip.app` from the DMG, allow Accessibility (and Automation → System Events when asked). Settings → *When you pick an item* = **Copy and paste it**.

## 1. Basics
- [ ] Clipboard icon in the menu bar, no Dock icon. First launch opens Settings and shows a notification.
- [ ] ⌥V opens the panel near the cursor with the search field focused. ⌥V again, Esc, or clicking elsewhere closes it.
- [ ] On a second display the panel opens on the display under the cursor and stays on screen. It also opens over a full-screen app.
- [ ] Settings → change the shortcut (e.g. ⌃⌥V): old one stops, new one works. ⌘Space is rejected. A shortcut owned by another app shows an error and the old one keeps working.
- [ ] Sleep and wake the Mac: the shortcut still works.

## 2. Copy and paste per app
For each app: copy text → ⌥V → the item is on top → Enter → it is pasted at the caret in the same app, the panel closes, and focus stays in the app.

| App | Check |
|---|---|
| **Safari** | Copy a paragraph, paste into a form field. Copy a link (Share → Copy Link) → shows as a link. Right-click an image → Copy Image → shows with a thumbnail; paste into Notes |
| **Chrome** | Same as Safari. Copy a formatted selection → pasted into Notes keeps formatting; `⇧↩` pastes plain text |
| **VS Code** | Copy 3+ lines of code → shown as code (monospace) → paste with indentation intact |
| **Xcode** | Copy a Swift function → paste into another file |
| **Notes** | Copy bold/list text → keeps formatting with `↩`, plain with `⇧↩`. Copy an image |
| **Terminal** | Copy command output → paste at the prompt |

- [ ] Open the panel in Safari, click into Chrome (panel closes): nothing is pasted into the wrong app.
- [ ] Open the panel, pick an item, immediately ⌘Tab: the item is copied and never pasted into the app you switched to.
- [ ] Revoke Accessibility, pick an item: it is copied, a notification explains, nothing is pasted.
- [ ] *Only copy it*: Enter copies and closes; paste manually with ⌘V.
- [ ] Picking an item moves it to the top without creating a duplicate.

## 3. Panel
- [ ] Newest first, grouped Pinned / Today / Yesterday / dated.
- [ ] ↑ ↓ move and scroll; Enter pastes; typing filters instantly; no results shows an empty state.
- [ ] ⌘P or the pin button pins/unpins; pinned items move to the top section.
- [ ] ⌘⌫ (empty search) or the trash button deletes; the selection moves to a neighbour.
- [ ] *Clear* removes unpinned items after confirmation. The gear opens Settings.
- [ ] Image thumbnails load as you scroll; pasting an image into Preview gives the full image.
- [ ] Looks right in light and dark mode. VoiceOver reads the search field, rows and buttons.

## 4. Persistence and size
- [ ] Quit and reopen: history and pins are still there. `strings ~/Library/Application\ Support/MacClip/data/history.bin` shows no readable text.
- [ ] History size 100: copy 105 distinct items; 100 unpinned remain; pinned items are untouched.
- [ ] Corrupt `history.bin` (append junk) and relaunch: the app starts empty, a banner explains, a `history.corrupt-*` file exists.

## 5. Privacy
- [ ] Pause (menu bar or Settings): copies are not saved, the panel shows a "paused" banner, and resuming does not import what was copied meanwhile.
- [ ] Copy from 1Password / Bitwarden / Keychain Access: not saved.
- [ ] Copy a GitHub token, an `AKIA…` key or `4111 1111 1111 1111`: not saved. Ordinary text, links and git SHAs are saved.
- [ ] Settings → Delete all history removes everything, including pinned items.
- [ ] `nettop`/Little Snitch: MacClip makes no network connections.

## 6. Misc
- [ ] Open at login (installed app): toggle on, log out and in, the app starts.
- [ ] Launching a second copy does not start a second instance (it opens the panel).
- [ ] Idle CPU in Activity Monitor stays near 0–1 %.
