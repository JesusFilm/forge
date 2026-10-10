---
title: "Datadog RN/Hermes source-map upload from an EAS on-success hook: DD_SITE domain vs SDK enum, version not in the hook shell, and set -u nounset"
date: "2026-07-08"
category: integration-issues
module: apps/tv
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "datadog-ci upload fails with 'getaddrinfo ENOTFOUND sourcemap-intake.us1' / 'api.US1'"
  - "'[datadog] no EXPO_PUBLIC_DATADOG_VERSION - skipping RN source map' — the upload branch never runs"
  - "Hook logs '[datadog] dSYMs uploaded' while datadog-ci printed 'Some dSYMS have not been uploaded correctly' just above it"
  - "'EAS_BUILD_GIT_COMMIT_HASH: unbound variable' -> non-zero exit -> the whole EAS build fails (bash 5.x; masked on macOS bash 3.2)"
  - "Datadog 'Explore RUM Debug Symbols' lists no source map for service:forge-tv"
root_cause: config_error
resolution_type: code_fix
related_components:
  - "apps/tv/scripts/eas-build-on-success.sh"
  - "apps/tv/scripts/eas-build-pre-install.sh"
tags:
  - "datadog"
  - "sourcemaps"
  - "eas"
  - "expo"
  - "tvos"
  - "bash"
  - "observability"
---

# Datadog RN/Hermes source-map upload from an EAS on-success hook

## Problem

Wiring the React Native / Hermes JS source-map upload into `apps/tv`'s EAS `eas-build-on-success` hook (so Datadog RUM symbolicates JS error stacks, feat-227 / KTD-4) failed in three separate, independent ways — every one of them invisible without reading a real keyed build's worker log, and one of them capable of failing the whole build.

## Symptoms

