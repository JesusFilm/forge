---
title: "TV Home Rail Focus-Clip Headroom: Sizing Padding Against tvOS Touchpad Parallax"
date: 2026-07-20
category: design-patterns
module: apps/tv Home rails / TV focus
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Rendering a horizontal FlatList rail on tvOS where a card scales up (magnify + lift + ring) on D-pad focus"
  - "The focused card's top edge is clipped against the rail's or FlatList's scroll/clip bounds"
  - "Accounting for react-native-tvos's default touchpad parallax (RCTTVView addParallaxMotionEffects: centre shift + two tilts, each its own perspective) layered on top of a static focus scale"
  - "Sizing paddingTop/marginTop headroom for a focus effect without changing resting layout, rail height, or the head-to-cards gap"
  - "Porting one rail component across card variants (landscape vs portrait) where taller cards need proportionally more headroom"
tags:
  - react-native-tvos
  - tvos
  - focus
  - parallax
  - home-rail
  - clipping
  - headroom
  - d-pad
---

# Sizing focus-clip headroom for a tvOS card rail, carved from the clip bounds

## Context

On the TV Home screen each curated section is a horizontal `FlatList` of fixed-size cards. When a card takes D-pad focus it grows and lifts: the "thumb" focus preset magnifies it to 1.06x, lifts it up by 8 points, and draws a 5-point white ring just outside the artwork (`apps/tv/src/components/focus/focusVisual.ts:14`, `:66`). That focus treatment pushes the card's top edge above the layout box the list reserved for it. A horizontal scroll container clips its children to its own bounds, so the raised top edge of a focused card was being trimmed flat — visible as a straight-cut top on the focus ring instead of the full rounded corner. The symptom was worst on the portrait poster rails, whose cards are much taller (260x390) than the landscape cards (400x187.5), so the same magnification lifts their top corner further above the box (`apps/tv/src/components/home/HomeCard.tsx:39`).

The naive fixes both fail. Adding a bigger flat `paddingTop` to every item does reserve room above the card, but if you pick one constant tuned for the landscape rails it still under-covers the taller portrait cards, and if you pick a constant large enough for portrait you have now pushed every rail's resting position down — the gap between each section's title and its cards visibly grows, and the whole rail is taller at rest even though nothing is focused. Worse, neither flat-padding approach accounts for a second, invisible source of overhang: on tvOS the Siri Remote touchpad drives a parallax nudge on every focusable view, on top of the focus scale, with no opt-in from the app. A card can therefore be clipped even when its static focused geometry would have fit.

## Guidance

Model the total overhang precisely, reserve exactly that much as top padding, and then pull the list up by the amount that exceeds the resting gap so the extra room is taken out of the clip bounds rather than the layout. The whole geometry lives in one pure, unit-tested module, `apps/tv/src/components/home/homeRailHeadroom.ts`, so the model can be pinned by jest without dragging in JSX.

The static rise is the height the focused card's top edge gains above its layout box. With the card's full height `cardHeight` (artwork plus a generous `META_HEIGHT_ALLOWANCE` of 80 points for the title block), the ring width, and the "thumb" preset's magnify and lift, the top edge sits at `(cardHeight/2 + ring) * magnify + lift` measured from the card centre; subtracting the un-magnified half-height `cardHeight/2` gives the overhang above the box (`homeRailHeadroom.ts:42`).

On top of that, tvOS parallax adds RCTTVView's default motion effect. The native source `RCTTVView.m` sets `shiftDistanceX`/`shiftDistanceY` to 2.0, `tiltAngle` to 0.05 radians, and `magnification` to 1.0 (`RCTTVView.m:38`). Its `addParallaxMotionEffects` builds four separate `UIInterpolatingMotionEffect` objects — a horizontal centre shift, a vertical centre shift, a tilt about the Y axis, and a tilt about the X axis — and installs them together as the view's `motionEffects` array (`RCTTVView.m:156`). Each of the two tilt effects builds its own `CATransform3D` that first sets `m34 = 1.0/500` (the perspective foreshortening term) and then rotates by the tilt angle (`RCTTVView.m:194`, `:213`). So a full nudge can add a plus-or-minus 2-point centre shift plus two 0.05-radian perspective tilts, and those tilts magnify the near top corner rather than the centre.

