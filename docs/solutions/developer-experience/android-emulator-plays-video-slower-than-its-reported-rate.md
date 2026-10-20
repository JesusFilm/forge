---
title: "The Android emulator plays video slower than the rate it reports: check a speed feature against a control run"
date: "2026-10-15"
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Verifying a playback-speed feature (a 2x hold, a speed setting) on an Android emulator"
  - "An emulator plays slower than the rate that the player and the media session report"
  - "Measuring the real playback rate of an expo-video player on a simulator or an emulator"
  - "Scripting a press-and-hold, or a hold that turns into a drag, on the iOS simulator or an Android emulator"
tags:
  - android-emulator
  - playback-rate
  - expo-video
  - device-verification
  - control-run
  - adb
  - idb
  - explore-feed
---

# The Android emulator plays video slower than the rate it reports: check a speed feature against a control run

## Context

PR #2727 (open as of 2026-10-15) adds a 2x hold to the Explore feed. A hold on the left or right edge of a playing clip plays it at
2x until the finger lifts. On 2026-10-15 the change was checked on the iPhone
17 Pro Max simulator and on the Pixel 9a Android emulator.

On iOS, the media time moved at 1.97x during a hold. On Android,
`player.playbackRate` read 2, and `adb shell dumpsys media_session` showed
`speed=2.0`. But the media time moved at only about 1.5x. These numbers looked
like an app bug: the rate seemed to be set but not applied.

It was not an app bug. The watch page's existing speed setting is a different
code path, and it played at only 1.35–1.57x on the same emulator session. The
same emulator played 1x at 0.99x over 609 s of clips. So it could decode the
stream at 1x but not at 2x. That emulator had run for 21 hours, and its load
average was 6.8–11.

## Guidance

### Measure the rate that plays, not the rate that is set

The player's `playbackRate` and the media session's `speed` show the rate that
the app asked for. They do not show the rate that the device plays at. To check
a speed feature, compare the media time with the wall clock over a window of
at least 2.5 s.

- **A temporary log in the `timeUpdate` handler.** In the Explore feed,
  `onTimeUpdate` (`apps/mobile/src/hooks/useFeedPlayers.ts:612`) receives each
  update. A line like this one logs both values with a timestamp:

  ```ts
  console.log(
    `[fast-verify] ${Platform.OS} t=${currentTime.toFixed(2)} rate=${player.playbackRate} now=${Date.now()}`,
  )
  ```

  The achieved rate is `Δt / Δnow` across the lines inside the hold. Select the
  lines by their `now` value, against host timestamps taken around the gesture.
  Use the `now` deltas, not the event count times the nominal interval. On
  Android the `timeUpdate` clock drifts (see Related).

- **The Android media session, with no code change.** Sample the playing
  session a few seconds apart:

  ```bash
  adb -s emulator-5554 shell 'dumpsys media_session | grep "state=PLAYING"'
  # state=PlaybackState {state=PLAYING(3), position=202138, ..., speed=2.0, updated=78298593, ...}
  ```

  `position` is the media time in ms. `updated` is the device clock (elapsed
  realtime) in ms. The achieved rate is `Δposition / Δupdated`. While the
  player played, the session updated about every 4 s in this run.

- **Read a paused player correctly.** In this run (expo-video 57.0.5), Android
  sent `timeUpdate` events while the player was paused, so a constant `t` meant
  paused. On iOS, the events stopped while the player was paused.

### Run a control on a known path before you debug the feature

If the achieved rate is low on an emulator, play the same rate through a
different, existing code path in the same emulator session. In `apps/mobile`,
the watch page's Settings → Playback speed → 2x writes the rate in
`PlaybackHost.tsx` (`apps/mobile/src/components/watch/PlaybackHost.tsx:858`).

- If the control is equally slow, the emulator is the limit. The feature code
  is not at fault.
- If the control plays at 2x and the feature does not, debug the feature.

Also measure 1x on the same session. A device that keeps up at 1x but not at
2x has a throughput limit. Set the control's speed back to Normal after the
run.

### Remove the log with a cold relaunch

Fast Refresh replaces the module, but an expo-video listener that is already
subscribed keeps the old function. On Android in this run, neither the restored
file nor a Metro `POST /reload` stopped the log. The reload returned 200, but
Metro logged no new "Android Bundled" line, as the Explore pager doc also
records (see Related). A force-stop and a relaunch stopped the log
(`adb shell am force-stop <package>`, then the dev-client deep link). After the
relaunch, play a clip and confirm that the log count does not increase.

### Use a tool that can make the gesture

