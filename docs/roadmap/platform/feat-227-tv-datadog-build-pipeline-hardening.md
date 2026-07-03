---
id: "feat-227"
title: "TV Datadog build pipeline: symbol upload CI and patch maintenance guards"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-07-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "tv"
  - "infrastructure"
  - "observability"
---

> **Scope note (2026-07-03):** the secret-gated symbol upload and the patch-pin CI guard proceed now; upstreaming the tvOS patch to `DataDog/dd-sdk-reactnative` is deferred by user decision. The patch stays a local carry, protected by the new guard.

## Problem

Two deliberate deferrals from PR #1434 need durable homes. (1) The `expo-datadog` config plugin was excluded (its dSYM-upload build phase hard-fails keyless builds and its datadog-ci path resolution breaks under pnpm), so native crash stacks arrive in Datadog unsymbolicated until a secret-gated upload step exists. (2) The tvOS fix lives in a pnpm patch keyed to `@datadog/mobile-react-native@3.5.2` — pnpm only WARNS when the key stops matching after a version bump, so the tvOS build breakage would silently return at the next native build, disconnected from the bump commit. The patch should also be upstreamed so it eventually becomes deletable.

## Entry Points — Read These First

1. `docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md` — the full patch story, plugin-exclusion rationale, and pnpm warn-only behavior.
2. `patches/@datadog__mobile-react-native@3.5.2.patch` — the two guards (stray Swift import removal; `#if TARGET_OS_IOS` around the RCT export).
3. Root `package.json` — `pnpm.patchedDependencies` (two entries: react-native-tvos + datadog).
4. `apps/web/package.json` — the `datadog:sourcemaps` script: the repo's secret-gated upload pattern to mirror.
5. `.github/workflows/ci.yml` — where a patch-pin guard job would live.
6. `apps/tv/eas.json` — EAS build profiles; EAS build hooks (`eas-build-on-success` npm script) are the natural place for post-build uploads.

## Grep These

- `patchedDependencies`
- `datadog:sourcemaps`
- `DATADOG_API_KEY`
- `dsyms`
- `eas-build-on-success`

## What To Build

1. **Secret-gated symbol upload**: an EAS post-build hook (`eas-build-on-success` script in `apps/tv/package.json`) or CI job that runs `pnpm dlx @datadog/datadog-ci dsyms upload` (iOS) and the RN source-map upload for `service:forge-tv`, ONLY when `DATADOG_API_KEY` is present (EAS secret — never `EXPO_PUBLIC_*`). No-key builds must skip silently and succeed — that is the entire reason the plugin was excluded. Version-tag uploads to match `EXPO_PUBLIC_DATADOG_VERSION`.
2. **Patch-pin CI guard**: a small script (new CI step) that fails when the installed version of any package in `pnpm.patchedDependencies` no longer matches its key — covers both the datadog patch and the pre-existing react-native-tvos patch. Failing fast at the version-bump commit beats a silent tvOS break at the next native build.
3. **Upstream the fix**: file an issue + PR against `DataDog/dd-sdk-reactnative` contributing the two guards (strong precedent: they accepted the equivalent tvOS fix in v2.13.1 via PR #1034). Record the links in the solution doc; when a release includes the fix, the patch entry gets deleted on the next SDK bump.

## Constraints

- Symbol upload must never become a mandatory build phase for keyless/local builds.
- Do NOT reintroduce the `expo-datadog` plugin to get uploads — the standalone `datadog-ci` invocation is the pattern.
- The CI guard must be advisory-free: hard fail on mismatch, zero output changes when aligned.

## Verification

- A build with `DATADOG_API_KEY` set uploads dSYMs (datadog-ci exits 0, upload visible in Datadog); a build without the key completes green with the step skipped.
- Temporarily bumping `@datadog/mobile-react-native` in a scratch branch turns the CI guard red; reverting turns it green.
- Upstream issue/PR URLs recorded in `docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md`.
