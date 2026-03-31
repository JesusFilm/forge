---
title: Viewport-gated lazy section rendering for Android memory optimization
category: mobile
date: 2026-03-31
severity: high
module: apps/mobile
tags:
  - react-native
  - expo
  - performance
  - memory-management
  - android
  - video-playback
  - lazy-rendering
  - viewport-gating
related_plans:
  - docs/plans/2026-03-30-004-perf-android-viewport-gated-lazy-section-rendering-plan.md
related_brainstorms:
  - docs/brainstorms/2026-03-30-android-memory-lazy-rendering-requirements.md
  - docs/brainstorms/2026-03-31-mobile-video-playback-lifecycle-requirements.md
---

# Viewport-Gated Lazy Section Rendering for Android OOM Fix

## Problem

Android OOM crashes in the React Native / Expo mobile app when experiences contain many video sections. All sections were mounted eagerly in `FixedHeroLayout`, causing every `VideoView` instance to acquire a hardware decoder slot simultaneously. Mid-range Android devices typically have 3-5 hardware decoder slots; exceeding this budget crashes the app.

Additionally, `VideoRenderer` used `measureInWindow` + `useScrollY` on every scroll event for per-component visibility detection — generating expensive async bridge calls at 60fps.

## Root Cause

`FixedHeroLayout` rendered all sections in plain `<View>` wrappers with no lifecycle gating. Every `VideoRenderer` mounted immediately, called `useVideoPlayer()` (acquiring a decoder slot), and ran `measureInWindow` on every scroll frame to check its own visibility. With 5+ video sections in an experience, all decoder slots were consumed on mount, causing OOM on Android.

## Solution Architecture

Introduced a three-tier viewport-gated lifecycle via a `LazySection` wrapper component:

| Tier       | Gate         | Buffer                     | Effect                                             |
| ---------- | ------------ | -------------------------- | -------------------------------------------------- |
| Mount      | `isMounted`  | 0.5 viewport heights       | Component enters React tree, decoder slot acquired |
| Visibility | `isVisible`  | 0 (exact viewport overlap) | Video plays/pauses via `useSectionVisible()`       |
| Unmount    | `!isMounted` | 1.5 viewport heights       | Component removed, decoder slot freed              |

The gap between mount (0.5vh) and unmount (1.5vh) buffers provides hysteresis that prevents rapid mount/unmount cycling at boundary edges.

### Key Components

**`LazySection`** — Always-present wrapper View that:

- Tracks its Y offset via `onLayout` (no async `measureInWindow` calls)
- Subscribes to scroll events via `useScrollY` for visibility computation
- Conditionally renders children or a height-preserving placeholder
- Exposes `isVisible` via `LazySectionContext` for child components

**`LazySectionContext` / `useSectionVisible()`** — React context that pushes a boolean visibility signal down to children. `VideoRenderer` reads this instead of running its own `measureInWindow` on every scroll frame.

**`FixedHeroLayout`** — Wraps all top-level sections in `LazySection` for both hero and no-hero render paths. Pre-computes `initialMountState` from estimated section heights to avoid either mounting everything (crashes Android) or showing all placeholders (blank flash).

### Video Player Lifecycle

```tsx
// VideoRenderer.tsx — plays/pauses based on context, not measureInWindow
const visible = useSectionVisible()

const player = useVideoPlayer(streamingUrl, (p) => {
  p.muted = true
  p.loop = true
  // No p.play() here — gated on visibility effect below
})

useEffect(() => {
  if (visible && appActiveRef.current) {
    player.play()
  } else if (!visible) {
    try {
      player.pause()
    } catch {
      /* native player may be released */
    }
  }
}, [visible, player])
```

### Programmatic Scroll Navigation

`scrollToSection` was rewritten for lazy-aware navigation:

1. Set `forceMountKey` to force-mount the target section
2. `requestAnimationFrame` to let React render the mounted section
3. `measureInWindow` to get the section's screen position
4. Animate scroll with `skipLazyGating=true` to prevent mount/unmount during animation
5. Cleanup closure resets all state on completion or cancellation

### Scroll Deceleration Edge Case

