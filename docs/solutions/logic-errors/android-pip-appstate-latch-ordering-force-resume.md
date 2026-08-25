---
title: "Android picture-in-picture guard never armed: the OS window arrives after the AppState background event"
date: 2026-08-25
category: logic-errors
module: apps/mobile
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Closing the Android picture-in-picture window and reopening the app resumes a video the viewer dismissed"
  - "A video paused inside the picture-in-picture window starts playing when the window is expanded back into the app"
  - "Both defects pass every test in the picture-in-picture suite"
root_cause: async_timing
resolution_type: code_fix
severity: high
related_components:
  - apps/mobile/src/hooks/useManagedVideoPlayer.ts
  - apps/mobile/src/lib/pipPolicy.ts
  - apps/mobile/src/hooks/__tests__/useManagedVideoPlayer.test.tsx
tags:
  - mobile
  - android
  - picture-in-picture
  - expo-video
  - appstate
  - event-ordering
  - test-fixture
---

# Android picture-in-picture guard never armed: the OS window arrives after the AppState background event

Fix: PR #2022, branch `fix/mobile-android-playback-recovery-and-pip`. The PR is
open and not merged at the time of writing, so treat the code below as pending.

## Problem

On Android the AppState `"background"` event fires BEFORE the operating system's
picture-in-picture window opens and reports itself. A guard armed inside the
background branch as `leftUnderPipRef.current = pipActive` therefore always stored
`false` on Android, and no test could report that, because every pre-existing test in
the suite supplied the one input that armed it.

The platform scoping matters. On iOS the order is reversed — `inactive` arrives first
and decides nothing, and automatic entry has already fired by the time `background`
arrives — so that same line IS the arming path there. The guard was not dead
everywhere. It was dead on the one platform whose ordering the code had assumed away.

**This was predicted before it shipped.** The SDK 57 spike
(`docs/solutions/integration-issues/mobile-android-picture-in-picture-spike-20260813.md`)
listed it under "Still unproven": _"React Native reports AppState `background` from
`Activity.onPause` ... which would leave the latch unset at the moment the decision
is read."_ The prediction was correct and went unconfirmed for eleven days.

## Symptoms

Reported 2026-08-24, reproduced on a Galaxy Tab S8 (SM-X700) and a Galaxy S20
(SM-G981U1, Android 13).

1. Pressing Home during playback dismissed the app with no working window — the
   ordinary background pause had already stopped the video the window was about to
   carry.
2. Closing the window and reopening the app resumed the dismissed video. The tester
   waited a deliberate 22 seconds before reopening, which rules out the 3-second
   expand grace as the cause.
3. A video the viewer paused INSIDE the window started playing again when they
   expanded the window back into the app.

## What Didn't Work

**Suppressing the background pause when the window arms — rejected.** The obvious
read of symptom 1 is "do not pause when picture-in-picture is coming". That is wrong
for a reason unrelated to ordering: a viewer who has picture-in-picture switched off
in Android settings would then keep playing audio in the background forever. A brief
gap is better than audio that never stops. The pause always runs, and the latch's
`started` edge undoes it.

**Deferring the release pause behind a `setTimeout` — failed on the device.** Closing
the window and expanding it back raise the SAME stop event, so the first attempt
delayed the pause to see which had happened. Once the Android activity is stopped the
callback did not run for about ten seconds, and the viewer kept hearing audio after
closing the window. The shipped version pauses synchronously and records a clock
reading a later foreground can undo. A clock reading survives JS-thread suspension; a
scheduled callback does not.

**The green test suite was actively misleading.** Every pre-existing
picture-in-picture test called `store.setPipHold(true)` BEFORE
`emitAppState("background")` — the reverse of the Android order. Under that fixture
`pipActive` IS true at the background event, so the guard armed, and the assertions
passed. The fixture encoded an event order Android never produces, and the code was
only correct under that fiction.

The true order did get written down, with a comment stating it plainly:

```ts
// No setPipHold(true) yet: on the device the background event lands first,
// so the ordinary pause runs and stops the video the window will carry.
await emitAppState("background")
```

But that comment arrived while fixing symptom 1 — in the same commit as this fix, not
before it. The lesson is narrower than "one test contradicted the others for weeks",
and less comfortable: **the ordering was learned while fixing one symptom, and the
fixtures for the other symptoms were not revisited against it.** Learning a platform
ordering fact does not retroactively correct the tests written before you knew it.
Symptom 2 was found on hardware, not by the suite, even though the suite by then
contained a comment describing exactly the ordering that caused it.

## Solution

`onPictureInPictureStart` is the only producer of the latch's `true` edge, in
`apps/mobile/src/lib/miniPlayer/pictureInPicture.ts`:

```ts
onPictureInPictureStart: () => getMiniPlayerStore().setPipHold(true),
onPictureInPictureStop: () => getMiniPlayerStore().setPipHold(false),
```

That callback runs a beat AFTER AppState reports `"background"`. The `false` edge has
a second producer — the host's unmount cleanup in
`apps/mobile/src/components/watch/PlaybackHost.tsx`, which clears the latch so a
teardown cannot strand it set. That path reaches the same release branch, pause
included.

### Fix 1 — arm the guard on the latch edge, not on the background event

The only assignment that could arm the guard sat in the background branch, where on
Android the latch is guaranteed clear:

```ts
leftUnderPipRef.current = pipActive // always false on Android
```

**That line still exists and was deliberately left alone.** It is the arming path for
the opposite order — iOS, where entry has already fired by the time `background`
arrives — and it is also why the control test in the falsification below still passes.
The fix ADDS a second arming path rather than moving this one.

The arming that matters on Android now happens on the `started` edge, via a pure
decision in `apps/mobile/src/lib/pipPolicy.ts`:

```ts
if (transition === "started") {
  if (!armsPip || foreground) return NO_PIP_ACTION
  return {
    armLeftUnderPip: true,
    resume: !castActive && wasPlaying,
    pause: false,
  }
}
```

One edge now does both jobs: it undoes the background pause (symptom 1) and arms the
guard (symptom 2). With the guard armed, the foreground branch reads the LIVE player
instead of the stale snapshot.

The stale snapshot was written by the SAME background branch, because
`recordWasPlaying` is `!pipActive` and `pipActive` is false at that instant. One event
both recorded a true "was playing" and failed to arm the guard that would have
overridden it.

### Fix 2 — record the expand grace only when the release actually stopped playback

The release path recorded its timestamp unconditionally, so an expand undid a pause
the VIEWER had made. Now the release reads the player first:

```ts
let stoppedPlayback = false
try {
  stoppedPlayback = player.playing
} catch {
  // Already released; nothing was playing to undo.
}
// ...
pausedOnPipReleaseAtRef.current = stoppedPlayback ? Date.now() : null
```

## Why This Works

One platform fact explains all three symptoms: **`"background"` and the
picture-in-picture window are not simultaneous, and the background event comes
first.**

- Symptom 1: the pause ran against a video the window was about to carry.
- Symptom 2: the guard sampled the latch at the one moment it is guaranteed clear,
  while the same branch stored a "was playing" snapshot that then had nothing to
  override it.
- Symptom 3: the release path could not tell a stop it caused from a stop the viewer
  caused.

Moving the arming to the `started` edge samples the latch when it is guaranteed
MEANINGFUL rather than when it is guaranteed clear. The state is the same; only the
event that reads it changed.

## Prevention

### 1. A matched pair proves the fixture, not the code, was deciding

The suite contains two tests that assert the SAME property and differ essentially
only in the order of two statements. With the guard-arming line removed:

```console
✓ leaves the video paused when the viewer returns long after closing the window
✕ leaves the video paused when the window started after the background event
Tests:       1 failed, 21 skipped, 1 passed, 23 total
```

The first sets the latch before the background event; the second uses the Android
order. Same assertion, same bug present, opposite verdicts. The fixture's event order
was the whole difference between catching this and shipping it. (The two are not a
literal two-statement swap — the device-order test also wraps its latch call in
`act()` and asserts an intermediate state — but the ordering is the only difference
that decides the outcome.)

For any pair of platform events with a known ordering:

- Write the ordering down ONCE in a named helper and drive tests through it. A helper
  cannot be reversed by accident; two hand-sequenced statements can.
- A test that needs the counterfactual order must say so in place, and why.
- Where the order was learned from hardware, stamp it with the device, OS version, and
  date next to the helper.

### 2. A guard that never arms is invisible to a passing suite

This is the ordering-axis member of the repo's mocked-shape-vs-real-contract family
(see the META bullet in the root `CLAUDE.md`). A boolean guard needs at least one test
where its ARMING CONDITION is produced the way production produces it — not the way
the assertion finds convenient. When a guard is fed by an event whose timing the test
controls, the timing IS the contract under test.

The `apps/tv` analog is
`docs/solutions/logic-errors/liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md`
— a watchdog armed by a signal the fault path never produces.

### 3. Falsify each guard separately

Deleting one line must fail a set of tests that DIFFERS from the set another deleted
line fails. Across the full suite, removing the arming failed two tests — the
device-order test above, and `does not resume a video paused inside the window when it
expands back`. Removing the `stoppedPlayback` conditional failed only the second: a
strict subset. That difference is the proof the expand test alone would not have caught
the arming bug. Had both deletions failed the same single test, one fix would have been
untested and a reviewer could not tell which.

(The console block in §1 is a filtered two-test run of the matched pair, not this
full-suite comparison. They are different mutations shown at different scopes.)

### 4. Detecting the Android picture-in-picture window from a shell

On the Galaxy Tab S8 the window appears as a `pip_input_consumer` entry in
`adb shell dumpsys window windows`. On the Galaxy S20 (Android 13) it does NOT, even
while the window is on screen — which briefly read as a regression during hardware
verification. The reliable cross-device signal is the activity's own reported mode:

```console
adb shell dumpsys activity activities | grep -i mLastReportedPictureInPictureMode
# mLastReportedPictureInPictureMode=true
```

Treat the absence of `pip_input_consumer` as telling you nothing.

## Related Issues

- `docs/solutions/integration-issues/mobile-android-picture-in-picture-spike-20260813.md`
  — the SDK 57 spike that predicted this under "Still unproven". Its open question is
  now answered; that section needs a dated superseding note.
- `docs/plans/2026-08-12-001-feat-mobile-mini-player-plan.md` — source of the R13/KTD12
  requirement IDs the code comments cite. KTD12 states the latch contract this fix
  restores.
- `docs/solutions/logic-errors/liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md`
  — same failure shape on `apps/tv`.
- `docs/solutions/logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md`
  — same module and adapter, gate-release discipline.
- `docs/solutions/ui-bugs/tvos-appstate-inactive-vs-background-video-teardown.md` — the
  `inactive` vs `background` taxonomy `appStateBranchDecision` relies on.
- PR #2022 (this fix, open); PR #1962 (introduced the latch and the AppState handler).

**Not yet documented:** the same PR corrected a separate expo-video hazard — on Android
`replaceAsync` settles when the item is SET, not when it has loaded, so a seek written
in its continuation lands on the outgoing item. No standing doc covers the Android form
of that lesson; the closest,
`docs/solutions/integration-issues/expo-video-replaceasync-seek-silently-dropped-tvos.md`,
documents a different mechanism on tvOS. It deserves its own learning.
