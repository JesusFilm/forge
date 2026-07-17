---
title: "expo-video timeUpdate clock drift: a one-interval audio-fade window hard-cuts on Android TV"
date: "2026-07-17"
module: apps/tv
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "Showcase Mode reel audio crossfade ramps smoothly to silence on the tvOS simulator but hard-cuts with an audible pop on Android TV at each excerpt's window end"
  - "The fade-out armed only inside a one-second window (endSeconds-1 to endSeconds) — exactly one nominal timeUpdateEventInterval"
  - "On Android the arm sample and the window-end sample landed in the same timeUpdate callback, so the fade interval was created then immediately cleared before any audible ramp"
  - "Invisible in tvOS-simulator verification and in a naive t += 1 unit test; only real Android TV timing surfaces it"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - apps/mobile
  - expo-video
tags:
  - expo-video
  - timeupdate
  - android-tv
  - tvos
  - audio-fade
  - clock-drift
  - showcase-mode
---

# Audio crossfade hard-cut on Android because a timing window was sized to one expo-video timeUpdate interval

## Problem

Showcase Mode's excerpt reel (`apps/tv`) crossfades each excerpt's audio out over its final second so it lands on silence at the excerpt's window end and never plays into the credits R6 keeps clear. The fade first armed inside a window exactly one `timeUpdate` interval wide, which is safe on the tvOS lattice but not on Android's drifting clock — so on ~1-5% of Android transitions the fade never ran and the audio hard-cut to zero instead of ramping. Shipped in PR #1595 (branch `feat/tv-showcase-audio-fade-credits-guard`, unmerged at time of writing).

## Symptoms

- On the tvOS simulator (where the feature was built and verified) the fade-out ran on **100%** of transitions — 0% observed failure. The class of bug is structurally invisible on that platform.
- On real Android TV hardware, roughly **1-5%** of excerpt transitions hard-cut: instead of a smooth ramp to silence over the last second, the audio dropped to zero in a single step at the window end. The exact same JS ran on both platforms.
- The failure was intermittent and phase-dependent — the same excerpt could fade correctly one play and hard-cut the next, because whether the drifting clock stepped over the arming window depended on the sub-second phase offset at which sampling happened to begin.

## What Didn't Work

**Sizing the arming window to one nominal interval.** The original fade armed in a window exactly `1.0s` wide — `[endSeconds - 1, endSeconds)` — one nominal `timeUpdate` interval, coincident with the fade span itself. `apps/tv/src/components/showcaseMode/ReelPlayer.tsx:139` sets `p.timeUpdateEventInterval = 1`, one event per nominal second. On tvOS the event clock is an exact 1.0s **media** lattice, so a sample always lands inside a 1s-wide window. On Android the clock steps by strictly **more** than 1s per sample with cumulative drift, so it skips over a 1s-wide window `delta/(1000+delta)` of the time. When the arm sample was skipped, the very next `timeUpdate` invocation satisfied both the arm condition AND the window-end condition in the same handler pass — the fade interval was created and then immediately cleared, and the hard `setVolume(0)` at the window end fired with no ramp.

**Driving the fade off wall-clock elapsed.** Ramping volume from a fixed start value over a fixed wall-clock duration assumes the fade begins at a known offset from the end. Under a drifting media clock the arming sample lands at a different remaining-media-time on every transition, so a wall-clock ramp starting "now" could not reliably reach silence _at the window end_ — it reached silence at start-plus-duration, which drift decoupled from the actual end.

**Verifying only on the tvOS simulator.** The tvOS sim shows 0% failure for this entire class of timing bug because its media lattice is exactly the integer grid the broken code implicitly assumed. "Verified on the tvOS sim" was not evidence the fade worked cross-platform — it was evidence only that it worked on the one platform that cannot expose the defect.

**A test that iterated an integer grid.** The first pure unit test walked `for (let t = 0; t <= end; t += 1)`. That grid _is_ the tvOS 1.0s lattice encoded as a loop; it is structurally incapable of representing Android's fractional, over-1s-spaced samples, so it passed vacuously while the Android path stayed untested.

## Solution

Two changes to the pure curve module, consumed by the player.

**(1) Arm two seconds out — more than one whole nominal interval of margin.** `apps/tv/src/lib/showcaseMode/audioFade.ts:15-20`:

```ts
export const AUDIO_FADE_OUT_SECONDS = 1 // the ramp still occupies only the last second
export const AUDIO_FADE_OUT_ARM_SECONDS = 2 // but arm a whole spare interval earlier
```

`shouldArmFadeOut` opens the window at `endSeconds - 2` (`audioFade.ts:68`):

