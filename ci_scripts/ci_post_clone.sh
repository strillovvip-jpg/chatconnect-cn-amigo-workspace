#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "[ci_post_clone] repository: $REPO_ROOT"
xcodebuild -version

echo "[ci_post_clone] source commit: $(git rev-parse HEAD)"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[ci_post_clone] Node.js is not preinstalled; installing it with Xcode Cloud Homebrew"
  if ! command -v brew >/dev/null 2>&1; then
    echo "[ci_post_clone] Homebrew is unavailable, so Node.js cannot be installed" >&2
    exit 1
  fi

  export HOMEBREW_NO_AUTO_UPDATE=1
  brew install node
  NODE_PREFIX="$(brew --prefix node)"
  export PATH="$NODE_PREFIX/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[ci_post_clone] Node.js installation completed but node/npm are still unavailable" >&2
  exit 1
fi

node --version
npm --version

echo "[ci_post_clone] installing JavaScript dependencies"
npm ci

if [ -z "${AMIGO_API_KEY:-}" ] && [ -n "${VITE_AMIGO_API_KEY:-}" ]; then
  # Existing Xcode Cloud workflows used this secret name before the key was
  # moved entirely into the native Release configuration.  Keep the fallback
  # private to this shell so old Cloud configuration can build the current
  # source without ever exposing the value to the JavaScript bundle.
  AMIGO_API_KEY="$VITE_AMIGO_API_KEY"
  export AMIGO_API_KEY
fi

if [ -z "${AMIGO_API_KEY:-}" ]; then
  echo "[ci_post_clone] required Secret AMIGO_API_KEY is not configured" >&2
  exit 1
fi

echo "[ci_post_clone] generating private native build configuration"
"$REPO_ROOT/scripts/generate-amigo-xcconfig.sh"

if [ -n "${CI_BUILD_NUMBER:-}" ]; then
  echo "[ci_post_clone] setting the actual iOS bundle version to Xcode Cloud build ${CI_BUILD_NUMBER}"
  node scripts/set-ios-build-number.mjs "$CI_BUILD_NUMBER"
fi

export VITE_APP_BUILD_NUMBER="${CI_BUILD_NUMBER:-$(sed -n 's/.*CURRENT_PROJECT_VERSION = \([^;]*\);/\1/p' ios/App/App.xcodeproj/project.pbxproj | head -1 | tr -d '[:space:]')}"
export VITE_GIT_COMMIT="$(git rev-parse --short=12 HEAD)"
export VITE_BUNDLE_DIAGNOSTIC="${VITE_BUNDLE_DIAGNOSTIC:-0}"
echo "[ci_post_clone] bundle fingerprint: build=${VITE_APP_BUILD_NUMBER} commit=${VITE_GIT_COMMIT} diagnostic=${VITE_BUNDLE_DIAGNOSTIC}"

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