Added `onMomentumScrollEnd={handleScroll}` to both ScrollViews to ensure a final visibility recheck when scroll momentum stops. Without this, sections entering the viewport during the last deceleration frame may not receive a visibility update.

## Code Review Fixes Applied

During review, five P2 issues were identified and fixed:

1. **Duplicated constants** — `ESTIMATED_HEIGHTS`, `DEFAULT_ESTIMATED_HEIGHT`, `MOUNT_BUFFER_VH` were defined identically in both `LazySection.tsx` and `FixedHeroLayout.tsx`. Extracted as exports from `LazySection.tsx`, imported in `FixedHeroLayout.tsx`.

2. **`useMemo(fn, [])` with eslint-disable** — Replaced with `useState(() => ...)` for `initialMountState`. `useState` with an initializer is the correct React idiom for compute-once-on-mount; no lint suppression needed.

3. **`prevViewportHeightRef` anti-pattern** — Removed the ref + comparison pattern in `LazySection`. A direct `useEffect` on `viewportHeight` that clears `measuredHeightRef` is sufficient.

4. **Repeated cleanup logic** — `scrollToSection` had `isProgrammaticScroll = false; setSkipLazyGating(false); setForceMountKey(null)` at 3 exit points. Extracted to a single `cleanup()` closure.

5. **Defensive unmount cleanup** — Added `player.pause()` in a cleanup effect on both `VideoRenderer` and `VideoHeroRenderer` to address expo-video regression (expo/expo#33804) where decoder slots may not be freed reliably.

## Known Limitation

**expo-video `player.pause()` does not visually pause the video** in version 3.0.16. The `PAUSE` call fires correctly (confirmed via logs), `player.playing` may update, but the native video surface continues rendering. Videos only stop when the component fully unmounts (LazySection removes it from the tree). This appears to be an expo-video bug — the unmount path via LazySection serves as the effective workaround.

## Prevention Strategies

### For New Section Types

1. Add an entry to `ESTIMATED_HEIGHTS` in `LazySection.tsx` — this is the single source of truth
2. If the section uses video, camera, or GPU-heavy rendering, consume `useSectionVisible()` and defer resource initialization until visible
3. Never call `player.play()` in the `useVideoPlayer` setup callback — gate playback on a visibility effect
4. Add defensive `player.pause()` cleanup in an unmount effect with try-catch

### Key Invariants

- **Wrapper View is always in the tree** — never conditionally render the outer `<View onLayout>`, only the children
- **Scroll offset from ref, not state** — `scrollOffsetRef.current` is synchronous; `useState` for scroll position causes 60fps re-renders
- **Mount and visibility are independent gates** — different buffers, different lifecycle stages, never merge them
- **Hysteresis gap >= 1.0 viewport height** — prevents rapid mount/unmount cycling at boundaries
- **`skipLazyGating` during programmatic scroll** — prevents decoder thrashing as the viewport sweeps

### Warning Signs

- **Scroll jank during fling** — mount/unmount rate too high; increase unmount buffer
- **Placeholder pop-in (white flash)** — mount buffer too small; increase `MOUNT_BUFFER_VH`
- **Section jumps during scroll** — estimated heights significantly wrong; re-measure and update
- **Videos play before entering viewport** — `useSectionVisible()` not being consumed; audit video components

## Related Documentation

- [Full-bleed video hero with scroll-over content](full-bleed-video-hero-with-scroll-over-content.md) — foundational hero architecture that LazySection wraps
- [ScrollView touch event z-index fix](react-native-scrollview-touch-event-z-index-fix.md) — gesture preemption patterns relevant to interactive elements inside LazySection
- [Translucent section backgrounds](translucent-section-backgrounds-with-react-context.md) — HeroSectionContext pattern that LazySection coexists with

## Files

- `apps/mobile/src/components/sections/LazySection.tsx` — viewport-gated wrapper (new)
- `apps/mobile/src/components/sections/LazySectionContext.ts` — visibility context + hook (new)
- `apps/mobile/src/components/sections/FixedHeroLayout.tsx` — wraps sections in LazySection
- `apps/mobile/src/components/sections/VideoRenderer.tsx` — uses `useSectionVisible()` for play/pause
- `apps/mobile/src/components/sections/VideoHeroRenderer.tsx` — defensive unmount cleanup
