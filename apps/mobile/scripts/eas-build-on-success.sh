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
# `version` tag, or the map uploads but never symbolicates.

# Only the SHIPPED bundle is a witness of what the app reports. A re-export is a
# second bundling pass that re-reads .env.local, so it can inline a value the
# archived app never carried -- the mismatch that left prod unsymbolicated.
dd_fallback_version="$(node -e \
  "process.stdout.write(String(require('./app.json').expo.version||''))" \
  2>/dev/null || true)"

# Recovers the literal the bundler inlined for EXPO_PUBLIC_DATADOG_VERSION.
# $1 = bundle path. Empty output means "not inlined" -> caller uses the fallback.
version_from_bundle() {
  node -e '
    const fs = require("fs");
    try {
      const src = fs.readFileSync(process.argv[1], "utf8");
      const m = src.match(/EXPO_PUBLIC_DATADOG_VERSION["'"'"']?\s*[:=]\s*["'"'"']([^"'"'"']+)["'"'"']/);
      process.stdout.write(m ? m[1] : "");
    } catch { process.stdout.write(""); }
  ' "$1" 2>/dev/null || true
}

# Locates the bundle the archive actually embedded. $1=ios|android. Prints
# nothing when the build layout hides it -- the caller then degrades loudly.
shipped_bundle_path() {
  case "$1" in
  ios) find ios/build -name main.jsbundle -type f 2>/dev/null | head -n 1 ;;
  android)
    find android/app/build -name index.android.bundle -type f 2>/dev/null |
      head -n 1
    ;;
  esac
}

# Uploads the RN/Hermes JS source map for one platform. $1=ios|android,
# $2=bundle basename. Best-effort; every failure is non-fatal.
upload_rn_sourcemap() {
  platform="$1"
  bundle_name="$2"
  sm="$(mktemp -d)"
  if npx expo export:embed --platform "$platform" --dev false \
    --bundle-output "$sm/$bundle_name" \
    --sourcemap-output "$sm/$bundle_name.map" 2>&1 | redact; then
    # Prefer the archived bundle: it is what users actually run. The re-export is
    # only a fallback witness, and any disagreement between them is the silent
    # failure this whole block exists to make loud.
    reexport_version="$(version_from_bundle "$sm/$bundle_name")"
    shipped="$(shipped_bundle_path "$platform")"
    shipped_version=""
    [ -n "$shipped" ] && shipped_version="$(version_from_bundle "$shipped")"

    if [ -n "$shipped_version" ]; then
      dd_version="$shipped_version"
      version_source="shipped-bundle"
      if [ -n "$reexport_version" ] && [ "$reexport_version" != "$shipped_version" ]; then
        echo "[datadog] WARNING: $platform re-export inlined '$reexport_version'" \
          "but the shipped bundle carries '$shipped_version'; uploading under the" \
          "shipped value. The source map is built from the re-export, so line" \
          "numbers may be offset - investigate before trusting these stacks."
      fi
    elif [ -n "$reexport_version" ]; then
      dd_version="$reexport_version"
      version_source="re-export(UNVERIFIED)"
      echo "[datadog] WARNING: could not read the shipped $platform bundle;" \
        "falling back to the re-export's value, which the archived app may not carry."
    else
      dd_version="$dd_fallback_version"
      version_source="app.json(NOT INLINED)"
      echo "[datadog] WARNING: EXPO_PUBLIC_DATADOG_VERSION was not inlined into" \
        "either $platform bundle; every build will share '$dd_version'."
    fi

    if [ -z "$dd_version" ]; then
      echo "[datadog] no resolvable version - skipping $platform RN source map"
      rm -rf "$sm"
      return 0
    fi
    echo "[datadog] $platform symbol upload version=$dd_version source=$version_source"
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
