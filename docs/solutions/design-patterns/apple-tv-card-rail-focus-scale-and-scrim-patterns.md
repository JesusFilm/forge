---
title: "Apple TV Card-Rail Cosmetic Patterns: Focus-Scale Anchor, Text-Bounded Scrim, Image Crop"
date: "2026-07-01"
category: design-patterns
module: apps/tv
problem_type: design_pattern
component: frontend_stimulus
severity: low
applies_when:
  - "Building a horizontal FlatList card rail in react-native-tvos where FocusableCard scales on focus"
  - "Overlaying a LinearGradient readability scrim on cards whose text height varies with content"
  - "Choosing an expo-image crop anchor for CMS-sourced card background images"
tags:
  - tv
  - react-native-tvos
  - expo-image
  - focus
  - flatlist
  - gradient
  - layout
  - tvos
---

# Apple TV Card-Rail Cosmetic Patterns: Focus-Scale Anchor, Text-Bounded Scrim, Image Crop

## Context

Three cosmetic defects surface only in the tvOS simulator (never in unit tests, never in a desktop browser preview) when building a horizontal card rail in `apps/tv`. All three were hit while reworking the Bible Quotes carousel and recur whenever a new rail renderer is added to the SDUI dispatcher. Source: `apps/tv/src/components/sections/BibleQuotesCarouselRenderer.tsx` and the shared `apps/tv/src/components/FocusableCard.tsx`.

This doc is a sibling of `docs/solutions/ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md`, which fixes the **vertical** focus-scale clip (a scaled card trimmed top/bottom by the FlatList row frame) via the outer/inner layer split and a `paddingVertical` item wrapper. That fix is already in place here (`cardWrapper: { paddingVertical: scale(40) }`). The patterns below are a different facet: **horizontal** neighbor clipping, the scrim, and the image crop anchor.

## Guidance

### Pattern 1 — Focus-scale clipping by the _next_ card (horizontal), fixed by center-anchoring

`FocusableCard` scales to 1.05x on focus via React Native's `Animated.spring` on the outer `Animated.View` (`overflow: "visible"`, so the scaled card can bleed past its layout box). Growth on focus does not reflow layout, so the scaled card overlaps its neighbors' painted regions.

The non-obvious part: **a FlatList paints cells in document order, so the _next_ card (a later sibling) paints on top of the focused card.** With `focusAnchor="left"` (`transformOrigin: "0% 50%"`) a card grows rightward only — `(1.05 - 1) x 570 = 28.5px` on a 570px card — which exceeds the 24px inter-card gap. The following card then paints over that 4.5px of overflow and clips the focused card's right edge **and its white focus ring**.

**Fix: scale from center (`transformOrigin: "50% 50%"`, the CSS default) for every card.** Center growth is +/-14.25px per side: the right side stays inside the 24px gap (never reaches the neighbor), and the left side grows into the empty list inset rather than into the previous card's painted region. This is deterministic. Do **not** try to win this with cross-cell `zIndex` — z-index across FlatList cells is unreliable, and a prior session reached the same conclusion for the parallel keyboard-key bug, where the lever was always container padding, never paint order (session history).

```tsx
// FocusableCard.tsx — "left" is still supported but the default is "center".
focusAnchor?: "center" | "left" // default "center"
focusAnchorLeft: { transformOrigin: "0% 50%" }
// focusAnchor="center" sets no transformOrigin -> CSS default "50% 50%".

// BibleQuotesCarouselRenderer.tsx — every card now passes "center"
<QuoteCard focusAnchor="center" ... /> // was "left" -> clipped the first card's right edge
```

Trade-off: a first card flush with the left inset now "pops" symmetrically on focus (its left edge moves ~14px into the inset) instead of staying pinned. Acceptable, and consistent with every other card. Reserve `focusAnchor="left"` only for a deliberately single-card or zero-right-neighbor layout where flush-to-inset matters.

> Two distinct clip mechanisms, two distinct fixes. **Vertical** clip (card trimmed top/bottom by the FlatList frame) -> `paddingVertical` item wrapper + outer/inner split (see the overflow doc). **Horizontal** clip (focused card covered by its right neighbor) -> center-anchor the scale. The prior session that fixed the vertical case used container padding and never touched `transformOrigin` (session history) — so the anchor lever is the new contribution.

### Pattern 2 — Text-bounded gradient scrim

A full-card `absoluteFill` gradient leaves a tall dark band above short text — a one-line quote ends up with hundreds of px of dead dark space above it. Bind the scrim to the text block instead: a bottom-anchored, auto-height content container with the gradient _inside_ it.

