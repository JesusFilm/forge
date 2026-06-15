---
title: "tvOS: disable native focus-scroll and drive row-anchored scrolling from focus"
date: 2026-06-15
category: design-patterns
module: apps/tv
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "A tvOS / Android TV feed where a hero or showcase must stay pinned and rails anchor near the viewport top when focused"
  - "Scroll position is driven programmatically from D-pad focus on a React Native ScrollView"
  - "UIKit's native focus-scroll (scroll-into-view) is nudging the feed and fighting your scrollTo"
  - "A background refetch can remount rows and invalidate cached layout measurements"
tags:
  - "tv"
  - "tvos"
  - "focus"
  - "scrollview"
  - "programmatic-scroll"
  - "row-anchor"
  - "onlayout"
  - "react-native-tvos"
related_components:
  - "apps/tv/app/index.tsx"
  - "apps/tv/src/components/home/homeScrollState.ts"
---

# tvOS: disable native focus-scroll and drive row-anchored scrolling from focus

## Context

The redesigned TV Home drives scroll position from D-pad focus: row 0 (the featured rail) and the chrome (top bar, hero actions) pin the feed to `y=0`; rows `>= 1` anchor near the viewport top at `rowY - ROW_ANCHOR_OFFSET`; the mission tail scrolls to the end. Each rail calls `handleRowFocus(rowIndex)` when any card in it gains focus.

The symptom that surfaced (user-reported): _"shifting focus across the top carousel scrolls the screen down slightly."_ The cause is UIKit's built-in focus-scroll. With `scrollEnabled` at its default (`true`), the tvOS focus engine runs a scroll-into-view pass for every focused element. The row-0 card labels sit at the viewport's bottom edge, so that pass nudges the feed down a few points on every horizontal D-pad move within the first rail — and the native nudge fires _after_ (and overrides) the screen's own `scrollTo({ y: 0 })`.

## Guidance

**Set `scrollEnabled={false}` on the ScrollView and own every scroll programmatically.** The prop disables native pan gestures _and_ the UIKit focus-scroll pass; `scrollTo` / `scrollToEnd` still work. Then three rules make it safe:

1. **Cover every focusable that changes the visible region with a scroll hook.** With native scroll off, an uncovered focusable moves focus off-screen with no recovery — the TV equivalent of a dead end.

   | Focusable surface           | Handler              | Action                          |
   | --------------------------- | -------------------- | ------------------------------- |
   | Rail card, row 0            | `handleRowFocus(0)`  | scroll to `y=0`                 |
   | Rail card, row `>= 1`       | `handleRowFocus(n)`  | scroll to `rowY - anchorOffset` |
   | Top-bar tabs / hero actions | `handleChromeFocus`  | `scrollTo({ y: 0 })`            |
   | Mission-tail QR             | `handleMissionFocus` | `scrollToEnd()`                 |

2. **Defer the scroll for unmeasured rows.** A row's `y` comes from `onLayout`, which fires asynchronously after mount (and again after a refetch remounts rows). A card focused before its row is measured yields a `null` target; silently dropping it strands the card. Stash the pending row and flush it when `onLayout` lands.

3. **Reset the measured-`y` cache when the model's row set changes.** A background refetch remounts rows; stale `y` values from the previous layout would anchor focus to the wrong position during the re-measure window. Clear the cache (and the pending-scroll ref) and let `onLayout` repopulate — the deferred-scroll path covers the gap.

```tsx
// ScrollView — native focus-scroll OFF; all scrolling is programmatic.
<ScrollView ref={scrollRef} stickyHeaderIndices={[0]} scrollEnabled={false}>

// Scroll a row into its anchor; returns false when the row isn't measured yet.
const scrollToRow = useCallback((rowIndex: number): boolean => {
  const target = resolveRowScrollTarget({
    rowIndex,
    rowLayoutYs: rowYsRef.current,
    anchorOffset: scale(ROW_ANCHOR_OFFSET),
  })
  if (target == null) return false
  scrollRef.current?.scrollTo({ y: target, animated: true })
  return true
}, [])

// Focus handler — defer if not yet measured; recordRowY flushes it.
const handleRowFocus = useCallback((rowIndex: number) => {
  setBrowseState(resolveBrowseState(rowIndex))
  pendingScrollRowRef.current = scrollToRow(rowIndex) ? null : rowIndex
}, [scrollToRow])

// onLayout — record y AND flush a pending scroll for this row.
const recordRowY = useCallback((rowIndex: number, y: number) => {
  rowYsRef.current[rowIndex] = y
  if (pendingScrollRowRef.current === rowIndex && scrollToRow(rowIndex)) {
    pendingScrollRowRef.current = null
  }
}, [scrollToRow])

// Reset stale measurements when the section set changes (refetch remounts rows).
const sections = model?.sections
useEffect(() => {
  rowYsRef.current = []
  pendingScrollRowRef.current = null
}, [sections])
```

Keep the row-target math pure and tested (`resolveRowScrollTarget` in `homeScrollState.ts`): row 0 returns `0`; rows `>= 1` return `max(0, rowY - anchorOffset)`; an unmeasured row returns `null`. The `null` is the contract the deferred-scroll path depends on — do not replace it with a fallback value.

## Why This Matters

Disabling native focus-scroll trades automatic scroll-into-view for total programmatic responsibility. The win is deterministic anchoring (a pinned hero with rails anchored beneath it) and no scroll-fight artifacts. The cost is that any focusable without a scroll hook, or any focus that lands before a row is measured, strands off-screen — so the deferred-scroll and cache-reset rules are not optional polish, they are what keep the screen navigable.

## When to Apply

Any tvOS RN screen that needs a specific scroll anchor (hero/showcase at top, rails beneath) where UIKit's scroll-into-view fights the target. If the design only needs "keep the focused cell visible" with no specific anchor, native focus-scroll is less invasive — leave it on.

This is one of two known approaches to the same problem class (programmatic scroll vs. the tvOS focus engine). The other — invisible focus anchors plus `setNativeProps({ hasTVPreferredFocus: true })` with a short delay — is documented in `react-native-tvos-porting-pitfalls-20260414.md` (Pitfall 4) for the experience/section-navigation screen. Prefer **this** approach for a home/row layout where focus naturally maps to rows and you want a fixed anchor; prefer the anchor-teleport approach when you need to jump focus to an arbitrary off-screen target.

## Examples

- **Row-0 horizontal move no longer scrolls:** with `scrollEnabled={false}`, the top bar's Y stays identical as focus moves card 0 → card 1 → card 2 (verified in the simulator). Previously the feed crept down on each move.
- **Deep-row descent anchors near the top** while the top bar hides and the scrim deepens — driven by `handleRowFocus(n)` → `rowY - anchorOffset`.
- **Mission tail reachable:** `handleMissionFocus` → `scrollToEnd()` brings the QR into view; without an explicit hook (native scroll off) it would be unreachable.

## Related

- `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md` — Pitfall 4 is the alternative fix (invisible anchor + `setNativeProps`) for the same problem class; this doc is the row-anchor alternative.
- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` — the non-interactive-hero / rail-owns-focus / debounce patterns on the same Home screen.
- `docs/solutions/best-practices/react-native-tvos-flatlist-sheet-virtualization-pitfalls.md` — `scrollToIndex` + `hasTVPreferredFocus` discipline for Modal-mounted lists.
