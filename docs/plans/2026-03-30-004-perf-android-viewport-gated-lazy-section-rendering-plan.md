---
title: "perf: Viewport-gated lazy section rendering for Android memory management"
type: perf
status: active
date: 2026-03-30
origin: docs/brainstorms/2026-03-30-android-memory-lazy-rendering-requirements.md
---

# perf: Viewport-gated lazy section rendering for Android memory management

## Overview

The Expo Android app progressively lags from launch and eventually crashes due to OOM. `FixedHeroLayout` uses a plain `ScrollView` that eagerly mounts all 5-10 sections at render — including 3-5 video players, image carousels, and blur effects. Each `expo-video` player allocates an Android `MediaCodec` hardware decoder slot (devices typically have 4-6 slots). Mounting all players simultaneously exhausts these slots and triggers OOM.

This plan introduces a `LazySection` wrapper that conditionally mounts/unmounts section content based on scroll proximity, with a tiered video lifecycle: pause when leaving the viewport, destroy when 2+ screens away. (see origin: `docs/brainstorms/2026-03-30-android-memory-lazy-rendering-requirements.md`)

## Problem Statement / Motivation

Android devices have tighter memory budgets than iOS and limited hardware decoder slots. The current architecture renders every section and initializes every video player on mount, regardless of whether the user can see them. This is the direct cause of the progressive lag and crash. iOS is more tolerant but would also benefit from reduced memory pressure.

## Proposed Solution

Add a `LazySection` wrapper component that wraps each non-hero section inside `FixedHeroLayout`. The wrapper:

1. Tracks its own Y-offset via `onLayout` (persists across mount/unmount since the wrapper View is always in the tree)
2. Subscribes to scroll events via the existing `useScrollY` hook
3. Computes distance from viewport as `sectionY - scrollOffset`
4. Mounts children when within 1.5x viewport height; unmounts when beyond 2.5x (hysteresis prevents flicker)
5. Renders a height-preserving placeholder `View` when children are unmounted

The hero video (R2) remains always-mounted since it is rendered at `position: absolute` outside the ScrollView content.

**Key decision (from origin):** Keep the existing `ScrollView` architecture. The pinned hero video + scroll-driven blur/dim would be painful to retrofit into `FlashList`/`SectionList`. A lightweight lazy wrapper is lower-risk and directly targets the problem.

## Technical Considerations

### Architecture

The `LazySection` wrapper inserts between the existing section-level `View` and `SectionDispatcher` in the `.map()` loop. The wrapper View is always in the tree (for stable layout and ref registration); only its children toggle between real content and a placeholder.

```
FixedHeroLayout
  View (heroContainer, position: absolute)
    VideoHeroRenderer (always mounted — R2)
  ScrollView
    View (overlay spacer)
    View (translucentSection)
      LazySection (wraps section 1)   ← NEW
        SectionDispatcher | placeholder
      LazySection (wraps section 2)   ← NEW
        SectionDispatcher | placeholder
      ...
```

### Position Tracking: `onLayout` Y-Offset (not `measureInWindow`)

The SpecFlow analysis identified that calling `measureInWindow` on every section at 60fps would generate 600 async bridge calls/second — counterproductive on the low-end Android devices this fix targets.

Instead, each `LazySection` records its content-relative Y offset via `onLayout` on its always-present wrapper View. Visibility is computed as pure synchronous JS:

```
sectionScreenY = sectionLayoutY - scrollOffset
isNearViewport = sectionBottom > -mountBuffer && sectionTop < viewportHeight + mountBuffer
```

This avoids all bridge overhead. The `onLayout` Y offset updates automatically when sections above mount/unmount and change height.

### Buffer Zone Sizing

| Zone                 | Size                       | Purpose                                                                                  |
| -------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| **Mount buffer**     | 1.5x viewport height       | Sections mount before entering viewport during normal scrolling                          |
| **Unmount buffer**   | 2.5x viewport height       | Hysteresis prevents rapid mount/unmount cycling at boundaries                            |
| **Video pause zone** | Actual viewport (0 buffer) | Video pause/play triggers at real visibility (handled by existing `VideoRenderer` logic) |

For a typical 800px Android viewport: mount at ~1200px distance, unmount at ~2000px distance.

### Initial Mount Strategy

