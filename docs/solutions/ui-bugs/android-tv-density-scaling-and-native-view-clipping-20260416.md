---
title: "Android TV layout scaling and native view clipping fixes"
date: "2026-04-16"
category: ui-bugs
module: tv-app
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "All UI elements (cards, fonts, padding, borders) appeared ~2x too large on Android TV compared to Apple TV"
  - "expo-image and LinearGradient native views completely invisible inside FocusableCard on Android TV"
  - "Touch targets and auto-scroll worked on invisible cards, confirming views existed but visual content was not painted"
  - "FocusableCard default backgroundColor rendered on top of native child views on Android"
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

## Prevention

- **Always use `scale()` for TV dp values.** Never hardcode raw dp values for dimensions, fonts, padding, or border radii in TV UI code. All sizing flows through the scale utility so both platforms share a single reference canvas.

- **Never place `overflow: "hidden"` on a plain `View` that directly parents native-backed views** (expo-image, LinearGradient, VideoView) on Android. Move clipping to an outer `Animated.View` or a wrapper that doesn't interpose between the native view and the compositing layer.

- **Never set `backgroundColor` on a container that wraps native child views on Android** unless explicitly needed — it may paint over native view content.

- **Gate hardware compositing props on interaction state** (`isFocused`, `isPlaying`) to avoid unnecessary GPU texture allocation for idle or off-screen cards.

- **Test on the 1080p Android TV emulator** (`Television_1080p_API_36`) in addition to Apple TV simulator. The 4K emulator consumes ~6.8GB RAM and ~4x GPU load; the 1080p AVD exercises the same density path at a fraction of the host resource cost.

- **Guard against `Dimensions.get("window")` returning 0 on Android cold start.** Use `(screenWidth || referenceWidth)` as a fallback to prevent division yielding 0.

## Related Issues

- `docs/solutions/ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md` — The FocusableCard outer/inner layer split for focus glow clipping (predecessor to this fix)
- `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md` — Pitfall 5 covers native view compositing issues on tvOS; this doc extends the pattern to Android TV
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` — Section 6 documents the FocusableCard focus management pattern
- `docs/solutions/mobile/responsive-typography-hook.md` — Documents `Math.round()` for scaled font sizes on Android (same principle applied here via `scale()`)
- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — Android VideoView SurfaceView z-order issues (same native compositing constraint family)