```tsx
cardContent: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,           // anchored to the card bottom; height is auto (shrinks to text)
  paddingHorizontal: scale(20),
  paddingTop: scale(64), // fade headroom above the first line
  paddingBottom: scale(20),
},

// gradient is absoluteFill of the container -> spans only text + padding, not the card
<View style={styles.cardContent}>
  <LinearGradient
    colors={[hexToRgba(bgColor, 0), bgColor]}
    locations={[0, 0.6]}
    style={StyleSheet.absoluteFill}
    pointerEvents="none"
  />
  {/* text nodes */}
</View>
```

Because the container's height is the text height, a one-line quote gets a short gradient and a six-line quote a tall one — and it stays a smooth gradient, not a hard block. Conventions that apply: use `hexToRgba(bgColor, 0)` for the transparent stop, never the `"transparent"` keyword (RN interpolates through black otherwise), and the opaque stop's `bgColor` must equal the card's `backgroundColor` so the scrim reads as the surface darkening. Readability trade-off: the top line of a very long quote over a bright image gets a slightly weaker scrim than a full-card gradient would give.

### Pattern 3 — Image crop anchor is composition-dependent (NOT "always center")

`expo-image` with `contentFit="cover"` fills the card and crops two sides; `contentPosition` chooses which part survives. The correct anchor depends on **where the salient content sits in your image set** — there is no universal default.

- **`contentPosition="top left"` is the apps/tv app-wide standard for logo-bearing card images** (LUMO collection cards carry the wordmark at top-left; a center crop decapitates it). A prior session applied `top left` across every carousel/rail/hero image surface for exactly this reason and recorded "no remaining center-crop surface" (session history). Keep this default for collection/series/hero cards.
- **Use `contentPosition="center"` for decorative/photographic card images with a centered subject** — e.g. the Bible Quotes background wallpapers (Unsplash photos, no logo), where `top left` anchored the crop to a corner and pushed the subject off. `center` matches the web (`object-position: center`) and mobile defaults.

```tsx
// Logo card (LUMO wordmark top-left): keep top left
<Image ... contentFit="cover" contentPosition="top left" />
// Decorative/photographic card (centered subject): center
<Image ... contentFit="cover" contentPosition="center" />
```

The takeaway is to match the anchor to the composition, and to know that flipping a shared rail component to `center` can re-break a logo card that relied on `top left`.

## Why This Matters

These defects are invisible to the test suite (they are RN `StyleSheet` values, `transformOrigin` layout behavior, and image compositing) and to a browser preview — they appear only in the tvOS simulator or on device. The focus-scale clip is the worst because it disfigures the _focused_ card, the primary D-pad affordance, making the whole app look broken. The scrim issue degrades typography on any SDUI quote section with short text. The crop-anchor issue silently decapitates subjects — logos with a center crop, photo subjects with a top-left crop — so it is a correctness call per image set, not a style preference.

## When to Apply

- **Pattern 1 (center-anchor):** every multi-card horizontal `FlatList` rail using `FocusableCard` with `focusScale > 1`. Center is the default; `focusAnchor="left"` only for single-card/zero-right-neighbor layouts. Pair with the overflow doc's `paddingVertical` wrapper for the vertical axis.
- **Pattern 2 (text-bounded scrim):** any card overlaying text on a full-bleed image where the text line count is data-driven. A fixed-height text block can keep a full-card scrim.
- **Pattern 3 (crop anchor):** any full-bleed CMS-sourced card image. Default `top left` for logo/wordmark cards (the app standard); `center` for decorative/photographic cards with a centered subject. Decide per image set, not per component habit.

## Related

- `docs/solutions/ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md` — the sibling fix: vertical focus-scale overflow (outer/inner layer split, `Animated.spring`, `paddingVertical` item wrapper). Pattern 1 here is the horizontal counterpart; the two are candidates for consolidation into one "TV card-rail focus-scale" reference.
- `docs/solutions/best-practices/tv-focus-white-ring-default-and-light-surface-exception.md` — the app-wide white focus-ring default these cards must respect (the ring that Pattern 1's clip was eating); `focusRing="crimson"` is retired (session history).
- `docs/solutions/ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md` — expo-image + LinearGradient compositing failures inside FocusableCard on Android TV; same files, native-view concern rather than layout semantics.
- `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md` — the `hexToRgba(color, 0)` transparent-stop rule used by Pattern 2.
- `apps/tv/CLAUDE.md` — TV conventions: `Math.round()` all scaled font sizes, `hexToRgba` for transparent gradient stops, the react-native-tvos Pressable Android focus patch. Verify these 10-foot focus/layout behaviors in the tvOS simulator — the codebase tests logic/data, not RN `StyleSheet` values.
- PR [JesusFilm/forge#1429](https://github.com/JesusFilm/forge/pull/1429)
