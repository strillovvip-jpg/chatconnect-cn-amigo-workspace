#!/bin/sh
set -eu

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
cd "$REPO_ROOT"

echo "[ci_post_clone] repository: $REPO_ROOT"
xcodebuild -version

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

echo "[ci_post_clone] resolving Swift packages"
xcodebuild -resolvePackageDependencies \
  -workspace ios/App/App.xcworkspace \
  -scheme App

echo "[ci_post_clone] done"
