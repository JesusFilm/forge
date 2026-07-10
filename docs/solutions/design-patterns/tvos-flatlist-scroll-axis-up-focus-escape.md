---
title: "tvOS up-escape from a vertically-scrolling FlatList: nextFocusUp destination plus momentum gating"
date: 2026-06-22
category: design-patterns
module: apps/tv
problem_type: design_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "A focusable widget (keyboard, toolbar) sits ABOVE a vertically-scrolling FlatList in a full-screen tvOS layout and D-pad-up must escape the list's top row into that widget"
  - "D-pad-up from the top row stays stuck on the topmost card until the FlatList's scroll momentum fully settles, then jumps to the widget"
  - "The same screen with the widget to the LEFT (cross-axis escape) works fine — only the along-scroll-axis (vertical) escape is blocked"
  - "Rapidly pressing / holding D-pad-up builds scroll momentum that swallows the exit"
tags:
  - tv
  - tvos
  - android-tv
  - react-native-tvos
  - tvfocusguideview
  - nextfocusup
  - focus
  - d-pad
  - flatlist
  - scroll
  - decelerationrate
related_components:
  - apps/tv/src/components/search/SearchResultsGrid.tsx
  - apps/tv/src/components/search/SearchKeyboardLinear.tsx
  - apps/tv/app/search.tsx
---

# tvOS up-escape from a vertically-scrolling FlatList: nextFocusUp destination plus momentum gating

## Context

On the Apple TV `/search` screen (stacked layout) a single-line keyboard sits ABOVE a vertically-scrolling results grid (`FlatList`, `numColumns`). When the user D-pads DOWN into the grid then presses UP repeatedly, focus stays stuck on the topmost result card and **cannot reach the keyboard above until the grid's scroll momentum fully settles** — only after the scroll stops does the up-move land on the keyboard.

The two-pane (Android) layout of the same screen is immune: there the keyboard is to the LEFT, so escaping the grid is a cross-axis (horizontal) move the platform never defers. The bug is specific to escaping a vertically-scrolling list **along its own scroll axis**.

## Root cause: tvOS defers along-axis focus exits during scroll

This is native tvOS focus-engine behavior, not an app bug. While a `UIScrollView` / `FlatList` is decelerating (momentum from rapid D-pad presses), the focus engine captures focus for fast-scroll position management (a hidden `_UIFocusFastScrollingIndexBarView`) and does **not** process a directional move that exits the scroll view _along its scroll axis_ — `shouldUpdateFocus` is never called during fast scroll. The exit is swallowed until deceleration ends. Cross-axis exits (left/right out of a vertical list) are unaffected, which is why the two-pane layout works.

Two consequences shape the fix:

1. Destination-finding APIs alone (`nextFocusUp`, `TVFocusGuideView destinations`) do **not** bypass the deferral — they decide _where_ a move lands, not _whether_ the engine processes it. During deceleration the engine never decides to move, so they fire only after the scroll settles.
2. So the fix must both (a) shrink the deceleration window and (b) make the landing deterministic.

## Guidance — the fix has two layers, both required

### 1. Shrink the momentum window — gate `decelerationRate` to the affected platform

`decelerationRate="fast"` on the results `FlatList` trims the deceleration tail so the up-press is processed sooner. Because the same `FlatList` is shared by the Android two-pane layout (no along-axis escape, different momentum model), gate it so Android keeps its default — otherwise you silently change Android's scroll feel:

```tsx
// SearchResultsGrid.tsx — the FlatList is shared by BOTH layouts
<FlatList
  // ...
  decelerationRate={Platform.OS === "ios" ? "fast" : "normal"}
/>
```

### 2. Make the landing deterministic — `nextFocusUp` from the top row to the widget's node

Wire the grid's TOP ROW (`index < numColumns`) — and only the top row — to the keyboard's first-key node via `nextFocusUp`, so once the move is processed it lands on the keyboard rather than on geometric fallback. Capture the node ref-as-state — the same primitive the home rails use (`HomeCard` / `HomeRail`) (session history):

