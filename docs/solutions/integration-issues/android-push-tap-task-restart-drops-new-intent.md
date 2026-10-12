---
title: "Android push tap after process death opens Home: the task restart sends the tap only to onNewIntent, and Expo drops it"
date: 2026-10-13
category: integration-issues
module: apps/mobile
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "A tap on a Firebase-posted push notification opens Home, not the destination, after Android stopped the app's process while the task stayed in Recents"
  - "The app sends no ReportPushOpen for that tap, so the campaign report undercounts Android opens"
  - "`Notifications.getLastNotificationResponse()` returns null after the cold start"
  - "`adb logcat -b events` shows `wm_new_intent`, then `wm_restart_activity`, and no `wm_create_activity` for MainActivity"
root_cause: async_timing
resolution_type: code_fix
framework_version: "expo 57.0.27, expo-notifications 57.0.22, expo-updates 57.0.25"
retire_when: "expo/expo#49254 is closed with a fix in a released expo-notifications version; check with `gh issue view 49254 --repo expo/expo` and compare the fix version with the pins in apps/mobile/src/lib/__tests__/androidPushTapUpstream.guard.test.js"
related_components:
  - expo-notifications
  - firebase-cloud-messaging
tags:
  - expo-notifications
  - push-notifications
  - android
  - onnewintent
  - config-plugin
  - mainactivity
  - task-restart
  - device-verification
---

# Android push tap after process death opens Home: the task restart sends the tap only to onNewIntent, and Expo drops it

## Problem

