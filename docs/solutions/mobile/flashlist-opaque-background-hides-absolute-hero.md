---
title: "FlashList opaque contentContainerStyle hides absolutely-positioned hero"
category: ui-bugs
date: 2026-04-07
tags:
  [react-native, expo, flashlist, sdui, background-color, z-index, mobile-v2]
related_issues: []
---

# FlashList opaque contentContainerStyle hides absolutely-positioned hero

## Problem

In the `apps/mobile-v2/` SDUI app, the VideoHero section on the home screen was
completely invisible. The hero area rendered as empty black space. The VideoHero
component was absolutely positioned behind a FlashList, with `paddingTop` on the
list's content container intended to create a transparent window revealing the hero
underneath.

## Root Cause

The FlashList's `contentContainerStyle` included `backgroundColor: "#1c1917"` (an
opaque dark color). In React Native, `contentContainerStyle.backgroundColor` fills
the **entire** content container area, including any padding. This meant the opaque
background covered the `paddingTop` region that was supposed to be transparent,
completely hiding the absolutely-positioned VideoHero behind it.

The parent container already carried `backgroundColor: "#1c1917"`, so the duplicate
declaration on the content container was redundant for feed items but destructive
for the hero reveal pattern.

## Investigation Steps

1. Confirmed the VideoHero component rendered correctly in isolation.
2. Verified the hero was positioned with `position: "absolute"` and correct `zIndex`.
3. Checked that `paddingTop` on the FlashList matched the hero height.
4. Toggled `contentContainerStyle` properties — removing `backgroundColor` immediately
   revealed the hero.
5. Confirmed the parent view already supplies the same background color, so feed items
   still render against the correct dark background.

## Solution

Remove `backgroundColor` from the FlashList's `contentContainerStyle` in
`apps/mobile-v2/src/components/sections/CuratedHomeLayout.tsx`.

**Before:**

```tsx
<FlashList
  contentContainerStyle={{
    paddingTop: HERO_HEIGHT,
    backgroundColor: "#1c1917",
  }}
/>
```

**After:**

```tsx
<FlashList
  contentContainerStyle={{
    paddingTop: HERO_HEIGHT,
  }}
/>
```

The parent container retains `backgroundColor: "#1c1917"`, so the visual appearance
of list items is unchanged. The padding area is now transparent, allowing the
absolutely-positioned hero to show through.

## Prevention

- **Never set `backgroundColor` on `contentContainerStyle` when content is layered
  behind a scrollable list.** The background fills padding regions and blocks anything
  underneath.
- When using the "absolute hero behind scrollable list" pattern, keep the background
  color on the **parent wrapper** only, not on the scroll container's content style.
- If a future developer needs a different background per-section within the list,
  apply it at the **item level** (per-row wrapper), not on the content container.

## Entry Points

- `apps/mobile-v2/src/components/sections/CuratedHomeLayout.tsx` — the FlashList and
  hero layering
- `apps/mobile-v2/src/components/sections/VideoHeroRenderer.tsx` — the hero component

## Cross-references

- `docs/solutions/mobile/translucent-section-backgrounds-with-react-context.md` —
  covers the HeroSectionContext pattern for adjusting child section backgrounds when
  layered under a hero. Same principle: child containers must not carry opaque
  backgrounds that occlude content behind them.
- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — the
  original two-layer hero pattern documentation.
