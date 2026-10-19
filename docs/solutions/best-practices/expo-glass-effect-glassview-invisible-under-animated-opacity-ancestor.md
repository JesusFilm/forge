---
title: "expo-glass-effect GlassView fails under an animated-opacity ancestor; keep the glass out of the fade and dissolve it"
date: "2026-08-13"
last_updated: "2026-10-19"
category: "best-practices"
module: "apps/mobile"
problem_type: "best_practice"
component: "tooling"
severity: "medium"
applies_when:
  - "Rendering expo-glass-effect's GlassView inside a view whose opacity is animated (Animated.View, Reanimated shared value, or any ancestor driving an opacity style)"
  - "Showing and hiding Liquid Glass on chrome or controls that fade in and out, such as auto-hide player controls or a short-lived label"
  - "Deciding between GlassSurface (GlassView), expo-blur's BlurView, and Image blurRadius for a translucent surface in this app"
  - "Verifying whether a translucent effect is actually compositing its material, or only rendering it subtly"
symptoms:
  - "On expo-glass-effect 0.1.10, GlassView renders no material at all inside an Animated.View with animated opacity - not subtle, fully invisible"
  - "On expo-glass-effect 57.0.4, GlassView inside a fading layer draws glass on some reveals and not on others, and the result differs per button"
  - "Setting an opaque tintColor such as rgba(255,0,0,0.9) on the GlassView produces zero visible change, even at 4x magnification of a device screenshot"
  - "The same GlassView props render visible glass elsewhere in the same app, over the same video, on the same screen"
  - "Nothing logs - no warning, no error, no red box, and the component tree is correct"
related_components:
  - "apps/mobile/src/components/ui/GlassSurface.tsx"
  - "apps/mobile/src/components/ui/PlatformBlur.tsx"
  - "apps/mobile/src/components/watch/VideoPlayer.tsx"
  - "apps/mobile/src/components/watch/PlayerControls.tsx"
  - "apps/mobile/src/components/watch/SeekFlashPill.tsx"
  - "apps/mobile/src/hooks/useControlsVisibility.ts"
  - "apps/mobile/src/lib/liquidGlass.ts"
tags:
  - "expo-glass-effect"
  - "glassview"
  - "glass-dissolve"
  - "expo-blur"
  - "ios-liquid-glass"
  - "animated-opacity"
  - "video-player-chrome"
  - "ios26"
retire_when: "expo-glass-effect installs and keeps the glass under a low-alpha ancestor, so the isEffectRenderable gate and its comment leave ios/GlassView.swift; check the installed package source and the expo-glass-effect CHANGELOG"
---

# GlassView fails inside an animated-opacity ancestor; keep the glass out of the fade and dissolve it

## Update 2026-10-16 (feat-705, PR #2750)

The rule still holds: do not put a `GlassView` inside a layer whose opacity an
ancestor animates. Two things changed, and both change what you do.

- **The failure is now partial, not total.** On `expo-glass-effect` 57.0.4 the
  glass draws on some reveals only. In the player's fading layer, AirPlay drew
  glass on 5 of 5 reveals, Back 10 on 1 of 5, and the other buttons on none
  (iPhone Air simulator, iOS 26.5, 2026-10-15). A surface that draws only
  sometimes is not usable.
- **The fix on iOS 26 is no longer `BlurView`.** Keep the glass outside the
  fade, and dissolve the material with
  `glassEffectStyle: { style: "none", animate: true }`. The dissolve worked on 5
  of 5 changes, including the first change from `"none"`. Fade the glyph or the
  label on its own layer inside the glass. `GlassSurface` does all of this, and
  the player chrome now uses it.

`BlurView` through `PlatformBlur` stays the look where Liquid Glass is not
available: Android and iOS before 26. The Context section below is the August
diagnosis on 0.1.10, as written then. The Guidance, Examples and the operating
rule are updated for 57.0.4.

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
for the auto-hide fade. In August 2026 the layer in
`apps/mobile/src/components/watch/VideoPlayer.tsx` faded on every platform:

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

`controls.opacityAnim` is an `Animated.Value` that
`apps/mobile/src/hooks/useControlsVisibility.ts` creates and drives with
`Animated.timing(…, { useNativeDriver: true })`. This ancestor is the trigger,
and the scope boundary below states how narrowly.

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

### The 57.0.4 re-check (session history)

The feat-705 audit repeated the test before it planned native glass for the
player chrome. A spike put a `GlassView` with a loud magenta tint into the
fading controls layer and revealed the controls five times. The first captures
showed no magenta, but that result was false: the controls were hidden, and the
gear in the capture was the Expo dev menu's floating button, not the player's
settings button. With the controls revealed, the per-button counts above came
out. A second spike switched `FloatingBackButton`'s `glassEffectStyle` between
`"regular"` and `"none"` every 1.5 s, with no fading ancestor and the glyph on
its own layer. The material dissolved and came back on 5 of 5 changes. Both
spikes were temporary edits, and neither was committed.