- `datadog-ci` upload fails: `getaddrinfo ENOTFOUND sourcemap-intake.us1` and `api.US1`.
- `[datadog] no EXPO_PUBLIC_DATADOG_VERSION - skipping RN source map` — the source-map branch is skipped entirely.
- The hook logs `[datadog] dSYMs uploaded` even though `datadog-ci` printed `Some dSYMS have not been uploaded correctly` immediately above (**false success**).
- On a modern bash worker, `EAS_BUILD_GIT_COMMIT_HASH: unbound variable` → non-zero exit → **the whole build fails** (masked when tested locally on macOS's default bash 3.2).
- Datadog **Explore RUM Debug Symbols** (Digital Experience → RUM app → Debug Symbols) shows no React Native source map for `service:forge-tv`.

## What Didn't Work

- **Staging it (prior state, feat-227 / #1458).** (session history) The completion work deliberately _staged_ the source-map upload with a KTD-4 note: "a plain EAS build does not retain the composed map — the first real keyed build confirms whether `SOURCEMAP_FILE`..." dSYMs alone symbolicate native crashes, so the JS map was deferred until a keyed build could reveal the composed-map path. This session was that first keyed build.
- **The `expo-datadog` config plugin** (the "official" debug_id path) was excluded and stayed excluded: it hard-fails without `DATADOG_API_KEY` even in Debug builds, and its `datadog-ci` path resolution assumes a hoisted, non-pnpm `node_modules` layout. Re-adopting it would reintroduce both failure modes.
- **First wiring pass copied env values from the working dSYM path.** It reused `DD_SITE=US1` (the mobile-SDK enum already set for dSYMs) and `--release-version "$EXPO_PUBLIC_DATADOG_VERSION"` (the env var). Both are wrong in this context and failed _silently_ (non-fatal, swallowed) — the build stayed green while nothing uploaded.
- **Testing the nounset fix locally didn't reproduce the crash.** macOS's default bash 3.2 returns empty for `${unset_var:0:7}` instead of raising `unbound variable`, so the build-failing behavior only appears on the Linux/bash-5.x EAS worker.

## Solution

Four changes to `apps/tv/scripts/eas-build-on-success.sh` (the re-export path is the KTD-4 fallback; the primary `SOURCEMAP_FILE` path is a deferred optimization):

**1. `DD_SITE` is the intake DOMAIN, not the mobile SDK site enum.**

```bash
# before (breaks datadog-ci: sourcemap-intake.us1 -> ENOTFOUND)
export DD_SITE="${DD_SITE:-US1}"
# after
export DD_SITE="${DD_SITE:-datadoghq.com}"   # US1 site == datadoghq.com domain
```

This also un-broke the pre-existing **dSYM upload**, which had been silently failing for the same reason.

**2. Derive the version from the EAS git-SHA env, not `EXPO_PUBLIC_DATADOG_VERSION`.**

```bash
# The pre-install hook writes EXPO_PUBLIC_DATADOG_VERSION into .env.local for the
# BUNDLER to inline; the on-success SHELL does not source .env.local, so it is unset here.
dd_version="${EAS_BUILD_GIT_COMMIT_HASH:-}"   # :- FIRST (see #3)
dd_version="${dd_version:0:7}"                 # same short SHA the pre-install hook stamps
```

**3. Default the var before slicing (under `set -u`).**

```bash
# before — bare substring on an unset var trips nounset and exits non-zero:
dd_version="${EAS_BUILD_GIT_COMMIT_HASH:0:7}"   # unbound variable -> build fails
# after — provide a default first, then let the existing [ -n ] guard skip gracefully:
dd_version="${EAS_BUILD_GIT_COMMIT_HASH:-}"; dd_version="${dd_version:0:7}"
```

**4. Re-export + upload, keyed to the SDK's version tag.**

```bash
sm="$(mktemp -d)"
npx expo export:embed --platform ios --dev false \
  --bundle-output "$sm/main.jsbundle" --sourcemap-output "$sm/main.jsbundle.map"
pnpm dlx @datadog/datadog-ci@5.8.0 react-native upload \
  --platform ios --service forge-tv \
  --bundle "$sm/main.jsbundle" --sourcemap "$sm/main.jsbundle.map" \
  --release-version "$dd_version" \
  --build-version "${EAS_BUILD_ID:-$dd_version}"
```

Verified on a real production build (log: `✅ Uploaded 1 sourcemap ... version: 96b7c9c service: forge-tv`, plus `✅ Uploaded 1 dSYM`).

## Why This Works

- **DD_SITE.** `datadog-ci` builds its intake hostname from `DD_SITE` as a domain: `sourcemap-intake.<DD_SITE>`, `api.<DD_SITE>`. `US1` is the **mobile SDK's site enum**; the same site's **domain** is `datadoghq.com`. They are two different strings for the same region, and only the domain resolves.
- **Version scope.** `EXPO_PUBLIC_DATADOG_VERSION` lives in `.env.local` (written by the `eas-build-pre-install` hook) purely so the Metro bundler inlines it into the app. The `eas-build-on-success` shell is a separate process that never sources `.env.local`, so the variable is unset in it. `EAS_BUILD_GIT_COMMIT_HASH` is the EAS-provided source the pre-install hook itself slices, so deriving from it yields the exact `version` the RUM SDK reports.
- **nounset.** Substring expansion `${VAR:0:7}` is not one of bash's nounset-safe forms (`${VAR:-}`, `${VAR:+}`, ...). Under `set -u` on bash ≥ 4.4, referencing an unset var this way prints `unbound variable` and exits non-zero — independent of `set -e`. Because this hook's non-zero exit fails the whole build, the defensive `[ -n "$dd_version" ]` guard beneath it becomes dead code. macOS's bash 3.2 returns empty instead, hiding the bug locally.
- **Matching.** With no metro `debug_id` in the bundle (the "Debug ID not found" SDK warning), Datadog matches a JS error to its source map by `service + version + bundle_name + platform`. So `--release-version` MUST equal the RUM SDK's `version` tag — not `MARKETING_VERSION`. Since this app overrides the SDK version to the git SHA, the upload must use the same SHA or maps upload but silently fail to symbolicate.

## Prevention

- **`DD_SITE` for any `datadog-ci` call is the intake domain** (`datadoghq.com` for US1, `datadoghq.eu`, `us5.datadoghq.com`, ...), never the mobile-SDK site enum (`US1`, `EU1`). Different value space for the same region.
- **EAS hook env boundary:** an `eas-build-on-success` (or `on-error`) shell does NOT inherit `.env.local`. Read build identity from EAS-provided vars (`EAS_BUILD_GIT_COMMIT_HASH`, `EAS_BUILD_ID`), and make it the _same_ value any sibling hook (`eas-build-pre-install`) stamps.
- **In `set -uo pipefail` scripts, never bare-slice a possibly-unset var:** `x="${VAR:-}"; x="${x:0:7}"`. A `bash -n` plus a nounset smoke (`bash -c 'set -u; unset VAR; ...'`) on **modern bash** would have caught this — macOS bash 3.2 masks it, so CI/local shells that differ from the worker give false confidence.
- **Verify symbol uploads at the source, not the hook's own log.** `datadog-ci`'s `dsyms upload` can exit 0 on partial failure, so an `if cmd | redact; then echo uploaded` line is unreliable. Trust `datadog-ci`'s own `✅ Uploaded N ...` line and Datadog's **Explore RUM Debug Symbols** (filter by service + version) — its dropdowns need a typed search term and lag ~5 min after upload.
- **`--release-version` must equal the RUM SDK's reported `version`.** When you override the SDK version (git SHA here), thread the exact same value through the upload, or symbolication silently no-ops.

## Related

- `docs/solutions/best-practices/datadog-tvos-observability-pipeline-qoe-and-guardrails.md` — the feat-227/#1458 completion doc; it describes this same hook while the source-map upload was still _staged_ (now stale — refresh candidate).
- `docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md` — the tvOS SDK pnpm-patch integration and why the `expo-datadog` plugin is excluded.