```tsx
// the keyboard exposes its FIRST key's node (ref-as-state)
<KeyButton nodeRef={index === 0 ? onLandingNodeChange : undefined} /* ... */ />

// the stacked body holds the node and threads it to the grid's top row
const [keyboardLandingNode, setKeyboardLandingNode] = useState<View | null>(null)
// ...
<SearchResultsGrid topRowFocusUp={keyboardLandingNode} /* ... */ />

// the grid applies it on the FIRST ROW only; a not-yet-captured node
// coalesces to undefined -> geometry, never wires to null
nextFocusUp={index < numColumns ? (topRowFocusUp ?? undefined) : undefined}
```

The two-pane / Android body passes **neither** prop, so its grid keeps geometry-driven up-navigation and left-exit — unchanged.

## Why `nextFocusUp` alone is not enough

Destination APIs answer "given a move, where does it go," not "is the move processed." During deceleration the engine never decides to move, so `nextFocusUp` on its own still loses to the momentum tail. The momentum-kill is the decisive lever; `nextFocusUp` guarantees the destination once the move is allowed. They are complementary, not alternatives.

A crucial constraint from prior tvOS focus work (session history): per-view `nextFocus*` is **silently ignored when the destination lives inside a DIFFERENT FlatList** — only `TVFocusGuideView destinations` (a `UIFocusGuide`) crosses FlatList boundaries. Here the target (the keyboard's key) is a `Pressable` _outside_ any FlatList, so `nextFocusUp` is valid. If the keyboard were ever virtualized into its own list, this would break and you would need a `requestTVFocus` / `destinations` bounce instead.

## When to apply

- A fixed focusable widget ABOVE a **vertically-scrolling** FlatList on tvOS, where up must escape the list's top row.
- NOT for cross-axis escapes (widget to the left/right of the list) — those aren't deferred, so they need no special handling.
- The `nextFocusUp` half is safe whenever the target is NOT inside another FlatList; if it is, use `TVFocusGuideView destinations` instead.

## Verification caveat

The momentum-timing behaviour **differs between the tvOS simulator and real Apple TV hardware** — the sim's deceleration is unrepresentative, and `idb` / simulator input can't reproduce the rapid-press fast-scroll the bug requires. Verify the fast-fling-then-up escape on physical Apple TV. If a swallow tail remains on hardware, escalate to `snapToInterval` (measured row height) + `disableIntervalMomentum` to force row-by-row settling with zero lingering momentum.

## What didn't work (and adjacent prior art)

- **`nextFocusUp` / destination APIs alone** — don't bypass the deceleration deferral; the engine never processes the move mid-scroll. Momentum must be shrunk too.
- **`TVFocusGuideView destinations` for a directional escape** — catches ALL entries into the guide, not just the edge case, causing regressions in the opposite direction; prior TV work reverted it in favour of directional `nextFocus*` and reserved `destinations` for the _receiving_ side of a bridge (session history).
- **per-view `nextFocus*` across a FlatList boundary** — tvOS silently ignores it; only `destinations` crosses lists (session history). The keyboard target here is outside any FlatList, so `nextFocusUp` is valid.

## Related

- `docs/solutions/design-patterns/tv-sticky-header-nextfocus-asymmetry-bridge-20260619.md` — the `nextFocusUp` ref-as-state primitive + the sticky-header `nextFocusDown`-drop asymmetry.
- `docs/solutions/design-patterns/tv-rail-overhang-pad-bounce-focus-20260616.md` — ref-as-state node capture + the cross-FlatList `nextFocus*` limitation and `requestTVFocus` bounce.
- `docs/solutions/best-practices/react-native-tvos-flatlist-sheet-virtualization-pitfalls.md` — `hasTVPreferredFocus` single-cell focus claims on FlatLists.
- Spec: `docs/superpowers/specs/2026-06-22-tv-apple-linear-search-keyboard-design.md`.
