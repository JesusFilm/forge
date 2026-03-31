---
title: "Android VideoRenderer mute button and accurate off-screen mute detection"
category: "mobile"
date: "2026-04-01"
tags:
  - expo-video
  - android
  - mute
  - measureInWindow
  - visibility
  - LazySection
  - scroll
  - accessibility
related_files:
  - apps/mobile/src/components/sections/VideoRenderer.tsx
  - apps/mobile/src/components/sections/LazySection.tsx
  - apps/mobile/src/components/sections/VideoHeroRenderer.tsx
related_docs:
  - docs/solutions/mobile/android-lazy-section-viewport-gating-oom-fix.md
  - docs/solutions/mobile/react-native-scrollview-touch-event-z-index-fix.md
  - docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md
---

# Android VideoRenderer Mute Button and Accurate Off-Screen Mute Detection

## Problem

Inline video players (`VideoRenderer`) on Android had two usability bugs:

1. **No mute/unmute control.** VideoRenderer relied on expo-video's `nativeControls` for volume management. Android's native ExoPlayer controls only expose play/pause, seek, and fullscreen — no volume/mute toggle. iOS native controls include volume, so the gap is Android-specific. Users had no way to hear inline videos after autoplay-muted.

2. **Asymmetric off-screen mute detection.** When scrolling a video off the top of the screen, it took significantly more scrolling to trigger muting than when scrolling off the bottom. The video would keep playing audibly even after it was visually gone.

## Root Causes

### Missing mute button

VideoHeroRenderer already had a custom mute button but VideoRenderer didn't — it assumed all platforms' native controls include volume management.

### Asymmetric mute detection

LazySection computes viewport visibility using `layoutYRef.current` (cached from `onWrapperLayout`) plus `contentOffsetY`. When sibling sections mount/unmount — swapping real content for height-preserving placeholders — the video shifts position on screen, but `layoutYRef` retains the stale pre-shift value until the next `onWrapperLayout` event fires.

Impact on the visibility formula `sectionBottom > 0 && sectionY < viewportHeight`:

- **Top exit** (scrolling down): computed `sectionBottom` is higher than actual → takes more scrolling to cross 0 → video stays "visible" too long
- **Bottom exit** (scrolling up): computed `sectionY` is higher than actual → crosses `viewportHeight` sooner → video mutes faster

This created a directional asymmetry where top-exit was delayed and bottom-exit was immediate.

## Solution

### 1. Android-only mute button

Added a custom mute toggle rendered only on Android via `Platform.OS === "android"`. Reuses the same `VolumeOffIcon`/`VolumeOnIcon` components and pattern from VideoHeroRenderer.

```tsx
{
  /* Android native video controls don't expose a mute toggle;
    iOS nativeControls includes volume, so no custom button needed. */
}
{
  Platform.OS === "android" && (
    <Pressable
      style={styles.muteButton}
      onPress={handleMuteToggle}
      accessibilityRole="button"
      accessibilityLabel={muted ? "Unmute video" : "Mute video"}
    >
      {muted ? <VolumeOffIcon /> : <VolumeOnIcon />}
    </Pressable>
  )
}
```

Touch target: 44×44 (meets accessibility minimum). Style matches VideoHeroRenderer's button.

### 2. measureInWindow for mute detection

Replaced the LazySectionContext-based mute detection with direct `measureInWindow` calls in a `useScrollY` callback. This measures the component's actual window-relative position on every scroll event, bypassing stale layout offsets entirely.

```tsx
const isOnScreenRef = useRef(true)
useScrollY(
  useCallback(
    (_scrollY: number) => {
      containerRef.current?.measureInWindow((_x, windowY, _w, h) => {
        const onScreen = windowY + h > 0 && windowY < viewportHeight
        if (onScreen === isOnScreenRef.current) return
        isOnScreenRef.current = onScreen
        if (!onScreen) {
          player.muted = true
          setMuted(true)
        }
      })
    },
    [player, viewportHeight],
  ),
)
```

**Why two visibility systems?** Play/pause still uses `useSectionVisible()` from LazySectionContext — slight inaccuracy is acceptable (paused video is silent). Muting needs precision: if the user unmuted a video, it must re-mute reliably the moment it leaves the screen. The `measureInWindow` approach gives ground-truth pixel position independent of sibling layout shifts.

### 3. Stale closure fix in mute toggle

Used functional updater to prevent double-tap race condition:

```tsx
const handleMuteToggle = useCallback(() => {
  setMuted((prev) => {
    const next = !prev
    player.muted = next
    return next
  })
}, [player])
```

## Key Design Decisions

| Decision                           | Rationale                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Android-only mute button           | iOS nativeControls includes volume; adding a redundant button would clutter the UI                           |
| measureInWindow per scroll frame   | Accuracy trumps cost for muting; with tight mount buffer (0.5 VH), at most 2-3 videos measure simultaneously |
| Keep unmount cleanup effect        | Required per expo/expo#33804 — decoder slots may not free reliably on Android                                |
| Functional updater for mute toggle | Eliminates stale closure when `muted` state hasn't re-rendered between taps                                  |

## Relationship to measureInWindow Removal

The [viewport gating solution](android-lazy-section-viewport-gating-oom-fix.md) documents that `measureInWindow` was intentionally removed from per-component visibility tracking to eliminate expensive async bridge calls at 60fps. This fix **selectively re-introduces** it for a narrow use case:

- **Removed for:** general visibility gating (mount/unmount, play/pause) — handled by LazySection's computed offsets
- **Re-introduced for:** mute-only detection where accuracy is critical and tolerance for stale offsets is zero

The mount buffer (0.5 VH) limits concurrent mounted videos to 2-3, keeping the bridge call cost bounded.

## Investigation Steps

1. Compared VideoHeroRenderer (has mute button) vs VideoRenderer (doesn't) — identified the Android native controls gap
2. Lowered `ESTIMATED_HEIGHTS.video` from 320 to 220 — did not fix the asymmetry, confirming the issue was stale `layoutYRef`, not height estimates
3. Analyzed LazySection visibility formula — identified that `onWrapperLayout` Y offset goes stale when siblings mount/unmount with different placeholder heights
4. Adopted `measureInWindow` pattern already used by VideoHeroRenderer in inline mode

## Prevention

- **Test on both platforms.** Never assume native controls provide the same features on iOS and Android. Document platform-specific capabilities.
- **Prefer direct measurement for precision-sensitive visibility checks.** Cached layout offsets are fine for approximate gating but unreliable when sibling layout can shift.
- **Use functional state updaters in callbacks** passed to memoized handlers to avoid stale closure bugs.
- **Size touch targets to 44×44 minimum** on all platforms for accessibility compliance.
- **Test scroll-direction symmetry** when implementing viewport-based behavior — verify both top-exit and bottom-exit trigger at the same distance from the viewport edge.
