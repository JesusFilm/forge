#!/usr/bin/env bash
# Create the feat-240 fleet-ceiling Datadog log monitors (M1/M2/M3) from the
# committed JSON payloads. POST always creates NEW monitors — running twice makes
# duplicates (see README.md to list/delete). Needs DD_API_KEY + DD_APP_KEY.
set -euo pipefail

: "${DD_API_KEY:?set DD_API_KEY (Forge-production API key)}"
: "${DD_APP_KEY:?set DD_APP_KEY (a Datadog application key)}"
DD_SITE="${DD_SITE:-datadoghq.com}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
files=(m1-exceeded m2-missing-key-id m3-near)

# Preflight: fail fast if any payload is malformed JSON.
if command -v jq >/dev/null 2>&1; then
  for f in "${files[@]}"; do
    jq empty "$here/$f.json" || { echo "invalid JSON: $f.json" >&2; exit 1; }
  done
fi

rc=0
for f in "${files[@]}"; do
  echo "→ creating from $f.json"
  # Keys ride a curl config on a process-substitution FD, never argv: printf is a shell
  # builtin, so the key values never surface in `ps`/proc cmdline the way -H "...$KEY" would.
  resp="$(curl -sS -X POST "https://api.${DD_SITE}/api/v1/monitor" \
    -H "Content-Type: application/json" \
    --data-binary @"$here/$f.json" \
    -K <(printf 'header = "DD-API-KEY: %s"\nheader = "DD-APPLICATION-KEY: %s"\n' "$DD_API_KEY" "$DD_APP_KEY"))"
  # curl -sS exits 0 even on 4xx/5xx, so detect a rejected create by the ABSENCE of .id
  # (Datadog returns {id,...} on success, {errors:[...]} on failure) and fail the run.
  if command -v jq >/dev/null 2>&1; then
    if id="$(printf '%s' "$resp" | jq -re '.id')" && [ -n "$id" ]; then
      printf '%s' "$resp" | jq '{id, name}'
    else
      echo "  x create FAILED for $f.json:" >&2
      printf '%s\n' "$resp" >&2
      rc=1
    fi
  else
    printf '%s\n' "$resp"
  fi
done
exit "$rc"
