---
title: "A nested Animated.sequence never ran on Android Fabric, and the written law named only the loop form"
date: "2026-09-09"
category: "ui-bugs"
module: "apps/mobile"
problem_type: ui_bug
component: frontend_stimulus
severity: high
symptoms:
  - "On an Android release build (emulator API 35) the splash projector screen never appeared -- the mark's scale stayed at 0 for the whole sequence"
  - "The sibling plain Animated.timing calls in the same Animated.parallel (ray, crimson, word) all ran correctly, so only the nested Animated.sequence was inert"
  - "iOS ran the identical code correctly, so the defect was invisible on the simulator used for day-to-day work"
  - "No error or warning appeared, and logcat showed Glide decoding both mark rasters at 1024x748, which ruled out packaging and assets"
  - "The component's 22 existing tests all stayed green -- mutating the mark's scale to a static value failed nothing"
root_cause: wrong_api
resolution_type: code_fix
framework_version: "react-native 0.86.3 / expo 57.0.21 (Fabric new architecture), react 19.2.3"
related_components:
  - "apps/tv"
  - "docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md"
  - "docs/plans/2026-09-09-1059-feat-mobile-animated-splash-plan.md"
tags:
  - react-native
  - animated
  - animated-sequence
  - fabric
  - android
  - new-architecture
  - splash
  - mutation-testing
---

# A nested `Animated.sequence` never ran on Android Fabric, and the written law named only the loop form

## Problem

PR #2216 adds a branded cold-start splash to `apps/mobile` (open, not yet
merged, as of 2026-09-09). The layer runs four
beats inside one `Animated.parallel`. A white projector screen blooms in, one
ray of light grows from the right edge, the screen crossfades to brand crimson,
and the word `Jesus` fades in on top
(`apps/mobile/src/components/splash/SplashSequence.tsx`, the `Animated.parallel` the sequence effect starts).

The bloom was first written as an `Animated.sequence` of two timings, nested
inside that `Animated.parallel`. No `Animated.loop` was present anywhere. On an
Android release build the nested sequence never ran. The bloom's
`Animated.Value` stayed at 0, so the projector screen never appeared. The three
sibling plain timings in the same `parallel` ran correctly. The beam therefore
grew and pointed at nothing, and the word faded in over an empty field. iOS ran
the identical code correctly.

This is the code PR #2216 removed:

```tsx
Animated.parallel([
  Animated.sequence([
    Animated.timing(bloom, {
      toValue: BLOOM_OVERSHOOT_SCALE,
      duration: SPLASH_BLOOM_RISE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }),
    Animated.timing(bloom, {
      toValue: 1,
      duration: SPLASH_BLOOM_SETTLE_MS,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: true,
    }),
  ]),
  Animated.timing(rayGrow, {
    /* ... */
  }), // ran
  Animated.timing(crimson, {
    /* ... */
  }), // ran
  Animated.timing(wordFade, {
    /* ... */
  }), // ran
])
```

The mark read that value directly, as `transform: [{ scale: bloom }]`.

### The configuration this was observed on

This is an empirical observation on one build, made on 2026-09-09. It is not a
claim about every React Native version or every Android device.

- Android release build, Android emulator, API 35.
- Expo SDK 57 — `apps/mobile/package.json:36` pins `"expo": "~57.0.21"`.
- React Native 0.86.3 — `apps/mobile/package.json:58`.
- React 19.2.3 — `apps/mobile/package.json:57`.
- The new architecture (Fabric) is on —
  `apps/mobile/android/gradle.properties:38` sets `newArchEnabled=true`.
- Every timing used `useNativeDriver: true`.

**The mechanism inside React Native is not known.** Nobody read the Fabric or
NativeAnimated source to explain why the nested sequence did not start. What is
established is the observed behaviour and the fix that removed it. Treat any
explanation beyond that as unverified.

## Symptoms

- The projector screen never appeared on the Android release build, while the
  beam and the word both drew.
- The mark's scale stayed at 0 for the whole sequence.
- iOS showed the same code working, so the defect looked platform-specific
  rather than construct-specific.
- Logcat showed Glide decoding both mark rasters at 1024x748, so the images were
  packaged, found and loaded. The in-tree record of this is the comment at
  `apps/mobile/src/components/splash/__tests__/SplashSequence.test.tsx`,
  `it("uses no Animated.sequence at all")`.
- The whole jest suite, `tsc`, eslint and prettier stayed green through the
  defect. No automated check could see it.

## What Didn't Work

### The corpus law covers only the loop form

The repository already carried a doc for this area:
`docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md`.
Its trailing Fabric note reads, at lines 204-207:

> Fabric note: `Animated.loop(Animated.sequence(...))` runs only once on the new
> architecture, and a JS-driver loop won't update native views — use a single
> `Animated.loop(Animated.timing(...))` + interpolation on the native driver for
> continuous animation. (auto memory [claude])

That claim is scoped to a loop that wraps a sequence. The failure in PR #2216
needed no loop at all.

The agent's own auto-memory entry carries the same narrow scope. Its
`description` line is "RN New Architecture (Fabric) — looped Animated.sequence
stops after one iteration, and JS-driver Animated may not update views; use a
looped single timing + interpolation on the native driver for continuous
pulses" (auto memory [claude], `rn-animated-loop-fabric-gotcha`). That entry
records Expo SDK 54 and RN 0.81, a different configuration from the one above.

### The plan reasoned correctly from that law and ruled the defect out

The feature plan, `docs/plans/2026-09-09-1059-feat-mobile-animated-splash-plan.md`,
took the written law and drew a conclusion from it. Decision KTD9 says, at line
192:

> A looped `Animated.sequence` runs only once on Fabric, so any repeat must loop
> a single timing and interpolate from it.

The plan then turned that decision into a test scenario for unit U4, in its Approach list:

> No `Animated.loop` wraps a sequence, so the Fabric single-run defect cannot
> appear.

Both sentences are faithful to the law as written. Both are also wrong about the
code that shipped, because the defect sat one construct away from the law's
scope. **Correct reasoning from a too-narrow written law still produced a
shipped Android defect.** No review of the law, and no application of it, could
have caught this. A device found it.

### The pre-existing guard forbade only the loop

The suite's guard block already asserted that no `Animated.loop` is ever called
(`apps/mobile/src/components/splash/__tests__/SplashSequence.test.tsx`,
`it("never wraps a sequence in Animated.loop")`).
That guard is the letter of KTD9. It passed on the broken code, because the
broken code used no loop.

## Solution

Carry both halves of the bloom on ONE timing, and put the overshoot in an
`interpolate()` instead of a second timing. Compute the phase boundary from the
two durations, so the two constants still state the shape.

The phase boundary and the overshoot value
(`apps/mobile/src/components/splash/SplashSequence.tsx`, `SPLASH_BLOOM_RISE_MS` through `BLOOM_OVERSHOOT_AT`):

```tsx
/** The screen's rise into its overshoot. */
export const SPLASH_BLOOM_RISE_MS = 460
/** Its settle back. Longer than the rise, so the screen does not snap. */
export const SPLASH_BLOOM_SETTLE_MS = 540
const BLOOM_OVERSHOOT_SCALE = 1.08
/** Where in the bloom's progress the overshoot sits, so ONE timing can carry
 *  both halves. A nested Animated.sequence does not run on Android/Fabric —
 *  the mark simply never appeared, while its sibling timings did. */
const BLOOM_OVERSHOOT_AT =
  SPLASH_BLOOM_RISE_MS / (SPLASH_BLOOM_RISE_MS + SPLASH_BLOOM_SETTLE_MS)
```

The interpolation the mark reads
(`apps/mobile/src/components/splash/SplashSequence.tsx`, `bloomScale`, applied on the
mark as `transform: [{ scale: bloomScale }]`):

```tsx
const bloomScale = useMemo(
  () =>
    bloom.interpolate({
      inputRange: [0, BLOOM_OVERSHOOT_AT, 1],
      outputRange: [0, BLOOM_OVERSHOOT_SCALE, 1],
    }),
  [bloom],
)
```

The single timing that drives it
(`apps/mobile/src/components/splash/SplashSequence.tsx`, the `Animated.timing(bloom, …)` entry):

```tsx
Animated.timing(bloom, {
  toValue: 1,
  duration: SPLASH_BLOOM_RISE_MS + SPLASH_BLOOM_SETTLE_MS,
  // Decelerating, so the overshoot is reached early in wall-clock time
  // and the settle back takes the rest — R8's "settle slower than the
  // rise" expressed as one curve rather than two timings.
  easing: Easing.out(Easing.cubic),
  useNativeDriver: true,
})
```

## Why This Works

The `Animated.Value` now runs from 0 to 1 once, on the native driver, inside a
plain `Animated.timing`. That is the same construct as the three sibling beats
that always ran on Android. The overshoot is no longer a second animation. It is
a point on the output curve, so nothing has to be scheduled after anything else.