On Android, a tap on a campaign push notification opened Home instead of the destination, and the app reported no open. This happened when Android had stopped the app's process while the app's task stayed in Recents. Expo SDK 57 drops the tap in this state (upstream expo/expo#49254, open).

## Symptoms

- A cold tap (process stopped, task kept in Recents) opens Home. A warm tap (process alive) opens the destination. A tap after the person removes the task from Recents also opens the destination.
- The app sends no `ReportPushOpen`, so admin's campaign report undercounts Android opens.
- `getLastNotificationResponse()` is null, so `apps/mobile/src/lib/lapseReminders/tapHandler.ts` has nothing to consume at attach.
- The window event log is the signature: `adb logcat -b events` shows `wm_new_intent`, then `wm_restart_activity` for `MainActivity`, and no `wm_create_activity` for it.

## What Didn't Work

- **A JavaScript fix.** The tap never reaches JavaScript, so no change in `tapHandler.ts` or the adapter can see it. The fault is native.
- **Leaving it as a known limitation.** In this session's brainstorm, the owner first chose no new plugin, then made the fix mandatory after evaluation. The plan's Problem Frame gives the reason: a cold tap is probably the usual campaign case, because an announcement arrives at the person's morning hour, often hours after the last use, and low-end Android phones stop background processes sooner.
- **Rejected alternatives** (`docs/plans/2026-10-12-1532-fix-android-cold-push-tap-plan.md`, Key Decisions and Scope Boundaries): a pnpm patch to Expo's activity wrapper, a data-only push for every announcement so that expo-notifications posts it itself, and a change to the activity's `launchMode`. The plan chose the config plugin as the smallest change that works in both release and dev-client builds and leaves the notification look, admin, and iOS unchanged. A wrapper patch alone would not help a dev client, because the dev launcher also drops the intent.
- **Device-verification traps** (Samsung Galaxy S20, Android 13, 2026-10-12 and 2026-10-13):
  - `adb shell am kill` does nothing while a video plays in the mini player, because the process is not in the background. One "cold" run on 2026-10-13 was really a warm tap. It also did nothing on 2026-10-12 while the screen was off over the app (auto memory [claude]). Pause the media, press Home, wake the screen, and confirm that `pidof` is empty before you send.
  - A dev client cannot reproduce the replay cases. The dev launcher restarts the task with `FLAG_ACTIVITY_CLEAR_TASK` (logged as `wm_finish_activity ... clear-task-all`), so the restored launch intent is gone. Use a release build for them.
  - `am force-stop` keeps the task in Recents but removes its activity records. A reopen from Recents then creates a new activity with `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` and no saved state. A force stop also blocks push delivery until the next launch, so run that case last.
  - Play Protect's "Send app for a security check?" dialog blocks `adb install` of a local release APK until someone taps "Don't send". Samsung's USB dialog "Allow access to phone data?" can appear during a session, and on 2026-10-13 an answer to it reset the USB connection, so adb lost the phone for a few seconds (both observed in this session).

## Solution

`apps/mobile/plugins/withAndroidPushTapRelay.js` generates two blocks in `MainActivity.kt` with `withMainActivity` and `CodeGenerator.mergeContents` from `expo/config-plugins`. `apps/mobile/android/` is generated (CNG), so the fix must be a config plugin.

Block A (`withAndroidPushTapRelay.js:20-31`) runs in `onCreate`, before the superclass call. On a restore, it removes the tap key from the activity's own intent:

```kotlin
if (savedInstanceState != null ||
  ((intent?.flags ?: 0) and android.content.Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
  val tapKey = expo.modules.notifications.service.NotificationsService.GOOGLE_MESSAGE_ID_KEY
  // ... log the clause and whether the key was present
  intent?.removeExtra(tapKey)
}
```

Block B (`withAndroidPushTapRelay.js:33-48`) overrides `onNewIntent`. It hands a Firebase tap to expo-notifications, then removes the key, then calls the superclass:

```kotlin
override fun onNewIntent(intent: android.content.Intent) {
  val extras = intent.extras
  if (extras != null &&
    extras.containsKey(NotificationsService.GOOGLE_MESSAGE_ID_KEY) &&
    !extras.containsKey(NotificationsService.NOTIFICATION_RESPONSE_KEY) &&
    !extras.containsKey(NotificationsService.TEXT_INPUT_NOTIFICATION_RESPONSE_KEY)) {
    NotificationManager.onNotificationResponseFromExtras(extras)
    intent.removeExtra(NotificationsService.GOOGLE_MESSAGE_ID_KEY)
  }
  super.onNewIntent(intent)
}
```

(The generated code uses fully qualified names, so the plugin adds no imports.)

`apps/mobile/src/lib/__tests__/androidPushTapUpstream.guard.test.js` pins the exact `expo`, `expo-notifications`, and `expo-updates` versions and eleven upstream facts. Each fact has a negative control. `apps/mobile/src/lib/__tests__/appJsonNotifications.guard.test.js` fails when `android.googleServicesFile` is set and the plugin is not registered.

## Why This Works

- **Why the tap reaches only `onNewIntent`.** `MainActivity` is `singleTask` (`launchMode="singleTask"` in the generated `AndroidManifest.xml`). When the process is dead and the task survives, Android restarts the task with the task's OLD launch intent. `onCreate` gets that old intent, which carries no tap, and the pending tap intent arrives through `onNewIntent` after `onCreate` and before `onResume`.
- **Why Expo drops it.** `ReactActivityDelegateWrapper.onNewIntent` returns early while `loadAppReady` is incomplete (`ReactActivityDelegateWrapper.kt:306-309` in the installed `expo@57.0.27` package). In a release build, expo-updates supplies a delay-load handler outside developer support (`UpdatesPackage.kt:69-70` in the installed `expo-updates@57.0.25` package), so the app is still loading when the new intent arrives. In a dev client, the dev launcher drops the intent.
- **Why Block B fixes it.** `NotificationManager.onNotificationResponseFromExtras` queues the extras until a JavaScript listener attaches (`NotificationManager.kt:116-117` in the installed `expo-notifications@57.0.22` package). At start-up, the tap handler reads that response, reports the open, and opens the destination.
- **Why the tap is delivered once.** Expo's own listener forwards only an "FCM intent", and `isFCMIntent` keys on `google.message_id` alone (`ExpoNotificationLifecycleListener.kt:66-67` in the same package, used at lines 29 and 52). Block B removes that key before it calls the superclass, so Expo's listener ignores the tap in every app state, warm taps included.
- **Why Block B skips Expo's response keys.** When the app is on screen or its process is alive and in front, expo-notifications posts the notification itself. Its tap goes through `NotificationForwarderActivity` and a broadcast, which already deliver the response, and the intent to `MainActivity` carries `notificationResponse`. A second hand-off would deliver the tap twice.
- **Why Block A is needed.** When an earlier tap created the task, the restored launch intent still carries that earlier tap. Expo's `onCreate` listener would queue it, and the queue keeps only the first bundle while no listener exists (`NotificationManager.kt:116-117`). So the old tap would win over a newer one, and a plain reopen from Recents or the launcher would replay it. Block A removes the key only on a restore (saved state, or the history flag after a force stop), so a fresh tap that creates a new activity keeps its key.

Device evidence (S20, release build, 2026-10-13): cold taps to a video, a series, and an experience opened the destination. A newer cold tap won over the tap that created the task. Reopens from Recents, from the launcher, and after a force stop did not replay. A dev client counted one `ReportPushOpen` per tap.

## Prevention

- **Never write the text `super.onCreate(` inside a generated block.** expo-splash-screen and react-native-google-cast insert their blocks at the FIRST line that holds it. The plugin test checks that no generated line holds that text, and it runs the real vendor plugins in `app.json` order and in reverse.
- **Fail at prebuild, never skip.** The plugin throws on a Java `MainActivity`, a missing anchor, or another `onNewIntent` override. A skipped plugin would ship the defect silently.
- **Re-check at every Expo SDK upgrade.** The tripwire's version pins fail on any upgrade. Three of its facts pin the `isFCMIntent` gate that single delivery depends on. Re-read expo PR #47615 (merged to Expo's main branch on 2026-07-09, expected in SDK 58), which drains the tap queue after a listener handles a tap, and re-check expo/expo#49254. If upstream fixes the drop, remove the plugin after a device pass.
- **Verify on a device with a release build.** Use `am kill` after you pause media and press Home, check that `pidof` is empty and the task is still in Recents, and read `adb logcat -s ForgePushTap` and `adb logcat -b events`. Block B's log line means that the hand-off ran, not that the queue kept the tap.
- **Ship it in a native build.** The plugin changes the app config, so it moves the fingerprint runtime version on both platforms. An `eas update` reaches no installed build until a new native build ships.

## Related Issues

- expo/expo#49254 (open): the upstream issue for this exact defect. Re-check it whenever the tripwire goes red.
- The pending Renovate "expo monorepo" update (Dependency Dashboard, JesusFilm/forge#2589) will fail the tripwire's version pins on purpose. Re-verify the relay before that merge.
- `docs/plans/2026-10-12-1532-fix-android-cold-push-tap-plan.md`: requirements R1-R12, the rejected alternatives, and the device cases V1-V9.
- `docs/solutions/best-practices/expo-config-plugin-withappdelegate-mod-reverse-order.md`: mods run in reverse plugin order; throw on a missing anchor; stay idempotent.
- `docs/solutions/integration-issues/expo-screen-orientation-rnscreens-deferral-blocks-fullscreen-rotate.md`: another case where the expo dev launcher makes a dev client behave unlike a release build.
- `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`: prove the artifact and the instrument; this doc adds Android instrument traps.
- `docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`: the fake admin that counted one `ReportPushOpen` per dev-client tap.
- `docs/solutions/developer-experience/physical-android-dev-build-local-admin-emulator-alias.md`: the LAN override a physical Android phone needs for a dev build.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`: why the tripwire reads installed upstream sources and why only a device proves the Kotlin behavior.