The subtle part is how the two tilts compose. Because UIKit installs the X-axis tilt and the Y-axis tilt as two independent motion effects, at a full diagonal nudge the corner is routed through both perspective transforms in sequence, each carrying its own `m34`. The corner's outward offset is therefore weighted by roughly `(1 + cos(0.05))`, which is close to 2, not by a single perspective's factor of 1. The module encodes exactly this: it divides the static top-corner distance by a perspective factor that carries the `(1 + cos)` weight, and adds the 2-point vertical shift, before subtracting the resting half-height (`homeRailHeadroom.ts:50`):

```ts
const perspectiveW =
  1 -
  (PARALLAX_TILT_SIN * (1 + PARALLAX_TILT_COS) * (halfWidth + topFromCenter)) /
    PARALLAX_PERSPECTIVE
return Math.ceil(
  topFromCenter / perspectiveW + PARALLAX_SHIFT_Y - cardHeight / 2,
)
```

The carve-from-the-clip technique is the second half. `railPaddingTopFor` reserves the headroom but floors it at the resting head-to-cards gap so short rails are never pulled tighter than the design gap of 32 points; `railPullUpFor` returns the negative complement, the amount by which the reserved padding exceeds that gap (`homeRailHeadroom.ts:62`, `:68`):

```ts
export function railPaddingTopFor(dims: RailCardDims): number {
  return Math.max(HEAD_CARD_GAP, focusHeadroomFor(dims))
}
export function railPullUpFor(dims: RailCardDims): number {
  return HEAD_CARD_GAP - railPaddingTopFor(dims)
}
```

In the rail component, the per-item wrapper takes the computed `paddingTop`, and the `TVFocusGuideView` that wraps the `FlatList` takes an equal-and-opposite negative `marginTop`. Before the fix the rail wrapper carried a single flat top padding and no pull-up. After the fix the two are paired (`apps/tv/src/components/home/HomeRail.tsx:98`, `:112`, `:294`):

```tsx
// per item: reserve the headroom
paddingTop: railPaddingTopFor(HOME_CARD_DIMS.portrait)
// on the list wrapper: carve it back out of the clip bounds
marginTop: railPullUpFor(HOME_CARD_DIMS.portrait)
```

Because the padding pushes the cards down by the headroom and the margin pulls the list up by the headroom-minus-gap, the visible seam under each section title stays exactly `HEAD_CARD_GAP`, and the rail's outer height is unchanged — the extra room exists only inside the clip region, precisely where a focused card needs it.

Merge state: this rides in PR #1615 (open, CI green as of this writing) — whose title is about default audio/subtitle language settings, because the rail fix and that feature were developed on the same branch; the headroom commits are `fix(tv): stop clipping focused portrait Home cards at the rail top` and `fix(tv): widen Home rail head-to-cards gap so focused cards clear the title`.

## Why This Matters

Three things make this a reusable pattern rather than a one-off tweak.

First, the `(1 + cos)` composition subtlety is a genuine correctness point, not decoration. This was a two-pass finding: the first model used a single shared perspective and undersized the headroom, and an adversarial review caught that the two tilts compose as separate concatenated transforms. The numbers show why it matters. With the two-perspective composition the portrait card needs 53 points of headroom; a single-perspective model computes only 41, about a dozen points short — enough that a full diagonal touchpad nudge would still clip the portrait corner. The landscape card needs 36 versus a naive 30. A model that looks plausible and passes a quick simulator check on landscape rails can still be silently wrong on taller cards, because the overhang grows with card height and the perspective weighting compounds it.

Second, the resting-invariant discipline is what lets you size headroom aggressively without regressing the calm, un-focused layout. The rule is that whatever you add as padding to make clip room, you subtract again as margin so the resting geometry is byte-identical. That invariant, `railPaddingTopFor(d) + railPullUpFor(d) === HEAD_CARD_GAP`, is pinned by a test so a future constant change cannot quietly reintroduce a resting-layout shift.

Third, the Android divergence is deliberate. Android TV is D-pad only and has no touchpad parallax, so the parallax shift and tilt terms are zeroed on Android (`homeRailHeadroom.ts:28`). Only the static focus rise is reserved there, which keeps Android rails from carrying tvOS-only headroom they would never use.

A verification note worth carrying forward: the tvOS simulator cannot drive the Siri Remote touchpad synthetically, so the worst-case parallax excursion cannot be reproduced through `idb` or `cliclick` remote automation. It was reproduced instead by temporarily injecting the equivalent JS transform into the focused card (`perspective 500` then `rotateX`, `perspective 500` then `rotateY`, then a downward `translateY`) and screenshotting; the static clip was measured directly, by pixel-measuring the focus ring's corner inset — a flat 21-pixel cut before the fix versus the full 41-pixel rounded arc after.

## When To Apply

