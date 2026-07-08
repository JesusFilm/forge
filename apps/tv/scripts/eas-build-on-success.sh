#!/usr/bin/env bash
# EAS on-success hook (runs in apps/tv on the build worker, after the archive).
# Uploads iOS/tvOS dSYMs (native crash stacks) + the RN/Hermes JS source map
# (JS error stacks) to Datadog.
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

case "${EAS_BUILD_PLATFORM:-ios}" in
ios)
  # dSYMs match crashes by UUID (no version needed). ios/build is the gym output.
  if pnpm dlx @datadog/datadog-ci@5.8.0 dsyms upload ios/build 2>&1 | redact; then
    echo "[datadog] dSYMs uploaded"
  else
    echo "[datadog] dSYM upload failed (non-fatal)"
  fi

  # RN/Hermes JS source map (KTD-4): no metro debug_id, so RUM matches by
  # service+version+bundle_name+platform -- release-version MUST equal the SDK's
  # version tag (the short SHA the pre-install hook stamps; unset in this shell).
  dd_version="${EAS_BUILD_GIT_COMMIT_HASH:-}" # :- avoids a set -u exit (bare ${VAR:0:7} on unset) that fails the build
  dd_version="${dd_version:0:7}"
  if [ -n "$dd_version" ]; then
    sm="$(mktemp -d)"
    if npx expo export:embed --platform ios --dev false \
        --bundle-output "$sm/main.jsbundle" \
        --sourcemap-output "$sm/main.jsbundle.map" 2>&1 | redact; then
      if pnpm dlx @datadog/datadog-ci@5.8.0 react-native upload \
          --platform ios --service forge-tv \
          --bundle "$sm/main.jsbundle" --sourcemap "$sm/main.jsbundle.map" \
          --release-version "$dd_version" \
          --build-version "${EAS_BUILD_ID:-$dd_version}" 2>&1 | redact; then
        echo "[datadog] RN source map uploaded (version=$dd_version)"
      else
        echo "[datadog] RN source map upload failed (non-fatal)"
      fi
    else
      echo "[datadog] RN re-export failed (non-fatal); source map not uploaded"
    fi
    rm -rf "$sm"
  else
    echo "[datadog] no git SHA - skipping RN source map"
  fi
  ;;
android)
  # Android mapping + RN source map upload mirrors the iOS branch; deferred and
  # unverified this effort (see the plan's Scope Boundaries).
  echo "[datadog] android symbol upload staged (deferred)"
  ;;
esac
exit 0
