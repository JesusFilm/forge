---
title: "expo-glass-effect GlassView renders no material under an animated-opacity ancestor"
date: "2026-08-13"
category: "best-practices"
module: "apps/mobile"
problem_type: "best_practice"
component: "tooling"
severity: "medium"
applies_when:
  - "Rendering expo-glass-effect's GlassView inside a view whose opacity is animated (Animated.View, Reanimated shared value, or any ancestor driving an opacity style)"
  - "Building a frosted-glass backplate for chrome or controls that fade in and out, such as auto-hide player controls"
  - "Deciding between GlassView, expo-blur's BlurView, and Image blurRadius for a translucent surface in this app"
  - "Verifying whether a translucent effect is actually compositing its material, or only rendering it subtly"
symptoms:
  - "GlassView renders no material at all inside an Animated.View with animated opacity - not subtle, fully invisible"
  - "Setting an opaque tintColor such as rgba(255,0,0,0.9) on the GlassView produces zero visible change, even at 4x magnification of a device screenshot"
  - "The same GlassView props render visible glass elsewhere in the same app, over the same video, on the same screen"
  - "Nothing logs - no warning, no error, no red box, and the component tree is correct"
related_components:
  - "apps/mobile/src/components/watch/VideoPlayer.tsx"
  - "apps/mobile/src/components/ui/PlatformBlur.tsx"
  - "apps/mobile/src/components/ui/FloatingBackButton.tsx"
  - "apps/mobile/src/components/ui/HomeHeader.tsx"
tags:
  - "expo-glass-effect"
  - "glassview"
  - "expo-blur"
  - "blurview"
  - "ios-liquid-glass"
  - "animated-opacity"
  - "video-player-chrome"
  - "ios26"
  - "mobile"
---

# GlassView renders nothing inside an animated-opacity ancestor; BlurView renders correctly

## Context

The watch player's chrome controls needed a translucent backplate. Bare white
glyphs and a bare white timestamp sit over arbitrary video frames, so a bright
shot destroys their contrast. The obvious primitive was `GlassView` from
`expo-glass-effect`, because `apps/mobile` already uses it for the floating back
button and the home header.

`GlassView` produced no material at all inside the player chrome. The timestamp
pill it wrapped showed bare white text over the video with no backplate behind
it. The failure was total, not partial: the wrapped subtree rendered, and the
glass rendered nothing. Nothing logged.

The chrome controls live inside one `Animated.View` whose `opacity` is animated
for the auto-hide fade. See `apps/mobile/src/components/watch/VideoPlayer.tsx`:

```tsx
{controls.mounted && !awaitingAutostart && (
  <Animated.View
    style={[StyleSheet.absoluteFill, { opacity: controls.opacityAnim }]}
    pointerEvents="box-none"
  >
    <PlayerControls … />
  </Animated.View>
)}
```

`controls.opacityAnim` is an `Animated.Value` created at
`apps/mobile/src/hooks/useControlsVisibility.ts:42` and driven by
`Animated.timing(…, { useNativeDriver: true })` in the same hook. This ancestor
is the trigger, and the scope boundary below states how narrowly.

### How it was diagnosed

The order matters, because three of the four steps were wrong turns.

**1. `GlassView` with the house pattern.** The first attempt copied the working
call sites verbatim — `glassEffectStyle="regular"` plus `colorScheme="dark"`, as
at `apps/mobile/src/components/ui/FloatingBackButton.tsx` and
`apps/mobile/src/components/ui/HomeHeader.tsx`. No visible backplate. The first
reading was wrong: "iOS 26 Liquid Glass is subtle over dark video." That reading
cost time, because it made the symptom look like a tuning problem.

**2. A tint to give the glass definition.** Adding a quarter-black `tintColor`
produced no change whatsoever. This should have been the first alarm. A tint
that changes nothing is not a weak effect.

**3. A forced Metro re-transform.** This session had already hit a stale Metro
transform once, so the file was `touch`ed and the screen re-captured. The result
was identical. That ruled out a stale bundle, but it did not move the diagnosis
forward, because the test still could not distinguish "faint" from "absent".

**4. The falsification test that settled it.** The tint was set to
`tintColor="rgba(255,0,0,0.9)"` — a 90%-opaque pure red. A device screenshot was
then magnified 4x over the pill. Zero pixels changed. A 90%-opaque red backplate
cannot be subtle, so the view was an empty passthrough, not an effect that
needed tuning.

That single step converted an unfalsifiable claim ("maybe it is just subtle")
into a decided one ("it renders nothing"), and it changed the search from "which
prop tunes this" to "why does this view produce no output here".