Reach for this whenever a `react-native-tvos` surface puts any focus scale, lift, or outer ring on a card that lives inside a clipped horizontal rail (a `FlatList` or `ScrollView`). The taller and narrower the card, the more likely the landscape-tuned intuition is wrong, so portrait or poster rails are the highest-risk case. If the surface is tvOS, budget for the touchpad parallax on top of the static focus treatment even though nothing in the app opts into it, and model the two tilts as composing through separate perspectives rather than one. And whenever you reserve clip headroom, pair it with an equal negative margin so the resting layout is provably unchanged — do not just enlarge a flat padding.

## Examples

The whole model is three pure functions in `apps/tv/src/components/home/homeRailHeadroom.ts`. `focusHeadroomFor(dims)` returns the total overhang above the layout box for a given card shape, combining the static magnify-plus-lift-plus-ring rise with the worst-case diagonal parallax through the two concatenated perspectives (`homeRailHeadroom.ts:42`). `railPaddingTopFor(dims)` floors that at the 32-point resting gap (`:62`). `railPullUpFor(dims)` returns the negative complement that carves the surplus out of the clip bounds (`:68`).

The test file pins the model against the two real card shapes (`apps/tv/src/components/home/homeRailHeadroom.test.ts`). The worst-case-nudge headroom is pinned at 36 points for the landscape card and 53 points for the portrait card at scale 1, with a comment instructing that any drift means re-verifying top-edge clipping in the simulator before accepting the new numbers (`homeRailHeadroom.test.ts:25`). A separate test asserts the portrait headroom exceeds the landscape headroom, which is the original portrait-only clip written down as an ordering invariant (`:31`). The floor test confirms a tiny card falls back to the resting gap (`:35`). The resting-seam invariant test asserts `railPaddingTopFor(dims) + railPullUpFor(dims) === HEAD_CARD_GAP` for landscape, portrait, and tiny shapes (`:39`). Pinning the worst-case output values against the real card dimensions — rather than only asserting the invariant — is the mocked-shape-vs-real-contract discipline applied to geometry: the invariant test would still pass if the parallax model were deleted, so the exact-value pins are what actually guard the fix.

The wiring is in `apps/tv/src/components/home/HomeRail.tsx`. The per-variant `ITEM_WRAPPER` sets `paddingTop: railPaddingTopFor(HOME_CARD_DIMS.landscape | portrait)` with the bottom padding left at the base gap (`HomeRail.tsx:98`). The per-variant `RAIL_PULL_UP` sets `marginTop: railPullUpFor(...)` (`:112`). The pull-up margin is applied to the `TVFocusGuideView` that wraps the `FlatList`, so the whole scrolling list moves up while the items inside carry the reserved padding (`:294`).

## Related

- [tv-carousel-card-focus-animation-overflow-20260416.md](../ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md) — the closest prior art on the same defect class (a focused card clipped by a rail's scroll bound) but on the Crimson Gallery `FocusableCard` carousels rather than the WATCH_THEME `HomeRail`. It establishes the shared root cause ("a FlatList clips to its own frame; `contentContainerStyle` padding does not expand the clip boundary") and the item-wrapper-padding technique, but uses a flat `paddingVertical` constant with no parallax model and no carve-back. This doc generalizes that fix; consider a consolidation pass to point the older doc forward.
- [apple-tv-card-rail-focus-scale-and-scrim-patterns.md](./apple-tv-card-rail-focus-scale-and-scrim-patterns.md) — sibling coverage of the _horizontal_ focus-scale clip (neighbour-card paint order); orthogonal axis, no parallax model.
- [tv-rail-overhang-pad-bounce-focus-20260616.md](./tv-rail-overhang-pad-bounce-focus-20260616.md) — same file (`HomeRail.tsx`), same screen, but a D-pad focus-movement facet (over-hang pad-cell bounce), not visual clipping.
- [mirror-ui-derive-geometry-from-shared-constants.md](./mirror-ui-derive-geometry-from-shared-constants.md) — the shared-constants convention this module follows: `HEAD_CARD_GAP` is exported from one place and mirrored by the skeleton rather than hand-copied.
- [tv-focus-white-ring-default-and-light-surface-exception.md](../best-practices/tv-focus-white-ring-default-and-light-surface-exception.md) — defines the app-wide focus visual (scale + white ring via `focusVisual.ts`) that the static term of the headroom model is built from.
- [mocked-shape-vs-real-contract-discipline-20260506.md](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — the testing discipline behind pinning the exact worst-case headroom values, not only the invariant.