On first render, before any `onLayout` has fired, use cumulative estimated heights to compute which sections fall within the mount buffer:

```
estimatedTop[0] = heroSpacerHeight  // viewport height for hero, 0 for no-hero
estimatedTop[i] = estimatedTop[i-1] + estimatedHeight(section[i-1].kind)
```

Sections whose estimated position falls within 1.5x viewport mount immediately. Others render as placeholders. This avoids both:

- Mounting everything (defeats the purpose, crashes Android)
- Showing all placeholders (visible blank flash on first frame)

### Estimated Height Table

Per-section-type fallback heights before first measurement:

| Section Kind          | Estimated Height | Rationale                         |
| --------------------- | ---------------- | --------------------------------- |
| `text`                | 200px            | ~3-4 paragraphs                   |
| `video`               | 320px            | 16:9 aspect + title + padding     |
| `mediaCollection`     | 350px            | Carousel or grid                  |
| `sectionWrapper`      | 400px            | Variable, contains nested content |
| `container`           | 350px            | Stacked or row layout             |
| `bibleQuotesCarousel` | 300px            | Horizontal paging carousel        |
| `navigationCarousel`  | 280px            | Horizontal scroll nav             |
| `relatedQuestions`    | 400px            | Expandable accordions             |
| `cta`                 | 150px            | Button + description              |
| `card`                | 250px            | Image + text card                 |
| `quizButton`          | 100px            | Simple button                     |
| `easterDates`         | 200px            | Date picker                       |

These should be validated against real content and tuned during implementation.

### Scroll Position Stability (R6)

When a section mounts and its actual height differs from the placeholder:

1. `onLayout` on the child content fires with the real height
2. If the section is **above** the current viewport, programmatically adjust `scrollTo` by the height difference to prevent visible content jumping
3. If the section is **at or below** the viewport, no adjustment needed — content below shifts naturally
4. Cache the measured height in a `useRef` for future placeholder use

### Programmatic Scroll (`scrollToSection`) Coordination

During a `scrollToSection` animation (triggered by NavigationCarousel taps):

1. **Before animation**: Force-mount the target section immediately (bypass lazy gating)
2. **During animation**: Skip mount/unmount decisions for intermediate sections (access `isProgrammaticScroll` ref via context or prop)
3. **After animation settles**: Resume normal lazy gating; intermediate sections that are now outside the unmount buffer will unmount on the next scroll event

This prevents decoder thrashing as the viewport sweeps across sections during the animation.

### Video Player Lifecycle

The tiered lifecycle (from origin) leverages the existing architecture:

**Tier 1 — Mount/Unmount (handled by `LazySection`):**

- Section mounts → `useVideoPlayer` creates native player → decoder slot acquired
- Section unmounts → `useVideoPlayer` cleanup runs → `release()` frees decoder slot
- Defensive: add `player.pause()` in cleanup before the hook's own `release()` (addresses expo-video regression #33804)

**Tier 2 — Pause/Play (handled by existing `VideoRenderer`):**

- Already implemented: `VideoRenderer` uses `useScrollY` + `measureInWindow` to pause/play based on actual viewport visibility
- No changes needed — once a section mounts, its `VideoRenderer` manages its own visibility-based playback

**Tier 3 — Hero video (always mounted):**

- `VideoHeroRenderer` in controlled mode: parent manages `paused` via scroll offset threshold
- Not subject to lazy gating (R2)

### Both Render Paths

`LazySection` applies to both the hero path (lines 234-245) and the no-hero path (lines 165-176) in `FixedHeroLayout`. An experience without a hero video but with multiple video sections faces the same Android memory crash.

### expo-video Cleanup Verification

