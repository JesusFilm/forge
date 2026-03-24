---
title: "feat: Full-bleed video hero with scroll-over content"
type: feat
status: completed
date: 2026-03-24
---

# feat: Full-bleed video hero with scroll-over content

## Overview

Make the video hero banner full-bleed and fixed at the top of the screen, with scrollable content sliding OVER the hero as the user scrolls — instead of the current behavior where the hero scrolls away with the content.

## Problem Statement

Currently, `VideoHeroRenderer` renders inline inside a `ScrollView` as just another section. When the user scrolls, the hero scrolls away with the rest of the content. The desired behavior is a "content over hero" pattern: the hero stays pinned behind the scroll content, and opaque content sections slide up to cover it.

Additionally, `WatchHomeScreen` (the Easter page) is missing `ScrollContext`, which means `useScrollY` in `VideoHeroRenderer` is a no-op there — the scroll-aware pause/resume never fires.

## Proposed Solution

**Phase 1 (MVP) — Position-absolute hero, no new dependencies:**

Extract the first `videoHero` section from the sections array. Render it as `position: absolute` behind the `ScrollView`. Add `paddingTop` to the ScrollView's `contentContainerStyle` equal to the hero's rendered height. Content sections get opaque backgrounds so they visually cover the hero on scroll.

**Phase 2 (optional) — react-native-reanimated for parallax/fade:**

Install `react-native-reanimated` v4.1.x (Expo SDK 54 compatible) and add `useAnimatedScrollHandler` + `interpolate` for parallax translateY and opacity fade on the hero as content scrolls over it.

## Technical Approach

### Architecture

```
[Root View - flex: 1]
  |
  +-- [View - position: absolute, top: 0, zIndex: 0] (Hero layer)
  |     +-- VideoHeroRenderer (full bleed, edge-to-edge)
  |
  +-- [ScrollView - flex: 1, backgroundColor: transparent] (Content layer)
        +-- [paddingTop = heroHeight] (transparent gap revealing hero)
        +-- [Content sections with opaque backgroundColor: '#fff']
```

### Key Files

| File                                                        | Change                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/mobile/src/components/sections/FixedHeroLayout.tsx`   | **NEW** — shared layout wrapper that extracts the hero and renders the two-layer architecture |
| `apps/mobile/src/screens/ExperienceScreen.tsx`              | Wrap section rendering with `FixedHeroLayout`                                                 |
| `apps/mobile/src/screens/WatchHomeScreen.tsx`               | Add `ScrollContext` (bug fix) + wrap with `FixedHeroLayout`                                   |
| `apps/mobile/src/components/sections/VideoHeroRenderer.tsx` | Update `useScrollY` visibility logic for fixed positioning; adjust mute button for safe area  |

### Implementation Phases

#### Phase 1: Core scroll-over-hero layout

**1a. Fix WatchHomeScreen ScrollContext bug** (standalone commit)

Wire up `ScrollContext.Provider` and `useScrollHandle` in `WatchHomeScreen`, mirroring `ExperienceScreen`. This is independently valuable — the hero's scroll-aware pause/resume is currently broken on the Easter page.

Files: `apps/mobile/src/screens/WatchHomeScreen.tsx`

**1b. Create `FixedHeroLayout` component**

A shared wrapper that:

1. Checks if `sections[0].kind === 'videoHero'` — only extract when the hero is the first section
2. If hero found: renders it in a `position: absolute` container behind the `ScrollView`, with `paddingTop` on the content
3. If no hero: renders a normal `ScrollView` with all sections (current behavior, no change)
4. Uses `onLayout` on the hero container to measure actual rendered height (since `minHeight: 400` is dynamic)
5. Defaults `paddingTop` to `400` before measurement completes (matches `minHeight`)

Files: `apps/mobile/src/components/sections/FixedHeroLayout.tsx` (new)

**1c. Touch passthrough for hero controls**

The `ScrollView` sits on top of the hero, consuming all touches. The mute button and CTA button need to remain tappable. Approach:

- Use `pointerEvents="box-none"` on a transparent spacer `View` at the top of the ScrollView content (instead of using `paddingTop`). This passes touches through the spacer to the hero underneath, while still allowing scroll gestures on the ScrollView itself.
- Structure:

```tsx
<ScrollView style={{ flex: 1, backgroundColor: 'transparent' }}>
  {/* Spacer: passes touches through to hero layer */}
  <View style={{ height: heroHeight }} pointerEvents="box-none" />
  {/* Content sections: opaque, receive touches normally */}
  {remainingSections.map(...)}