## Guidance

**Never put a `GlassView` inside a layer whose opacity an ancestor animates.**
Keep the glass outside the fade, and give each kind of motion its own mechanism:

| What must change                  | Mechanism                                                                                                                    | `GlassSurface` prop          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| The material appears or goes      | `glassEffectStyle: { style: "regular" \| "none", animate: true }`                                                            | `visible`, `dissolveSeconds` |
| The glyph or label fades          | One `Animated.View` around the children, inside the `GlassView`                                                              | `fade`                       |
| A button shows that it is pressed | Apple's press response (`isInteractive`) on glass, a dim in the fallback. An opacity below 1 on any ancestor stops the glass | `interactive`, `pressed`     |
| Liquid Glass is not available     | `PlatformBlur`: a blur on iOS before 26, a flat dim on Android                                                               | `fallback`                   |

Use `GlassSurface` in `apps/mobile/src/components/ui/GlassSurface.tsx` for every
floating control. It reads `canUseLiquidGlass()` from
`apps/mobile/src/lib/liquidGlass.ts` once, and it holds the whole rule in one
place:

```tsx
function LiquidGlassSurface({
  style,
  visible = true,
  dissolveSeconds = DEFAULT_DISSOLVE_SECONDS,
  tintColor,
  fade,
  interactive,
  children,
}: GlassSurfaceProps) {
  const reduceMotion = useReduceMotion()
  return (
    // On 57.0.4 isInteractive no longer flashes white on remount (iPhone 15
    // Pro, iOS 26.5, 2026-10-19). The 0.1.9 flash is why older code omits it.
    <GlassView
      isInteractive={interactive}
      style={style}
      glassEffectStyle={{
        style: visible ? "regular" : "none",
        animate: !reduceMotion,
        animationDuration: visible ? dissolveSeconds.in : dissolveSeconds.out,
      }}
      colorScheme="dark"
      tintColor={tintColor}
    >
      {fade == null ? (
        children
      ) : (
        <Animated.View style={{ opacity: fade }}>{children}</Animated.View>
      )}
    </GlassView>
  )
}
```

The `fade` wrapper is a child of the glass, not an ancestor. Its opacity does not
enter the alpha product that the library checks (see Why This Matters).

On the fallback path a fade may wrap the whole surface, because a blur has no
such limit. So a container that keeps its own fade there must pass `fade` to the
glass path only, or the surface fades twice.

### Where the fade goes when a whole layer used to fade

The player chrome is the worked case. On the glass path, the controls layer in
`VideoPlayer.tsx` does not fade. `PlayerControls` gets the fade value and the
controls' published visibility, and fades its own parts:

```tsx
<Animated.View
  style={[
    StyleSheet.absoluteFill,
    !glass && { opacity: controls.opacityAnim },
  ]}
  pointerEvents="box-none"
>
  <PlayerControls
    …
    fade={glass ? controls.opacityAnim : undefined}
    visibleStore={glass ? controls.visibleStore : undefined}
  />
</Animated.View>
```

Each plate takes `fade` for its glyph and `visible` for its material.
`PlayerControls` reads the published visibility with `useControlsGlassVisible`
and passes it to each plate as `visible`. The seek bar sits outside any plate, so it fades
on its own layer. The scrim behind the chrome keeps its fade, because it holds
no glass.

### The scope boundary — read this before you generalize

**"GlassView is broken in this app" is FALSE.** `GlassView` renders visible
glass today, in this same app, over video. `FloatingBackButton.tsx` and
`HomeHeader.tsx` did so in August, and every `GlassSurface` does so now.

The back button proved the boundary most sharply. On the watch route it renders
as a sibling of the player's dock wrapper, so the fading `Animated.View` — which
lives inside the player's own tree — is never its ancestor. It sits on the same
screen, above the same video, and its glass is visible. The only structural
difference from the failing pill was the animated-opacity ancestor.

So the rule is narrow: an animated opacity on an ancestor is the trigger. A
dissolve on the glass itself and a fade on a child layer are both safe.

### Three blur mechanisms live in this app — pick deliberately

