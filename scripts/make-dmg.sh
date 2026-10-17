#!/bin/bash
# Usage: scripts/make-dmg.sh <arch>   (arm64 | x64)  ->  release/MacClip-<version>-<arch>.dmg
# Expects dist/MacClip-darwin-<arch>/MacClip.app (run `ARCH=<arch> npm run package` first).
set -euo pipefail
ARCH="${1:?usage: make-dmg.sh arm64|x64}"
cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
APP="dist/MacClip-darwin-$ARCH/MacClip.app"
OUT="release/MacClip-$VERSION-mac-$ARCH.dmg"
[ -d "$APP" ] || { echo "Missing $APP" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p release
cp -R "$APP" "$STAGE/MacClip.app"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/READ ME FIRST.txt" <<TXT
Install: drag MacClip.app onto the Applications folder.

First launch (this build is not notarized by Apple):
  1. Open MacClip from Applications. macOS will block it.
  2. Open System Settings > Privacy & Security, scroll down, click "Open Anyway" next to MacClip.
  Or, in Terminal:  xattr -dr com.apple.quarantine /Applications/MacClip.app

Then press Option+V to open your clipboard history.
For automatic paste, allow MacClip under Privacy & Security > Accessibility.
TXT

rm -f "$OUT"
hdiutil create -quiet -volname "MacClip" -srcfolder "$STAGE" -fs HFS+ -format UDZO -imagekey zlib-level=9 "$OUT"
echo "Built $OUT"