```ts
export function shouldArmFadeOut({ currentTime, window }): boolean {
  if (!Number.isFinite(currentTime)) return false
  return currentTime >= window.endSeconds - AUDIO_FADE_OUT_ARM_SECONDS
}
```

A ≥2s-wide window cannot be stepped over by a clock whose period is only slightly above 1s — at least one sample always lands inside it. Arming early is free because the curve holds at full volume until the last second (see below), so no audio is skipped by watching earlier.

**(2) Drive the ramp off remaining MEDIA time, not wall-clock elapsed.** `fadeOutVolumeAt` is a pure function of what's _left_ (`audioFade.ts:50`):

```ts
export function fadeOutVolumeAt({
  remainingSeconds,
}: {
  remainingSeconds: number
}): number {
  if (!Number.isFinite(remainingSeconds)) return 1
  return clamp01(remainingSeconds / AUDIO_FADE_OUT_SECONDS)
}
```

With `AUDIO_FADE_OUT_SECONDS = 1` this holds at `1.0` for any `remainingSeconds >= 1` and ramps to `0` exactly as `remainingSeconds` reaches `0`. The player re-bases this on media position and projects forward at 50ms tick granularity in `driveFadeOut` (`ReelPlayer.tsx:232`):

```ts
const driveFadeOut = useCallback(
  (mediaTime: number, endSeconds: number) => {
    stopFade()
    const basedAtMedia = mediaTime
    const basedAtWall = Date.now()
    const tick = () => {
      const projected = basedAtMedia + (Date.now() - basedAtWall) / 1000
      const volume = fadeOutVolumeAt({
        remainingSeconds: endSeconds - projected,
      })
      setVolume(volume)
      if (volume <= 0) stopFade()
    }
    tick()
    fadeTimerRef.current = setInterval(tick, AUDIO_FADE_TICK_MS)
  },
  [stopFade, setVolume],
)
```

Every `timeUpdate` that MOVED re-bases the projection, so whichever sample arms the fade, and however the platform clock drifts between samples, the 50ms local tick interpolates volume down to silence exactly at `endSeconds`. The `timeUpdate` handler gates the arm through a token-keyed latch and re-drives on moved samples (`ReelPlayer.tsx:395`).

**(3) A drift-aware test that the integer grid could not express.** The new phase-sweep in `apps/tv/src/lib/showcaseMode/audioFade.test.ts:137` walks fractional, over-1s-spaced periods across every sub-second phase offset and asserts that _some_ sample still arms with audible content left:

```ts
it("still arms on a drifting, over-1s clock at every phase offset", () => {
  for (const period of [1.01, 1.05, 1.2]) {
    for (let phase = 0; phase < period; phase += 0.05) {
      const w = win(0, 25)
      let armedWithRemaining: number | null = null
      for (let t = phase; t <= 25; t += period) {
        if (
          armedWithRemaining == null &&
          shouldArmFadeOut({ currentTime: t, window: w })
        ) {
          armedWithRemaining = w.endSeconds - t
        }
      }
      expect(armedWithRemaining).not.toBeNull()
      expect(armedWithRemaining!).toBeGreaterThan(0)
      expect(
        fadeOutVolumeAt({ remainingSeconds: armedWithRemaining! }),
      ).toBeGreaterThan(0)
    }
  }
})
```

An invariant test pins the margin so a future edit can't shrink the window back to one interval (`audioFade.test.ts:191`):

```ts
it("arms at least one spare interval before the fade itself begins", () => {
  expect(AUDIO_FADE_OUT_SECONDS).toBe(1)
  expect(AUDIO_FADE_OUT_ARM_SECONDS).toBeGreaterThanOrEqual(
    AUDIO_FADE_OUT_SECONDS + 1,
  )
})
```

Reverting `AUDIO_FADE_OUT_ARM_SECONDS` from `2` back to `1` fails the phase-sweep test (several phase/period combinations never arm) — so the drift-aware test is a real regression guard, not decoration.

## Why This Works

**The platform-clock asymmetry is real and lives in expo-video's native code** (`expo-video@3.0.16`, verified against the installed package):

- **tvOS / iOS** — the vendored `expo-video/ios/VideoPlayerObserver.swift:326` builds the interval as `CMTimeMake(value: Int64(interval * 1000), timescale: CMTimeScale(1000))` (with `interval = 1.0` that is exactly `CMTime(1000, 1000)` = 1.0s) and registers it via `player?.addPeriodicTimeObserver(forInterval:, queue: .main)` (line 329). AVPlayer's periodic observer fires against the item's own **timebase**, so `currentTime` arrives on an exact whole-second media lattice. A sample always lands inside any window ≥1 nominal interval wide.
- **Android** — the vendored `expo-video/android/src/main/java/expo/modules/video/IntervalUpdateClock.kt:42-53` is a self-rescheduling `Handler.postDelayed(update, interval)` where `update` emits and then re-posts itself. `postDelayed` guarantees _at least_ `interval` ms; the main-Looper scheduling latency plus the work done in each emit pushes every real period strictly above 1000ms, and because each post is relative to the previous callback the error **accumulates**. The emitted position is `player.currentPosition / 1000.0` (`expo-video/android/.../VideoPlayer.kt:483`) — arbitrary fractional seconds, not a lattice.

