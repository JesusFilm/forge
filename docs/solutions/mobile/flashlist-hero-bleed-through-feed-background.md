---
title: "Fix video hero bleed-through between FlashList feed items"
category: mobile
date: 2026-04-07
tags:
  - react-native
  - expo
  - flashlist
  - linear-gradient
  - visual-artifact
  - mobile-v2
  - hexToRgba
  - two-layer-hero
components:
  - CuratedHomeLayout.tsx
  - VideoHeroRenderer.tsx
  - color.ts
severity: medium
resolution_time: quick
---

## Problem

In the mobile-v2 home feed's two-layer architecture (VideoHero absolutely positioned behind a FlashList), feed items had transparent backgrounds by default. As users scrolled, the video hero was visible between feed items -- a distracting visual artifact that broke the content hierarchy.

The architecture:

- **Layer 0:** VideoHero, absolutely positioned (`zIndex: 0`)
- **Layer 1:** FlashList on top, with `paddingTop` to reveal the hero
- **Layer 2:** Pointer pass-through for hero interactive elements

## Root Cause

FlashList items render with transparent backgrounds by default. The two-layer hero pattern relies on feed content visually obscuring the hero as users scroll down. Without opaque backgrounds on feed items, the hero bled through gaps between content sections.

Additionally, the VideoHeroRenderer's bottom gradient only faded to 0.85 opacity (not fully opaque), leaving a faint seam between the hero and the feed area.

## Solution

Three-file fix applying translucent backgrounds to feed items and smoothing the hero-to-feed transition:

### 1. Shared color constant (`src/lib/color.ts`)

Promoted `BG_COLOR` from a local constant in VideoHeroRenderer to a shared export:

```ts
export const BG_COLOR = "#1c1917"
```

### 2. Feed item backgrounds + feather gradient (`CuratedHomeLayout.tsx`)

Wrapped each FlashList item in a `View` with translucent background, and added a `LinearGradient` feather on the first item:

```tsx
const renderItem = ({ item, index }) => {
  const isFirst = index === 0
  const content = /* dispatcher logic */

  return (
    <View style={styles.feedItemBackground}>
      {isFirst && (
        <LinearGradient
          colors={[hexToRgba(BG_COLOR, 0), hexToRgba(BG_COLOR, 0.8)]}
          style={styles.feedFeather}
        />
      )}
      {content}
    </View>
  )
}

// Styles
feedItemBackground: {
  backgroundColor: hexToRgba(BG_COLOR, 0.8),
},
feedFeather: {
  height: 48,
  marginTop: -48,  // extends above the first item
},
```

The feather gradient uses negative top margin to extend 48px above the first feed item, creating a smooth fade from transparent to the feed background color.

### 3. Solid hero bottom gradient (`VideoHeroRenderer.tsx`)

Changed the bottom gradient endpoint from partial opacity to fully opaque:

```tsx
// Before
colors={[hexToRgba(BG_COLOR, 0), hexToRgba(BG_COLOR, 0.85)]}

// After
colors={[hexToRgba(BG_COLOR, 0), BG_COLOR]}
```

This ensures the hero dissolves cleanly into the app background with no visible seam.

## Code Review Improvements

Three issues caught during review and fixed immediately:

1. **Hardcoded color duplication** -- `"#1c1917"` was repeated across files. Promoted to shared `BG_COLOR` constant in `src/lib/color.ts`.
2. **Inline rgba string** -- `"rgba(28, 25, 23, 0.8)"` used instead of `hexToRgba(BG_COLOR, 0.8)`, violating project convention. Replaced.
3. **Redundant `key` prop** -- FlashList manages keys via `keyExtractor`; the `key` on the inner `View` was a no-op. Removed.

## Prevention Strategies

- **Default to opaque backgrounds on all feed/list items.** Any component rendered above a hero or background layer should have an explicit, non-transparent background.
- **Use a feather gradient at the boundary.** The first item in a scrollable list over a hero should include a gradient transition so the handoff feels intentional.
- **Single source of truth for colors.** Always use shared constants via `hexToRgba()` -- never hardcode hex or rgba strings in component files.
- **Promote on second use.** If a color appears in two or more files, extract to the shared module immediately.

## Checklist for Similar Changes

- [ ] Every list/feed item has an explicit background color
- [ ] Background color references a shared constant via `hexToRgba()`
- [ ] First visible item includes a feather gradient if hero should be partially visible
- [ ] Test at three scroll positions: top, mid-scroll, fully scrolled
- [ ] Test iOS overscroll bounce (rubber-band can reveal the hero)
- [ ] No duplicate color values introduced
- [ ] FlashList `estimatedItemSize` still accurate after adding wrappers

## Related Documentation

- [FlashList opaque background hides absolute hero](flashlist-opaque-background-hides-absolute-hero.md) -- Earlier iteration of the same two-layer problem
- [Full-bleed video hero with scroll-over content](full-bleed-video-hero-with-scroll-over-content.md) -- Foundational pattern doc (references deprecated `apps/mobile/`)
- [LinearGradient dark banding with transparent keyword](linear-gradient-dark-banding-transparent-keyword.md) -- Why `hexToRgba(color, 0)` is used instead of `"transparent"`
- [Translucent section backgrounds with React Context](translucent-section-backgrounds-with-react-context.md) -- Earlier approach using Context (deprecated `apps/mobile/`)
- [Media collection overlay carousel pipeline](media-collection-overlay-carousel-pipeline.md) -- Origin of `hexToRgba` helper convention
