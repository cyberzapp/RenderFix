#!/usr/bin/env bash
set -euo pipefail

FRONTEND_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$FRONTEND_DIR/.." && pwd)"
BUILD_DIR="$FRONTEND_DIR/build"
ICON_SOURCE="$BUILD_DIR/icon-source.png"
ICONSET_DIR="$BUILD_DIR/RenderFix.iconset"

if [[ ! -f "$ICON_SOURCE" ]]; then
  echo "The RenderFix icon source is missing: $ICON_SOURCE"
  exit 1
fi

mkdir -p "$ICONSET_DIR"
sips -z 16 16 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
python3 "$FRONTEND_DIR/build_icon.py"

printf '%s\n' "$PROJECT_ROOT/backend" > "$BUILD_DIR/backend-path.txt"
npm run build
npx electron-builder --mac dir --arm64

echo
echo "RenderFix.app is ready at $FRONTEND_DIR/release/mac-arm64/RenderFix.app"
