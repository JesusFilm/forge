---
title: "Fade an expo-glass-effect GlassView through glassEffectStyle; a style change before its first layout pops in at full"
date: "2026-10-13"
category: "best-practices"
module: "apps/mobile"
problem_type: "best_practice"
component: "tooling"
severity: "medium"
applies_when:
  - "A Liquid Glass button or surface (expo-glass-effect GlassView) must fade in or fade out"
  - "The glass sits over a ground that a cover in a flat color cannot match, such as a blur over video"
  - "A GlassView mounts and changes its glassEffectStyle at once, for example to start a fade-in"
  - "A recording shows a glass button at full material in the first frame while its siblings fade"
symptoms:
  - "The blur and the text of an overlay fade in, but its glass buttons show at full material in the first frame"
  - "A per-frame brightness trace of the button area jumps from dark to full in one frame on the fade-in, while the fade-out is smooth"
root_cause: "async_timing"
resolution_type: "code_fix"
related_components:
  - "apps/mobile/src/components/dailyPause/PauseFrame.tsx"
  - "apps/mobile/src/components/dailyPause/ClosePrompt.tsx"
  - "apps/mobile/src/components/dailyPause/PartPlayer.tsx"
  - "apps/mobile/src/components/dailyPause/useFadeOut.ts"
  - "apps/mobile/src/components/ui/PlatformBlur.tsx"
tags:
  - "expo-glass-effect"
  - "glassview"
  - "glasseffectstyle"
  - "liquid-glass"
  - "ios26"
  - "fade-in"
  - "fade-out"
  - "first-layout"
  - "requestanimationframe"
  - "animated-opacity"
  - "daily-bible-pause"
  - "mobile"
---

# Fade an expo-glass-effect GlassView through glassEffectStyle; a style change before its first layout pops in at full

## Context

The Daily Bible Pause close prompt blurs the run and asks "Close the
devotional?" with two Liquid Glass pill buttons. The owner asked for the blur,
the text, and the buttons to fade in and out together. The prompt uses 250 ms.

Two rules in this app block the obvious ways to fade a `GlassView`:

- An animated opacity on an ancestor makes the glass draw nothing. See
  [`expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md`](./expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md).
- An opacity on the `GlassView` itself does not hide it on iOS, and no test
  proves that such an opacity fades it. See
  [`homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md`](../ui-bugs/homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md).

Earlier work in the same feature used a cover to obey both rules (session
history, 2026-10-06 and 2026-10-07). A layer in the screen's own color sat over
the glass and faded away. A grey pill sat over the glass for a disabled state. A
cover works only over a flat ground that is known in advance. The close prompt
sits over a blurred run that can hold a playing video, so no flat color matches
its ground. Each glass button had to fade itself.

The first version mounted the glass with style `"none"` and switched it to
`"regular"` in the next commit, with `useEffect(() => setEntered(true), [])`. A
60 fps simulator recording showed the blur and the text fade in. The Close
button area was dark in every frame before the tap, then full cream in the
first frame after it. The glass did not fade in; it popped in.

## Guidance

**Fade the glass through `glassEffectStyle`. Fade only the label by opacity.**
The style accepts a config object,
`{ style, animate?, animationDuration? }`, with the duration in seconds
(`GlassEffectStyleConfig` in
`apps/mobile/node_modules/expo-glass-effect/build/GlassView.types.d.ts`). The
style `"none"` removes the material. The label sits in an `Animated.View` inside
the glass, so no opacity is above the glass. From
`apps/mobile/src/components/dailyPause/PauseFrame.tsx` (`PauseButton`):

```tsx
<GlassView
  testID="pause-glass-button"
  style={styles.glassButton}
  glassEffectStyle={
    fade == null
      ? "regular"
      : {
          style: fade.shown ? "regular" : "none",
          animate: true,
          animationDuration: fade.durationMs / 1000,
        }
  }
  colorScheme="dark"
  tintColor={outline ? undefined : pauseColors.ink}
  isInteractive
>
  {fade == null ? (
    labelNode
  ) : (
    <Animated.View
      testID="pause-glass-label-fade"
      style={{ opacity: fade.opacity }}
    >
      {labelNode}
    </Animated.View>
  )}
</GlassView>
```

