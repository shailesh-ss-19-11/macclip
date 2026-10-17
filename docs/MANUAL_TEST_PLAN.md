# Manual test plan

Prerequisites: `npm run package`, install and open `MacClip.app`, grant Accessibility and Automation when prompted. Settings → *When selecting an item* = **Copy and Paste**. Quit MacClip between sections if you change permissions.

## 0. Basics
- [ ] Clipboard icon appears in the menu bar, no Dock icon.
- [ ] ⌥V opens the panel near the cursor, search field focused. ⌥V again or Esc closes it. Clicking elsewhere closes it.
- [ ] On a second display the panel opens on the display under the cursor and never goes off-screen.
- [ ] Opens over a full-screen app.
- [ ] Settings → change shortcut to ⌃⌥V: old one stops, new one works. Try ⌘Space (rejected), a shortcut already used by another app (error shown, old shortcut keeps working).
- [ ] Sleep the Mac, wake it: shortcut still works.

## 1. Per-app copy and paste

For each app: copy a text snippet in the app → press ⌥V → the item is on top with the app's name as the source → press Enter → the text is pasted at the caret in that same app, the panel closes, and focus stays in the app (no window switch).

| App | Text copy/paste | Other checks |
|---|---|---|
| **Safari** | Copy a paragraph from a web page, paste into the address bar / a form field | Copy a link (Share → Copy Link) → shows as Link. Right-click image → Copy Image → shows as Image with thumbnail; paste into Notes |
| **Chrome** | Same as Safari | Copy a rich selection → pasted into Notes keeps formatting |
| **VS Code** | Copy 3+ lines of code → shows as Code (monospace) → paste in a new editor tab with indentation intact | Copy a single identifier (stays Text); copy with an empty line selected (not recorded) |
| **Xcode** | Copy a Swift function → Code → paste into another file | |
| **Notes** | Copy formatted text (bold/list) → Rich Text → paste into Notes keeps formatting; paste into TextEdit plain-text mode gives plain text | Copy an image from Notes |
| **Terminal** | Select and copy command output → paste at the prompt (multi-line text is pasted without being executed until Enter is pressed) | Verify ⌘V target is Terminal, not another window |

- [ ] Switch case: open the panel in Safari, click into Chrome (panel closes) — nothing is pasted into the wrong app.
- [ ] Open the panel in Safari, pick an item, immediately ⌘Tab: the item is copied; at most one paste lands in Safari, never in the app you switched to.
- [ ] Revoke Accessibility, select an item: it is copied, a notification explains how to enable pasting, nothing is pasted.
- [ ] Set *Copy to Clipboard*: Enter copies and closes; pasting is manual with ⌘V.
- [ ] Selecting an item does not create a duplicate entry (it moves to the top).

## 2. Panel
- [ ] Items newest first, sections Pinned / Today / Yesterday / dated.
- [ ] ↑ ↓ move and scroll the selection; stops at the first/last item; Enter selects; ⌘1–⌘9 select by position.
- [ ] Typing filters instantly (text, URL, app name, "image", "link"). No results shows an empty state.
- [ ] ⌘P and the pin button pin/unpin; pinned items move to the Pinned section.
- [ ] ⌘⌫ (empty search) and the trash button delete; selection moves to a neighbour.
- [ ] Footer *Clear* removes unpinned items only, after confirmation.
- [ ] Image thumbnails appear lazily when scrolled into view; pasting an image into Preview/Notes gives the full-size image.
- [ ] Light and dark appearance, and the Settings → Appearance override, look correct.
- [ ] VoiceOver: search field, rows (with "pinned") and buttons are announced.

## 2b. Plain text, snippets, icons, secrets
- [ ] Copy bold text in Notes, open the panel, press `⇧↩`: pasted without formatting. `↩` keeps formatting.
- [ ] Settings → Snippets: add, edit, delete. Tab in the panel shows them; `↩` pastes into the previous app; `⌘⌫` deletes; Tab returns to History.
- [ ] `⌘S` on a history item creates a snippet (a notification confirms).
- [ ] Rows show the correct source app icon (Safari, Notes, Terminal…).
- [ ] Copy a GitHub token / `AKIA…` key / `4111 1111 1111 1111`: not saved (default). With *Save hidden for 2 minutes*: row shows a masked label, is not searchable, pastes correctly, and disappears after ~2 minutes unless pinned.
- [ ] Ordinary text, URLs and git SHAs are still saved.

## 2c. Screenshots
- [ ] ⌘⇧4 (or ⌘⇧3) a region: after the thumbnail disappears (a few seconds) the screenshot appears in History as an Image from "Screenshot", and ⌘V pastes it into Notes/Preview.
- [ ] macOS asks to allow access to the screenshot folder the first time; allow it.
- [ ] Turn off *Also copy screenshots to the clipboard*: screenshots appear in history but the clipboard is unchanged.
- [ ] Turn off *Save screenshots to history* or pause monitoring: new screenshots are not imported.
- [ ] ⌃⌘⇧4 (clipboard-only screenshot) appears as an Image from the app that was frontmost.
- [ ] Screenshots that existed before launch are not imported. Screen recordings are ignored.

## 3. Persistence & retention
- [ ] Quit and reopen: history and pins are still there. `history.bin` contains no readable text (`strings history.bin`).
- [ ] Limit 100: copy 105 distinct items; only 100 unpinned remain. Pinned items are untouched.
- [ ] Retention 1 day: change the system date forward / edit an item's age; old unpinned items disappear after the hourly sweep or relaunch.
- [ ] Damage `history.bin` (append junk), relaunch: app starts empty, a banner explains, a `history.corrupt-*` file exists.

## 4. Privacy
- [ ] Menu bar → Pause Monitoring: copies are not recorded; panel shows a "paused" banner; resume does not import what was copied while paused.
- [ ] Copy a password from 1Password/Bitwarden/Keychain Access (or any app added under Excluded apps): not recorded.
- [ ] Copy a password from an app that is not excluded: it *is* recorded (documented limitation) — then delete it and confirm it is gone.
- [ ] Settings → Delete All History removes everything, including `blobs/`.
- [ ] Network check (Little Snitch/`nettop`): MacClip makes no connections.

## 5. Misc
- [ ] Launch at login (installed app): toggle on, log out/in, app starts.
- [ ] Opening a second copy of the app does not start a second instance.
- [ ] Quit from the menu bar; relaunch immediately — no data loss.
- [ ] Idle CPU in Activity Monitor stays near 0–1 %.
