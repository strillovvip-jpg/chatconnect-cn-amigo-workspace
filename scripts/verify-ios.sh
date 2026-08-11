#!/bin/bash
# iOS build verification script - run on macOS with Xcode installed.
# Usage: bash scripts/verify-ios.sh [ios/App/App.xcworkspace]
#
# Opens the workspace if it exists, otherwise the xcodeproj, runs a
# command-line build against a generic iOS Simulator, and captures the
# complete error output to /tmp/ios-build-errors.log.
set -euo pipefail

cd "$(dirname "$0")/.."

WORKSPACE="ios/App/App.xcworkspace"
PROJECT="ios/App/App.xcodeproj"
TARGET_KIND="-workspace"

if [ -d "$WORKSPACE" ]; then
  TARGET="$WORKSPACE"
  echo "[verify-ios] using workspace: $TARGET"
else
  TARGET="$PROJECT"
  TARGET_KIND="-project"
  echo "[verify-ios] workspace missing, using project: $TARGET"
fi

# Prefer a physical-device-ish generic build; fall back to simulator if none.
SCHEME="App"
DESTINATION="generic/platform=iOS"
LOG="/tmp/ios-build-errors.log"

echo "[verify-ios] running xcodebuild (scheme=$SCHEME destination=$DESTINATION)"
echo "[verify-ios] full log: $LOG"

set +e
xcodebuild \
  "$TARGET_KIND" "$TARGET" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -configuration Debug \
  -derivedDataPath /tmp/chatconnect-dd \
  build 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}
set -e

if [ "$STATUS" -ne 0 ]; then
  echo ""
  echo "[verify-ios] BUILD FAILED (exit=$STATUS)"
  echo "[verify-ios] first error block:"
  grep -n "error:" "$LOG" | head -40 || true
  exit "$STATUS"
fi

echo ""
echo "[verify-ios] BUILD SUCCEEDED"
echo "[verify-ios] app product: /tmp/chatconnect-dd/Build/Products/Debug-iphoneos/ChatConnect.app"