</ScrollView>
```

- `pointerEvents="box-none"` means the spacer View itself ignores touches, but its parent (ScrollView) still handles scroll gestures. Taps that land on the hero's mute button or CTA pass through to the absolute-positioned hero behind it.

Files: `apps/mobile/src/components/sections/FixedHeroLayout.tsx`

**1d. Opaque backgrounds on content sections**

Add `backgroundColor: '#fff'` to the wrapping `<View>` around each non-hero section in the `FixedHeroLayout` content loop. This ensures the hero is visually covered as content scrolls over it.

Currently, only `SectionWrapperRenderer` has explicit backgrounds. Leaf renderers like `MediaCollectionRenderer`, `TextRenderer`, `CTARenderer` have transparent backgrounds.

Files: `apps/mobile/src/components/sections/FixedHeroLayout.tsx`

**1e. Update hero visibility logic for fixed positioning**

With position:absolute, the hero never moves — `measureInWindow` will always return the same position (visible). The pause/resume logic must change from "is the component on screen?" to "has content scrolled far enough to cover the hero?".

New logic: receive `scrollY` from `useScrollY` and compare against hero height. If `scrollY > heroHeight`, the hero is fully covered → pause. If `scrollY <= heroHeight`, the hero is at least partially visible → play.

This requires the hero to know its own height. Pass it as a prop from `FixedHeroLayout`.

Files: `apps/mobile/src/components/sections/VideoHeroRenderer.tsx`

**1f. Safe area handling**

The hero should be truly full-bleed — video extends under the status bar/notch. The mute button's `top: 16` must be offset by the safe area inset to avoid being hidden behind the status bar.

Use `useSafeAreaInsets()` from `react-native-safe-area-context` (already available via Expo) to offset the mute button position: `top: insets.top + 16`.

Files: `apps/mobile/src/components/sections/VideoHeroRenderer.tsx`

#### Phase 2: Parallax and fade effects (optional, separate PR)

1. `npx expo install react-native-reanimated react-native-worklets`
2. Replace `ScrollView` with `Animated.ScrollView` in `FixedHeroLayout`
3. Add `useAnimatedScrollHandler` to track scroll offset in a `SharedValue`
4. Apply `useAnimatedStyle` with `interpolate` on the hero container:
   - `translateY`: hero moves up at 0.5x scroll speed (parallax)
   - `opacity`: fades from 1 → 0 as content covers hero
5. Optionally migrate `ScrollOffsetContext` to use `SharedValue` for all scroll-aware components

## System-Wide Impact

- **Interaction graph**: `FixedHeroLayout` → reads sections array → extracts hero → renders `VideoHeroRenderer` + `SectionDispatcher` for remaining sections. No new callbacks, middleware, or observers.
- **Error propagation**: If hero `onLayout` never fires (unlikely), `paddingTop` stays at default 400. Graceful degradation.
- **State lifecycle risks**: None — no persistent state changes. Only local component state (heroHeight via `onLayout`).
- **API surface parity**: Both `ExperienceScreen` and `WatchHomeScreen` need the same change. `FixedHeroLayout` prevents duplication.
- **Integration test scenarios**:
  1. Experience with videoHero as first section → hero pinned, content scrolls over
  2. Experience with no videoHero → normal scroll behavior unchanged
  3. Mute button tappable when hero is visible (before scrolling)
  4. Video pauses when content fully covers hero
  5. Android: verify VideoView renders behind ScrollView content (not on top)

## Acceptance Criteria

### Functional Requirements

- [ ] Video hero banner is full-bleed (edge-to-edge, extends under status bar)
- [ ] Scrollable content scrolls OVER the hero — hero stays pinned
- [ ] Hero mute button remains tappable when hero is visible
- [ ] Hero CTA button remains tappable when hero is visible
- [ ] Video auto-pauses when content fully covers the hero
- [ ] Video auto-resumes when user scrolls back to reveal the hero
- [ ] Works on both iOS and Android
- [ ] Screens with no videoHero section behave exactly as before (no regression)
- [ ] WatchHomeScreen scroll-aware pause/resume works (ScrollContext bug fixed)

### Non-Functional Requirements

- [ ] No new dependencies in Phase 1 (zero-dependency approach)
- [ ] Smooth 60fps scrolling — no jank from hero layout calculations
- [ ] Video does not consume excessive resources when fully covered (paused)

### Quality Gates

- [ ] Tested on iOS simulator (iPhone 17 Pro Max) and Android emulator (Medium Phone API 35)
- [ ] Tested with and without videoHero sections
- [ ] Tested mute/CTA touch passthrough on both platforms
- [ ] Tested safe area inset handling on notched devices

## Dependencies & Risks

| Risk                                                                                            | Likelihood | Impact | Mitigation                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android VideoView ignores zIndex ([expo/expo#30275](https://github.com/expo/expo/issues/30275)) | Medium     | High   | Render VideoView FIRST in JSX tree (earlier = visually behind on Android). Test empirically on Android emulator before merging. Fallback: use thumbnail Image on Android if VideoView renders on top. |
| `pointerEvents="box-none"` breaks scroll in hero area                                           | Low        | Medium | The spacer View ignores touches, but ScrollView (parent) still handles scroll gestures. Validated pattern in RN docs.                                                                                 |
| Hero height measurement delay (first frame)                                                     | Certain    | Low    | Default to `minHeight: 400` before `onLayout` fires. One-frame flash is imperceptible.                                                                                                                |
| Scroll indicator includes paddingTop in total height                                            | Low        | Low    | Set `scrollIndicatorInsets={{ top: heroHeight }}` on iOS to offset.                                                                                                                                   |

## Known Gotchas

1. **Android elevation vs zIndex**: If content sections have `elevation` set (for shadows), they may render below the hero on Android. Ensure `elevation: 0` on the hero container.
2. **expo-video on Android**: Only one `VideoView` per `VideoPlayer` instance can be mounted simultaneously.
3. **Screen rotation**: `heroHeight` from `onLayout` must be recalculated. `onLayout` fires again on orientation change, so this is handled automatically.

## Sources & References

### Internal References

- [VideoHeroRenderer.tsx](apps/mobile/src/components/sections/VideoHeroRenderer.tsx) — current hero component
- [ExperienceScreen.tsx](apps/mobile/src/screens/ExperienceScreen.tsx) — screen with ScrollContext
- [WatchHomeScreen.tsx](apps/mobile/src/screens/WatchHomeScreen.tsx) — screen missing ScrollContext
- [ScrollOffsetContext.ts](apps/mobile/src/contexts/ScrollOffsetContext.ts) — scroll pub/sub system
- [SectionDispatcher.tsx](apps/mobile/src/components/sections/SectionDispatcher.tsx) — section routing
- [sectionModels.ts](apps/mobile/src/lib/sectionModels.ts:80) — VideoHeroSection type definition

### External References

- [expo/expo#30275](https://github.com/expo/expo/issues/30275) — Android VideoView zIndex issue
- [React Native ScrollView docs](https://reactnative.dev/docs/scrollview) — pointerEvents, scrollIndicatorInsets
- [react-native-reanimated docs](https://docs.swmansion.com/react-native-reanimated/) — Phase 2 reference
- [Expo react-native-reanimated](https://docs.expo.dev/versions/latest/sdk/reanimated/) — SDK 54 compatibility

### Related Work

- PR for GraphQL schema drift fix (current branch `fix/mobile-graphql-stale-video-image-and-easter-fragment`)
