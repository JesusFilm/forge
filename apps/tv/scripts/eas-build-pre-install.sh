#!/usr/bin/env bash
# EAS pre-install hook (runs in apps/tv on the build worker, before install).
# Stamps a per-build version from the git SHA so RUM sessions and the symbol
# upload share one build identity. Local builds have no EAS_BUILD_GIT_COMMIT_HASH
# -> the var stays unset -> the SDK falls back to the bundle version, and the RUM
# null-gate is untouched.
# NOT set -e: the version stamp is cosmetic (optional end-to-end per env.ts) and a
# non-zero exit from an EAS hook fails the whole build, so a .env.local write hiccup
# must degrade to an untagged build, not abort the pipeline (matches on-success).
set -uo pipefail

if [ -n "${EAS_BUILD_GIT_COMMIT_HASH:-}" ]; then
  short_sha="${EAS_BUILD_GIT_COMMIT_HASH:0:7}"
  # .env.local is read by the Expo bundler; EXPO_PUBLIC_* is inlined into the app.
  if printf '\nEXPO_PUBLIC_DATADOG_VERSION=%s\n' "$short_sha" >>.env.local; then
    echo "[datadog] stamped EXPO_PUBLIC_DATADOG_VERSION=$short_sha"
  else
    echo "[datadog] version stamp failed (non-fatal); build continues untagged"
  fi
fi
exit 0
