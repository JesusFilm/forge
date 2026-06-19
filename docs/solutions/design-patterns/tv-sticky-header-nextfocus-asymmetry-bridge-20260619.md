---
title: "tvOS sticky-header nextFocus asymmetry: bridging D-pad focus across an offset top bar"
date: 2026-06-19
last_refreshed: 2026-06-19
category: design-patterns
module: apps/tv
problem_type: design_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "A React Native ScrollView uses stickyHeaderIndices and the sticky header holds focusable nav (tabs/buttons)"
  - "Focusable content below the sticky header is horizontally offset from the header's controls (no projection overlap)"
  - "D-pad Up from the content or Down from the sticky-header tabs dead-ends with no visible response"
  - "nextFocusDown set on a sticky-header tab type-checks and compiles but does nothing at runtime"
tags:
  - tv
  - tvos
  - android-tv
  - react-native-tvos
  - tvfocusguideview
  - focus
  - d-pad
  - nextfocus
  - sticky-header
related_components:
  - apps/tv/app/index.tsx
  - apps/tv/src/components/home/HomeHeroCarousel.tsx
  - apps/tv/src/components/home/HomeTopBar.tsx
  - apps/tv/src/components/home/MissionSection.tsx
---

## Context

The TV home screen renders one full-screen `ScrollView` whose first child is pinned with `stickyHeaderIndices={[0]}` — the top bar (centered Search / Home tabs, brandmark, clock). Below it the hero carousel's action row — the "See more" CTA and the next-slide chevron — is **left-anchored** inside the hero region.

tvOS focus is purely **geometric**: pressing Up/Down, the engine projects the focused element's horizontal bounds into a vertical beam and looks for the nearest focusable inside that beam. The centered tabs and the left-anchored hero buttons share **no horizontal overlap**, so the beam finds nothing: D-pad Up from the hero dead-ends under the hero artwork, and D-pad Down from a tab falls straight through to the first content rail, skipping the hero entirely. (The previous full-width featured rail overlapped the centered tabs, so geometry worked then; the new left-anchored hero buttons don't.)

The intuitive fix — set `nextFocusDown` on the tabs to point at the hero CTA — **silently does nothing**. Sticky-header children are re-parented during layout, and that re-parenting causes the focus engine to drop `nextFocus*` hints set on them. The asymmetry is real and load-bearing:

- `nextFocusUp` on a **normal scroll-body child** pointing INTO the sticky header **works**.
- `nextFocusDown` set **on a sticky-header child** pointing down is **dropped**.

So one ScrollView + sticky header + horizontally offset focusables produces **two simultaneous dead-ends that need two different mechanisms**.

## Guidance

When a sticky-header nav sits above focusables that are horizontally offset from its controls, bridge each direction by the **source** of the D-pad press:

**Up (normal scroll-body child → sticky header): `nextFocusUp` on the source.**

Lift the sticky tab's native node out via a ref-as-state callback, thread it into the offset component as a target prop, and assign it to `nextFocusUp` on every focusable in the offset region. This is the same ref-as-state mechanism the section rails already use to bridge edge cards Up to the hero CTA (`upFocusTarget={ctaNode}`) — the consumer holds the node, the producer applies it.

```tsx
// app/index.tsx — capture the Search tab node out of the sticky HomeTopBar.
// ViewType is `View` aliased from react-native: import { type View as ViewType } from "react-native"
const [searchTabNode, setSearchTabNode] = useState<ViewType | null>(null)
<HomeTopBar onSearchTabNode={setSearchTabNode} ... />
<HomeHeroCarousel upFocusTarget={searchTabNode} ... />

// HomeHeroCarousel.tsx — both action buttons point Up at the Search tab
<Pressable nextFocusUp={upFocusTarget ?? undefined} ... />
```

**Down (sticky-header child → offset focusable below): `TVFocusGuideView` on the destination region.**

Do **not** set `nextFocusDown` on the sticky tab — it is dropped. Instead wrap the destination region in a `TVFocusGuideView` with `autoFocus` and `destinations={[ctaNode]}`. A Down move that enters the guide's bounds is redirected to the CTA. Hold the destination in **state, not a ref**, so the component re-renders with a real destination the moment the CTA mounts (a plain ref leaves `destinations` undefined on first render).

```tsx
// app/index.tsx — guide bridges Down from the tabs into the offset CTA
const [ctaNode, setCtaNode] = useState<ViewType | null>(null)
<TVFocusGuideView autoFocus destinations={ctaNode != null ? [ctaNode] : undefined}>
  <HomeHeroCarousel onCtaNode={setCtaNode} ... />
</TVFocusGuideView>
```

**The decision rule:**

| Press source                                 | Mechanism                                                       |
| -------------------------------------------- | --------------------------------------------------------------- |
| Normal scroll-body child                     | `nextFocusUp` / `nextFocusDown` on the source                   |
| Sticky-header child (Down out of the header) | `TVFocusGuideView destinations` wrapping the destination region |

