---
id: "feat-402"
title: "Mobile Expo SDK 57 patch alignment"
owner: "edmonday"
priority: "P0"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "mobile"
  - "infrastructure"
---

## Problem

Expo Doctor now reports nine SDK 57 patch mismatches on `main`. Affected CI
runs Mobile validation for lockfile changes, so this registry drift blocks
otherwise unrelated PRs such as the isolated Better Auth upgrade in feat-401.

## Entry Points — Read These First

1. `docs/plans/2026-08-21-001-chore-mobile-expo-sdk57-patch-alignment-plan.md`
   — the exact nine-package scope, stop conditions, and verification contract.
2. `apps/mobile/package.json` — the SDK 57 dependency pins and Mobile scripts.
3. `pnpm-lock.yaml` — the generated workspace lockfile; do not hand-edit it.
4. `.github/workflows/ci.yml` — the canonical Expo Doctor invocation and
   affected-package gates.

## Grep These

- `expo-doctor@1.20.1` — the exact CI validation command.
- `@expo/metro-runtime` — the first of the nine aligned packages.
- `expo-updates` — the last of the nine aligned packages.

## What To Build

- Run Expo's supported install workflow from `apps/mobile` with exactly these
  packages: `@expo/metro-runtime`, `expo`, `expo-build-properties`,
  `expo-constants`, `expo-dev-client`, `expo-file-system`, `expo-linking`,
  `expo-router`, and `expo-updates`.
- Commit only the resulting patch-level manifest and lockfile changes plus this
  roadmap bookkeeping.
- Merge the focused Mobile PR through the normal PR-to-main path, then update
  feat-401 PR #1978 from `main` and verify its complete CI suite is green.

## Constraints

- Stay on Expo SDK 57; do not update React, React Native, Better Auth, or any
  package outside the named nine.
- Do not weaken or exclude Expo Doctor.
- Do not include feat-401 content changes in the Mobile PR.
- Do not deploy directly or merge PR #1978.

## Verification

```bash
pnpm install --frozen-lockfile
cd apps/mobile && npx expo-doctor@1.20.1
pnpm --filter @forge/mobile test
pnpm --filter @forge/mobile lint
pnpm --filter @forge/mobile typecheck
pnpm --filter @forge/mobile build
```

Also run non-deploying `EXPO_NO_DOTENV=1 expo export` checks for `--platform
ios` and `--platform android` into disposable directories outside the
repository, and require green GitHub checks before merging the Mobile PR.
