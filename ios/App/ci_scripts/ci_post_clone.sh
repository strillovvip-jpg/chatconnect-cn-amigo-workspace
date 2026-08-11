#!/bin/sh
set -eu

# Xcode Cloud resolves custom scripts beside App.xcworkspace. Keep the build
# implementation at the repository root so local and cloud builds share one path.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
exec "$REPO_ROOT/ci_scripts/ci_post_clone.sh"