So the same `timeUpdateEventInterval = 1` yields an exact grid on one platform and a drifting, over-1s, fractional clock on the other. Any window sized to exactly one nominal interval is safe on the first and lossy on the second.

**Media-time projection is robust to drift because it targets a position, not a duration.** `fadeOutVolumeAt` computes volume from `endSeconds - projected` — the distance still to travel in media time. It does not care _when_ the fade started or how many samples were missed getting there; from any arming point the curve is a function of what remains, so it reaches exactly `0` at `endSeconds` regardless of the clock's spacing. A wall-clock "fade from 1 to 0 over 1000ms starting now" has no such anchor and drifts off the end.

**The 2s margin specifically covers a period just over 1s.** With a window of width `W` and a clock period `p`, at least one sample lands inside iff `W >= p`. Android's `p` is `1000ms + delta` for a small drift `delta`; `W = 2s` gives roughly a full second of slack over the worst realistic per-sample drift, so the arm is never skipped. The fade itself still occupies only the final second because the curve holds at `1.0` for all `remainingSeconds >= 1` — arming at 2s out costs zero audio.

The fade ramps `player.volume` on the reel's **single long-lived expo-video player** — the reel deliberately uses one player whose source swaps via `replaceAsync`, because a two-player preload pattern triggers a known unreleased tvOS memory leak (session history, from the feat-262 build). The fade exists within that architecture; there is no second player to cross-fade against, which is why volume is ramped on the one player rather than dissolved between two.

## Prevention

- **Never size a timing window to exactly one event-loop / player-callback interval.** "Fires once per interval" is a _nominal_ rate, not a guarantee that a sample lands in any given 1-interval window. Give the window >=1 whole spare interval of margin, and pin that margin with an invariant test (`ARM >= SPAN + 1`) so a later edit can't quietly shrink it back.
- **Drive any time-targeted ramp off media/stream position, not wall-clock elapsed.** If the goal is "reach state X exactly at position P," compute the ramp as a function of `P - currentPosition` and re-base it on every position update. Wall-clock duration ramps silently decouple from the target the moment the source clock drifts, stalls, or is sampled irregularly.
- **Test timing with fractional, >1s-spaced samples across every phase offset — not an integer grid.** A `for (t = 0; t <= end; t += 1)` loop encodes one platform's exact lattice and passes vacuously for every other clock. Sweep periods like `1.01 / 1.05 / 1.2` across sub-second phase offsets so the test can actually represent a drifting clock. This is the repo's "mocked-shape vs real-contract" law (`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`): the integer grid proved the shape the code assumed, not the contract the device delivers.
- **A tvOS simulator cannot catch cross-platform media-clock bugs.** Its `timeUpdate` is an exact integer media lattice, so this whole class shows 0% failure there. Cross-platform timing code needs either real Android TV hardware _or_ a drift-aware unit test as the standing evidence — a green tvOS-sim smoke is not sufficient.
- **This applies to `apps/mobile` too.** Mobile uses the same `expo-video` package with the same per-platform clock split (AVPlayer periodic observer on iOS, `IntervalUpdateClock` `postDelayed` on Android). Any mobile feature that arms an action inside a `timeUpdate`-sized window or ramps a value on wall-clock elapsed has the identical latent hard-cut.

## Related Issues

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META law this is a fresh instance of: the integer-grid test proved branch shape, not the production clock contract. The phase-sweep test is the real-contract check.
- `docs/solutions/logic-errors/liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md` — same file (`ReelPlayer.tsx`), same feat-262 lineage, same "a green suite hid a real timing/guard defect" narrative. Different mechanism (self-referential watchdog arming + ref-lifetime pairing vs platform-clock drift) — a same-file sibling, not a duplicate.
- `docs/solutions/ui-bugs/tv-home-backdrop-crossfade-aba-stall-20260615.md` — thematic sibling: another `apps/tv` crossfade that silently misbehaves until a specific replay pattern is exercised. Different component and root cause.
- `apps/tv/CLAUDE.md` — Showcase Mode / ReelPlayer conventions; `expo-video` for HLS playback.
- PR #1595 (`feat/tv-showcase-audio-fade-credits-guard`) — the change; builds on the Showcase Mode reel from PR #1586 (feat-262).
