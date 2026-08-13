#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
OUTPUT_PATH="${1:-$REPO_ROOT/ios/App/App/Config/AmigoSecrets.generated.xcconfig}"
KEY="${AMIGO_API_KEY:-}"

if [ -z "$KEY" ]; then
  echo "[amigo-key] required Secret AMIGO_API_KEY is not configured" >&2
  exit 1
fi

if [ "${#KEY}" -ne 72 ] || \
   ! printf '%s' "$KEY" | LC_ALL=C grep -Eq '^ak_live_[0-9A-Fa-f]{64}$'; then
  echo "[amigo-key] production key has an invalid format (value is hidden)" >&2
  exit 1
fi

umask 077
mkdir -p "$(dirname -- "$OUTPUT_PATH")"
TEMP_PATH="$(mktemp "${OUTPUT_PATH}.tmp.XXXXXX")"
trap 'rm -f "$TEMP_PATH"' EXIT HUP INT TERM
printf 'AMIGO_API_KEY = %s\n' "$KEY" > "$TEMP_PATH"
chmod 600 "$TEMP_PATH"
mv -f "$TEMP_PATH" "$OUTPUT_PATH"
trap - EXIT HUP INT TERM

echo "[amigo-key] generated private native build configuration (value is hidden)"