## Why This Matters

tvOS focus is geometric — when elements lack horizontal overlap there is no natural path between them, and the result is a **silent dead-end, not an error**. The trap is that `nextFocusDown` on the sticky tab type-checks and compiles, so it looks done; at runtime UIKit's sticky-header re-parenting discards the hint and the press falls through. This is platform behavior, not a fileable bug. The UX cost on a 10-foot screen is real: Down from the Search tab skips the hero and lands on the first rail; Up from the hero drops focus into a dead zone with no visible response.

## When to Apply

Apply the two-mechanism bridge whenever all of the following hold in `apps/tv`:

1. A `ScrollView` uses `stickyHeaderIndices` to pin a nav row.
2. The nav row contains focusable elements (tabs, buttons).
3. Focusables below the sticky header are horizontally offset from those controls (e.g. left-anchored content under a centered nav).

The same re-parenting behavior applies to any direction with no horizontal overlap: reach for a `TVFocusGuideView destinations` on the destination region for **sticky-header-sourced** moves, and `nextFocus*` only for **normal-child-sourced** moves.

## Examples

**Node capture for Up.** `HomeTopBar` exposes its Search tab's node through an `onSearchTabNode` callback (a ref-as-state seam it already had). `app/index.tsx` captures it into `searchTabNode` and threads it as `upFocusTarget` into `HomeHeroCarousel`; both `HeroCtaButton` and `HeroChevronButton` assign it to `nextFocusUp`. This is the vertical-Up complement of the section rail's existing `upFocusTarget={ctaNode}` bridge.

**Guide for Down.** `ctaNode` is already captured from `HomeHeroCarousel` via `onCtaNode` (originally wired only for the rail's Up bridge). Wrapping the hero in `<TVFocusGuideView autoFocus destinations={[ctaNode]}>` is the only addition needed for Down — no per-tab wiring.

**Precedent.** `MissionSection` ships the identical guide shape to bridge Down into its right-anchored QR tile below left-anchored rails — the canonical in-repo example of an offset-focus `TVFocusGuideView destinations` bridge.

**Simulator verification (the only reliable gate — native focus is not unit-testable under jest-expo).** Drive the Apple TV remote with `idb ui key` one press at a time and screenshot after each: `82`=Up, `81`=Down, `79`=Right, `80`=Left. Confirm, on the actual build:

1. Down from Search tab → lands on the See more CTA (not the first rail).
2. Down from Home tab → lands on the See more CTA.
3. Up from See more → lands on the Search tab.
4. Up from the chevron → lands on the Search tab.
5. Down from See more → continues into the first rail (the guide must **not** trap Down-leaving).

Check 5 is the absorption test from [`tv-focus-driven-hero-patterns-20260420.md`](../best-practices/tv-focus-driven-hero-patterns-20260420.md) §3, which warns that a `destinations` pointing at a **descendant** (rather than a sibling) can make the guide absorb the first Down press (double-press to leave). Empirically here, single-press worked in both directions — the descendant-destination warning did **not** manifest, matching `MissionSection`'s shipped descendant-destination bridge. Treat §3 as a per-instance check to run, not a blanket prohibition: verify single-press on each new guide rather than assuming the descendant shape is broken.

## Related learnings

- [`tv-rail-overhang-pad-bounce-focus-20260616.md`](./tv-rail-overhang-pad-bounce-focus-20260616.md) — establishes the `nextFocusUp` → ref-as-state node mechanism (its §1) for **rail edge cards**. This doc is the same mechanism applied to the **hero buttons**, plus the new sticky-header Down finding. That doc's "do not set `nextFocusDown` on the sticky-header tab" rule should point here.
- [`rntvos-inplace-dpad-paging-press-vs-arrival-move.md`](./rntvos-inplace-dpad-paging-press-vs-arrival-move.md) — the **horizontal** focus behavior of the same `HomeHeroCarousel` buttons (`useTVEventHandler` + self-targeted `nextFocusLeft/Right`). This doc is the vertical complement.
- [`tv-home-row-anchored-scroll-native-focus-scroll-disabled-20260615.md`](./tv-home-row-anchored-scroll-native-focus-scroll-disabled-20260615.md) — the scroll layer of the same screen (`scrollEnabled={false}`, focus-driven `scrollTo`). Context for why focus entering the hero via the guide still pins the feed to scroll 0.
- [`tv-focus-driven-hero-patterns-20260420.md`](../best-practices/tv-focus-driven-hero-patterns-20260420.md) — the predecessor "non-interactive hero" model and the §3 sibling-vs-descendant `destinations` caveat. The hero is interactive again here (a paged carousel), so its central thesis is partly superseded for the image-hero case.