| Mechanism                                    | What it is                                     | Use when                                                                                        |
| -------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GlassView` via `GlassSurface`               | iOS 26 system Liquid Glass material            | Any floating control on iOS 26, including auto-hide chrome, with no fading ancestor             |
| `BlurView` (`expo-blur`), via `PlatformBlur` | Live backdrop blur on iOS, flat dim on Android | The `GlassSurface` fallback, and a surface whose ancestor must fade, such as the hero backdrops |
| `blurRadius` on `Image`                      | A blurred bitmap, not a vibrancy surface       | A soft wash derived from a still image, as in `WatchAmbient.tsx`                                |

The third is easy to mistake for the other two by eye. It blurs a bitmap and
never samples what is behind it, so it is immune to this whole class of problem
— and equally unable to react to live video.

## Why This Matters

**What the library source shows (57.0.4).** `GlassView` installs its effect in
`layoutSubviews`, and only after a check. The check multiplies the `alpha` of the
view and every superview, and requires the product to be above 0.02
(`isEffectRenderable` in the package file `ios/GlassView.swift`). Below that, the view waits on a
display link and installs the effect later. The source comment states the reason:
"UIKit silently skips the glass effect when the view's opacity is low, and never
installs it again."

57.0.4 added this wait. Its CHANGELOG entry reads "Fix the glass effect not
rendering when the view fades in from low opacity" (expo/expo#48994). That fits
the August result: on 0.1.10 a glass that first laid out at a low alpha never
drew. The wait does not make a fading ancestor safe. The check runs before the
first install only (`guard !isMounted`), so a later fade is not checked again.
The 0.02 limit is also a trial-and-error value, per the source comment. Why some
buttons drew and others did not is not known, and nobody measured it.

**Why the dissolve is safe.** A style change to `"none"` or `"regular"` with
`animate: true` runs inside `UIView.animate(withDuration:)` and swaps the effect
of the same visual effect view (`applyGlassStyle` in the same package file). No
alpha changes, so the install check never sees a low value.

**The cost of the old answer.** `BlurView` drew a visible backplate in the fading
layer, and it shipped in PR #1927. But it is not the iOS 26 system material, so
the player chrome would not match the native glass that feat-705 puts on every
other floating control. The dissolve gives the player the same material, with
no fading ancestor.

## When to Apply

Reach for this doc when a translucent effect is invisible or looks weaker than
expected, and especially when the surface sits inside anything that fades.

**Use the falsification test on any "maybe it is just subtle" effect.** Set the
parameter to a value whose absence is impossible to miss, then look. For a tint,
use a near-opaque saturated colour. For a size, use an absurd one. For a delay,
use ten seconds. The purpose is not to ship that value. The purpose is to make
one observation decide between "the effect is weak" and "the effect is absent",
because those two diagnoses need opposite next moves. Magnify the capture before
judging it — this case needed 4x, and at 1x the answer still looked ambiguous.

**Make sure the probe is live and the surface is on screen.** Fast Refresh does
not reliably apply changes to the material. Terminate and relaunch the dev
client, and prove the reload landed with an unmistakable colour. Then reveal the
auto-hide controls before you capture, and do not mistake the Expo dev menu's
floating gear for the player's settings button (session history).

**Find the nearest working instance before blaming the component.** When a
third-party view misbehaves, search the app for a call site that works, then
diff the ancestor chain rather than the props. Here the props were identical and
the ancestor was the whole story.

**Expect no automated guard.** No jest guard forbids `GlassView` inside an
animated-opacity layer. Render suites mock `GlassView` and `PlatformBlur` — to
`() => null`, a pass-through, or a host element — so they assert tree shape and
props, never pixels. jest-expo also reports Liquid Glass as available, so a suite
that does not mock `canUseLiquidGlass` or `expo-glass-effect` takes the glass
path; pin the branch in each suite. Verify
any change to a blur or glass surface on a simulator or device, with a
screenshot.

**Watch two traps when the fade moves into the glass.** Both come from the
native-driven fade on the child layer, not from the glass.

- A press during the 150 ms hide fade stops the fade, and the native side
  reports the stopped position late. `snapReveal` in `useControlsVisibility.ts`
  sets the value again in the `stopAnimation` reply. Without it, a plate that
  re-rendered drew its glyph at about 30% (measured 2026-10-15).
- On Fabric iOS, after a native animation writes `opacity` to a view, React
  commits for that key on the same view do not apply. A label that shows again
  while its fade runs keeps the dim value. `SeekFlashPill.tsx` gives each flash a
  new `Animated.Value` and keys the view on the flash id, so each flash gets a
  new view (see the comment at the top of `SeekFlashPill.tsx`).

**If you need to judge blur cost, measure it twice.** A prior session measured
an always-on blurred layer on the Android emulator with `dumpsys gfxinfo`; the
first run showed 39.7% jank and the repeat showed 0.65% with the layer present
versus 0.96% without. The first number was first-load noise from video buffering
and cold image decode, not the blur. Discard the first measurement (session
history).

**Keep the two `GlassView` opacity failures apart.** They are different defects
with different fixes, and merging them produces wrong advice:

- **Opacity applied TO the `GlassView`**: the native layer ignores the value on
  iOS. To show and hide the glass, dissolve it with the `"none"` style, or mount
  and unmount it. See the related doc below.
- **Opacity animated on an ANCESTOR of the `GlassView`** (this doc): the glass
  draws nothing on 0.1.10 and only sometimes on 57.0.4. Changing the value does
  not help. Move the glass out of the fade and dissolve it.

## Examples

**Before (August 2026, PR #1927).** The player chrome used `PlatformBlur` for
every backplate, because the whole controls layer faded:

```tsx
// Frosted backplate for every chrome control. Lighter than the hero blurs so a
// 44pt control does not read as a solid block.
function Frosted({ style, children }: { … }) {
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

**After (feat-705, PR #2750).** Each backplate is a `GlassSurface`. On iOS 26 the
material dissolves with `visible` and the glyph fades with `fade`. Elsewhere the
same element draws `PLATE_FALLBACK`, the old blur:

```tsx
function Plate({ style, fade, visible, children }: { … }) {
  return (
    <GlassSurface
      style={style}
      fallback={PLATE_FALLBACK}
      fade={fade}
      visible={visible}
    >
      {children}
    </GlassSurface>
  )
}
```

**A short-lived label.** The double-tap ±10 s label in `SeekFlashPill.tsx` holds
for 600 ms, then leaves over 250 ms. When it leaves, it sets `visible` to false
with `dissolveSeconds={{ in: 0, out: 0.25 }}`, and it fades its `fade` value to
0 over the same 250 ms. The glass and the label leave together, and no ancestor
fades. The match of the dissolve and the label fade on a device is not verified
yet; it is in the PR's device check.

## Related

- [`homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md`](../ui-bugs/homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md)
  — adjacent and distinct. That doc records `GlassView` ignoring an `opacity`
  value applied to itself on iOS, and prescribes conditional mount for show and
  hide. The `"none"` dissolve is now a second way to show and hide. Its rule 3
  repeats this doc's 0.1.10 wording.
- [`expo-glass-effect-interactive-flash-2026-04-08.md`](./expo-glass-effect-interactive-flash-2026-04-08.md)
  — same component, a third failure mode: on 0.1.9, `isInteractive` flashed
  white on remount. On 57.0.4 the owner saw no flash, so `GlassSurface` now sets
  it on buttons. It is this app's general "how to integrate GlassView" reference. Its
  section on fading layers repeats this doc's 0.1.10 wording.
- [`mobile-auto-hide-overlay-fade-race-ref-sync.md`](../design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md)
  — documents the auto-hide chrome hook that now also publishes the visibility
  the glass plates read. Work on that layer needs both its ref-sync contract and
  this constraint.
- [`expo-image-blurradius-cross-platform-calibration.md`](../mobile/expo-image-blurradius-cross-platform-calibration.md)
  — distinguishes the three blur mechanisms and establishes the iOS-blur /
  Android-dim split that `PlatformBlur` formalizes.
- `apps/mobile/CLAUDE.md`, section "Liquid Glass (feat-705)", and the plan
  `docs/plans/2026-10-15-1036-feat-mobile-native-liquid-glass-plan.md` — the
  full set of glass rules in this app: the availability check, the sheets, the
  dark window style and the contrast result.

Taken together the GlassView docs give one operating rule for
`expo-glass-effect` in this app: use `GlassSurface`. Do not fade the `GlassView`
or any ancestor of it. Change the material only through `glassEffectStyle` with
`animate: true`, and fade content only inside the glass. Give a button Apple's
own press response with `interactive`, and give it to no panel or label. That
response sees only a touch on the glass. A ring of up to 6 pt outside the glass
with no cue is accepted (owner, 2026-10-19); a wider gap needs the glass to fill
the touch target or its own cue. Where Liquid Glass is not available, the
`fallback` draws a `PlatformBlur` or a plain fill.

## Versions and verification

- August 2026: `expo-glass-effect` `~0.1.10`, `expo-blur` `~15.0.8`, `expo`
  `~54.0.36`. iOS 26 simulator, iPhone 17 Pro Max; the Android dim path was also
  checked on the Pixel 9a emulator. Verified 2026-08-13 in PR #1927, merged
  2026-08-13.
- October 2026: `expo-glass-effect` `~57.0.4` on Expo SDK 57. The fading-layer
  counts and the dissolve were measured on the iPhone Air simulator, iOS 26.5,
  on 2026-10-15. The player chrome and the skip label ship in PR #2750, which is
  open and unmerged at the time of writing.
- 2026-10-19: the owner ran the branch on an iPhone 15 Pro, iOS 26.5, through
  Metro. The glass buttons drew, and `isInteractive` on every `GlassSurface`
  gave no white flash on tab switches, a video opened and closed, or a return
  from the background. The tab bar is native now (`NativeTabs`), so a tab switch may not remount a screen, and this check may not have run the 0.1.9 trigger. Fresh mounts did run, such as the player buttons when a video opens. The skip-label fade has no device
  result yet.
