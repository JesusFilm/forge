#!/usr/bin/env bash
# EAS on-success hook (runs in apps/mobile on the build worker, after the archive).
# Uploads iOS dSYMs (native crash stacks) + the RN/Hermes JS source map (JS error
# stacks) to Datadog, for BOTH iOS and Android (mobile ships both first-class).
#
# A non-zero exit here FAILS THE WHOLE BUILD (verified in eas-cli source), so:
#   - no DATADOG_API_KEY -> exit 0 (keyless builds pass through untouched)
#   - every upload error is swallowed (never fails a good build)
#   - never enable `set -x` around the key; datadog-ci output is redacted
set -uo pipefail # deliberately NOT -e

if [ -z "${DATADOG_API_KEY:-}" ]; then
  echo "[datadog] no DATADOG_API_KEY - skipping symbol upload"
  exit 0
fi

# datadog-ci reads DD_API_KEY or DATADOG_API_KEY depending on version; export both.
# DD_SITE for datadog-ci is the intake DOMAIN, not the mobile SDK enum: US1 =
# datadoghq.com (the enum "US1" resolves to sourcemap-intake.us1 -> ENOTFOUND).
export DD_API_KEY="$DATADOG_API_KEY"
export DD_SITE="${DD_SITE:-datadoghq.com}"
redact() { sed "s|$DATADOG_API_KEY|[REDACTED]|g"; }

# No metro debug_id, so RUM matches a JS error to its source map by
# service+version+bundle_name+platform -- release-version MUST equal the SDK's
# `version` tag (the short SHA the pre-install hook stamps), or the map uploads
# but never symbolicates. Default-first before slicing: a bare ${VAR:0:7} on an
# unset var exits non-zero under `set -u` and fails the whole build.
dd_version="${EAS_BUILD_GIT_COMMIT_HASH:-}"
dd_version="${dd_version:0:7}"

# Uploads the RN/Hermes JS source map for one platform. $1=ios|android,
# $2=bundle basename. Best-effort; every failure is non-fatal.
upload_rn_sourcemap() {
  platform="$1"
  bundle_name="$2"
  if [ -z "$dd_version" ]; then
    echo "[datadog] no git SHA - skipping $platform RN source map"
    return 0
  fi
  sm="$(mktemp -d)"
  if npx expo export:embed --platform "$platform" --dev false \
    --bundle-output "$sm/$bundle_name" \
    --sourcemap-output "$sm/$bundle_name.map" 2>&1 | redact; then
    if pnpm dlx @datadog/datadog-ci@5.8.0 react-native upload \
      --platform "$platform" --service forge-mobile \
      --bundle "$sm/$bundle_name" --sourcemap "$sm/$bundle_name.map" \
      --release-version "$dd_version" \
      --build-version "${EAS_BUILD_ID:-$dd_version}" 2>&1 | redact; then
      echo "[datadog] $platform RN source map uploaded (version=$dd_version)"
    else
      echo "[datadog] $platform RN source map upload failed (non-fatal)"
    fi
  else
    echo "[datadog] $platform RN re-export failed (non-fatal); source map not uploaded"
  fi
  rm -rf "$sm"
}

case "${EAS_BUILD_PLATFORM:-ios}" in
ios)
  # dSYMs match native crashes by UUID (no version needed). ios/build is gym output.
  if pnpm dlx @datadog/datadog-ci@5.8.0 dsyms upload ios/build 2>&1 | redact; then
    echo "[datadog] dSYMs uploaded"
  else
    echo "[datadog] dSYM upload failed (non-fatal)"
  fi
  upload_rn_sourcemap ios main.jsbundle
  ;;
android)
  # Android has no dSYMs; the JS/Hermes source map is the primary symbolication
  # surface for RN errors. (Native NDK mapping via android/app/build/outputs is a
  # separate, later concern — most crashes here are JS.)
  upload_rn_sourcemap android index.android.bundle
  ;;
esac
exit 0
