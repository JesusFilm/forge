---
title: Full-Bleed Video Hero with Scroll-Over Content in React Native / Expo
category: mobile
date: 2026-03-25
tags:
  - react-native
  - expo
  - video-hero
  - scroll-layout
  - performance
  - android-compatibility
  - expo-blur
  - expo-video
severity: medium
affected_components:
  - apps/mobile/src/components/sections/FixedHeroLayout.tsx
  - apps/mobile/src/components/sections/VideoHeroRenderer.tsx
related_docs:
  - docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md
---

# Full-Bleed Video Hero with Scroll-Over Content

## Problem Description

Implementing a full-viewport video hero banner that stays fixed while scrollable content slides over it. The hero must pause video playback when scrolled past, apply a blur/dim effect that increases with scroll depth, and work cross-platform (iOS and Android) in Expo managed workflow (Expo Go).

## Root Cause of Failed Approaches

**`Animated.Value.addListener()` does not reliably fire JS-thread callbacks when `useNativeDriver: true` is set.** The animation runs entirely on the native thread, and the JavaScript bridge for listener callbacks is unreliable. This breaks any pattern that attempts to bridge native-driven scroll animations back to the JS thread for video pause/resume or blur updates.

This was the root cause of 3 failed implementation attempts before the working solution was found.

## Investigation Steps (What Didn't Work)

### 1. Animated.ScrollView + translateY + addListener

Visual pinning worked — `Animated.Value.interpolate` counteracted scroll offset with a `translateY` transform. But `addListener` on the `Animated.Value` (with `useNativeDriver: true`) failed to reliably fire JS callbacks. Video pause/resume never triggered consistently.

### 2. ScrollContext Bridge via addListener

Attempted to bridge the native-driven `Animated.Value` to the existing `ScrollOffsetContext` system via `useEffect` + `addListener`. Same root cause — `addListener` is unreliable with the native driver. Context updates didn't propagate.

### 3. Callback Ref Pattern

Passed a `MutableRefObject` from `FixedHeroLayout` to `VideoHeroRenderer`, writing a scroll callback into it. The ref callback still depended on `addListener` or `Animated.event` listener prop, which had the same reliability issue.

### 4. expo-blur on Android

`BlurView` renders only a tinted overlay in Expo Go on Android (requires a development build for real blur). `Image.blurRadius` also doesn't work over `VideoView` because Android `VideoView` ignores zIndex and renders on top of everything ([expo/expo#30275](https://github.com/expo/expo/issues/30275)).

## Working Solution

### Architecture

```
View (root, flex: 1, bg: #000)
  |
  +-- View (position: absolute, fills parent) ← Hero layer
  |     +-- VideoHeroRenderer (video + blur/dim overlay)
  |
  +-- ScrollView (transparent, zIndex: 1) ← Content layer
        +-- View (height: viewport, justifyContent: flex-end) ← Spacer + overlay
        |     +-- VideoHeroOverlay (gradient + heading/subheading/CTA)
        +-- View (opaque bg) ← Content section 1
        +-- View (opaque bg) ← Content section 2
        +-- ...
```

### Key Design Decisions

1. **position:absolute hero, plain ScrollView** — No `Animated.ScrollView`, no `useNativeDriver`, no `addListener`. The hero stays fixed via CSS-like absolute positioning. The `ScrollView` is transparent, so the hero shows through the spacer area.

2. **Simple boolean `paused` prop** — Driven by `useState` from a regular JS `onScroll` handler. `setPaused(y > 0)` with a guard to avoid redundant updates. VideoHeroRenderer watches this prop in a `useEffect` and calls `player.pause()` / `player.play()`.

3. **Quantized blur brackets** — Instead of continuous `useState` for scroll offset (which causes 60fps re-renders), the scroll offset is quantized into 10 discrete brackets (0–10). Only bracket changes trigger re-renders (~10 updates over 400px of scroll instead of hundreds).