None of the `GlassView` experiment code was committed. The branch contains only
the `BlurView` solution, so the surviving record of the gotcha is the doc
comment in `apps/mobile/src/components/ui/PlatformBlur.tsx`.

## Guidance

**Do not use `GlassView` inside a layer whose opacity an ancestor animates. Use
`expo-blur`'s `BlurView` there.** In this app that means reaching for
`apps/mobile/src/components/ui/PlatformBlur.tsx`, which wraps the choice and
already handles the Android split:

```tsx
/**
 * Translucent backdrop that blurs on iOS and dims flat on Android — expo-blur is
 * unreliable there, so every surface in this app makes the same split. Note that
 * expo-glass-effect's GlassView is NOT a drop-in here: it renders nothing inside
 * a fading (animated-opacity) layer, and it ignores the opacity prop on iOS.
 */
export function PlatformBlur({
  style,
  intensity = 50,
  tint = "dark",
  androidDim = "rgba(0, 0, 0, 0.6)",
  children,
}: PlatformBlurProps) {
  if (Platform.OS === "ios") {
    return (
      <BlurView intensity={intensity} tint={tint} style={style}>
        {children}
      </BlurView>
    )
  }
  return (
    <View style={[style, { backgroundColor: androidDim }]}>{children}</View>
  )
}
```

The doc comment carries the whole learning at the one place a future author
picks the primitive. Three call sites route through it: the two hero backdrops
in `apps/mobile/src/components/home/HomeHeroPager.tsx` and
`apps/mobile/src/components/sections/VideoHeroRenderer.tsx` at intensity 50, and
the player chrome backplate in
`apps/mobile/src/components/watch/PlayerControls.tsx` at intensity 40 via a
local `Frosted` helper.

### The scope boundary — read this before you generalize

**"GlassView is broken in this app" is FALSE.** `GlassView` renders visible
glass today, in this same app, over video, in
`apps/mobile/src/components/ui/FloatingBackButton.tsx` and
`apps/mobile/src/components/ui/HomeHeader.tsx`.

The back button proves the boundary most sharply. On the watch route it renders
as a sibling of the player's dock wrapper, so the fading `Animated.View` — which
lives inside the player's own tree — is never its ancestor. It sits on the same
screen, above the same video, and its glass is visible. The only structural
difference from the failing pill is the animated-opacity ancestor.

So the rule is narrow: `GlassView` is not a drop-in inside a layer whose opacity
an ancestor animates. Outside such a layer it stays the correct primitive, and
the change that produced this learning left both existing call sites untouched.

### Three blur mechanisms live in this app — pick deliberately

Choosing a translucent surface here is a three-way decision, not two (session
history):

| Mechanism                                    | What it is                                     | Use when                                                         |
| -------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `GlassView` (`expo-glass-effect`)            | iOS 26 system Liquid Glass material            | Static chrome outside any animated-opacity layer                 |
| `BlurView` (`expo-blur`), via `PlatformBlur` | Live backdrop blur on iOS, flat dim on Android | Anything inside a fading or animated layer                       |
| `blurRadius` on `Image`                      | A blurred bitmap, not a vibrancy surface       | A soft wash derived from a still image, as in `WatchAmbient.tsx` |

The third is easy to mistake for the other two by eye. It blurs a bitmap and
never samples what is behind it, so it is immune to this whole class of problem
— and equally unable to react to live video.

## Why This Matters

State the certain part and the uncertain part separately.

**What was proved.** `BlurView` renders a visible frosted backplate inside the
fading chrome layer. `GlassView`, with the same props and in the same position,
renders nothing there. The falsification test at 90%-opaque red is the evidence
for "nothing" rather than "faint".

**The suspected mechanism, which was NOT proved.** A backdrop-sampling view
needs to read the pixels behind it. It plausibly cannot sample through its own
compositing group, and an animated opacity plausibly creates one — the fade runs
with `useNativeDriver: true`, so the opacity is applied on the native layer that
hosts the whole chrome subtree. That story fits every observation here. It rests
on no native-layer inspection, no Xcode view-debugger capture, and no Apple
documentation. Treat it as a hypothesis. If a later session needs the real
answer, capture the layer tree in the Xcode view debugger with the chrome
visible and compare the `GlassView` and `BlurView` cases.

**Why `BlurView` escapes the same problem is also unknown.** Both are backdrop
effects. Only the outcome was isolated. Do not build a theory of iOS compositing
on this doc.

## When to Apply

Reach for this doc when a translucent effect is invisible or looks weaker than
expected, and especially when the surface sits inside anything that fades.

