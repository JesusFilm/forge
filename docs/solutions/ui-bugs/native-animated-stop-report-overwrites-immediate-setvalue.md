---
title: "A setValue reset on a native-driven Animated value lands late: a stop report overwrote it, and a mount drew the stale value first"
date: "2026-09-24"
last_updated: "2026-09-29"
category: ui-bugs
module: apps/mobile
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "A stopped skeleton pulse rested at RGB (39,35,34) or (39,36,34) instead of the dim rest (33,29,28), in 3 of 3 iPhone 17 Pro simulator trials"
  - "The frozen brightness matched the pulse phase at the moment the loop stopped, not the value the code had just written"
  - "One earlier device run of the same code read the correct (33,29,28), so a single passing run proved nothing"
  - "Every jest suite stayed green, because jest has no native driver and the shelf suite mocks Animated.loop"
  - "Each Bible verse change began with one black frame where neither verse showed; a useLayoutEffect setValue reset of a shared native value landed one frame after the mount, with no stop before it"
root_cause: async_timing
resolution_type: code_fix
severity: medium
framework_version: "expo 57.0.24 / react-native 0.86.3"
related_components:
  - apps/mobile/src/hooks/useShimmerOpacity.ts
  - apps/mobile/src/hooks/__tests__/useShimmerOpacity.test.tsx
  - apps/mobile/src/components/home/RecommendationsShelf.tsx
  - apps/mobile/src/components/bible/VerseSlider.tsx
  - apps/mobile/src/components/bible/__tests__/VerseSlider.test.tsx
tags:
  - mobile
  - react-native
  - animated
  - native-driver
  - setvalue
  - layout-effect
  - skeleton
  - async-timing
---

# A setValue reset on a native-driven Animated value lands late: a stop report overwrote it, and a mount drew the stale value first

## Problem

PR #2418 (open, not merged as of 2026-09-24) gives the Recommended for You
shelf a skeleton whose cards pulse through `useShimmerOpacity`
(`apps/mobile/src/hooks/useShimmerOpacity.ts`). The pulse is one
`Animated.timing` from 0 to 1 over 1400 ms, on the native driver, inside
`Animated.loop` (`useShimmerOpacity.ts:40-49`). An interpolation maps progress
`[0, 0.5, 1]` to opacity `[0.35, 1, 0.35]` (`useShimmerOpacity.ts:23-24`).

The PR adds an `active` argument, default `true` (`useShimmerOpacity.ts:15`).
The shelf passes `awaitingSlate(status) && focused`
(`apps/mobile/src/components/home/RecommendationsShelf.tsx:327`). When the
pulse must stop, the skeleton must rest at its dim value, opacity 0.35. The
first implementation stopped the loop and then reset the value at once:

```ts
useEffect(() => {
  if (!active) {
    progress.setValue(0) // rest at DIM at once
    return
  }
  const loop = Animated.loop(
    Animated.timing(progress, {
      toValue: 1,
      duration: CYCLE_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }),
  )
  loop.start()
  return () => loop.stop()
}, [progress, active])
```

When `active` went from `true` to `false`, React ran the old cleanup
(`loop.stop()`) and then the new setup (`progress.setValue(0)`). The code
looked correct. On the device, the still skeleton kept the brightness the loop
had at the moment it stopped.

The defect was found on a failed slate load, where the first version of the PR
kept a still skeleton on screen. The final PR hides the whole row on a failed
load, so a still skeleton now appears only on a blurred Home or for the one
commit where `served` lands before its slate. The mechanism below applies to
any native-driven value that is stopped and then reset. "A second case: a
reset with no stop" under Symptoms shows a late reset with no stop before it.

## Symptoms

- On the iPhone 17 Pro simulator (iOS 26.5, dev client), a pixel inside a
  still skeleton card read (39,35,34) in one trial and (39,36,34) in two, after
  a forced slate failure. The dim rest is (33,29,28).
- The colour arithmetic: the card surface `#292524` is (41,37,36) and the page
  ground `#1c1917` is (28,25,23). Opacity 0.35 gives (33,29,28), and opacity
  1.0 gives (41,37,36). The measured values are about opacity 0.85.
- The value repeated because the failure timeline is fixed. The pulse starts
  with the first slate request. The client makes three attempts, each with a
  3 s deadline (`DELIVERY_DEADLINE_MS`,
  `apps/mobile/src/lib/recommendations/transport.ts:12`), with 5 s between
  them (`DELIVERY_RETRY_DELAY_MS` and `DELIVERY_ATTEMPTS`,
  `apps/mobile/src/hooks/useUserRecommendations.ts:35-36`). The failure lands
  at about 3 + 5 + 3 + 5 + 3 = 19 s, which is 13.57 cycles of 1.4 s. With the
  `Easing.inOut(Easing.ease)` curve, that phase gives opacity about 0.85, which
  rounds to (39,35,34), the value of the first trial.
