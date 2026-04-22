---
date: 2026-03-30
topic: android-memory-lazy-rendering
---

# Android Memory Management: Lazy Section Rendering & Video Lifecycle

## Problem Frame

The Expo Android app progressively lags from launch and eventually crashes. The root cause is that `FixedHeroLayout` uses a plain `ScrollView` that eagerly renders all 5-10 sections at mount — including 3-5 video players, image carousels, and blur effects. On Android's tighter memory budget, this exhausts hardware decoder slots and triggers OOM. iOS is more tolerant but would also benefit.

## Requirements

- R1. **Viewport-gated section rendering.** Sections in the `ScrollView` should only mount when they are within a buffer zone around the visible viewport. Sections outside the buffer should unmount and render a height-preserving placeholder instead.
- R2. **Hero video exemption.** The first section (when it is a `videoHero`) is pinned via `position: absolute` and must always remain mounted — it is not subject to lazy gating.
- R3. **Video players do not initialize until their section mounts.** Since unmounted sections don't exist in the tree, video players are naturally deferred. No video should begin decoding or buffering until the user scrolls near it.
- R4. **Videos pause when leaving the viewport.** When a video section scrolls out of the visible area but remains within the mount buffer, the video pauses.
- R5. **Videos destroy after distance.** When a video section leaves the mount buffer entirely (approximately 2+ screens away), the section unmounts and the video player is fully released from memory. Re-entering the buffer re-initializes the player.
- R6. **Stable scroll position.** Unmounting a section must not cause scroll jumps. Placeholders must preserve the measured height of their content.
- R7. **No visible pop-in for fast scrolling.** The mount buffer should be generous enough that sections are ready before they enter the viewport under normal scroll speeds. Brief placeholder visibility during very fast flings is acceptable.

## Success Criteria

- Android app no longer crashes from memory pressure during normal use of 5-10 section experiences with 3-5 videos.
- No perceptible scroll jank or position jumps when sections mount/unmount.
- Hero video pinning, scroll-driven blur/dim, and mute button continue to work unchanged.
- iOS behavior is not degraded.

## Scope Boundaries

- **In scope:** `FixedHeroLayout` scroll container, section mount lifecycle, video player init/pause/destroy lifecycle.
- **Out of scope:** Image caching strategy, code splitting of section renderers, navigation-level screen caching, server-side content changes, carousel virtualization within individual sections.
- **Out of scope:** Replacing `ScrollView` with `FlashList`/`SectionList` — we are keeping the `ScrollView` and adding a lazy wrapper.

## Key Decisions

- **Keep ScrollView, add viewport gating:** The pinned hero video + scroll-driven blur architecture in `FixedHeroLayout` would be painful to retrofit into a virtualized list. A lightweight lazy wrapper per section is lower-risk and directly targets the problem.
- **Tiered video lifecycle (pause -> destroy):** Videos pause when leaving the viewport but only fully destroy when ~2 screens away. This avoids re-initialization flicker on small scroll-backs while still freeing memory from distant sections.

## Dependencies / Assumptions

- Section heights are either estimable or can be measured on first mount and cached for accurate placeholders.
- `expo-video` properly releases native resources when its component unmounts (assumed based on standard React Native lifecycle).

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] What is the right buffer zone size (in pixels or screen-heights) for the mount/unmount threshold? Needs profiling on mid-range Android devices.
- [Affects R5][Technical] Does `expo-video` v3.0.16 reliably free hardware decoder slots on unmount, or does it need explicit cleanup?
- [Affects R6][Technical] Best approach for measuring/estimating section heights — measure once on first render vs. static estimates per section type?
- [Affects R7][Needs research] Should the lazy wrapper use `onLayout` + scroll math, or is there a lighter pattern (e.g., `react-native-intersection-observer` or Reanimated-based detection)?

## Next Steps

-> `/ce:plan` for structured implementation planning
