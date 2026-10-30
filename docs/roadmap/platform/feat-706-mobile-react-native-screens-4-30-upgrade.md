---
id: "feat-706"
title: "Upgrade react-native-screens to 4.30 or later for the iOS 26 search tab"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-11-02"
duration: 3
depends_on:
  - "feat-705"
blocks: []
tags:
  - "mobile"
---

## Problem

feat-705 built the iOS 26 search tab on `react-native-screens` 4.26.2. That version has three known gaps:

- `react-native-screens` issue #4671 says that a build with Xcode 27 may draw the search tab as a labelled tab in the main bar. Nobody has reproduced it in this app.
- The native search field cannot turn autocorrect off. Discover's own field turned it off. The owner accepted the change on 2026-10-15, until this upgrade.
- `allowToolbarIntegration` set to `stacked` or `false` gives an empty capsule, so Discover keeps the default.

Do the upgrade when the app moves to Xcode 27, or earlier if the first TestFlight build shows the labelled tab.

## Entry Points — Read These First

1. `apps/mobile/app/(tabs)/watch/index.tsx` — the `Stack.SearchBar` options and the uncontrolled field.
2. `apps/mobile/app/(tabs)/watch/_layout.ios.tsx` — the iOS `Stack` and its header options.
3. `apps/mobile/app/(tabs)/_layout.ios.tsx` — the `role="search"` trigger.
4. `apps/mobile/CLAUDE.md`, section "Liquid Glass (feat-705)" — the search tab bullet.
5. `docs/plans/2026-10-15-1036-feat-mobile-native-liquid-glass-plan.md` — KTD9 and the Risks table.

## Grep These

- `Stack.SearchBar|role=\{|systemItem` in `apps/mobile/app/`
- `react-native-screens` in `apps/mobile/package.json` and the root `pnpm-lock.yaml`
- `autoCapitalize|autoCorrect` in `apps/mobile/app/(tabs)/watch/index.tsx`

## What To Build

1. Upgrade `react-native-screens` to 4.30 or later with the Expo SDK that supports it. Keep `expo-router` in step.
2. Turn autocorrect off on the native search field if the new version has the option.
3. Check `placement` and `allowToolbarIntegration` again on iOS 26 and on an iPad.
4. If the first TestFlight build shows the labelled tab, pin the EAS build image to Xcode 26 until this ticket ships.

## Constraints

- The upgrade is native, so it moves the fingerprint runtime version. A native build must ship before the next `eas update`.
- Keep the Android and iOS before 26 Discover screen as it is.
- Keep Discover's RUM view name `(tabs)/watch` (`app/__tests__/discoverRoute.test.tsx`).

## Verification

- `pnpm --filter @forge/mobile test`, `pnpm --filter @forge/mobile typecheck` and `pnpm --filter @forge/mobile lint` pass.
- On the iOS 26 simulator and on a physical iPhone: the search tab is a separate circle with no label, the field sits at the bottom, and typing gives no autocorrect suggestion.
- On an iPad simulator: record where the field sits.