- An earlier single device run of the same code read (33,29,28) after the
  failure. That run was a false pass.
- Every jest suite stayed green.

### A second case: a reset with no stop

The verse fade in the Bible reader (`VerseSlider`, the follow-up to PR #2427,
unmerged on 2026-09-29) had a late reset with no stop before it. Each verse
change mounted a still copy of the old verse on one shared native-driven
`Animated.Value`. A finished run left that value at 1 (copy opacity 0), and a
`useLayoutEffect` then called `progress.setValue(0)`. The mount commit carried
the stale 1. This pre-fix fade code was never committed.

The reset reached the view one frame late, so each change began with one frame
where neither verse showed. A 60 fps capture on the iPhone 17 Pro Max simulator
(2026-09-28) read one frame at YAVG about 16 (limited-range black) before each
fade. The fix gives each run a new `Animated.Value` at its start value
(`newClock`, `apps/mobile/src/components/bible/VerseSlider.tsx:284-289`).
Android was not measured. Until the follow-up merges, `main` has the merged
slide version of `VerseSlider`, with the same shape: one shared value and a
`useLayoutEffect` reset. Nobody measured whether that slide shows a stale
frame.

## What Didn't Work

- **An immediate `setValue(0)` after `loop.stop()`.** The stop goes to the
  native side. The native side reports its stop-time position back to JS
  later, and that report replaced the reset. "Why This Works" gives the source
  trace.
- **One passing device run as proof.** The frozen value and the dim rest are
  the same colour whenever the stop lands near the start or the end of a cycle.
  Over evenly spaced phases, with this easing and this rounding, about 15% of
  the cycle rounds to exactly (33,29,28), so one run passes by chance about one
  time in seven. The phase also moves fast with time: a stop at 18.5 s predicts
  (35,31,30), at 19.0 s (39,35,34), and at 19.5 s (33,29,28). Three trials on a
  forced failure found the defect.
- **Render tests.** Jest has no native driver, so a test has no native stop
  report. The shelf suite also mocks `Animated.loop`, so the loop never runs.
- **A static reading of the loop branch.** A first reading of `Animation.js`
  concluded that the native end callback returns early for a looping animation,
  before it updates any view (`Animation.js:155-159`). That branch does not
  apply here. With the native driver, `Animated.loop` calls `_startNativeLoop`
  (`Libraries/Animated/AnimatedImplementation.js:487-489`), which passes
  `{...config, iterations}` and no `isLooping`
  (`AnimatedImplementation.js:251-254`). So `__isLooping` is `undefined`
  (`Animation.js:59`), and the end callback continues to `node.update()`
  (`Animation.js:163-165`). The device result settled the defect; the static
  reading did not.

## Solution

The fix was opened in #2418. The inactive branch asks the value to stop and
resets inside the stop callback (`useShimmerOpacity.ts:28-50`):

```ts
useEffect(() => {
  if (!active) {
    // The native stop reports its position back late and would overwrite an
    // immediate reset, so reset in that report; skip it if the pulse restarted.
    let restarted = false
    progress.stopAnimation(() => {
      if (!restarted) progress.setValue(0)
    })
    return () => {
      restarted = true
    }
  }
  const loop = Animated.loop(
    Animated.timing(progress, {
      toValue: 1,
      duration: CYCLE_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }),
  )
  loop.start()
  return () => loop.stop()
}, [progress, active])
```

The fix has three parts:

1. **`progress.stopAnimation(callback)`.** For a native value, `stopAnimation`
   sends `NativeAnimatedAPI.getValue(tag, callback)`
   (`Libraries/Animated/nodes/AnimatedValue.js:264-275`). The callback runs
   only when the native side answers.
2. **The reset in that callback.** `progress.setValue(0)` runs after the native
   answer, so it is the last write.
3. **The `restarted` flag.** The effect cleanup sets it. If `active` goes
   `true` to `false` to `true` before the native answer arrives, the late
   callback must not reset: `setValue` stops any animation that runs on the
   value (`AnimatedValue.js:197-201`), so a late reset would stop the new loop.

The second stop call stops nothing new, because the old cleanup already ran
`loop.stop()`. Its job is the native round trip: it puts a `getValue` request
behind the stop. For a value that is not native, `stopAnimation` calls the
callback at once with the JS value (`AnimatedValue.js:271-273`), so the reset
still runs at once there.