`useVideoPlayer` (expo-video v3.0.16) uses `useReleasingSharedObject` which calls `release()` on unmount. Known regressions exist (#33804, #29950) but fixes were merged for SDK 54. Implementation should:

1. Add defensive cleanup effect: `player.pause()` before unmount
2. Verify on a mid-range Android device using `adb shell dumpsys media.codec` that decoder slots are freed
3. If slots leak, add explicit `player.replace(null)` in cleanup to force decoder release

### Height Cache Invalidation on Rotation

When `useWindowDimensions` changes (rotation, split-screen):

- Clear all cached heights → revert to estimated heights for placeholder sizing
- Sections currently in the viewport remain mounted → they re-measure via `onLayout`
- Buffer calculations use the new viewport height

## System-Wide Impact

- **Interaction graph**: `LazySection` subscribes to `ScrollContext` via `useScrollY`. It consumes scroll events but does not produce them. No callbacks, middleware, or observers are affected outside the component.
- **Error propagation**: If `LazySection` fails to mount a section (e.g., measurement error), the section stays as a placeholder. No crash — graceful degradation. The user can still scroll to trigger a mount retry.
- **State lifecycle risks**: Unmounting a section destroys all its React state (expanded accordions, carousel scroll position). This is acceptable — re-mounting starts fresh. If this becomes a UX issue for specific sections, `LazySection` could be made opt-out per section kind.
- **API surface parity**: No API changes. `SectionDispatcher`, `SectionNavContext`, and all renderers are unchanged. `LazySection` is purely additive.
- **Integration test scenarios**: (1) Scroll to bottom of a 10-section experience with 5 videos — verify no crash and max 3-4 concurrent players. (2) Tap NavigationCarousel to jump to section 8 — verify section mounts and scroll lands correctly. (3) Rotate device mid-scroll — verify no content jump.

## Acceptance Criteria

### Functional Requirements

- [ ] Sections outside the mount buffer (1.5x viewport) render as height-preserving placeholders — `apps/mobile/src/components/sections/LazySection.tsx`
- [ ] Sections unmount when beyond the unmount buffer (2.5x viewport) — `LazySection.tsx`
- [ ] Hero video section (position: absolute) remains always mounted — `FixedHeroLayout.tsx`
- [ ] Video players do not initialize until their section mounts — verified by checking decoder slot count with `adb shell dumpsys media.codec`
- [ ] Videos pause when leaving the visible viewport (existing `VideoRenderer` behavior preserved)
- [ ] No scroll position jumps when sections mount/unmount — scroll offset adjustment in `LazySection.tsx`
- [ ] `scrollToSection` works correctly for unmounted target sections — pre-mount target in `FixedHeroLayout.tsx`
- [ ] `LazySection` applies to both hero and no-hero render paths in `FixedHeroLayout`
- [ ] Screen rotation clears cached heights and recalculates buffers

### Non-Functional Requirements

- [ ] Android app does not crash from memory pressure during normal use (5-10 sections, 3-5 videos)
- [ ] No perceptible scroll jank — sections mount before entering viewport during normal scroll speeds
- [ ] Brief placeholder visibility during very fast flings is acceptable (R7)
- [ ] iOS behavior is not degraded
- [ ] Hero video pinning, scroll-driven blur/dim, and mute button continue unchanged

### Quality Gates

- [ ] Manual test on mid-range Android device (e.g., Pixel 6a or Samsung A series)
- [ ] Manual test on iOS to verify no degradation
- [ ] Verify hardware decoder slot count stays within limits using `adb shell dumpsys media.codec`
- [ ] Existing `FixedHeroLayout.test.tsx` and `VideoRenderer.test.tsx` tests pass

## Implementation Phases

### Phase 1: `LazySection` Component + `FixedHeroLayout` Integration

**New file:** `apps/mobile/src/components/sections/LazySection.tsx`

Create the `LazySection` wrapper:

- `onLayout`-based Y-offset tracking on the always-present wrapper View
- `useScrollY` subscription for scroll position
- Mount/unmount logic with 1.5x/2.5x hysteresis buffers
- Height caching in `useRef` with per-section-type estimated fallbacks
- Scroll offset adjustment when mounted content height differs from placeholder
- `__DEV__` logging for mount/unmount decisions

**Modified file:** `apps/mobile/src/components/sections/FixedHeroLayout.tsx`

- Wrap each non-hero section in `LazySection` in both render paths (hero path lines 234-245, non-hero path lines 165-176)
- Pass `scrollOffsetRef` to `LazySection` for scroll position access
- Move `sectionNav.registerSectionRef` to the `LazySection` wrapper View (so refs are always available for navigation)
- Add `isProgrammaticScroll` to context or pass as prop for programmatic scroll coordination
- Pre-mount target section in `scrollToSection` before starting animation

**Modified file:** `apps/mobile/src/contexts/ScrollOffsetContext.ts`

- Export `isProgrammaticScroll` via context if not already accessible (or add to `SectionNavContext`)

### Phase 2: Video Player Defensive Cleanup

**Modified file:** `apps/mobile/src/components/sections/VideoRenderer.tsx`

- Add defensive cleanup `useEffect` that calls `player.pause()` before the hook's own unmount cleanup

**Modified file:** `apps/mobile/src/components/sections/VideoHeroRenderer.tsx`

- Same defensive cleanup for inline/uncontrolled mode

### Phase 3: Validation & Tuning

- Manual testing on mid-range Android with `adb shell dumpsys media.codec` monitoring
- Tune estimated height table against real content
- Tune buffer multipliers if needed (1.5x/2.5x are starting points)
- Verify `scrollToSection` lands correctly for all section positions
- Test screen rotation behavior
- Run existing test suite

## Known Limitations (v1)

- **Nested videos in SectionWrapper:** A `SectionWrapper` containing multiple videos will mount all of them when the wrapper enters the buffer. This is accepted for v1 since typical content has 1-2 videos per wrapper. Address with content-level lazy gating in a follow-up if needed.
- **State reset on remount:** Unmounting a section destroys all React state (expanded accordions, carousel positions). Re-mounting starts fresh. Acceptable for v1.
- **Dynamic height changes:** Sections that change height after mount (e.g., accordion expansion) update the cached height, but if they unmount and re-mount, they start at the collapsed/default height, causing a minor jump from the expanded-height placeholder. Acceptable for v1.
- **Accessibility:** Placeholder Views should include `accessibilityLabel` with the section title for screen readers. This is noted for implementation but not a blocker.

## Dependencies & Risks

| Risk                                                               | Likelihood | Impact | Mitigation                                                                                               |
| ------------------------------------------------------------------ | ---------- | ------ | -------------------------------------------------------------------------------------------------------- |
| expo-video doesn't reliably release decoder slots on unmount       | Medium     | High   | Defensive `player.pause()` + `player.replace(null)` cleanup; verify with `adb shell dumpsys media.codec` |
| Estimated heights are significantly wrong for real content         | Medium     | Medium | Measure real content during Phase 3; scroll offset adjustment compensates for mismatches                 |
| `onLayout` Y-offsets are stale during rapid mount/unmount          | Low        | Medium | Wrapper View is always in the tree and receives `onLayout` updates                                       |
| `scrollToSection` lands at wrong position for lazy-mounted targets | Medium     | Medium | Pre-mount target before animation; re-measure after mount if height differs                              |
| Performance regression from mount/unmount overhead on scroll       | Low        | Medium | Only 5-10 sections; mount/unmount is infrequent (only at buffer boundaries)                              |

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-30-android-memory-lazy-rendering-requirements.md](docs/brainstorms/2026-03-30-android-memory-lazy-rendering-requirements.md) — Key decisions carried forward: (1) Keep ScrollView + add viewport gating, (2) Tiered video lifecycle (pause -> destroy), (3) 1.5x mount / 2.5x unmount hysteresis buffers

