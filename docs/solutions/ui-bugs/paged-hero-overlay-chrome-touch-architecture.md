---
title: "Paged hero chrome unreachable — FlashList swallows taps, measureLayout rects are page-relative"
date: "2026-06-11"
category: ui-bugs
module: apps/mobile
problem_type: ui_bug
component: frontend_stimulus
severity: high
symptoms:
  - "Watch Now / insert CTA taps do nothing on every hero slide"
  - "Mute works only on slide 0; on later slides the invisible touch target sits one screen-width off-screen"
  - "Swiping the hero horizontally scrolls the feed instead of advancing the pager"
  - "All three failures are silent — the FlashList wins the responder race without logging"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - HomeScreen.tsx
  - HomeHeroPager.tsx
  - pagerReducer.ts
tags:
  - react-native
  - panresponder
  - flashlist
  - zindex
  - touch-events
  - hero-pager
  - pointerevents
  - measurelayout
---

# Paged hero chrome unreachable — FlashList swallows taps, measureLayout rects are page-relative

## Problem

The mobile Home's paged hero had three simultaneous interaction failures, all rooted in interactive elements living below or inside the scroll layer.

## Symptoms

- Tapping "Watch Now" or the insert CTA does nothing, on every slide — the FlashList scrolling above the hero layer swallows the taps.
- Mute works only on slide 0; on slide 1+ the invisible Pressable's x includes the page offset (`index * screenWidth`) and sits off-screen.
- Swiping left/right over the hero scrolls the feed vertically instead of advancing the pager.
- No console error — all three failures are silent (the FlashList wins the responder race without logging).

## What Didn't Work

- **The hybrid measureLayout pattern on paged content.** The repo's documented overlay pattern (visual element in the hero layer + invisible overlay Pressable positioned via `measureLayout`) is correct for a single-video hero because the measured rect is viewport-aligned. In a paged `FlatList`, content lays out at `index * screenWidth` from the list origin, and `measureLayout` returns rects relative to the list's content view — so on slide 1 the captured x is one screen-width to the right of the screen. (Pattern still valid for non-paged heroes: `docs/solutions/mobile/hero-mute-button-hybrid-overlay-touch-target.md`.)
- **Nested-scroll gesture configuration.** Proposed during review for the chip rail; misdiagnosis — the rail is a _sibling_ of the pager, not nested, and sibling gesture coordination isn't available via `nestedScrollEnabled`.
- **A naive transparent swipe-View above the FlashList.** Rejected at design time: RN's responder model never re-offers a declined touch to a lower z-order sibling, so a full-hero gesture view would also swallow vertical feed scrolls that start over the hero — a dead zone for scrolling.

## Solution

Four interlocking changes (`apps/mobile/src/components/home/HomeScreen.tsx`, `HomeHeroPager.tsx`, `src/lib/watchHome/pagerReducer.ts`):

**a) Visible chrome rendered directly in the touch overlay** (zIndex 2, above the feed) at fixed positions, fading with scroll, with a `pointerEvents` opacity gate so half-faded chrome can't intercept feed taps:

```tsx
// HomeScreen.tsx — HeroChrome wrapper
<View
  style={[styles.heroChrome, { opacity }]}
  pointerEvents={opacity < 0.5 ? "none" : "box-none"}
>
```

The pager's pages render display content only — no Pressables live inside them.

**b) Capture-phase PanResponder on the screen root** claims only horizontal-dominant gestures over the visible hero band; verticals return `false` and pass through to the feed untouched:

```ts
// HomeScreen.tsx — capture predicate
onMoveShouldSetPanResponderCapture: (evt, gesture) => {
  const { scrollY, slideCount, heroHeight: h } = swipeStateRef.current
  if (slideCount < 2) return false
  const visibleHeroBottom = Math.max(0, h - scrollY)
  const claims =
    evt.nativeEvent.pageY < visibleHeroBottom &&
    Math.abs(gesture.dx) > Math.abs(gesture.dy) * HERO_SWIPE_DOMINANCE &&
    Math.abs(gesture.dx) > HERO_SWIPE_ACTIVATE_PX
  if (claims) gestureStartIndexRef.current = swipeStateRef.current.activeIndex
  return claims
},
```

