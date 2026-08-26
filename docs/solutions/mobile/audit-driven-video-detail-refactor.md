---
title: "Audit-Driven Video Detail Page Refactor: Color Tokens, Shared Types, and Accessibility"
category: mobile
date: 2026-04-08
tags:
  [
    react-native,
    expo,
    color-tokens,
    accessibility,
    flatlist,
    audit,
    video-detail,
    theming,
    shared-types,
  ]
severity: medium
components:
  [
    mobile-v2,
    video-detail,
    VideoCarouselRenderer,
    VideoCardRenderer,
    MediaCollectionRenderer,
    TextRenderer,
  ]
related_issues: []
---

## Problem

The video details page in `apps/mobile/` accumulated 12+ technical quality issues through organic feature growth. A systematic audit using the `impeccable:audit` skill scored the page **12/20** across 5 dimensions (accessibility, performance, theming, responsive design, anti-patterns). Key symptoms: hard-coded hex colors in 6+ files with no token system, dead tap targets on media collection cards, semi-transparent play button with insufficient contrast, ScrollView instead of FlatList, fixed card widths, inconsistent play icons (text character vs icon component), and duplicate `VideoRef` type assertions across 4 renderers.

## Root Cause

No design token system existed beyond a single `BG_COLOR` constant. Each renderer independently chose colors, types, and implementation patterns. The SDUI architecture (CMS -> normalizer -> dispatcher -> renderers) meant renderers were developed in isolation, leading to:

1. **6 hex colors repeated across 6+ files** — palette changes required editing every file
2. **Same VideoRef type assertion copy-pasted 4 times** — CMS schema changes needed 4 independent updates
3. **Mixed virtualization** — some carousels used FlatList, others ScrollView
4. **Ad-hoc accessibility** — no systematic touch target or contrast standards applied

## Solution

### 1. Color Token Extraction

Extended existing `src/lib/color.ts` (which had only `BG_COLOR` and `hexToRgba`) with 8 semantic tokens:

```typescript
// src/lib/color.ts
export const BG_COLOR = "#1c1917" // App background (warm dark)
export const SURFACE_COLOR = "#292524" // Cards, elevated surfaces
export const BLACK = "#000000" // Player background
export const TEXT_PRIMARY = "#f5f5f4" // Headings (stone-100)
export const TEXT_SECONDARY = "#a8a29e" // Muted text (stone-400)
export const TEXT_BODY = "#d6d3d1" // Body text (stone-300)
export const ACCENT = "#CB333B" // Brand red (JFP)
export const TEXT_ON_OVERLAY = "#ffffff" // Text on image/gradient overlays
```

**Key decision**: Tokens live in the existing `color.ts` utility file (not a new file), since `hexToRgba` was already there and all files imported from it. Semantic names (not color names) — `TEXT_PRIMARY` not `STONE_100`.

### 2. Shared VideoRef Type

Created `src/lib/types.ts` with a single shared type:

```typescript
export type VideoRef = {
  documentId?: string
  title?: string
  slug?: string
  imageAlt?: string
  images?: {
    url?: string
    mobileCinematicHigh?: string
    videoStill?: string
  }
}
```

Replaced 4 identical inline type assertions (`section.videoRef as { title?: string; ... } | null | undefined`) across `[sectionKey].tsx`, `VideoCardRenderer`, `VideoCarouselRenderer`, and `MediaCollectionRenderer`.

### 3. MediaCollectionRenderer Overhaul

Three fixes in one file:

- **Dead tap targets**: Added `onPress` handler navigating via `router.push(/video/${encodeURIComponent(key)})` using `linkToSectionKey ?? video?.slug`
- **ScrollView -> FlatList**: Virtuized rendering with `snapToInterval`, `decelerationRate="fast"`, and proper `keyExtractor`
- **Responsive width**: Changed from fixed `CARD_WIDTH = 140` to `CARD_WIDTH_RATIO = 0.37` with `Math.round(screenWidth * CARD_WIDTH_RATIO)`

### 4. Accessibility Fixes