4. **Platform-specific blur/dim** — iOS uses `expo-blur` `BlurView` (intensity 50, tint dark). Android uses a `rgba(0,0,0,0.6)` dim overlay fallback, because `expo-blur` doesn't work in Expo Go on Android and `VideoView` z-order prevents image-based blur overlays.

5. **Responsive viewport height** — `useWindowDimensions()` hook instead of `Dimensions.get("window").height` at module scope. Responds to rotation, foldables, and split-screen.

6. **Overlay as scroll content** — The heading/subheading/CTA overlay is rendered inside the `ScrollView` (not inside the hero layer), positioned at the bottom of a viewport-height spacer via `justifyContent: "flex-end"`. It scrolls with the content. Uses `LinearGradient` (transparent → rgba(0,0,0,0.8)) for a seamless fade with no hard edge.

### Code Patterns

**Quantized blur bracket (FixedHeroLayout):**

```typescript
const BLUR_DISTANCE = 400

const handleScroll = useCallback(
  (e) => {
    const y = e.nativeEvent.contentOffset.y

    // Pause: only update at the 0 boundary
    setPaused((prev) => {
      const next = y > 0
      return prev === next ? prev : next
    })

    // Blur: quantize to 10 brackets to limit re-renders
    const bracket = Math.min(Math.round((y / BLUR_DISTANCE) * 10), 10)
    if (bracket !== lastBracketRef.current) {
      lastBracketRef.current = bracket
      setBlurBracket(bracket)
    }
  },
  [scrollHandle],
)
```

**Platform blur/dim overlay (VideoHeroRenderer):**

```tsx
{
  blurOpacity > 0 && (
    <View
      style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}
      pointerEvents="none"
    >
      {Platform.OS === "ios" ? (
        <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "rgba(0,0,0,0.6)" },
          ]}
        />
      )}
    </View>
  )
}
```

**Overscroll prevention (both platforms):**

```tsx
<ScrollView bounces={false} overScrollMode="never" />
```

## Prevention Strategies

### Android VideoView Z-Order

Android's `VideoView` is a native surface that renders on top of all React Native Views regardless of `zIndex`. You cannot overlay a `BlurView`, `Image`, or any `View` on top of a `VideoView` on Android. Design layouts that avoid this — use absolute positioning to place the video behind the scroll content, not overlay elements on top of the video.

### Animated.Value.addListener Reliability

Never depend on `Animated.Value.addListener()` for critical JS-thread logic (like pause/resume, state updates, or navigation) when `useNativeDriver: true` is set. The listener fires sporadically or not at all. Use regular `onScroll` JS callbacks instead, and only use `Animated` for purely visual transforms.

### Scroll Performance

Avoid `useState` for continuous scroll offset tracking — each update re-renders the component tree at 60fps. Instead:

- Use `useRef` for the raw offset (no re-renders)
- Quantize into discrete brackets for state that drives visual changes
- Only use `Animated.event` with native driver for purely transform-based animations

### expo-blur Platform Support

`expo-blur` works reliably on iOS but not on Android in Expo Go. Always provide a platform fallback:

- iOS: `BlurView` from `expo-blur`
- Android: Semi-transparent `View` with dark background color

### Viewport Dimensions

Always use `useWindowDimensions()` inside components, never `Dimensions.get("window")` at module scope. The module-scope value is stale after rotation, split-screen, or foldable state changes.

## Cross-References

- [GraphQL Schema Drift Fix](../integration-issues/expo-graphql-schema-drift-and-fragment-validation.md) — Documents the `Video.image` → `images[]` migration that affects `VideoHeroRenderer`'s thumbnail URL
- [expo/expo#30275](https://github.com/expo/expo/issues/30275) — Android VideoView zIndex issue
- Branch: `feat/mobile-full-bleed-hero-scroll-over`
- Plan: `docs/plans/2026-03-24-002-feat-mobile-full-bleed-hero-scroll-over-plan.md`
