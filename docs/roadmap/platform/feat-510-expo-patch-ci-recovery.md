---
id: "feat-510"
title: "Restore Expo compatibility checks after patch drift"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-16"
duration: 1
depends_on: []
blocks: []
tags: [mobile, infrastructure]
---

## Problem

PR #2311's full repository CI exposes existing Expo patch drift: `expo`
57.0.22 must be 57.0.23 and `expo-build-properties` 57.0.17 must be 57.0.19.
The identical check fails in untouched, previously merged commit d9dce17.
The Web Railway trigger has `checkSuites: true`, so this unrelated failure
prevents the normal rollout of the reviewed Redis cleanup fix.

## Entry points

- `apps/mobile/package.json` — only the two reported dependency ranges.
- `pnpm-lock.yaml` — regenerate through the package manager and inspect drift.
- `.github/workflows/ci.yml` — `expo-doctor` and `ci-gate`; preserve both.
- `docs/roadmap/platform/feat-402-mobile-expo-sdk57-patch-alignment.md` — prior
  instance of the same registry-driven compatibility drift.
- `docs/plans/2026-09-16-002-chore-expo-patch-ci-recovery-plan.md` — scope and checks.

## Work and constraints

Use Expo's supported installer with exactly `expo` and `expo-build-properties`.
Stay on SDK 57 with the same React and React Native versions. Review required
transitive changes; do not include unrelated dependency upgrades, UI changes,
native source regeneration, EAS publication, or weaker CI checks.

## Verification

Run frozen install, Expo install compatibility check, the pinned CI Expo Doctor,
Mobile tests/types/lint/build, and local iOS/Android exports outside the repo.
Require green PR CI, merge through normal GitHub flow, and observe Web's automatic
deployment with the Redis patch installed. feat-496 remains open for its separate
unresolved production timeout investigation.

Local validation passes frozen install, the standalone version check, all 19
isolated Doctor checks, 3,639 tests in 227 suites with the normal worker runner,
types, lint, and disposable iOS/Android exports. Serial Jest reports late `act`
warnings from `useAutostartPlayback`; the unchanged test reproduces those warnings
on the earlier main checkout too. No application source was changed to conceal
that existing teardown issue.

PR #2312 passed all 98 PR checks and merged as
`0a1c585998a6dbb4bf1399fe4c5eed25310a5512`. Main CI and CodeQL passed; Web's normal
deployment `43a75813-bcca-4381-8454-d43099079b51` reached SUCCESS at 23:43:15 UTC on
September 15. SSH confirmed the Redis cleanup patch in both installed exports,
and the production playback smoke passed. See
`docs/operations/watch-runtime-followup-2026-09-16.md` for evidence and limits.