| Issue                  | Before                                            | After                                          |
| ---------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Play button contrast   | `rgba(203, 51, 59, 0.85)` on arbitrary thumbnails | Fully opaque `ACCENT` — reliable 3:1+ contrast |
| Share button size      | 40x40px                                           | 44x44px (meets Apple HIG minimum)              |
| Back button hit area   | `hitSlop={8}` (36px effective)                    | `hitSlop={12}` (52px effective)                |
| Read-more touch target | No minimum height                                 | `minHeight: 48`                                |
| Carousel a11y role     | `accessibilityRole="adjustable"` (misleading)     | Removed — FlatList handles scroll natively     |

### 5. Icon Normalization

Replaced text character `▶` (renders differently across platforms/fonts) with `Ionicons name="play"` in 3 files:

- `[sectionKey].tsx` — size 28, detail page play button
- `VideoCardRenderer.tsx` — size 22, card play button
- `VideoCarouselRenderer.tsx` — size 18, carousel thumbnail play button

### 6. Navigation Consistency

Added `encodeURIComponent` to `VideoCarouselRenderer` navigation (was missing while the other two renderers had it). Found during code review by the Architecture Strategist agent.

## Key Insight

The `impeccable:audit` skill's 5-dimension scoring framework (0-4 per dimension, 20 total) made iterative improvement measurable and systematic:

- **Round 1**: 12/20 (Acceptable) — identified 1 P0, 4 P1, 3 P2, 4 P3
- **Round 2**: 16/20 (Good) — all P0/P1 resolved, 1 P2 and 3 P3 remaining
- **Round 3**: 18/20 (Excellent) — only P3 cosmetic items remaining

Each audit round explicitly scored dimensions and linked findings to specific fix commands (`/extract`, `/harden`, `/optimize`, `/adapt`, `/normalize`, `/polish`). This prevented both under-fixing (missing issues) and over-fixing (unnecessary changes).

## Prevention

1. **Import tokens, not hex values**: When adding new colors to any renderer in `apps/mobile/`, always check `src/lib/color.ts` first. If the color doesn't exist as a token, add it there before using it.

2. **Check shared types before duplicating**: Before writing an inline type assertion for CMS data shapes, check `src/lib/types.ts` for an existing shared type. The SDUI normalizer produces generic `NormalizedBlock` records, so renderers will always need `as` casts — but the target type should be shared.

3. **Run `/audit` after new screens**: When a new screen or major section ships, run the `impeccable:audit` skill to establish a baseline score. Address P0/P1 before merge. The 5-dimension framework catches issues that visual testing alone misses (touch targets, contrast ratios, token consistency).

4. **Use FlatList for all horizontal lists**: Never use `ScrollView` for horizontal card carousels — always `FlatList` with `keyExtractor`, `snapToInterval`, and responsive card widths via `useWindowDimensions`.

## Related Documentation

- `docs/solutions/mobile/responsive-typography-hook.md` — The `useTypography` hook used throughout these components
- `docs/solutions/mobile/typography-token-scope-shared-vs-purpose-specific.md` — Design decision on shared vs purpose-specific tokens
- `docs/solutions/mobile/text-renderer-paragraph-type-mismatch.md` — Prior TextRenderer fix for contentParagraphs validation

## Files Changed

- `apps/mobile/src/lib/color.ts` — 8 new semantic tokens
- `apps/mobile/src/lib/types.ts` — New shared `VideoRef` type
- `apps/mobile/app/_layout.tsx` — Token adoption + hitSlop increase
- `apps/mobile/app/video/[sectionKey].tsx` — Tokens, shared type, Ionicons, share URL, touch targets
- `apps/mobile/src/components/sections/MediaCollectionRenderer.tsx` — Navigation, FlatList, responsive width, tokens
- `apps/mobile/src/components/sections/VideoCardRenderer.tsx` — Tokens, shared type, Ionicons
- `apps/mobile/src/components/sections/VideoCarouselRenderer.tsx` — Tokens, shared type, Ionicons, encodeURIComponent
- `apps/mobile/src/components/sections/TextRenderer.tsx` — Tokens
