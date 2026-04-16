#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <doppler-project> <target-file>" >&2
  exit 1
fi

project="$1"
target="$2"
tmp="${target}.tmp"

cleanup() {
  rm -f "$tmp"
}

trap cleanup EXIT INT TERM
doppler secrets download --project "$project" --config dev --format env --no-file > "$tmp"
mv "$tmp" "$target"
