---
id: "feat-785"
title: "Verify expo-notifications 57.0.24 Android tap handling, then release the hold"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-10-23"
duration: 2
depends_on: []
blocks: []
tags:
  - "mobile"
  - "platform"
---

## Problem

On 2026-10-22, Expo published `expo-notifications` 57.0.24. CI's
`npx expo install --check` then failed on every mobile PR. PR #2867 bumped
`expo`, `expo-network`, and `expo-router`, but it held `expo-notifications`
at 57.0.23.

57.0.24 changes Android tap delivery. It is the change from Expo PR #47615.
A listener now returns whether it handled a tap. `NotificationManager` clears
the pending tap queue after a listener handles a tap. The repo's push-tap
relay (`plugins/withAndroidPushTapRelay.js`) depends on that queue. The rule
in `apps/mobile/CLAUDE.md` says that this kind of change needs a cold tap on a
release build before the pin moves.

The hold is an exact pin plus an exclusion:

- `apps/mobile/package.json` pins `"expo-notifications": "57.0.23"` (no
  tilde).
- `apps/mobile/package.json` has `expo.install.exclude: ["expo-notifications"]`,
  so `expo install --check` does not report it.

The exclusion also hides every later patch of this package. Remove it when
this ticket ends.

## Entry Points — Read These First

1. `apps/mobile/CLAUDE.md`, section "Android cold taps and the task restart":
   the tripwire rules and the device pass recipe.
2. `apps/mobile/plugins/withAndroidPushTapRelay.js`: Block A and Block B. Block B
   calls `NotificationManager.onNotificationResponseFromExtras`.
3. `apps/mobile/src/lib/__tests__/androidPushTapUpstream.guard.test.js`:
   `PINNED_VERSIONS` and the upstream facts.
4. `node_modules/.pnpm/expo-notifications@57.0.24*/node_modules/expo-notifications/android/src/main/java/expo/modules/notifications/notifications/NotificationManager.kt`
   and `.../emitting/NotificationsEmitter.kt`: the new `handled` flow.

## Grep These

- `onNotificationResponseIntentReceived`
- `pendingNotificationResponsesFromExtras`
- `expo.install.exclude`
- `PINNED_VERSIONS`

## What To Build

1. Set `"expo-notifications": "~57.0.24"` in `apps/mobile/package.json`.
   Remove `expo-notifications` from `expo.install.exclude`. If the list is
   empty, remove the `install` key.
2. Run `pnpm install` from the repo root.
3. Build a release APK. The recipe is in the memory note on local release
   builds.
4. Run the cold-tap pass from `apps/mobile/CLAUDE.md`. Do these four checks:
   - A cold tap to a video, a series, and an experience opens the
     destination.
   - A newer cold tap wins over the tap that created the task.
   - A reopen from Recents and from the launcher does not replay an earlier
     tap.
   - Admin receives one `ReportPushOpen` for each tap.
5. If every check passes, move `expo-notifications` in `PINNED_VERSIONS` to
   57.0.24. Add a dated line to the tripwire paragraph in
   `apps/mobile/CLAUDE.md`.
6. If a check fails, keep the hold. Record the failure here and adapt the
   relay plugin.

## Constraints

- Do not move the pin on a jest run alone. Jest cannot see the native tap
  path.
- Do not use a dev client for the replay cases. The dev launcher restarts the
  task with `FLAG_ACTIVITY_CLEAR_TASK`.
- Ship the change only in a native build. It moves the fingerprint runtime
  version.

## Verification

- `cd apps/mobile && npx expo install --check` prints "Dependencies are up to
  date" with no exclusion.
- `npx jest --no-watchman src/lib/__tests__/androidPushTapUpstream.guard.test.js`
  passes.
- `adb logcat -s ForgePushTap` shows Block B's line for each cold tap, and the
  destination opens once.
