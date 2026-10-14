---
title: "expo-video on iOS: a playbackRate write starts a paused player"
date: "2026-10-14"
category: integration-issues
module: apps/mobile
problem_type: integration_issue
component: tooling
symptoms:
  - "A Daily Bible Pause video part played on by itself after a return from the background, if a 2x hold was active when the app left"
  - "On the watch page, a speed pick in Video settings starts a paused video"
  - "Every jest test passes, because the shared expo-video double stores playbackRate as a plain field"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
framework_version: "expo-video 57.0.5, expo 57.0.26, react-native 0.86.3"
retire_when: "expo-video stops writing AVPlayer.rate from the playbackRate setter while the player is paused; check the playbackRate didSet in expo-video ios/VideoPlayer.swift of the installed release"
tags:
  - expo-video
  - playback-rate
  - ios
  - avplayer
  - paused-player
  - playback-speed
  - jest-double
  - daily-bible-pause
---

# expo-video on iOS: a playbackRate write starts a paused player

## Problem

In expo-video 57 on iOS, each write to `player.playbackRate` also sets the AVPlayer rate. On AVPlayer, a rate above 0 means "play", so a write to a paused player starts it. Two surfaces in `apps/mobile` write the rate while the player can be paused: the Daily Bible Pause 2x hold and the watch page's speed setting.

## Symptoms

- **Daily Bible Pause.** The viewer holds a side of the screen for 2x, and the app goes to the background. The part holds, then plays on by itself. On the iPhone 17 simulator, a part went from 2 s to 11 s with no Resume cue. A control run without the hold came back held at 4 s.
- **Watch page.** The viewer pauses a video and picks a speed in Video settings. The video starts. On the iPhone 17 simulator, `the-birth-of-jesus` was paused at 0:24. One second after a 1.25x pick, it showed 0:25 and a Pause button. The controls then hid, which they do only while the video plays. A control run that opened the settings sheet and the speed list but picked nothing stayed paused at 0:45.
- **Tests.** The jest suites stay green in both cases.

## What Didn't Work

- **Ending the 2x play with `player.playbackRate = 1` on every pause path.** This looked correct, and every jest test passed. On iOS, the write itself restarted the held part. A code review flagged the risk, and only a simulator repro proved it.
- **A tap on the video to show the controls during the watch-page check.** The first check reported a false positive. The "Toggle player controls" element covers the whole video, so a tap at its centre presses the centre Play button. Show the controls with a tap away from the centre buttons, and read the state without a tap on the video.

## Solution

Treat a rate write as "play at this rate" on iOS. The Daily Bible Pause fix in `apps/mobile/src/components/dailyPause/PartPlayer.tsx` has four parts. It is on the branch `Ur-imazing/pause-devo-feature-polish`. As of 2026-10-14 it is not committed, and the branch has no PR.

```ts
// 1. While paused, keep the new rate in JS only (PartPlayer.tsx:283-289).
// iOS starts a paused player when its rate is written, so a paused player
// takes a new rate only when it next plays.
const setRate = (next: number) => {
  rate = next
  if (readPlaying(player)) writeRate(next)
  clock = startClock(readPosition(player), Date.now(), clock.running, next)
}

// 2. Write the wanted rate just before play() (PartPlayer.tsx:306).
// A pause can leave the native rate at 2x, and play() uses it.
player.playbackRate = rate
player.play()

// 3. On the playingChange(true) edge, apply a rate that waited (PartPlayer.tsx:408).
if (player.playbackRate !== rate) writeRate(rate)

// 4. In the effect cleanup, write only while playing (PartPlayer.tsx:544).
if (rate !== 1 && readPlaying(player)) writeRate(1)
```

`readPlaying` (`PartPlayer.tsx:181`) reads `player.playing` inside a `try`, because a released player throws.

**The watch page is not fixed.** `apps/mobile/src/components/watch/PlaybackHost.tsx:857` writes `player.playbackRate` in an effect on every speed pick and on mount, with no playing check. `PlaybackHost.tsx:829` writes the rate in the `sourceLoad` resume latch, before its `wasPlaying`, cast and `AppState` checks. So the rate write can start a player that those checks keep paused. The simulator proved the first path. The second path is not proved on a device.

