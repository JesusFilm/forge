---
title: "Android TV layout scaling and native view clipping fixes"
date: "2026-04-16"
last_updated: "2026-06-20"
category: ui-bugs
module: tv-app
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "All UI elements (cards, fonts, padding, borders) appeared ~2x too large on Android TV compared to Apple TV"
  - "expo-image and LinearGradient native views completely invisible inside FocusableCard on Android TV"
  - "Touch targets and auto-scroll worked on invisible cards, confirming views existed but visual content was not painted"
  - "FocusableCard default backgroundColor rendered on top of native child views on Android"
  - "A full-height expo-video VideoView inside an overflow:hidden hero punched through and rendered over the rail below it on Android TV (the inverse of the expo-image clip-to-invisible failure); correct on tvOS"
root_cause: config_error
resolution_type: code_fix
severity: high
tags:
  - android-tv
  - tvos
  - density-scaling
  - overflow-hidden
  - expo-image
  - linear-gradient
  - focusable-card
  - react-native-tvos
  - 10-foot-ui
  - surfaceview
  - video-backdrop
---

# Android TV layout scaling and native view clipping fixes

## Problem

Android TV at 640 dpi reports a logical canvas of ~960x540dp — roughly half the ~1920x1080dp canvas Apple TV uses. All dp values tuned for Apple TV rendered ~2x too large on Android TV. Additionally, expo-image and LinearGradient native views inside `FocusableCard` were completely invisible on Android TV despite being interactive.

## Symptoms

- All UI elements (cards, fonts, padding, borders) appeared approximately 2x too large on Android TV, occupying 2x the expected screen percentage.
- Card images (expo-image) and gradient overlays (LinearGradient) were completely invisible inside `FocusableCard` on Android TV — touch targets and auto-scroll worked correctly, confirming the views existed but their visual content was not painted.
- The `backgroundColor` of FocusableCard's inner `View` appeared to render on top of native child views on Android.

## What Didn't Work

1. **`renderToHardwareTextureAndroid` on `Animated.View` alone** — Native child views remained invisible. Hardware texture promotion on the outer wrapper is not sufficient without addressing the inner View's clipping.

2. **`needsOffscreenAlphaCompositing` alone** — Same result. Offscreen compositing on the outer view doesn't fix the inner View's `overflow: "hidden"` swallowing native children.

3. **`collapsable={false}` on inner `View` alone** — No effect on visibility. Preventing view flattening is necessary but not sufficient.

4. **Moving `overflow: "hidden"` to outer `Animated.View` alone** — Did not fix card images in isolation. The `backgroundColor` on the inner View was still painting over native content. (session history)

5. **Removing `backgroundColor` from inner `View` alone** — Did not restore image rendering by itself. The `overflow: "hidden"` clipping of native views was the primary issue; backgroundColor removal was a necessary secondary fix.

## Solution

### Fix 1: Scale utility (`apps/tv/src/lib/scale.ts`)

A density-aware scaling function that normalizes dp values against Apple TV's 1920-wide reference canvas:

```typescript
import { Dimensions, Platform } from "react-native"

const REFERENCE_WIDTH = 1920
const { width: SCREEN_WIDTH } = Dimensions.get("window")

const SCALE_FACTOR =
  Platform.OS === "android"
    ? (SCREEN_WIDTH || REFERENCE_WIDTH) / REFERENCE_WIDTH
    : 1

export function scale(size: number): number {
  if (SCALE_FACTOR === 1) return size
  return Math.round(size * SCALE_FACTOR)
}
```

Applied across 16 component files — every hardcoded dp value (fonts, padding, margins, card dimensions, border radii) wrapped in `scale()`.

**Before:**

```typescript
const CARD_WIDTH = 320
const styles = StyleSheet.create({
  heading: { fontSize: 24, paddingHorizontal: 80 },
})
```

**After:**

```typescript
const CARD_WIDTH = scale(320)
const styles = StyleSheet.create({
  heading: { fontSize: scale(24), paddingHorizontal: scale(80) },
})
```

### Fix 2: FocusableCard native view visibility

The working solution required all four changes together:

```tsx
<Animated.View
  renderToHardwareTextureAndroid={isFocused} // gated on focus
  needsOffscreenAlphaCompositing={Platform.OS === "android" && isFocused}
  style={[
    styles.outer, // overflow: "visible" — allows focus glow to bleed
    layoutStyle,
    isFocused && styles.focusGlow,
    { transform: [{ scale }] },
  ]}
>
  <View
    style={[styles.inner, visualStyle, { flex: 1 }]} // overflow: "hidden", no backgroundColor
    collapsable={false}
  >
    {children}
  </View>
</Animated.View>
```

Key changes:

- **Removed default `backgroundColor`** from inner View — it was composited on top of native children on Android.
- **Added `collapsable={false}`** — prevents Android's view flattening from eliding the intermediate View node.
- **Added `flex: 1`** to inner View — ensures it fills the outer Animated.View's dimensions for absolutely positioned children.
- **Hardware compositing props gated on `isFocused`** — avoids permanent GPU texture allocation for every card; promotes only during animation.

### Fix 3: Additional corrections

- Video player shadow `shadowOffset` changed from `{ height: 4 }` to `{ height: 0 }` for centered glow.
- `paddingBottom: scale(600)` on scroll container ensures the last section can scroll to the top of the viewport for focus transfer.
- `SCREEN_WIDTH` falls back to `REFERENCE_WIDTH` when `Dimensions.get("window").width` returns `0` on Android cold start.

## Why This Works

**Sizing:** Android TV at 640 dpi divides its 3840x2160 physical pixels by the density factor, yielding ~960x540dp. Apple TV uses ~1920x1080dp. A ratio of `screenWidth / 1920` normalizes any dp value so it occupies the same screen percentage on both platforms. `Math.round()` prevents sub-pixel blurriness on Android — a documented CLAUDE.md convention.

**Native view visibility:** On Android, `overflow: "hidden"` on a plain React Native `View` clips the _visual paint_ of native-backed children (expo-image, LinearGradient) without clipping their layout or touch areas. The views are "there" (interactive) but invisible. The `backgroundColor` on the container is composited on top of native children in Android's render order. Removing it and using `collapsable={false}` together allow native views to paint correctly. Hardware compositing props ensure the Animated overlay doesn't tear native child layers during focus transitions.

## Update (2026-06-20): VideoView (SurfaceView) punch-through — the inverse failure mode (PR #1325)

Prevention rule #2 below ("never `overflow:"hidden"` over native-backed views on Android") has a **second, opposite-looking failure mode** worth its own example, hit while adding a "next-row peek" to the TV watch-detail hero.

`expo-image` and `LinearGradient` inside `overflow:"hidden"` get their paint **clipped → invisible** (the FocusableCard case above). But an **expo-video `VideoView` is backed by an Android `SurfaceView`**, which the OS composites at a separate hardware layer _after_ the RN layout pass. It is not clipped at all — it **punches through and renders OVER the content below the clip** (and over sibling RN views in the same ancestor), ignoring both `overflow:"hidden"` and JSX/`zIndex` draw order. Same root constraint, mirror-image symptom: expo-image disappears; `VideoView` over-paints.

### Symptom

The watch hero was shortened to `SCREEN_HEIGHT - HERO_PEEK` with `overflow:"hidden"` so the "Up Next" rail peeks above the fold, and `VideoBackdrop` rendered a full-`SCREEN_HEIGHT` `VideoView` inside it — the same full-height-clip trick the series screen uses for its static `expo-image` backdrop. On **tvOS** (`AVPlayerLayer` composites through UIKit and clips) it looked correct. On **Android TV** the bottom ~`HERO_PEEK` (170px) of the live trailer rendered on top of the Up Next rail, and a bottom-fade `LinearGradient` placed as a sibling of the backdrop _in the hero_ was drawn under the SurfaceView, so it masked nothing. The Apple-TV-simulator screenshot looked perfect — the bug is Android-TV-only.

### Fix — two parts, both required

**1. Size the surface to the visible region by construction.** You cannot clip a SurfaceView with an ancestor's `overflow:"hidden"`, so make the `VideoView` only as tall as the visible hero. `VideoBackdrop`'s container is `absoluteFillObject`, so rendering it inside the `SCREEN_HEIGHT - HERO_PEEK` hero (instead of a full-height layer) sizes the `VideoView` to the clipped height on both platforms — there is no overflow region to punch through.

**2. Draw any overlay over the SurfaceView as a sibling AFTER the `VideoView`, inside the SAME parent, with `collapsable={false}`.** This is the exact mechanism `VideoBackdrop`'s ambient scrims already use. A fade placed in the parent hero (a sibling of the backdrop _component_) is punched through; the same fade moved _inside_ `VideoBackdrop`, after the `VideoView`, composites correctly. Exposed via an opt-in `bottomFadeColor` prop:

```tsx
// VideoBackdrop.tsx — inner bottom fade, LAST child, after <VideoView>, collapsable={false}
{
  bottomFadeColor != null ? (
    <LinearGradient
      colors={[
        hexToRgba(bottomFadeColor, 0),
        hexToRgba(bottomFadeColor, 0.8),
        bottomFadeColor,
      ]}
      locations={[0, 0.65, 1]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.bottomFade} // position:absolute, left/right:0, bottom:0, height: HERO_BOTTOM_FADE_HEIGHT
      pointerEvents="none"
      collapsable={false}
    />
  ) : null
}

// watch/[slug].tsx — VideoBackdrop fills the SHORTENED hero (no full-height wrapper) + passes the fade color
;<VideoBackdrop
  streamingUrl={backdropSource ?? null}
  posterUrl={displayPoster}
  overlayVisible={playerState.isVisible}
  bottomFadeColor={WATCH_THEME.below}
/>
```

