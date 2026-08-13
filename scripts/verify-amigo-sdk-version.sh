#!/bin/sh
set -eu

release_file="ios/App/CapApp-SPM/Vendor/AMIGO_SDK_RELEASE"
framework="ios/App/CapApp-SPM/Vendor/AmigoFaceSwapSDK.xcframework/ios-arm64/AmigoFaceSwapSDK.framework/Info.plist"

if [ ! -f "$release_file" ] || ! grep -qx 'release=v1.0.2' "$release_file" || \
   ! grep -qx 'checksum=13cc7fe8bb00221298dc8ae478aa64a7a138d327f655731709145fb246a9261b' "$release_file"; then
  echo "Expected official Amigo download release v1.0.2 marker" >&2
  exit 1
fi

version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$framework")
echo "Official Amigo release v1.0.2 verified (framework metadata: $version)"