`BLOOM_OVERSHOOT_AT` is `460 / (460 + 540)`, which is `0.46`. Progress 0.46 maps
to scale 1.08, and progress 1 maps to scale 1. The design rule that the settle
must be slower than the rise now lives in the easing rather than in two
durations. `Easing.out(Easing.cubic)` decelerates, so the animation passes
progress 0.46 early in wall-clock time and spends the rest of the second
settling back. The two exported duration constants keep their meaning, because
the boundary is computed from them.

## Diagnosing the next one

The route that found this defect is worth copying, because the visible symptom
pointed at the wrong layer. A missing image on Android reads first as a
packaging or asset-resolution failure.

1. Read logcat before touching the code. Glide reported both mark rasters
   decoded at 1024x748. That single line ruled out packaging, path resolution
   and decoding, and left the transform as the only remaining suspect.
2. Compare the platforms. iOS ran the same JavaScript correctly, so the
   difference was in the native animation layer, not in the composition logic.
3. Bisect the animation composition by construct, not by value. The siblings in
   the same `Animated.parallel` were plain timings and ran. The one child that
   did not run was the one wrapped in a different construct.

The iOS behaviour of the finished sequence was measured separately, on the
iPhone 17 Pro Max simulator with a Release build. The session recorded a cold
launch with `xcrun simctl io recordVideo` and sampled frames with ffmpeg. These
timings are a session measurement with no artifact committed to the repository,
so treat them as an order-of-magnitude record rather than a reproducible
figure: the flat `#1c1917` native field held from 0.4s to 1.6s, the bloom
appeared at about 2.0s, the crimson settled at 2.8s, the word was up and fading
at 4.0s, and Home was visible at 5.2s. Frame sampling, not a screenshot, is what
makes an animation claim checkable at all.

## Prevention

### 1. Forbid the construct, not the reported form of it

The guard now spies on both `Animated.sequence` and `Animated.loop` and asserts
that neither is ever called. It carries the dated device observation in a
comment, so the next reader gets the evidence with the rule
(`apps/mobile/src/components/splash/__tests__/SplashSequence.test.tsx`,
`describe("the Fabric single-run defect (KTD9)")`):

```tsx
describe("the Fabric single-run defect (KTD9)", () => {
  it("never wraps a sequence in Animated.loop", async () => {
    const loop = jest.spyOn(Animated, "loop")
    await render({ reduceMotion: false })
    expect(loop).not.toHaveBeenCalled()
  })

  it("uses no Animated.sequence at all", async () => {
    // Observed on the Android release build, emulator API 35: the bloom was an
    // Animated.sequence nested in the Animated.parallel and simply never ran,
    // while its sibling plain timings did. Glide logged both mark rasters
    // decoded at 1024x748, so the images were fine — the scale stayed at 0 and
    // the projector screen never appeared. iOS ran the same code correctly.
    const sequence = jest.spyOn(Animated, "sequence")
    await render({ reduceMotion: false })
    expect(sequence).not.toHaveBeenCalled()
  })
```

A companion case pins the bloom to exactly one timing of the full duration, and
pins the whole layer to four timings — one per beat
(`apps/mobile/src/components/splash/__tests__/SplashSequence.test.tsx`,
`it("drives the bloom's overshoot by interpolation, not a second timing")`).

### 2. A call-shape guard alone cannot see this defect class

Every guard above reads `Animated` CALLS. The defect was a layer that never
moved. A layer can stop moving without any call changing, so no call-shape
assertion can detect it.

A code reviewer proved this by mutation during PR #2216. Changing the mark's
style from `transform: [{ scale: bloomScale }]` to a static
`transform: [{ scale: rest }]` left all 22 tests of the suite green at that
point. That is the same defect class that had already reached Android.

The fix is a test that DRIVES each beat's own `Animated.Value` and reads the
RENDERED style back. The helper takes the value off the timing's own call, so
the test cannot be satisfied by a value that no layer reads
(`apps/mobile/src/components/splash/__tests__/SplashSequence.test.tsx`, `valueDrivenBy`):

```tsx
function valueDrivenBy(
  timing: jest.SpyInstance,
  matches: (config: { delay?: number }) => boolean,
): Animated.Value {
  const call = timing.mock.calls.find(([, config]) => matches(config))
  expect(call).toBeDefined()
  return call![0] as Animated.Value
}
```

The case itself drives all four values to 1 and then reads the mark's scale, the
ray's scale, the crimson layer's opacity and the word's opacity
(`apps/mobile/src/components/splash/__tests__/SplashSequence.test.tsx`,
`it("drives every beat's own layer, not just the timing config")`).
A second case drives the bloom to the same fraction `BLOOM_OVERSHOOT_AT` holds —
recomputed inline from the two duration constants, because the constant itself
is not exported — and asserts the rendered scale is greater than 1, which pins
the overshoot itself (lines 451-469).