**Use the falsification test on any "maybe it is just subtle" effect.** Set the
parameter to a value whose absence is impossible to miss, then look. For a tint,
use a near-opaque saturated colour. For a size, use an absurd one. For a delay,
use ten seconds. The purpose is not to ship that value. The purpose is to make
one observation decide between "the effect is weak" and "the effect is absent",
because those two diagnoses need opposite next moves. Tuning a prop that renders
nothing can consume a whole session and never fail loudly. Magnify the capture
before judging it — this case needed 4x, and at 1x the answer still looked
ambiguous.

**Find the nearest working instance before blaming the component.** When a
third-party view misbehaves, search the app for a call site that works, then
diff the ancestor chain rather than the props. Here the props were identical and
the ancestor was the whole story. A component-level conclusion ("this library is
broken") would have been wrong and would have cost two working surfaces.

**Expect no automated guard.** No jest guard forbids `GlassView` inside an
animated-opacity layer, and none is proposed — the condition is a runtime
rendering outcome on a native view, which jest cannot see. The `PlayerControls`
suite deliberately mocks `BlurView` to a plain `View`, so it asserts tree shape
and never pixels. Verify any change to a blur or glass surface on a simulator or
device, with a screenshot.

**If you need to judge blur cost, measure it twice.** A prior session measured
an always-on blurred layer on the Android emulator with `dumpsys gfxinfo`; the
first run showed 39.7% jank and the repeat showed 0.65% with the layer present
versus 0.96% without. The first number was first-load noise from video buffering
and cold image decode, not the blur. Discard the first measurement (session
history).

**Keep the two `GlassView` opacity failures apart.** They are different defects
with different fixes, and merging them produces wrong advice:

- **Opacity applied TO the `GlassView`**: the native layer ignores the value on
  iOS. Mount and unmount is the reliable show-and-hide mechanism. See the
  related doc below.
- **Opacity animated on an ANCESTOR of the `GlassView`** (this doc): the glass
  renders nothing at all. Changing the value does not help, because there is
  nothing to fade. Use `BlurView` instead.

## Examples

The player chrome wraps `PlatformBlur` in a local helper so every control shares
one backplate treatment, in
`apps/mobile/src/components/watch/PlayerControls.tsx`:

```tsx
// Frosted backplate for every chrome control. Lighter than the hero blurs so a
// 44pt control does not read as a solid block.
function Frosted({
  style,
  children,
}: {
  style: StyleProp<ViewStyle>
  children: ReactNode
}) {
  return (
    <PlatformBlur
      style={style}
      intensity={40}
      androidDim={hexToRgba(SURFACE_COLOR, 0.6)}
    >
      {children}
    </PlatformBlur>
  )
}
```

Each backplate style sets `overflow: "hidden"` so the blur clips to the
control's corner radius.

## Related

- [`homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md`](../ui-bugs/homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md)
  — adjacent and distinct. That doc records `GlassView` ignoring an `opacity`
  value applied to itself on iOS, and prescribes conditional mount for show and
  hide. This doc records `GlassView` rendering nothing when an ancestor animates
  opacity. Its workaround does not generalize here: conditional mount does not
  help a `GlassView` whose parent fades.
- [`expo-glass-effect-interactive-flash-2026-04-08.md`](./expo-glass-effect-interactive-flash-2026-04-08.md)
  — same component, a third failure mode: `isInteractive` flashes white on
  remount. It is this app's general "how to integrate GlassView" reference and
  does not cover animated ancestors.
- [`mobile-auto-hide-overlay-fade-race-ref-sync.md`](../design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md)
  — documents the exact auto-hide chrome layer that triggers this. Work on that
  layer needs both its ref-sync contract and this constraint.
- [`expo-image-blurradius-cross-platform-calibration.md`](../mobile/expo-image-blurradius-cross-platform-calibration.md)
  — distinguishes the three blur mechanisms and establishes the iOS-blur /
  Android-dim split that `PlatformBlur` now formalizes.

Taken together the GlassView docs give one operating rule for
`expo-glass-effect` in this app: `GlassView` is a static chrome primitive. Do
not animate it, do not animate a layer that contains it, and do not set
`isInteractive` on it. When any of those is required, use `PlatformBlur`.

## Versions and verification

- `expo-glass-effect` `~0.1.10`, `expo-blur` `~15.0.8`, `expo` `~54.0.36` (see
  `apps/mobile/package.json`)
- iOS 26 simulator, iPhone 17 Pro Max. The Android dim path was also checked on
  the Pixel 9a emulator.
- Verified 2026-08-13 on branch `fix/mobile-watch-player-chrome`, in PR #1927,
  which is open and unmerged at the time of writing.
