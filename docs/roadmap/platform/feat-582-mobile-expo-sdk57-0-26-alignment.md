---
id: "feat-582"
title: "Align mobile Expo dependencies with the SDK 57.0.26 patch set"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-09-30"
duration: 1
depends_on: []
blocks: []
tags:
  - "mobile"
  - "infrastructure"
---

## Problem

The `expo-doctor` CI job fails at `npx expo install --check` on every pull
request that touches `apps/mobile`. Expo published `expo` 57.0.26,
`expo-constants` 57.0.20, `expo-router` 57.0.24, and `expo-updates` 57.0.24 on
2026-09-29 at about 10:57 UTC. The check compares the installed packages with
the versions that the Expo API expects today, so the same tree that passed
before that time now fails. The failure is on clean `main` too. PR #2466 was
the first mobile pull request to show it. After #2466 merged on 2026-09-30, the
`main` push run failed the same job, so `ci-gate` is red on `main`.

## Entry Points — Read These First

1. `apps/mobile/package.json` — the four Expo dependency ranges that CI reports.
2. `pnpm-lock.yaml` — the lockfile that pnpm writes for the new ranges.
3. `.github/workflows/ci.yml` — the `expo-doctor` job: the version check step,
   then the isolated `expo-doctor@1.20.1` step.
4. `docs/solutions/build-errors/expo-doctor-affected-gated-live-registry-drift-20260817.md`
   — the diagnosis and the recurrence record for this failure.

## Grep These

- `npx expo install --check`
- `expo-doctor@1.20.1`
- `"expo": "~57.0`

## What To Build

Run Expo's named-package installer from `apps/mobile`:

```bash
npx expo install expo expo-constants expo-router expo-updates --pnpm
```

Commit the four new ranges and the regenerated lockfile. Do not change any
other file.

## Constraints

- Stay on Expo SDK 57. Keep React and React Native at their current versions.
- Keep the version check and the Expo Doctor step as CI gates. Do not use
  `expo.install.exclude`.
- Do not change application source, native configuration, or deployment
  settings.
- The bump changes native module versions (`expo`, `expo-constants`,
  `expo-router`, `expo-updates`, and the transitive `expo-modules-core`). Ship
  a native build before the next `eas update` targets installed builds.

## Verification

From `apps/mobile`, run `npx expo install --check`. Then run the CI isolation
procedure: `pnpm --filter @forge/mobile deploy --prod <temp>`, then
`EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK=1 npx expo-doctor@1.20.1` in that
folder. Run `pnpm install --frozen-lockfile` from the repository root, then
mobile lint, typecheck, and Jest. Require green PR CI before merge.

## Results

Before the change, clean `main` failed `npx expo install --check` with the four
packages above, and `EXPO_OFFLINE=1 npx expo install --check` passed. That
split shows that the drift is upstream. After the change, six resolved versions
moved: the four direct packages, `expo-modules-core` 57.0.19 to 57.0.20, and
`@expo/ui` 57.0.20 to 57.0.21. The version check passes, the isolated Expo
Doctor passes 19 of 19 checks, and a frozen install leaves the lockfile
unchanged.