### Internal References

- `apps/mobile/src/components/sections/FixedHeroLayout.tsx` — Primary integration point (hero path lines 234-245, non-hero path lines 165-176)
- `apps/mobile/src/contexts/ScrollOffsetContext.ts` — `useScrollY` hook for scroll event subscription
- `apps/mobile/src/components/sections/VideoRenderer.tsx` — Video visibility detection pattern (lines 65-82)
- `apps/mobile/src/components/sections/VideoHeroRenderer.tsx` — Controlled/uncontrolled dual-mode video
- `apps/mobile/src/components/sections/SectionDispatcher.tsx` — Section routing (wrapped by `LazySection`)
- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — Quantized blur brackets, Android VideoView z-order, scroll performance patterns
- `docs/solutions/mobile/react-native-scrollview-touch-event-z-index-fix.md` — Android touch handling with overlapping ScrollViews
- `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md` — Composite key pattern for section items

### External References

- [expo-video player not released on unmount — GitHub #33804](https://github.com/expo/expo/issues/33804)
- [expo-video component crash on unmount — GitHub #29950](https://github.com/expo/expo/issues/29950)
- [Android MediaCodec hardware decoder limits](https://developer.android.com/media/media3/exoplayer/troubleshooting)
- [expo-video useVideoPlayer API](https://docs.expo.dev/versions/latest/sdk/video/)
