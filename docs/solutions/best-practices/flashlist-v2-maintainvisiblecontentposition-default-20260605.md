---
title: "FlashList v2 enables maintainVisibleContentPosition by default — disable it for search-filtered lists"
date: "2026-06-05"
category: "best-practices"
module: "apps/mobile"
problem_type: "best_practice"
component: "frontend_stimulus"
severity: "low"
applies_when:
  - "Rendering a @shopify/flash-list v2 list whose data array is replaced wholesale (search filter, tab/segment swap, full refetch)"
  - "The list is NOT a chat-style prepend/append feed"
  - "Building search/filter picker sheets in apps/mobile (LanguageSheet, SubtitleSheet) or any list that filters as the user types"
symptoms:
  - "Pressing the search-clear (X) button makes the list scroll up then settle down — a visible jump instead of a clean restore to top"
  - "The jump only happens on a data swap (typing into or clearing the search), never on plain scroll"
root_cause: "wrong_api"
resolution_type: "config_change"
related_components:
  - "apps/mobile/src/components/watch/LanguageSheet.tsx"
  - "apps/mobile/src/components/watch/SubtitleSheet.tsx"
tags:
  - "flash-list"
  - "react-native"
  - "expo"
  - "mobile"
  - "maintainvisiblecontentposition"
  - "scroll"
  - "watch"
---

# FlashList v2 enables maintainVisibleContentPosition by default — disable it for search-filtered lists

## Context

The mobile watch language picker (`LanguageSheet.tsx`) and subtitle picker (`SubtitleSheet.tsx`) each render a search-filtered `FlashList`. As the user types, the list's `data` prop is rebuilt wholesale from a fresh `useMemo` over the full sorted array; pressing the search-clear (X) restores the full dataset in one swap. These are **not** prepend/append feeds — every keystroke and every clear replaces the _entire_ `data` array.

On `@shopify/flash-list` v2 (declared `^2.0.2`, installed 2.3.1), pressing X to clear the query made the list visibly **scroll up and then settle back down** — a corrective jump — instead of cleanly re-rendering the full list from the top.

## Guidance

Set `maintainVisibleContentPosition={{ disabled: true }}` on any FlashList v2 whose `data` is replaced wholesale (search/filter results, tab-switched datasets). FlashList v2 turns this feature **on by default**, and the default is wrong for a non-chat list.

```tsx
<FlashList
  data={filtered}
  keyExtractor={keyExtractor}
  renderItem={renderItem}
  keyboardShouldPersistTaps="handled"
  // Off by intent: FlashList v2 enables maintainVisibleContentPosition by
  // default (for chat-like prepend/append lists). Here the data swaps
  // wholesale as the user types/clears the search, so anchoring makes the
  // list jump (scroll up, then settle) when the X clears the query.
  maintainVisibleContentPosition={{ disabled: true }}
  ListHeaderComponent={header}
  /* ... */
/>
```

The library's own type doc states the feature targets the _other_ use case:

```ts
// @shopify/flash-list/dist/FlashListProps.d.ts
maintainVisibleContentPosition?: {
  /** maintainVisibleContentPosition is enabled by default. */
  disabled?: boolean
  // ...
}
// "Configuration for maintaining scroll position when content changes.
//  Useful for chat-like interfaces where new messages can be added at the
//  top or bottom."
```

## Why This Matters

`maintainVisibleContentPosition` (MVCP) picks an anchor row in the current viewport and, when `data` changes, scrolls so that anchor stays put. That is exactly right for a chat feed where messages are prepended/appended around the user's position — and exactly wrong for a search list whose data is replaced wholesale. When the X swaps the small filtered set back to the full set, MVCP tries to keep the previously-anchored row visible, producing the scroll-up-then-settle correction. Disabling it tells FlashList to treat the new dataset as a fresh list and render from the top, so the clear is instant and stable.

It bites silently: no warning, no error — just a jump that looks like a layout or keyboard-dismiss bug, on every list someone wires up by copying a chat example or accepting defaults. (The instinct is to chase keyboard events, `keyboardShouldPersistTaps`, or the formSheet detent height — all dead ends. Don't reach for a manual `scrollToOffset(0)` either; it fights the same anchor and adds its own flicker.)

## When to Apply

- For any FlashList v2 list whose `data` is **replaced wholesale** (search results, filter results, tab-switched datasets), set `maintainVisibleContentPosition={{ disabled: true }}`.
- Keep MVCP enabled (the default) **only** for genuine prepend/append chat-style feeds where preserving the scroll anchor across incremental inserts is the desired UX.
- Rule of thumb: if a new `data` array is not a superset that grew at the head or tail of the old one, disable MVCP.
- **Paired hazard on these same sheets:** a sheet `FlashList` inside an Expo formSheet also needs an **explicit height** — both sheets wrap it in `<View style={{ height: listHeight }}>` via `useSheetListHeight(windowHeight)`, derived from the native detent index. A `flex: 1` height inside the unbounded formSheet content root makes FlashList render all rows (defeating virtualization) and `onLayout` becomes circular. Treat "disable MVCP" + "explicit height" as a paired checklist whenever adding or copying one of these picker sheets.

## Examples

There is no unit test — this repo has no render-test infra for FlashList. **Verification is the simulator:** open the language (or subtitle) sheet → type gibberish until the list is empty ("No languages/subtitles found") → press X to clear → confirm the list is stable at the top with no scroll-up/settle. Comparing screenshot frames at 0s and ~1s after the clear (they should be identical in list position) is enough to lock it.

**Superseded 2026-08-15 (`apps/mobile` only).** `apps/mobile` now has a component-render harness, and it needed no new dependency — `@testing-library/react-native` is still absent. See `apps/mobile/CLAUDE.md`, section "Component render tests". A render suite can now pin the MVCP prop on these sheets. It still cannot reproduce a native scroll settle, so the simulator check above stays the acceptance evidence. The paragraph above stays as the record of what was true when it was written.

## Related

- `bottom-sheet-migration-expo-sdk54-pitfalls-20260527.md` — same two sheets (`LanguageSheet`, `SubtitleSheet`), sibling hazards (gesture-handler bootstrap, snap-point remount, snap-vs-scroll). Different root cause. Its §9 list guidance prescribes `BottomSheetFlatList` with `initialNumToRender/windowSize`; these sheets have since moved to FlashList v2, so that section's list-lib advice is partially superseded here.
- `../mobile/flashlist-opaque-background-hides-absolute-hero.md` and `../mobile/flashlist-hero-bleed-through-feed-background.md` — other FlashList gotchas (background/z-index), same library family.
- `mobile-video-detail-page-patterns-20260527.md` — §5 list `renderItem`/hook memoization for scroll perf on the same mobile surface.
- Adjacent (in `MEMORY.md`, not a doc): the FlashList-in-formSheet explicit-height hazard on these same sheets — the paired requirement noted in "When to Apply".
