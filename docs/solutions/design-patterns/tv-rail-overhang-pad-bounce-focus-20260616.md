---
title: "TV home rail — column-preserving D-pad focus with invisible pad-cell over-hang bounce"
date: 2026-06-16
last_refreshed: 2026-06-19
category: docs/solutions/design-patterns
module: apps/tv
problem_type: design_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "Rendering multiple horizontal FlatList rails of unequal length on a tvOS / Android TV home screen"
  - "A shorter rail is skipped entirely when the focused column over-hangs its last card"
  - "D-pad Up/Down must land on the same column position across rails instead of replaying each rail's last-focused card"
  - "TVFocusGuideView autoFocus is teleporting focus unpredictably between stacked rails"
  - "An edge card has no focusable directly above/below it (e.g. a centered top bar over the rail's edge columns)"
tags:
  - tv
  - tvos
  - android-tv
  - react-native-tvos
  - tvfocusguideview
  - focus
  - d-pad
  - requesttvfocus
  - flatlist
related_components:
  - apps/tv/src/components/home/HomeRail.tsx
  - apps/tv/src/components/home/HomeCard.tsx
  - apps/tv/src/components/home/HomeTopBar.tsx
  - apps/tv/src/components/home/homeRailItems.ts
---

# TV home rail — column-preserving D-pad focus with invisible pad-cell over-hang bounce

## Context

The TV home screen (`apps/tv`, react-native-tvos 0.81.5) stacks several horizontal "rails" (FlatList carousels of cards) vertically. Three D-pad focus problems surfaced, and the over-hang one in particular only yielded after two intuitive fixes hit hard tvOS focus-engine limitations:

1. **Edge-card up-focus dead-end** — D-pad Up from the leftmost/rightmost card of the first rail did nothing, because the centered top bar has no focusable directly above those columns.
2. **Per-rail focus "memory"** — `TVFocusGuideView autoFocus` restored each rail's _last-focused_ card on re-entry, so Up/Down teleported focus horizontally between rails instead of preserving the column.
3. **Shorter rails skipped** — once nav was column-preserving (pure geometry), the focus engine _skips a shorter neighbour rail entirely_ when the entering column over-hangs its card count (e.g. column 4 over a 3-card rail), jumping to a longer rail beyond it.

