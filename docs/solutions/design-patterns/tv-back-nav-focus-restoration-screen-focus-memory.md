---
title: "tvOS back-navigation focus restoration via a screen-level focus memory (requestTVFocus on re-entry)"
date: "2026-06-25"
category: design-patterns
module: apps/tv
problem_type: design_pattern
component: rails_view
severity: medium
applies_when:
  - "A tvOS screen has many focusables (rails of cards, hero CTA, tabs) and users expect to return to the exact element after pushing then popping a detail screen"
  - "A one-shot hasTVPreferredFocus claim can only restore ONE fixed control, which is insufficient for a multi-focusable screen"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - HomeScreen
  - HomeCard
  - HomeHeroCarousel
tags:
  - tv
  - react-native-tvos
  - expo-router
  - usefocuseffect
  - requesttvfocus
  - navigation
  - focus
---

# tvOS back-navigation focus restoration via a screen-level focus memory (requestTVFocus on re-entry)

> `component: rails_view` is the nearest (Rails-oriented) schema value; the real surface is a **React Native tvOS screen** (`apps/tv/app/index.tsx` + its focusable children). Real tech is in `module` / `tags`.

## Context

On tvOS a stack **pop does not restore the previously-focused native view** (react-native-tvos #852) — the focus engine falls back to the geometric default (top-left). The previously documented workaround is a **one-shot `hasTVPreferredFocus`** flag toggled on re-entry. That works to restore **one designated control** (e.g., always land on Play on a detail page, or the Search tab when returning from `/search`). It does **not** restore "whatever the user was actually on" across a screen with many focusables. On the Home screen — rails of cards, the hero See-more CTA, the next-chevron, top-bar tabs, the mission QR — returning from a detail/series/video screen reset focus to the top-left card or See-more, regardless of where the user had been. Stacking a second `hasTVPreferredFocus` claim (the old `searchTabFocusKey` top-bar remount) only made multiple claims compete on re-entry.

## Guidance

Keep a **screen-level focus memory** of the last-focused element and imperatively restore it on genuine re-entry:

1. **Every focusable reports its native node on focus** to one screen-level capture function. Report the node from a **synchronous ref** set in the ref callback — not from React state, which can still be `null` on the first focus after mount.
2. A tiny memory holds the last non-null node: `capture(node)` ignores nulls (so a blur's null never wipes the target); `restore()` calls `requestTVFocus()` on the remembered node and no-ops when nothing is remembered.
3. **Restore only on a genuine re-entry**, never on first mount — let the mount-time `hasTVPreferredFocus` own initial focus. A prior blur (tracked across `useFocusEffect`'s cleanup) proves re-entry. Defer the restore one frame (`requestAnimationFrame`) so it runs past the pop's commit, when the target node is mounted.

`requestTVFocus()` is a **direct imperative focus** that crosses `FlatList`/tree boundaries — unlike declarative `nextFocus*`, which is silently ignored across `FlatList` boundaries. That is what lets the memory restore a card in _any_ rail, not just a fixed control.

Do **not** reach for per-rail `TVFocusGuideView autoFocus` to solve this: enabling it globally teleports columns during normal vertical traversal (see the over-hang pad-bounce doc). The imperative restore is scoped to re-entry only, so it leaves in-screen column-preserving navigation untouched.

## Why This Matters

A one-shot `hasTVPreferredFocus` restores a single, fixed control and competes when several claims fire on the same commit (the classic "multiple force-reveal paths race" trap). A node memory restores the _actual_ last-focused element with one mechanism and no competing claims — and because it stores the node, it works for cards deep in a horizontal rail where `nextFocus*` would not. The result is the platform-native expectation: press Back, and focus is exactly where you left it.

## When to Apply

- **Use the focus memory** for a tvOS screen with many focusables where users expect to return to exactly where they were after a push/pop (Home, a browse grid, any multi-rail surface).
- **A one-shot `hasTVPreferredFocus` flag is still the right tool** when you only need to restore focus to ONE fixed control on re-entry (Play on a watch detail; the Search tab returning from search). Don't over-engineer those with a memory.

## Examples

Before — a per-control claim that only restored the Search tab and competed with the hero/rails:

```tsx
// bumped on regain-focus so HomeTopBar puts hasTVPreferredFocus on Search
const [searchTabFocusKey, setSearchTabFocusKey] = useState(0)
useFocusEffect(
  useCallback(() => {
    setSearchTabFocusKey((k) => k + 1)
  }, []),
)
```

After — capture every focusable's node, restore the exact one on re-entry:

```tsx
// screen
const focusMemory = useRef(createFocusMemory()).current
const captureFocusedNode = useCallback((n) => focusMemory.capture(n), [])
const hasBlurred = useRef(false)
useFocusEffect(useCallback(() => {
  let raf = null
  if (hasBlurred.current) raf = requestAnimationFrame(() => focusMemory.restore())
  return () => { if (raf != null) cancelAnimationFrame(raf); hasBlurred.current = true }
}, []))

// each focusable (report a SYNCHRONOUS ref, not state)
const ref = useRef(null)
<Pressable ref={(n) => (ref.current = n)} onFocus={() => onFocusNode?.(ref.current)} />
```

```ts
// createFocusMemory(): capture ignores null; restore no-ops on nothing remembered
export function createFocusMemory() {
  let last = null
  return {
    capture(node) {
      if (node != null) last = node
    },
    restore() {
      if (last == null) return false
      last.requestTVFocus?.()
      return true
    },
  }
}
```

## Related

- `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md` — Pattern 4 (one-shot `hasTVPreferredFocus` for back-nav/foreground restore). This pattern **evolves** it: use the focus memory when restoring the _actual_ last element across many focusables; keep the one-shot flag for a single fixed control.
- `docs/solutions/design-patterns/tv-rail-overhang-pad-bounce-focus-20260616.md` — origin of `requestTVFocus()` as the cross-`FlatList` imperative focus, and why per-rail `autoFocus` must stay off for column-preserving traversal.
- `docs/solutions/design-patterns/tv-sticky-header-nextfocus-asymmetry-bridge-20260619.md` — the sticky-header `nextFocus` asymmetry this replaces the `searchTabFocusKey` remount for.
- `docs/solutions/ui-bugs/tv-watch-detail-blank-after-back-usefocuseffect-republish.md` — **sibling learning from the same work**: the _session-state_ half of "return from a child screen" (re-publish the shared WatchSession on focus). This doc is the _focus-engine_ half. Both shipped in PR #1367.
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`, `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`, `docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md` — name #852 back-nav focus loss; their `hasTVPreferredFocus`-only guidance should point here for the multi-focusable case.