### 3. A rest-state assertion is ALSO insufficient — this is the subtle part

The reviewer's first suggested fix was to assert the mark's rest values in the
motion path. That assertion passes on the broken code.

The layer seeds every value at 0 when motion is on, and at 1 when Reduce Motion
is on: `const rest = reduceMotion ? 1 : 0`
(`apps/mobile/src/components/splash/SplashSequence.tsx`, `const rest`). In the motion
path `rest` is therefore 0. The suite's existing motion-path case asserts that
the mark's scale is 0 before anything runs
(`apps/mobile/src/components/splash/__tests__/SplashSequence.test.tsx`,
`it("starts the sequence when it is off")`).
A static `transform: [{ scale: rest }]` also reads 0 there. The mutation
survives the assertion.

Only driving the value and reading the style back kills that mutation. Five
mutations were run against the new guards in PR #2216, and each one turned the
new tests red: the static-scale mutation, an `app.json` font-family rename, a
raised ceiling constant, a dropped effect cleanup, and a no-op retraction.

**The rule:** when a beat's whole job is to reach a layer, assert on the
RENDERED value after driving the source, at a point where the broken and correct
implementations must differ. A rest state where both read the same number is not
such a point.

### 4. Audit the other `Animated.sequence` call sites, and the prose next to them

After the fix, `apps/mobile` contains no `Animated.sequence(` call at all. The
only remaining mentions are explanatory comments and the guards themselves.

`apps/tv` still calls `Animated.sequence` in three files:

- `apps/tv/src/components/showcaseMode/ExcerptChrome.tsx:99`
- `apps/tv/src/components/showcaseMode/ReelPlayer.tsx:724` and `:735`
- `apps/tv/src/components/watch/VideoBackdrop.tsx:220`

Each of those is a TOP-LEVEL sequence that the effect starts directly. None is
nested inside an `Animated.parallel`, so none has the shape observed to fail.
`apps/tv` also runs a different configuration — `apps/tv/package.json` pins
Expo `~54.0.33` and `react-native-tvos@0.81-stable` — so the observation above
does not transfer to it. These sites are named here as an audit list, not as
suspected defects.

One piece of prose does need correcting when someone next works in that file.
`apps/tv/src/components/showcaseMode/ExcerptChrome.tsx:97-98` states:

```tsx
// One-shot sequence, not a loop: Animated.loop(Animated.sequence(...)) runs once
// on Fabric. A plain sequence is safe and is VideoBackdrop's poster-hold shape.
```

The sentence "A plain sequence is safe" is broader than any verified
observation. It is the same too-narrow reading that let this defect ship. It is
unverified on the TV configuration in either direction. Do not delete the
comment on the strength of this doc alone; measure on Android TV first, then
state what the measurement shows.

### 5. Source-shape guards are the established sibling pattern

`apps/mobile` already used a source-text guard for the loop form of this defect
family. `apps/mobile/src/components/ui/__tests__/circularSpinner.test.ts:41`
asserts `expect(SOURCE).not.toContain("Animated.sequence(")`, and matches the
CALL rather than the bare name so the component's own explanatory comment does
not trip it. `apps/mobile/src/hooks/useShimmerOpacity.ts:16-33` carries the
working single-timing-plus-interpolation shape. The splash guard is the spy
form of the same idea. Either form is acceptable. Both must forbid the
construct, not only the form the last incident happened to take.

## Related Issues

- `docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md`
  — carries the Fabric note whose scope this incident widens. Its rules on
  Animated cleanup are unaffected. Only the trailing note's breadth is at issue.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the standing law that mocked tests prove branch SHAPE and not production
  CONTRACT. This incident is a worked instance on both axes. A call-shape guard
  proved the shape and missed the contract, and a rest-state assertion where
  both implementations read 0 could not discriminate at all.
- `docs/solutions/ui-bugs/android-home-hero-black-refreshcontrol-surfaceview-compositing.md`
  — the sibling Android-only rendering defect on the same app and the same
  Expo SDK 57 / RN 0.86 Fabric upgrade, also invisible to every check until a
  device ran it, and also diagnosed by reading logcat first.
- `docs/solutions/ui-bugs/expo-splash-screen-sdk57-full-bleed-default-change.md`
  — the other splash-screen regression on the same SDK upgrade.
- `apps/mobile/src/components/splash/SplashSequence.tsx` and its suite
  `apps/mobile/src/components/splash/__tests__/SplashSequence.test.tsx` — the
  fix and the guards, from PR #2216 (open at the time of writing).