After the fix, 3 of 3 device trials rested at (33,29,28), both right after the
failure and after a Search to Home tab switch.

`apps/mobile/src/hooks/__tests__/useShimmerOpacity.test.tsx` spies on
`Animated.Value.prototype.stopAnimation` and holds its callback, which stands
in for the native reply. "rests at dim only after the native side reports the
stop" asserts that no reset happens until the held callback fires. "drops a
late reset when the pulse has already restarted" drives `true` to `false` to
`true` and then fires the callback; no reset may follow. Removing the
`restarted` guard makes the second test fail.

## Why This Works

All paths below are under `apps/mobile/node_modules/react-native/` at React
Native 0.86.3.

**Established from source:**

1. `loop.stop()` reaches `value.stopAnimation()` through the loop's and the
   timing's `stop` (`Libraries/Animated/AnimatedImplementation.js:496-499`,
   `243-245`). `Animation.stop()` sends
   `NativeAnimatedHelper.API.stopAnimation(nativeID)`
   (`Libraries/Animated/animations/Animation.js:85-99`).
2. At start, the animation registered a native end callback
   (`Animation.js:139-167`). That callback runs later in JS and calls
   `animatedValue.__onAnimatedValueUpdateReceived(value, offset)` with the
   stop-time value (`Animation.js:149-151`), which writes the JS `_value`
   (`Libraries/Animated/nodes/AnimatedValue.js:293-298`).
3. The first implementation's `setValue(0)` had already run. For a native
   value, `setValue` updates the JS value without a flush and queues
   `NativeAnimatedAPI.setAnimatedNodeValue(tag, 0)` in a batch
   (`AnimatedValue.js:197-211`). The late stop report then replaced the JS
   value with the stop-time value.
4. JS sends native operations in call order: the helper queues an operation
   "to prevent operations from being executed out of order"
   (`src/private/animated/NativeAnimatedHelper.js:125-143`). A `getValue` sent
   after the stop reaches the native side after the stop, so the reset in its
   answer is the last write.
5. **The second case.** React renders an animated style from the JS value
   (`src/private/animated/createAnimatedPropsHook.js:219-230`). A layout effect
   runs after that render, so the mount commit carries the stale value. A
   native `setValue` does not flush, so it causes no new render
   (`AnimatedValue.js:202-205`). The reset reaches the view only through the
   native module. On iOS bridgeless, when `cxxNativeAnimatedEnabled` is false,
   that module is `NativeAnimatedTurboModule`
   (`Libraries/Animated/shouldUseTurboAnimatedModule.js:14-20`). Its
   `setAnimatedNodeValue` goes to the UIManager queue and then to the main
   queue (`Libraries/NativeAnimation/RCTNativeAnimatedTurboModule.mm:131-136`,
   `255-264`, `290-309`). A new value for each run has the correct JS value at
   render, so the mount commit is correct and no native write must follow it.

**Not verified:**

- **Which step writes the stale value to the view.** One candidate is the end
  callback's `node.update()` (`Animation.js:163-165`). On Fabric that runs the
  props hook's callback, which calls `scheduleUpdate()` for a native node
  unless `cxxNativeAnimatedEnabled()` is true
  (`src/private/animated/createAnimatedPropsHook.js:127-145`), and the
  re-render reads the stale JS value. The JS default of that flag is `false`
  (`src/private/featureflags/ReactNativeFeatureFlags.js:219`); the runtime
  value on this build was not read. A second candidate is the order of the
  native stop and the batched `setAnimatedNodeValue`. Neither was traced on the
  device.
- **The order of the two native replies in JS.** It was not traced in native
  code. The device trials (3 of 3 at rest) support that the `getValue` answer
  lands last.
- **The frame order in the second case.** Source shows the two queue hops. It
  does not fix their order against the Fabric mount. The one late frame comes
  from the simulator capture. The runtime value of `cxxNativeAnimatedEnabled`
  was not read on that build either.
- **Android.** Neither the defect nor the fix was measured on Android.

## Prevention

- **Rule.** For a native-driven `Animated.Value`, a `setValue` can reach the
  view after the frame you need it in. Do not use an immediate `setValue` in
  these two cases:
  - **(a) A stop, then a reset.** Reset inside `stopAnimation`'s callback.
    Guard that reset with a flag the effect cleanup sets, so a late reset
    cannot stop a restarted animation.
  - **(b) A reset of a shared value in the commit that mounts a view that reads
    it.** The first frame shows the stale value. Create a new `Animated.Value`
    for each run, at its start value. Swap to it during render, not in an
    effect, so the mount commit carries it
    (`apps/mobile/src/components/bible/VerseSlider.tsx:142-151`, `284-289`).
