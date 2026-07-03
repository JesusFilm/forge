#!/usr/bin/env bash
# EAS on-success hook (runs in apps/tv on the build worker, after the archive).
# Uploads iOS/tvOS dSYMs to Datadog so native crash stacks symbolicate.
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
export DD_API_KEY="$DATADOG_API_KEY"
export DD_SITE="${DD_SITE:-US1}"
redact() { sed "s|$DATADOG_API_KEY|[REDACTED]|g"; }

case "${EAS_BUILD_PLATFORM:-ios}" in
ios)
  # dSYMs match crashes by UUID (no version needed). ios/build is the gym output.
  pnpm dlx @datadog/datadog-ci@5.8.0 dsyms upload ios/build 2>&1 | redact ||
    echo "[datadog] dSYM upload failed (non-fatal)"
  # RN/Hermes source map (KTD-4, staged): a plain EAS build does not retain the
  # composed map. The first real keyed build confirms whether SOURCEMAP_FILE or a
  # re-export produces it and at what path; wire `datadog-ci react-native upload
  # --platform ios --service forge-tv --release-version $EXPO_PUBLIC_DATADOG_VERSION
  # --bundle <b> --sourcemap <m>` then. dSYMs already symbolicate native crashes.
  echo "[datadog] dSYMs uploaded; RN source map upload staged (KTD-4)"
  ;;
android)
  # Android mapping + RN source map upload mirrors the iOS branch; deferred and
  # unverified this effort (see the plan's Scope Boundaries).
  echo "[datadog] android symbol upload staged (deferred)"
  ;;
esac
exit 0