`swipeStateRef` mirrors live state for the once-created (`useMemo`) responder — reading React state directly inside the predicate would capture a stale closure and silently break the geometry checks.

**c) Swipes dispatch a `SWIPED` reducer event with `moveTo` semantics** — unlike chip taps, never dropped during an in-flight `replaceAsync` swap (`moveTo` records `pendingSwap`). The gesture-start index snapshot anchors the swipe to the slide the user saw, so a mid-gesture auto-advance can't retarget the release.

**d) The pager FlatList is `scrollEnabled={false}`** (programmatic scrolls only), with a stale-settle guard: `handleMomentumScrollEnd` drops `SLIDE_SHOWN` dispatches whose index doesn't match `pendingScrollIndexRef` — an interrupted older animation can't revert the reducer. Shared geometry constants (`HERO_CHROME_BOTTOM`, `HERO_CTA_FOOTPRINT`) keep the pager's reserved padding and the overlay chrome from silently misaligning.

## Why This Works

RN hit-testing finds the topmost view whose frame contains the touch point; lower z-order **siblings never receive a touch that a higher layer consumed, and declined touches are not re-offered**. Interactive elements in the zIndex-0 hero layer under a scroll view are therefore structurally unreachable — the only exit is rendering them above the scroll view. The capture phase (`onMoveShouldSetPanResponderCapture` on a common ancestor) is the one mechanism that intercepts a gesture _before_ a descendant scroll responder claims it, which is what makes selective swipe-stealing possible without breaking vertical scrolling. And because the overlay chrome is a fixed-position absolute view on screen (not inside the FlatList content), its geometry is viewport-aligned — the page-offset coordinate bug cannot recur. The watch player independently converged on the same rule: chrome mounts above the scroll container, never inside it. (session history)

## Prevention

- Never render interactive elements (Pressable/Touchable) inside a hero layer that sits under a ScrollView/FlashList. Display content in the hero layer; interactive chrome in the overlay above the scroll view.
- The `measureLayout` hybrid-overlay pattern is only correct for **non-paged** content. Test hit targets on slide index 1 and 2, never just slide 0 (slide-0-only testing is the systematic blind spot for this bug class).
- When a background layer needs gestures, use a capture-phase `PanResponder` on the nearest common ancestor — and only `PanResponder`: `react-native-gesture-handler` crashes Expo Go in this app. The Scrubber's horizontal-intent threshold (`|dx| > |dy| * ratio` + activation px) is the established disambiguation recipe. (session history)
- `pointerEvents` gating is safe on plain View wrappers like chrome containers — but never put `pointerEvents="none"` on a `VideoView`: on Fabric it blacks out the video surface. (session history)
- Share geometry constants between the layer that reserves space and the layer that renders into it; two components independently hardcoding positions is the misalignment failure mode.
- Sim-verify taps via `idb ui tap` at real device coordinates on non-zero slides before reporting done.

## Related Issues

- `docs/solutions/mobile/hero-mute-button-hybrid-overlay-touch-target.md` — the predecessor pattern; remains correct for non-paged heroes (CuratedHomeLayout still uses it)
- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — the parent three-layer architecture this is a paged-hero variant of
- `docs/solutions/ui-bugs/homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md` — adjacent FlashList touch-interception fix on the same screen (resolved by raising zIndex)
- `docs/solutions/design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md` — overlay visibility lifecycle + pointerEvents discipline in the watch player
- `docs/solutions/mobile/react-native-scrollview-touch-event-z-index-fix.md` — foundational: zIndex doesn't beat a native scroll gesture recognizer
