---
title: Restore Expo patch compatibility for repository CI
type: chore
status: completed
date: 2026-09-16
roadmap: feat-510
---

# Restore Expo patch compatibility for repository CI

The Web reliability patch is merged as #2311, but the existing Expo compatibility
failure blocks successful repository CI. It reproduces unchanged on an earlier
main checkout. Repair the dependency baseline in a separate maintenance PR.

1. Run `expo install expo expo-build-properties --pnpm` from `apps/mobile`.
   Inspect the two dependency ranges and all generated lockfile changes. Retain
   React, React Native, SDK 57, existing patches, overrides and unrelated versions.
   Investigate rather than automatically accepting additional required upgrades.
2. Run `expo install --check`, the CI-pinned Expo Doctor, frozen install, Mobile
   tests, types, lint and build. Produce non-published iOS and Android exports to
   disposable directories. No new implementation-mirroring tests are needed.
3. Review package and lockfile scope, format the documentation, and require green
   GitHub CI before normal PR/main merge. Observe the automatic Web rollout and
   validate the deployed Redis patch plus normal production playback.

This changes the build dependency baseline only. It adds no Mobile or TV
recommendation surface and publishes no native build or EAS update. The homepage
block remains removed and its LaunchDarkly flag stays default off.

## Release result

PR #2312 passed all 98 PR checks and merged as
`0a1c585998a6dbb4bf1399fe4c5eed25310a5512`. Main CI and CodeQL passed. The normal
Web deployment reached SUCCESS at 23:43:15 UTC on September 15; installed patch
verification and the production playback smoke passed. Details are recorded in
`docs/operations/watch-runtime-followup-2026-09-16.md`.
