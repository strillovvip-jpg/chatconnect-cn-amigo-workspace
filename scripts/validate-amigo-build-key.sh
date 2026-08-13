#!/bin/sh
set -eu

if [ "${CONFIGURATION:-}" != "Release" ]; then
  exit 0
fi

KEY="${AMIGO_API_KEY:-}"
if [ "${#KEY}" -ne 72 ] || \
   ! printf '%s' "$KEY" | LC_ALL=C grep -Eq '^ak_live_[0-9A-Fa-f]{64}$'; then
  echo "error: Release archive requires the AMIGO_API_KEY Secret; the value is missing or malformed." >&2
  exit 1
fi

echo "[amigo-key] Release secret is available to the native target (value is hidden)"
