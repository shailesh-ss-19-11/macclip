Clipboard history for macOS, inspired by Windows `Win + V`. Press **⌥V** from any app to open your history.

## Install
1. Download the zip for your Mac: **arm64** for Apple Silicon (M1 and later), **x64** for Intel.
2. Unzip and drag **MacClip.app** to `/Applications`.
3. This build is **not notarized** (ad-hoc signed). On first launch use right-click → **Open**. If macOS says the app is damaged or blocked, run:
   ```sh
   xattr -dr com.apple.quarantine /Applications/MacClip.app
   ```
4. For automatic paste, allow MacClip under System Settings → Privacy & Security → **Accessibility** (and Automation → System Events when asked). Without it, items are still copied and you press ⌘V yourself.

Requires macOS 12 or later. Verify downloads with `SHA256SUMS.txt`.

macOS cannot reliably identify sensitive content. Anything copied from an app that is not excluded and does not match a secret pattern is saved; use pause or excluded apps for sensitive work.

## What's changed
