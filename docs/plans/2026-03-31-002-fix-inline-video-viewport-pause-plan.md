---
title: "fix: Inline video viewport-gated pause/resume"
type: fix
status: active
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-mobile-video-viewport-pause-requirements.md
---

# fix: Inline video viewport-gated pause/resume

## Overview

Inline `VideoRenderer` sections autoplay when scrolled into the viewport but continue playing when scrolled away. The `LazySection` + `useSectionVisible()` infrastructure is already in place on this branch — the fix requires diagnosing why the visibility signal isn't reaching the player pause call, then addressing edge cases.

## Problem Statement

(see origin: `docs/brainstorms/2026-03-31-mobile-video-viewport-pause-requirements.md`)

Videos keep playing off-screen, wasting battery, bandwidth, and hardware decoder slots. The `VideoRenderer` play/pause effect at [VideoRenderer.tsx:46-56](apps/mobile/src/components/sections/VideoRenderer.tsx#L46-L56) is correctly wired to `useSectionVisible()`, and `FixedHeroLayout` already wraps all top-level sections in `LazySection` ([FixedHeroLayout.tsx:253](apps/mobile/src/components/sections/FixedHeroLayout.tsx#L253), [FixedHeroLayout.tsx:333](apps/mobile/src/components/sections/FixedHeroLayout.tsx#L333)). Despite this, `isVisible` is not transitioning to `false` when sections leave the viewport — or the transition is not reaching `VideoRenderer`.

## Proposed Solution

Three-phase approach: diagnose root cause, fix it, then harden edge cases.

### Phase 1: Diagnose the visibility signal chain

Trace the full signal path to find the break. The chain is:

```
ScrollView.onScroll → scrollHandle.handleScroll() → useScrollY listener
→ LazySection scroll callback → setIsVisible(false) → LazySectionContext.Provider
→ useSectionVisible() → VideoRenderer effect → player.pause()
```

**Diagnostic steps (in order, stop at first break):**

1. **Verify `useScrollY` callback fires in `LazySection`.** Add `__DEV__` log inside the `useScrollY` callback ([LazySection.tsx:143](apps/mobile/src/components/sections/LazySection.tsx#L143)) that prints `sectionKind`, `sectionY`, `sectionBottom`, and `nowVisible` for video sections. If callback doesn't fire → scroll context subscription is broken.

2. **Verify `isVisible` state transitions.** Add `__DEV__` log after `setIsVisible` to confirm the state goes `true → false` when scrolling away. If state doesn't change → the visibility math is wrong (check `contentOffsetY`, `layoutYRef.current`).

3. **Verify context propagation.** Add `__DEV__` log in `VideoRenderer` after `const visible = useSectionVisible()` ([VideoRenderer.tsx:34](apps/mobile/src/components/sections/VideoRenderer.tsx#L34)). If `visible` stays `true` while `isVisible` transitions → context provider/consumer mismatch (wrong provider tree, stale context).

4. **Verify effect fires.** Add `__DEV__` log inside the play/pause effect ([VideoRenderer.tsx:46-56](apps/mobile/src/components/sections/VideoRenderer.tsx#L46-L56)). If effect fires with `visible=false` but video keeps playing → `player.pause()` is not working (expo-video bug or player already released).

**Likely root causes (ranked by probability):**

- **`contentOffsetY` mismatch in hero path.** In the hero layout, `contentOffsetY={viewportHeight}` offsets all sections by the hero spacer height. If `layoutYRef.current` from `onLayout` already includes this offset (because the View is inside `translucentSection`), the section Y is double-counted, making `sectionY` negative → `nowVisible` stays `true` far longer than expected.

- **`onLayout` Y not stable.** `onWrapperLayout` captures `e.nativeEvent.layout.y`, which is relative to the immediate parent. If the parent is `translucentSection` (not the ScrollView), the Y offset is relative to `translucentSection`'s origin — which is already at `viewportHeight`. Combined with `contentOffsetY={viewportHeight}`, this doubles the offset.

- **`scrollOffsetRef.current` stale during initial render.** The `onWrapperLayout` immediate check uses `scrollOffsetRef.current`, which is `0` before any scroll event. If the page loads scrolled (e.g. deep link), the initial check may be wrong.

### Phase 2: Fix the root cause

Based on diagnosis, apply the targeted fix. Most likely fix:

**If `contentOffsetY` double-counts (most probable):**

The `translucentSection` View starts at `viewportHeight` inside the ScrollView content. `LazySection`'s `onLayout` Y is relative to `translucentSection` (its parent), so `layoutYRef.current` is 0 for the first section in the translucent area, not `viewportHeight`. But `contentOffsetY={viewportHeight}` adds `viewportHeight` again.

Fix: Verify by logging `layoutYRef.current` for a video section in the hero path. If it returns a small number (relative to `translucentSection`), then `contentOffsetY` is correct. If it returns `viewportHeight + small number` (relative to ScrollView), then `contentOffsetY` should be 0 or the parent offset needs adjusting.

```tsx
// In LazySection.tsx onWrapperLayout callback, add diagnostic:
if (__DEV__ && sectionKind === "video") {
  console.log(
    `[LazySection] video layout Y=${layoutYRef.current}, contentOffsetY=${contentOffsetY}, scrollY=${scrollOffsetRef.current}`,
  )
}
```

**If some other cause:** Fix as discovered. The diagnostic chain above will isolate the exact break point.

### Phase 3: Harden edge cases

After the core fix works, address these edge cases identified by SpecFlow analysis:

**3a. Scroll deceleration stop (Critical — Gap 4)**

When scroll decelerates to a stop, the last scroll event may fire while the video section is partially visible. No further events arrive → `isVisible` is stale.

Fix: Add `onMomentumScrollEnd` handler to `FixedHeroLayout`'s ScrollView that triggers one final visibility recheck across all `LazySection` instances. This can reuse the existing `scrollHandle.handleScroll(e)` call since the event has the same shape.

```tsx
// FixedHeroLayout.tsx — add to both ScrollView instances
onMomentumScrollEnd = { handleScroll }
```

This re-fires all `useScrollY` listeners with the final resting scroll position, ensuring `isVisible` is accurate at rest.

**3b. Picture-in-Picture exemption (Medium — Gap 10)**

`VideoRenderer` has `allowsPictureInPicture={true}`. Scrolling away while PiP is active would abruptly pause the PiP window. Skip pause when the player is in PiP mode.

```tsx
// VideoRenderer.tsx — modify the play/pause effect
useEffect(() => {
  if (visible && appActiveRef.current) {
    player.play()
  } else if (!visible && !player.pictureInPictureActive) {
    try {
      player.pause()
    } catch {
      /* released */
    }
  }
}, [visible, player])
```

Verify `player.pictureInPictureActive` exists in the current expo-video version. If not available, defer this to a follow-up.

**3c. Nested videos in containers (Deferred)**

Videos inside `ContainerRenderer` or `SectionWrapperRenderer` inherit the parent `LazySection` context. Per-video granularity requires propagating `scrollOffsetRef` down and wrapping each content item in its own `LazySection`. This is explicitly deferred per the requirements doc (see origin: Scope Boundaries).

## Acceptance Criteria

- [ ] Inline videos pause within one frame of leaving the viewport
- [ ] Inline videos resume when scrolled back into view
- [ ] Video hero behavior is unchanged (R2 — excluded from this fix)
- [ ] Videos that enter the viewport during scroll deceleration still play (Gap 4)
- [ ] No regression in scroll performance
- [ ] `__DEV__` diagnostic logs removed (or gated) before merge
- [ ] Test on both iOS and Android

## Test Scenarios

1. Scroll down past an inline video → video pauses
2. Scroll back up to the video → video resumes from paused position
3. Fling quickly past a video section → video never plays (never visible long enough) or pauses immediately
4. Slow scroll that decelerates with video in viewport → video plays at rest
5. Hero video is unaffected by scrolling remaining sections
6. App background/foreground → visible videos resume, hidden videos stay paused
7. (If PiP fix applied) Activate PiP → scroll away → PiP continues playing

## Key Files

| File                                                                               | What to check                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [LazySection.tsx](apps/mobile/src/components/sections/LazySection.tsx)             | Visibility computation, `contentOffsetY` math                 |
| [LazySectionContext.ts](apps/mobile/src/components/sections/LazySectionContext.ts) | Default value `{ visible: true }`                             |
| [VideoRenderer.tsx](apps/mobile/src/components/sections/VideoRenderer.tsx)         | Play/pause effect, `useSectionVisible()`                      |
| [FixedHeroLayout.tsx](apps/mobile/src/components/sections/FixedHeroLayout.tsx)     | `LazySection` wrapping, `contentOffsetY` prop, scroll handler |
| [ScrollOffsetContext.ts](apps/mobile/src/contexts/ScrollOffsetContext.ts)          | `useScrollY` subscription                                     |

## Dependencies & Risks

- **Companion plan:** [2026-03-31-001-fix-mobile-video-playback-lifecycle-plan.md](docs/plans/2026-03-31-001-fix-mobile-video-playback-lifecycle-plan.md) covers related lifecycle bugs (hero `p.play()` in setup, muted state, mute button). These two plans can be implemented in either order but should both land before the branch merges.
- **expo-video PiP API:** `player.pictureInPictureActive` may not exist in the current expo-video version. Check before implementing 3b.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-31-mobile-video-viewport-pause-requirements.md](docs/brainstorms/2026-03-31-mobile-video-viewport-pause-requirements.md) — Key decisions: reuse LazySection pattern, exclude video hero, defer nested video granularity.

### Internal References

- [LazySection.tsx:142-185](apps/mobile/src/components/sections/LazySection.tsx#L142-L185) — scroll subscription and visibility computation
- [VideoRenderer.tsx:44-56](apps/mobile/src/components/sections/VideoRenderer.tsx#L44-L56) — play/pause effect
- [FixedHeroLayout.tsx:215-236](apps/mobile/src/components/sections/FixedHeroLayout.tsx#L215-L236) — scroll handler
- [FixedHeroLayout.tsx:330-355](apps/mobile/src/components/sections/FixedHeroLayout.tsx#L330-L355) — hero-path LazySection wrapping
- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — hero architecture learnings
- `docs/solutions/mobile/react-native-scrollview-touch-event-z-index-fix.md` — touch event patterns

### Known Limitations (deferred)

- Nested video visibility in ContainerRenderer/SectionWrapperRenderer (per-slot granularity)
- Scroll offset adjustment when measured height differs from placeholder