### Why expo-image is safe but VideoView is not

`expo-image`'s `Image` is a plain RN texture view the layout system clips normally, so the series screen's static backdrop CAN render at full `SCREEN_HEIGHT` inside the shortened hero and rely on `overflow:"hidden"` to clip it (full framing preserved, top not trimmed). A `VideoView` cannot — it must be sized to the visible region by construction.

### Verification

The tvOS simulator cannot reproduce this — `AVPlayerLayer` clips correctly, so a sim screenshot is a false "pass." Verify any change to z-ordering/clipping around a `VideoView` on a real **Android TV** emulator with the backdrop video **playing** — the poster `Image` clips fine, so the bug only appears once the SurfaceView's video fades in. Confirmed fixed on `Television_1080p_API_36` with a live-playing backdrop.

(session history) `VideoBackdrop` already gives the `VideoView` Surface-specific handling elsewhere — its mount is gated on `!overlayVisible` to free the single tvOS decode slot for the fullscreen player, and the series hero is deliberately image-only for that same decoder reason. This punch-through fix extends the "the `VideoView` needs special treatment" posture from decoding to compositing/clipping.

## Prevention

- **Always use `scale()` for TV dp values.** Never hardcode raw dp values for dimensions, fonts, padding, or border radii in TV UI code. All sizing flows through the scale utility so both platforms share a single reference canvas.

- **Never place `overflow: "hidden"` on a plain `View` that directly parents native-backed views** (expo-image, LinearGradient, VideoView) on Android. Move clipping to an outer `Animated.View` or a wrapper that doesn't interpose between the native view and the compositing layer.

- **Never set `backgroundColor` on a container that wraps native child views on Android** unless explicitly needed — it may paint over native view content.

- **Gate hardware compositing props on interaction state** (`isFocused`, `isPlaying`) to avoid unnecessary GPU texture allocation for idle or off-screen cards.

- **Test on the 1080p Android TV emulator** (`Television_1080p_API_36`) in addition to Apple TV simulator. The 4K emulator consumes ~6.8GB RAM and ~4x GPU load; the 1080p AVD exercises the same density path at a fraction of the host resource cost.

- **Guard against `Dimensions.get("window")` returning 0 on Android cold start.** Use `(screenWidth || referenceWidth)` as a fallback to prevent division yielding 0.

- **You cannot clip an Android `SurfaceView` (`expo-video VideoView`, `react-native-video`, Camera, Maps, GL) with an ancestor's `overflow:"hidden"` — size the surface itself to the visible region.** Unlike expo-image/LinearGradient (which get clipped to invisible), a SurfaceView ignores the clip and renders OVER the content below it. The full-height-inside-a-clipped-parent trick is safe for `Image` but not for `VideoView`.

- **An overlay that must layer over an Android `SurfaceView` must be a sibling placed AFTER it, inside the SAME parent component, with `collapsable={false}`.** A scrim/fade/gradient in an ancestor or outer sibling — even a direct parent of the backdrop — is punched through on Android regardless of JSX order or `zIndex`.

- **A change to z-ordering or clipping around a `VideoView` is not "done" until verified on a real Android TV emulator with the video playing.** tvOS (`AVPlayerLayer`) clips correctly, so the simulator hides SurfaceView bugs; and the poster `Image` clips fine, so the punch-through only appears once the video fades in.

## Related Issues

- `docs/solutions/ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md` — The FocusableCard outer/inner layer split for focus glow clipping (predecessor to this fix)
- `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md` — Pitfall 5 covers native view compositing issues on tvOS; this doc extends the pattern to Android TV
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` — Section 6 documents the FocusableCard focus management pattern
- `docs/solutions/mobile/responsive-typography-hook.md` — Documents `Math.round()` for scaled font sizes on Android (same principle applied here via `scale()`)
- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — Android VideoView SurfaceView z-order issues (same native compositing constraint family)
- `docs/solutions/ui-bugs/tv-backdrop-videoview-decoder-starvation-overlay-20260611.md` — the OTHER `VideoBackdrop` SurfaceView special-case (decode-slot starvation; `!overlayVisible` mount gate). Same component/file, different facet (decoding vs the 2026-06-20 clipping update above)
- `docs/solutions/performance-issues/tv-mobile-series-detail-overfetch-and-childdublanguages-index-20260619.md` — shipped in the same PR (#1325); the series/watch detail-screen query trim that motivated the hero "next-row peek" layout
