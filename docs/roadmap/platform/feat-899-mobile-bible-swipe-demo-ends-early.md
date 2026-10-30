---
id: "feat-899"
title: "Mobile Bible swipe demonstration ends after one cycle"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-10-29"
duration: 2
depends_on: []
blocks: []
tags:
  - "mobile"
---

## Problem

The Bible reader's first-run swipe demonstration should play 3 cycles (`SWIPE_DEMO_MS`, 12.4 seconds; the owner asked for at least three cycles on 2026-09-25). In release check session tries on 2026-10-28 it ended much sooner:

- Android phone emulator: 5 of 6 waits ended after about 4.8 seconds; 1 ran 13 seconds.
- iPhone SE simulator: 2 of 2 waits ended after about 3.9 seconds.
- Screenshots on the Android phone: the first cycle's chapter swipe at +2.7 seconds, the demonstration fading at +4.2 seconds, and the reader's swipe hint at +6.8 seconds. So the demonstration was marked as played.

Only `onDone` marks it as played: a tap on the demonstration, or the end of its animation. Neither should come after one cycle. A tap at that moment also selects the verse under it, which made `bible-verse-select` flaky until the journey stopped tapping the demonstration.

## Entry Points — Read These First

1. `apps/mobile/src/components/bible/SwipeDemo.tsx`: the 600 ms arming delay, the native-driven `Animated.timing`, and `onDone`.
2. `apps/mobile/src/lib/bible/onboarding/swipeDemoTimeline.ts`: the timeline and `SWIPE_DEMO_MS`.
3. `apps/mobile/src/components/bible/BibleReader.tsx`: `showDemo` (`onboarding.status`, `demoPending`, `focused`, `chapterReady`).
4. `apps/mobile/src/lib/bible/onboarding/store.ts`: `markDemoPlayed`.

## Grep These

```bash
rg -n "SWIPE_DEMO_MS|markDemoPlayed|showDemo" apps/mobile/src
rg -n "bible-swipe-demo" apps/mobile/src apps/mobile/release-check/journeys
```

## What To Build

- Find what ends the demonstration early. Log the animation's `finished` result and time, and each `showDemo` input, in a debuggable build.
- Fix it, so that the demonstration plays its 3 cycles unless the viewer taps it.

## Constraints

- A screen reader or Reduce Motion still skips the demonstration (R16).
- Keep the one-value timeline: a sequence inside a parallel can fail to run on Fabric.

## Verification

- A jest test pins the cause.
- Device: in a release check session, the demonstration stays for at least 12 seconds on `android-phone` and on `iphone-se`. Measure it as the `bible-verse-select` step "The swipe demonstration ends".