- **Scope.** Case (a) applies to any native-driven animation that a prop turns
  on and off: skeleton pulses, spinners, and fades. A stop on unmount alone is
  not at risk, because nothing resets after it. The other `useShimmerOpacity()`
  callers pass no argument and stop only on unmount
  (`SearchResultSkeleton.tsx`, `VideoDetailSkeleton.tsx`, `SheetLoading.tsx`,
  `BibleQuotesCarouselRenderer.tsx`). Case (b) applies to any layer that
  mounts for each run on a value that outlives the run: a still copy, a
  crossfade, or an entry animation. A `useLayoutEffect` does not prevent it,
  because the render already read the stale value.
- **Audit command.** List files that use the native driver and also call
  `setValue`:

  ```bash
  git grep -l -e 'useNativeDriver: true' -- apps/mobile/src apps/mobile/app \
    | xargs grep -ln 'setValue('
  ```

  On 2026-09-29 it listed 12 non-test files and 1 test file
  (`SplashSequence.test.tsx`) other than `useShimmerOpacity.ts`. They were not
  audited. A `setValue` there is at risk in case (a), when it follows a stop of
  a native animation on the same value. It is also at risk in case (b), when it
  resets a value in the commit that mounts a view that reads the value.

- **Device check.** Verify a still animation with pixel samples from live
  frames, and never trust one run.
  1. Force the path that stops the animation. Here that was a slate failure:
     a fake-Admin proxy hold longer than the 3000 ms `DELIVERY_DEADLINE_MS`
     (see `docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`;
     the session's slate-delay knob is not committed).
  2. Take a screenshot: `xcrun simctl io <udid> screenshot f.png`.
  3. Read one pixel inside the element:
     `ffmpeg -loglevel error -i f.png -vf "crop=1:1:X:Y" -f rawvideo -pix_fmt rgb24 - | od -An -tu1`.
  4. Compare the pixel with the computed composite values.
  5. Take several frames: a pulsing element changes, a still one holds.
  6. Run at least three trials, because about 15% of stop phases look the
     same as the rest.
  7. Predict the frozen value from the cycle phase at the stop, and treat a
     match as support, not proof.
- **Test shape.** Jest cannot see the native order.
  - Case (a): spy on `Animated.Value.prototype.stopAnimation`, hold its
    callback to stand in for the native reply, assert that no reset happens
    before it fires, and falsify the restart guard once.
  - Case (b): spy on `Animated.Value.prototype.setValue`, and assert that no
    call occurs across two changes in a row. Also assert the style of each
    newly mounted layer (here, the still copy) at the start of each change.
    Jest cannot see the dark frame, so this test pins only the mechanism
    (`apps/mobile/src/components/bible/__tests__/VerseSlider.test.tsx:284-299`).
- **Frame check for case (b).** A one-frame fault needs a frame capture, not a
  screenshot.
  1. Start a recording: `xcrun simctl io <udid> recordVideo --codec h264 --force out.mp4`.
  2. Make several transitions, then send SIGINT to stop the recording.
  3. Read the mean brightness of each frame in the region of the layers:
     `ffmpeg -i out.mp4 -vf "fps=60,crop=W:H:X:Y,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=yavg.txt" -f null -`.
     The `fps=60` filter gives one sample for each 60 Hz frame.
  4. Look for one lone dark frame before each transition. Here it read YAVG
     about 16, limited-range black, between two lit frames.
  5. Keep the capture from before the fix. It proves that the detector can see
     the fault. A clean capture after the fix is proof only next to it.
- **Review.** A ce-code-review adversarial reviewer predicted this defect at
  confidence anchor 50. A low-confidence finding about native animation timing
  costs little to check on a device; check it before you dismiss it.

## Related Issues

- `docs/solutions/ui-bugs/animated-sequence-nested-in-parallel-never-runs-on-android-fabric.md`:
  another Fabric `Animated` defect that every jest suite missed, with the same
  lesson to verify an animation with live device frames.
- `docs/solutions/logic-errors/layout-effect-commit-lag-mini-player-shrink-flash.md`:
  the same lesson for a `setState`: a layout effect cannot correct the commit
  it runs in. It also shows that Fabric keeps a native-driven value on a view,
  and it uses the same frame-capture method as case (b).
- `docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md`:
  `apps/tv` seeds a mid-glide restart from `stopAnimation`'s callback, not a JS
  mirror. The native side owns a native animation's current value, and that
  callback is the way to read it.
- `docs/solutions/design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md`:
  the mirror case, where a stale animation completion clobbered a newer state.
- `docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md`:
  review findings about missing `stop()` calls. Here the stop was present; the
  defect was the reset that followed it.
