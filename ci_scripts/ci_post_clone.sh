#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "[ci_post_clone] repository: $REPO_ROOT"
xcodebuild -version

echo "[ci_post_clone] source commit: $(git rev-parse HEAD)"
node --version
npm --version

export VITE_APP_BUILD_NUMBER="${CI_BUILD_NUMBER:-$(sed -n 's/.*CURRENT_PROJECT_VERSION = \([^;]*\);/\1/p' ios/App/App.xcodeproj/project.pbxproj | head -1 | tr -d '[:space:]')}"
export VITE_GIT_COMMIT="$(git rev-parse --short=12 HEAD)"
export VITE_BUNDLE_DIAGNOSTIC="${VITE_BUNDLE_DIAGNOSTIC:-1}"
echo "[ci_post_clone] bundle fingerprint: build=${VITE_APP_BUILD_NUMBER} commit=${VITE_GIT_COMMIT} diagnostic=${VITE_BUNDLE_DIAGNOSTIC}"

echo "[ci_post_clone] installing JavaScript dependencies"
npm ci

echo "[ci_post_clone] building and syncing the current source into iOS"
npm run build:ios

required_paths="
ios/App/App.xcworkspace
ios/App/App.xcodeproj
ios/App/App/public/index.html
ios/App/App/capacitor.config.json
ios/App/App/config.xml
ios/App/CapApp-SPM/Package.swift
ios/App/CapApp-SPM/Vendor/AmigoFaceSwapSDK.xcframework/Info.plist
"

for path in $required_paths; do
  if [ ! -e "$path" ]; then
    echo "[ci_post_clone] missing required path: $path" >&2
    exit 1
  fi
done

echo "[ci_post_clone] synced index: $(shasum -a 256 ios/App/App/public/index.html | awk '{print $1}')"

echo "[ci_post_clone] resolving Swift packages"
xcodebuild -resolvePackageDependencies \
  -workspace ios/App/App.xcworkspace \
  -scheme App

echo "[ci_post_clone] done"