- **iOS simulator.** `idb ui tap X Y --duration 3` holds a point for 3 s, in
  points. `idb ui swipe X1 Y1 X2 Y2 --duration 0.25` swipes. Neither idb nor the
  XcodeBuildMCP touch, drag or long-press tools can hold still and then move. So
  you cannot script a hold that turns into a drag on the iOS simulator.
- **Android emulator.** `adb shell input swipe X Y X Y 3000` holds a point for
  3 s, in pixels. A hold that turns into a drag needs separate events:

  ```bash
  adb -s emulator-5554 shell input motionevent DOWN 48 1500
  # Wait longer than the hold delay (250 ms in Explore), then move in steps.
  adb -s emulator-5554 shell input motionevent MOVE 48 1300
  adb -s emulator-5554 shell input motionevent MOVE 48 1000
  adb -s emulator-5554 shell input motionevent UP 48 650
  ```

  Each `adb shell` call took about 190 ms on the loaded emulator, so each MOVE
  arrives late. Read the result from the log, not from the command timing.

## Why This Matters

Without a control, a low emulator rate looks like a defect in the rate logic.
The obvious next changes are then wrong: more rate writes, or a different write
order. The Explore rate code follows a strict iOS rule: it writes the rate only
to a player that plays or is about to play. `syncRate`
(`apps/mobile/src/hooks/useFeedPlayers.ts:277-282`) skips a paused player, and
`play()` writes the rate just before it starts the player. A rate write added
to "fix" an emulator limit can break that rule and start a paused player on
iOS.

A control run takes about two minutes. It separates the device's limit from the
app's behavior with the same build, stream and emulator session.

## When to Apply

- Before you debug a playback rate that is lower than expected on an Android
  emulator.
- When you verify a new speed feature: a hold, a speed menu, or a rate change
  during a seek.
- When an emulator has run for hours or shows a high load average. A long-lived
  session also degrades video compositing (see Related).

## Examples

Measured on 2026-10-15 on the PR #2727 branch, in a dev client on the
worktree's Metro. Each achieved rate is media time divided by wall time.

| Run                           | Device                          | Code path        | Reported rate  | Achieved rate |
| ----------------------------- | ------------------------------- | ---------------- | -------------- | ------------- |
| Explore 2x hold               | iPhone 17 Pro Max simulator     | `useFeedPlayers` | 2              | 1.97x         |
| Explore at 1x                 | iPhone 17 Pro Max simulator     | `useFeedPlayers` | 1              | 0.998x        |
| Explore 2x hold               | Pixel 9a emulator               | `useFeedPlayers` | 2, `speed=2.0` | 1.52x         |
| Explore at 1x                 | Pixel 9a emulator               | `useFeedPlayers` | 1              | 0.989x        |
| Watch page, Playback speed 2x | Pixel 9a emulator, same session | `PlaybackHost`   | `speed=2.0`    | 1.35–1.57x    |

The last row is the control. It is as slow as the Explore hold on the same
emulator, so the emulator is the limit.

This run did not establish two things:

- whether a cold boot of the emulator raises the achieved rate;
- the achieved rate on a physical Android phone.

## Related

- `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`:
  the general rule to prove the instrument before you diagnose a defect from a
  device. This doc is one more case: the emulator is the instrument, and it
  cannot play at the rate under test.
- `docs/solutions/developer-experience/android-emulator-gfxstream-session-degradation-black-video.md`:
  a long-lived emulator session also degrades video compositing. Cold-boot the
  emulator before you diagnose.
- `docs/solutions/integration-issues/expo-video-ios-playback-rate-write-starts-paused-player.md`:
  why a rate write must happen only while the player plays on iOS. As of
  2026-10-15 this doc is on the branch `Ur-imazing/pause-devo-feature` (merged
  there through PR #2717), not on `main`.
- `docs/solutions/integration-issues/expo-video-timeupdate-clock-drift-audio-fade-hardcut.md`:
  the Android `timeUpdate` clock steps by more than its nominal interval, so
  measure a rate with wall-clock deltas over a long window.
- `docs/solutions/ui-bugs/nested-scrollview-in-panresponder-pager-slow-drag-moves-feed.md`:
  the Explore pager's `drag` and `feedMove` holds, its device-check matrix, and
  the cold-relaunch rule after `/reload` returns 200 with no new bundle.
- `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md`:
  the standing recipe to run a worktree's own Metro and drive the simulator.
- `apps/mobile/CLAUDE.md`, the Explore bullet "A hold on either side of a clip
  plays it at 2x".
