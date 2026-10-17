Clipboard history for macOS, inspired by Windows `Win + V`. Press **⌥V** in any app, pick an item, and it is pasted where you were typing.

## Install
1. Download the **.dmg** for your Mac: **arm64** for Apple Silicon (M1, M2, M3, M4…), **x64** for Intel.
2. Open it and drag **MacClip.app** onto **Applications**.
3. This build is **not notarized** by Apple, so macOS blocks the first launch. Open MacClip once, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to MacClip. (On macOS 14 and earlier, right-click → Open also works.) Or run in Terminal:
   ```sh
   xattr -dr com.apple.quarantine /Applications/MacClip.app
   ```
4. For automatic paste, allow MacClip under System Settings → Privacy & Security → **Accessibility**. Without it, items are still copied and you press ⌘V yourself.

Requires macOS 12 or later. Verify downloads with `SHA256SUMS.txt`. The `.zip` files contain the same app.

Everything stays on your Mac. macOS cannot reliably tell what is sensitive, so use **Pause** when working with secrets.

## What's changed