This sample and the `PausedCue` sample below set `isInteractive`. Do not copy
that prop. See the last item under When to Apply.

**For a fade-in, mount the glass with `"none"`. Switch the style to `"regular"`
two frames after mount.** From
`apps/mobile/src/components/dailyPause/ClosePrompt.tsx`:

```tsx
const [opacity] = useState(() => new Animated.Value(0))
// The glass mounts with no material, and the fade starts two frames later.
// iOS animates no change in the frame that first draws the glass.
const [entered, setEntered] = useState(false)
useEffect(() => {
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => setEntered(true))
  })
  return () => cancelAnimationFrame(frame)
}, [])
const shown = entered && !leaving
```

The `entered` latch also controls when the blur, the text, and the labels start
their opacity fade. So every layer starts its fade in the same frame. Under Reduce
Motion the component passes a duration of 0, and the glass and the labels change
at once.

**Mount a new view, with a new opacity value, for each show.** On React Native
0.86 Fabric iOS, React commits no `opacity` to a view after native Animated has
written it, until Fabric recycles the view (auto memory [claude]). A code review
found that a quick resume and pause could leave the play cue faint for that
reason. So the cue mounts a new view per show (`key={cue.show}`), and the run
screen mounts a new `ClosePrompt` per open (`key={promptView.show}`). Both keys
come from `useFadeOut`, which also keeps the view mounted while it fades out.

## Why This Matters

**The cause is in the native view, so the fix is a delay, not a prop.** In
`expo-glass-effect` 57.0.4, the native view applies no material before its first
layout pass. The citations below are in
`apps/mobile/node_modules/expo-glass-effect/ios/GlassView.swift`, a gitignored
install:

- `updateEffect()` returns at once while `isMounted` is false
  (`ios/GlassView.swift:309-312`).
- `isMounted` turns true only in `installEffect()`
  (`ios/GlassView.swift:87-94`).
- `layoutSubviews()` calls `installEffect()` on the first layout pass, when the
  material can render (`ios/GlassView.swift:54-64`).
- `installEffect()` sets the material directly. That call is outside the
  `UIView.animate` block that `applyGlassStyle` uses for `animate: true`
  (`ios/GlassView.swift:170-201`).

So when a style arrives before the first layout, the native view stores it but
does not apply it. The install then draws it at full, with no animation. The line numbers are for 57.0.4, so read
the file again after an upgrade.

**Two frames worked. Nobody tried one frame.** So two frames is a margin, not a
measured minimum. Do not shorten it without a new recording.

**The delay does not cover a glass that waits for visibility.** The install
waits while the product of the alphas up the superview chain is 0.02 or less
(`isEffectRenderable`, `ios/GlassView.swift:66-85`). A display link checks on
each frame, and asks for a new layout when the glass can render. In that case
the install can come after the two frames, and the glass can pop in again.

The comment above `isEffectRenderable` says "UIKit silently skips the glass
effect when the view's opacity is low, and never installs it again". That is the
library's own account of the ancestor-opacity failure. This doc did not test
that failure again on 57.0.4.

**A fade-out alone needs no delay.** The paused play cue in
`apps/mobile/src/components/dailyPause/PartPlayer.tsx` (`PausedCue`) mounts at
`"regular"` with no fade, because it appears at once. It leaves through
`{ style: "none", animate: true, animationDuration }`, and its glyph fades by
opacity. The glass is already drawn when that change comes, so the animation
runs.

**Jest cannot see a pop.** The Pause suites mock `GlassView` to a host element,
so a test can check the props but not the native install. Only a recording shows
the first frame.

## When to Apply

- Any `GlassView` that must fade. Fade its `glassEffectStyle`. Keep every
  opacity off the glass and its ancestors.
- Any `GlassView` that changes its style at mount. Wait two frames, or the first
  change shows at full.
- Do not use this where an ancestor must fade, such as the player chrome. There
  the glass drew nothing on Expo SDK 54, and nobody tested that case on 57.0.4.
  `PlatformBlur` is still the answer.
- Android and iOS before 26 have no Liquid Glass. `PauseButton` and `PausedCue`
  fall back to a plain pill or disc. When they fade, they fade the whole button
  by opacity.
