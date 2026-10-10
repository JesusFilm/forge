---
id: "feat-524"
title: "Align Mobile Expo SDK 57.0.24 patches"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-09-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "mobile"
  - "infrastructure"
---

## Problem

Expo's SDK 57 compatibility metadata now expects the 57.0.24 package set, so
the CI-equivalent `npx expo install --check` fails on clean `main` and blocks
otherwise unrelated pull requests.

## Entry Points — Read These First

1. `apps/mobile/package.json` — the seven Expo dependency ranges reported by
   the compatibility check.
2. `pnpm-lock.yaml` — regenerate only through the repository package manager.
3. `.github/workflows/ci.yml` — the canonical install and Doctor checks.

## Grep These

- `npx expo install --check`
- `expo-doctor@1.20.1`
- `expo-updates`

## What To Build

- Use Expo's supported installer to align exactly `expo`,
  `@expo/metro-runtime`, `expo-build-properties`, `expo-constants`,
  `expo-notifications`, `expo-router`, and `expo-updates` with SDK 57.0.24.
- Regenerate the workspace lockfile through pnpm.
- Open a focused draft pull request against `main` and require terminal green
  checks before handoff.

## Constraints

- Stay on Expo SDK 57 and do not change React or React Native.
- Do not weaken dependency validation or Expo Doctor.
- Do not include RAG documentation, production configuration, deployments, or
  unrelated package updates.

## Verification

```bash
pnpm install --frozen-lockfile
cd apps/mobile && npx expo install --check
cd apps/mobile && npx expo-doctor@1.20.1
pnpm --filter @forge/mobile test
pnpm --filter @forge/mobile lint
pnpm --filter @forge/mobile typecheck
pnpm --filter @forge/mobile build
```

Also run disposable iOS and Android Expo exports outside the repository, check
formatting and lockfile stability, and monitor the draft pull request through
terminal CI.

## Results

The clean-main compatibility check failed on exactly the seven scoped packages.
After the supported Expo install, the version check reports that dependencies
are current, both the full and CI-isolated Expo Doctor runs pass, all 4,325
Mobile tests pass, and lint, typecheck, build, frozen install, formatting, plus
disposable iOS and Android exports complete successfully.