## Why This Works

The `playbackRate` setter in `apps/mobile/node_modules/expo-video/ios/VideoPlayer.swift:29-40` does three things on every write. It emits `playbackRateChange` when the value changed, sets `ref.defaultRate` on iOS 16 and later, and sets `ref.rate`. It does not check whether the player is paused. `play()` calls `ref.play()` (`apps/mobile/node_modules/expo-video/ios/VideoModule.swift:336-338`). Per Apple's AVPlayer documentation, `play()` starts at `defaultRate` on iOS 16 and later.

So a rate write while paused starts playback, and a rate left at 2x plays at 2x on the next `play()`. The simulator proved the first half on 2026-10-14. The second half comes from the documentation and from reading the setter, not from a device run.

The fix keeps every native rate write inside the playing state. A paused player gets the rate at the next `play()`, and the `playingChange(true)` sync covers a player that starts by itself. The Android setter writes playback parameters only and does not call `play()` (`apps/mobile/node_modules/expo-video/android/src/main/java/expo/modules/video/VideoModule.kt:180-186`). This session did not test Android.

## Prevention

- **Read `player.playbackRate = x` as "play at x" on iOS.** Write it only while `player.playing` is true, or immediately before `play()`. List the writes with `grep -rn -E "\.playbackRate ?=" apps/mobile/src apps/mobile/app apps/tv/src`. On 2026-10-14 there were four, all in `apps/mobile`: two in `PartPlayer.tsx` and two in `PlaybackHost.tsx`.
- **The shared double cannot show this.** `apps/mobile/src/test-utils/expoVideoMock.ts:122` stores `playbackRate` as a plain field. A test for a rate write needs a local accessor that starts a paused player, as in `PartPlayer.test.tsx:1417`:

  ```ts
  function startOnRateWrite(): { starts: number } {
    const counts = { starts: 0 }
    let nativeRate = player.playbackRate
    Object.defineProperty(player, "playbackRate", {
      configurable: true,
      get: () => nativeRate,
      set: (next: number) => {
        nativeRate = next
        if (player.playing || next === 0) return
        counts.starts += 1
        player.playing = true
        player.__emit("playingChange", { isPlaying: true })
      },
    })
    return counts
  }
  ```

  Delete the accessor in `afterEach`, or the next test's `__reset()` writes through it.

  The shared double stays a plain field for now. If the double started a paused player on a rate write, the watch-page tests would start to model the open `PlaybackHost.tsx` bug. Make the double mirror iOS when the watch page is fixed, as it already mirrors the Android `preservesPitch` default on purpose (`expoVideoMock.ts:123-128`).

- **Give each redundant guard its own test.** The pre-play write and the `playingChange(true)` sync both put the rate back to 1. When a falsification removed one of them, the other kept every test green. Each now has a test that only it can pass. "sets the 1x rate before it plays" records the rate at the `play()` call. "applies the 1x rate when the player goes on by itself" emits `playingChange(true)` with no `play()`.
- **Check on a simulator, with a control run.** Pause, do the action, and read the state twice, a few seconds apart. Then do the same steps without the action. Read the state from the accessibility tree (`idb ui describe-all`), and do not tap the centre of the video.

## Related Issues

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`: the parent rule. Here the carrier is a property write whose native setter has a side effect, while the double stores it as inert data.
- `docs/solutions/logic-errors/first-frame-veil-hold-needs-per-source-latch-and-failure-release.md`: a second gap in the same shared double (`VideoView` never emits its first-frame event by itself).
- `docs/solutions/logic-errors/android-pip-appstate-latch-ordering-force-resume.md`: another way a paused watch video starts by itself. Its resume checks (`wasPlaying`, cast) do not cover a rate write.
- `docs/solutions/logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md`: the `AppState` check before `play()`, which a rate write also goes around.
- `docs/solutions/integration-issues/expo-video-replaceasync-seek-silently-dropped-tvos.md`: another expo-video property write (`currentTime`) whose native effect differs from the plain JS assignment.
- `apps/mobile/CLAUDE.md`, "Set `preservesPitch` EXPLICITLY on every player": another expo-video speed setting whose native behaviour differs from its documented default.