- The Daily Bible Pause code sets `isInteractive` inside a `Pressable` on three
  glass buttons: `PauseButton`, `PausedCue`, and the Home header's bell
  (`AnnouncementsButton`). The
  [isInteractive flash doc](./expo-glass-effect-interactive-flash-2026-04-08.md)
  forbids that after a white flash on a tab switch on Expo SDK 54. The iOS 26.5
  simulator showed no flash when the Pause buttons mount. Nobody tested a tab
  switch on SDK 57. Until such a test shows no flash, do not copy
  `isInteractive` into new code.

## Examples

**Before: switch in the commit after mount (the glass pops in).**

```tsx
// The glass mounts with no material and then fades it in, so the first
// commit shows nothing and the next one starts the fade.
const [entered, setEntered] = useState(false)
useEffect(() => setEntered(true), [])
```

**After: switch two frames after mount (the glass fades in).** See the
`ClosePrompt.tsx` block under Guidance.

**Fade-out only: no delay.** From `PausedCue` in `PartPlayer.tsx`:

```tsx
<GlassView
  testID="part-paused-cue-glass"
  style={styles.cueGlass}
  glassEffectStyle={
    leaving
      ? {
          style: "none",
          animate: true,
          animationDuration: CUE_FADE_MS / 1000,
        }
      : "regular"
  }
  colorScheme="dark"
  isInteractive
>
  <Animated.View testID="part-paused-cue-glyph" style={{ opacity }}>
    {glyph}
  </Animated.View>
</GlassView>
```

### How to see a pop

Record the simulator. Then print the mean brightness of the button area for
each frame:

```bash
xcrun simctl io <udid> recordVideo fade.mp4
ffmpeg -hide_banner -loglevel error -i fade.mp4 \
  -vf "crop=<w>:<h>:<x>:<y>,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" \
  -f null -
```

A fade shows a ramp over many frames. A pop shows a jump from dark to full in
one frame.

## Versions and verification

- `expo-glass-effect` 57.0.4, `expo` ~57.0.26, `react-native` 0.86.3 (see
  `apps/mobile/package.json`).
- iPhone 17 Pro Max simulator, iOS 26.5, 2026-10-12: after the fix, the fade-in
  took about 200 ms (13 frames) and the fade-out about 220 ms (14 frames), with
  no pop. On 2026-10-09 the play cue's glass fade-out took about 13 frames on
  the iPhone 17 simulator.
- `apps/mobile/src/components/dailyPause/__tests__/PauseGlassButton.test.tsx`
  ("fades the close prompt's glass buttons with no fading ancestor") checks
  `"none"` at mount, `"regular"` after 50 ms, no opacity above the glass, and
  one label fade per button. "gives the close prompt's glass no fade time under
  Reduce Motion" checks the 0 duration.
- Not checked: a physical device, and Reduce Motion on a simulator.
- The code is in PR #2680. That PR targets the `Ur-imazing/pause-devo-feature`
  branch, not `main`. On 2026-10-13 it was open and not merged.

## Related

- [`expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md`](./expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md)
  — the ancestor-opacity failure this technique avoids. Until 2026-10-13 its
  closing rule said "Do not animate it". The rule now forbids an animated
  opacity on the glass or on a layer that contains it. The rule points to this
  doc for a fade through `glassEffectStyle`.
- [`homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md`](../ui-bugs/homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md)
  — an opacity on the `GlassView` itself. That doc says that iOS ignores this
  opacity, and it marks the opacity fade of its title pill as unverified. This
  doc gives a fade that uses no opacity on the glass.
- [`expo-glass-effect-interactive-flash-2026-04-08.md`](./expo-glass-effect-interactive-flash-2026-04-08.md)
  — the `isInteractive` remount flash on SDK 54.
- [`native-animated-stop-report-overwrites-immediate-setvalue.md`](../ui-bugs/native-animated-stop-report-overwrites-immediate-setvalue.md)
  — another first-frame native timing trap, proved with the same 60 fps
  recording method.
- [`layout-effect-commit-lag-mini-player-shrink-flash.md`](../logic-errors/layout-effect-commit-lag-mini-player-shrink-flash.md)
  — Fabric keeps a native-driven value whatever React writes, which is why each
  show mounts a new view.
- [`mobile-auto-hide-overlay-fade-race-ref-sync.md`](../design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md)
  — a view that stays mounted while it fades out, as `useFadeOut` does here.
