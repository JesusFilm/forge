---
title: "React Native flex wrap-grid collapses to one full-width column — use an explicit computed card width"
date: "2026-06-16"
category: ui-bugs
module: apps/mobile
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "A 2-column (3x2) category grid renders as one full-width card per row instead of two columns"
  - "Non-deterministic: the same committed code rendered 2 columns earlier and 1 column later with no code or dependency change"
  - "Cards are full-row width (not narrow + left-aligned) — the signature of flexGrow expanding a lone wrapped item"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
related_components:
  - apps/mobile/src/components/search/BrowseTopics.tsx
  - apps/mobile/src/components/search/TopicCard.tsx
tags:
  - react-native
  - flexbox
  - yoga
  - grid-layout
  - usewindowdimensions
  - discover
---

# React Native flex wrap-grid collapses to one full-width column — use an explicit computed card width

## Problem

The Discover "Browse Categories" grid sized each card with `flexGrow: 1` + `flexBasis: "45%"` inside a `flexWrap` row. When Yoga's wrap algorithm placed a single card alone on a line, `flexGrow: 1` stretched it to the full row width — so the intended 2-column grid intermittently collapsed to one giant card per row.

## Symptoms

- The 2-column (3×2) category grid rendered as one full-width card per row.
- Non-deterministic — the identical committed code rendered 2 columns earlier in a session and 1 column later, with no code or dependency change in between.
- Cards were full-row width (not narrow + left-aligned), the tell-tale sign of `flexGrow` expanding a lone wrapped item rather than a wrap miscount.

## What Didn't Work

- **Hunting for the "commit that broke it."** Git archaeology showed `TopicCard.tsx`/`BrowseTopics.tsx` and their wrapper were unchanged since the feature commit (#1172), and `package.json` (the Yoga/RN version) had not changed since before it. There was no breaking commit — the layout was fragile from the start and only tipped into its failure mode later. (session history: the grid was built fresh from a Stitch design and rendered correctly in every build-time simulator check, so the fragility shipped latent.)
- **Assuming `flexBasis: "45%"` guarantees two per row.** With `flexGrow: 1`, once the wrap places one item alone on a line the basis is irrelevant — grow fills the line. The percentage basis only _usually_ yields two columns; it is not a guarantee.

## Solution

Compute an explicit per-card pixel width from `useWindowDimensions` and pass it down; drop `flexGrow`/`flexBasis`:

```tsx
// BrowseTopics.tsx
const GRID_PADDING = 16
const GRID_GAP = 12
const { width } = useWindowDimensions()
const cardWidth = Math.floor((width - GRID_PADDING * 2 - GRID_GAP) / 2)
// ...
<TopicCard /* ... */ cardWidth={cardWidth} />

// TopicCard.tsx — card style was { flexGrow: 1, flexBasis: "45%", aspectRatio: 1.05 }
<Pressable style={[styles.card, { width: cardWidth }]} />
```

`Math.floor((width - padding * 2 - gap) / 2)` guarantees `2 * cardWidth + gap <= contentWidth`, so two cards always fit on a row.

## Why This Works

A percentage `flexBasis` resolves against the parent's measured main-axis size, and `flexWrap` placement depends on that measurement — which can be evaluated before the parent has a definite width during a layout pass, making wrap placement timing-dependent. When the engine puts one card on a line, `flexGrow: 1` expands it to fill the row. An explicit pixel width is definite regardless of parent timing: a two-card row is computed to fit (see the `Math.floor` note in the Solution), so the layout is deterministic.

## Prevention

- **For fixed-column RN grids, compute an explicit width from `useWindowDimensions` and pass it to the card.** Reserve `flexGrow`/percentage `flexBasis` for genuinely fluid rows, not fixed N-column grids — a lone wrapped item plus `flexGrow` is the failure mode.
- A small unit test pinning `cardWidth` for representative screen widths (e.g. 375 / 414 / 430) catches silent regressions if the `GRID_PADDING`/`GRID_GAP` constants change.

## Related

- `docs/solutions/mobile/responsive-typography-hook.md` — establishes `useWindowDimensions()` as the reactive, rotation-safe source of screen width; the grid width reuses that pattern.
- `docs/solutions/best-practices/react-native-tvos-flatlist-sheet-virtualization-pitfalls.md` — same "explicit beats implicit in RN layout: the node must own its size constraint" family.
- Shipped in PR #1275.