Shipped in [PR #1274](https://github.com/JesusFilm/forge/pull/1274). The headline reusable pattern is #3: invisible "pad" cells that catch the over-hang and bounce focus to the rail's last real card.

## Guidance

### 1. Edge-card up-focus — `nextFocusUp` to a node lifted via ref-as-state

The Search/Home tab bar is centered, so edge cards have no focusable in their up-projection. Set `nextFocusUp` on the card's `Pressable`, targeting the Search tab's node. Lift that node out of `HomeTopBar` with ref-as-state (the same contract `MissionSection` uses for its QR destination):

```tsx
// app/index.tsx
const [searchTabNode, setSearchTabNode] = useState<ViewType | null>(null)

<HomeTopBar onSearchTabNode={setSearchTabNode} />

// Only the featured rail (row 0) sits under the top bar:
<HomeRail upFocusTarget={searchTabNode} ... />
```

```tsx
// HomeTopBar.tsx — the Search TopBarTab forwards its node:
<Pressable ref={nodeRef} ... />
```

```tsx
// HomeRail.tsx — coalesce null -> undefined so a not-yet-captured node
// falls back to spatial geometry rather than wiring up to a null destination:
<HomeCard nextFocusUp={upFocusTarget ?? undefined} ... />
```

`FocusDestination` accepts a **component instance** directly (`Pressable` forwards it via `tagForComponentOrHandle`) — no `findNodeHandle` / native-tag lookup needed. This works because the target (the top bar) is **not** inside a FlatList (see Why This Matters #1).

**The reverse direction is asymmetric — do not mirror it with `nextFocusDown` on the tab.** Down from the top-bar tab back to the content below cannot be wired with `nextFocusDown` on the tab: the tab lives in the ScrollView's **sticky header** (`stickyHeaderIndices`), and re-parented sticky-header children silently lose `nextFocus*` hints (distinct from the cross-FlatList drop in #3 — this is a sticky-header _source_ constraint). Bridge Down with a `TVFocusGuideView destinations` wrapping the destination region instead (the `MissionSection` pattern). So: `nextFocusUp` on the scroll-body child for Up, a guide on the destination for Down. See [`tv-sticky-header-nextfocus-asymmetry-bridge-20260619.md`](./tv-sticky-header-nextfocus-asymmetry-bridge-20260619.md).

### 2. Column-preserving vertical nav — drop `autoFocus`

`autoFocus` on a rail's guide restores the last-focused card on re-entry. Remove it so the tvOS spatial-geometry engine lands on the card whose on-screen x is nearest the leaving card's column:

```tsx
// before — teleports to each rail's remembered card
<TVFocusGuideView autoFocus>
  <FlatList ... />
</TVFocusGuideView>

// after — column-preserving (spatial geometry)
<TVFocusGuideView>
  <FlatList ... />
</TVFocusGuideView>
```

Keep `autoFocus` only where restoring the last horizontal position is the desired UX (a single-rail detail page), not on a vertically stacked multi-rail feed.

### 3. Over-hang skip — invisible pad cells that bounce via `requestTVFocus()`

**Failed approach A — per-card `nextFocusDown`/`nextFocusUp` to the neighbour rail's last card.** The obvious fix, and completely ineffective: tvOS **silently ignores** per-view `nextFocus*` when the destination is inside a _different_ FlatList. Verified twice with the override confirmed present via logs; the rail was still skipped.

**Failed approach B — full-width `TVFocusGuideView destinations`.** `destinations` _does_ cross FlatList boundaries (it reaches the target), but a full-width guide intercepts **every** inbound vertical move and redirects it to the destination — not only the over-hanging ones. This hijacks aligned moves and breaks column-preservation. Reverted. (The belief that "destinations only fires when there's no aligned competitor" is false for stacked rails.)

**Working solution — invisible pad cells.** Append transparent, focusable, inert placeholder cells to the _end_ of each rail, out to the visible column count. Geometry lands the over-hanging move on a pad (no skip); the pad's `onFocus` immediately bounces to the rail's last real card via `requestTVFocus()` — a **same-rail** move, which works where cross-FlatList `nextFocus` does not.

```ts
// homeRailItems.ts — pure, unit-tested (jest-expo can't load .tsx)
export type RailItem = { kind: "card"; card: WatchHomeCard } | { kind: "pad" }

export function buildRailItems(
  cards: WatchHomeCard[],
  visibleColumns: number,
): RailItem[] {
  if (cards.length === 0) return []
  const items: RailItem[] = cards.map((card) => ({ kind: "card", card }))
  const padCount = Math.max(0, visibleColumns - cards.length)
  for (let i = 0; i < padCount; i++) items.push({ kind: "pad" })
  return items
}
```

```tsx
// HomeRail.tsx — the pad and the bounce
function requestTVFocus(node: ViewType | null): void {
  // requestTVFocus() is a react-native-tvos NativeMethods extension absent
  // from the bundled View type; no-ops safely on a null/detached node.
  ;(node as { requestTVFocus?: () => void } | null)?.requestTVFocus?.()
}

const RailPad = memo(function RailPad({ targetNode }: { targetNode: ViewType | null }) {
  return (
    <Pressable
      focusable={targetNode != null}          // never strand focus on an uncaptured pad
      accessibilityElementsHidden               // VoiceOver skips it
      importantForAccessibility="no-hide-descendants"
      onFocus={() => requestTVFocus(targetNode)}
      style={styles.pad}                        // see the critical style note below
    />
  )
})

// style — CRITICAL: transparent, NOT opacity:0 (see Why This Matters #3)
pad: { width: HOME_CARD_WIDTH, height: HOME_CARD_THUMB_HEIGHT }
```

The rail captures its last real card's node via ref-as-state and feeds the FlatList `extraData` so the pads re-render once the target arrives:

```tsx
const [lastCardNode, setLastCardNode] = useState<ViewType | null>(null)

// in renderItem — only the last real card reports its node:
<HomeCard nodeRef={index === cards.length - 1 ? setLastCardNode : undefined} ... />
// ...and the pad consumes it:
<RailPad targetNode={lastCardNode} />

<FlatList data={items} extraData={lastCardNode} ... />  // required — see #4
```

## Why This Matters

Five tvOS / React Native constraints are load-bearing — get any wrong and the pattern silently fails:

1. **Cross-FlatList `nextFocus*` is silently ignored.** Per-view `nextFocusDown`/`nextFocusUp` only fire when the destination is in the _same_ FlatList. To a non-FlatList sibling (the top bar) they work fine — which is why #1 above succeeds and #3's approach A fails. No error either way; it just doesn't move.
2. **A full-width `TVFocusGuideView destinations` guide hijacks all inbound vertical moves**, aligned ones included — it does not check for a spatial competitor first. Only a guide/focusable scoped to the empty over-hang region avoids the hijack, which is exactly what the pad cells are.
3. **Alpha-0 views are unfocusable to the geometric focus engine.** `opacity: 0` makes the pad un-catchable, so it must be transparent via _absence of background and content_, alpha 1. (Note: this was established for geometric/directional catch. Whether an explicit `hasTVPreferredFocus` claim can still target an `opacity:0` view — as some older anchor patterns assume — was not tested here; see Related.)
4. **FlatList re-renders rows only on `data`/`extraData` change, not on `renderItem` closure change.** The bounce target arrives asynchronously (ref-as-state, after mount), so without `extraData={lastCardNode}` the pads keep their initial `null` target forever and never bounce.
5. **`useEffect` runs after the commit-phase ref callbacks.** Resetting the captured-node state in an effect (e.g. "clear on data change") wipes the nodes the refs just populated in the same commit, and stable refs never re-fire to restore them. Let ref detach/attach handle the lifecycle on remount.

`requestTVFocus()` is synchronous in `onFocus` and needs no `setTimeout`/`requestAnimationFrame` deferral on tvOS. **Verified on the tvOS simulator only — confirm on a physical Android TV device before relying on it there.**

## When to Apply

Use the **invisible-pad over-hang bounce** when all hold:

- react-native-tvos, tvOS (and verify on Android TV)
- multiple horizontally-scrolling FlatList rails stacked vertically
- rails of differing card counts (shorter rails create over-hanging columns)
- column-preservation on vertical D-pad nav is a product requirement

Use **`nextFocusUp`/`Down` ref-as-state** when the vertical target is geometrically offset from the source (e.g. a centered tab bar above edge cards) **and** the target is a non-FlatList `Pressable`.

**Drop `TVFocusGuideView autoFocus`** whenever column-preserving vertical nav is wanted; keep it only for single-rail surfaces where restoring the last horizontal position is desired.

## Examples

**Over-hang catch — 5-card rail above a 3-card rail, 5 visible columns.**
`buildRailItems` yields `[card0, card1, card2, pad, pad]` for the 3-card rail.
User on card4 (column 4) of the upper rail presses **Down**:

1. Geometry projects down from column 4.
2. The 3-card rail has no real card at column 4 — _without_ pads, tvOS skips it and jumps to a longer rail below.
3. _With_ pads, the pad at index 4 is present and focusable (`lastCardNode` was captured when card2 mounted) → focus lands on the pad.
4. `onFocus` → `requestTVFocus(lastCardNode)` → focus bounces to card2 (the last real card), which dispatches `onRowFocus` so the screen scrolls and the showcase updates.

Aligned columns are untouched: from column 1, Down lands on the 3-card rail's card1 directly by geometry — no pad involved (the pads only sit in the empty right columns).

**Edge up-focus — Down/Up symmetry from a corner card.** From card0 (leftmost) of the featured rail, Up with `nextFocusUp={searchTabNode}` routes to the Search tab regardless of geometry (the centered tab bar doesn't overlap column 0). Without it, the press is a dead-end.

## Related

- [`tv-home-row-anchored-scroll-native-focus-scroll-disabled-20260615.md`](./tv-home-row-anchored-scroll-native-focus-scroll-disabled-20260615.md) — **companion, same screen.** That doc is the row-anchored _scroll_ layer (`scrollEnabled={false}` + `handleRowFocus`); this doc is the _column-focus_ layer. Together they describe the redesigned home's navigation.
- [`tv-sticky-header-nextfocus-asymmetry-bridge-20260619.md`](./tv-sticky-header-nextfocus-asymmetry-bridge-20260619.md) — **the reverse-direction complement.** §1 here handles Up from edge cards/hero to the centered tab via `nextFocusUp` ref-as-state; that doc handles **Down** from the sticky-header tabs back to the hero (the tabs drop `nextFocusDown`, so a `TVFocusGuideView destinations` bridges Down to the hero CTA). Same `onSearchTabNode` / `ctaNode` ref-as-state contract.
- [`../best-practices/tv-focus-driven-hero-patterns-20260420.md`](../best-practices/tv-focus-driven-hero-patterns-20260420.md) — the prior home focus model (non-interactive hero / rail-owns-focus via `TVFocusGuideView autoFocus`). This doc **extends and partially supersedes** it: `autoFocus` is correct for first-mount initial focus but is the _wrong ongoing model_ for a multi-rail feed (it teleports columns), and its "full-width guide traps DOWN" note generalises to "a full-width `destinations` guide hijacks aligned lateral moves for sibling rails."
- [`../best-practices/react-native-tvos-porting-pitfalls-20260414.md`](../best-practices/react-native-tvos-porting-pitfalls-20260414.md) — general tvOS catalog. **Refresh candidate:** Pitfall 4's invisible focus anchor uses `opacity: 0`; this doc establishes that `opacity:0` is unfocusable for _geometric_ catch. Whether the anchor's explicit `setNativeProps({ hasTVPreferredFocus })` claim still works on an `opacity:0` view is unverified — worth a focused check before trusting that recipe. Pitfall 3's "`nextFocus*` failed" is refined here: it fails _across FlatList boundaries_, not universally.
- [`../best-practices/react-native-tvos-flatlist-sheet-virtualization-pitfalls.md`](../best-practices/react-native-tvos-flatlist-sheet-virtualization-pitfalls.md) — FlatList focus discipline; the one-shot `hasTVPreferredFocus` and re-render rules are cousins of the `extraData`-for-async-focus-target rule here.
- [`../design-patterns/rntvos-dpad-player-chrome-patterns.md`](./rntvos-dpad-player-chrome-patterns.md) — notes `nextFocusUp`/`nextFocusDown` quirks on `Pressable`; refined here to "works to non-FlatList targets, ignored across FlatList boundaries."
- [PR #1274](https://github.com/JesusFilm/forge/pull/1274) — the implementation.
