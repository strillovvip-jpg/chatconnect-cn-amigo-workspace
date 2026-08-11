#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ZIP_PATH="${1:-$HOME/Downloads/AmigoFaceSwapSDK.xcframework.zip}"
VENDOR_DIR="$ROOT_DIR/ios/App/CapApp-SPM/Vendor"
TARGET_DIR="$VENDOR_DIR/AmigoFaceSwapSDK.xcframework"

if [ ! -f "$ZIP_PATH" ]; then
  echo "[install-local-amigo-sdk] zip not found: $ZIP_PATH" >&2
  exit 1
fi

mkdir -p "$VENDOR_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

unzip -q -o "$ZIP_PATH" -d "$TMP_DIR"

SDK_PATH="$(find "$TMP_DIR" -type d -name 'AmigoFaceSwapSDK.xcframework' | head -n 1)"
if [ -z "$SDK_PATH" ]; then
  echo "[install-local-amigo-sdk] AmigoFaceSwapSDK.xcframework not found inside zip" >&2
  exit 1
fi

rm -rf "$TARGET_DIR"
cp -R "$SDK_PATH" "$TARGET_DIR"

echo "[install-local-amigo-sdk] installed to $TARGET_DIR"
