---
title: "Centralize mobile typography with responsive useTypography hook"
category: mobile
date: 2026-03-26
severity: medium
tags:
  - react-native
  - expo
  - typography
  - responsive-design
  - design-system
  - hooks
  - refactoring
modules:
  - apps/mobile/src/hooks/useTypography.ts
  - apps/mobile/src/components/sections/*Renderer.tsx
  - apps/mobile/src/screens/WatchHomeScreen.tsx
  - apps/mobile/src/screens/ExperienceScreen.tsx
symptoms:
  - Visible text size inconsistencies when sections appear side-by-side in carousels
  - Font sizes did not adapt to different device screen widths
  - BibleQuotesCarouselRenderer used stale screen dimensions after device rotation
root_cause: >
  12 renderer and screen components each hardcoded independent fontSize values
  with no shared scale, causing inconsistent text sizing across sections.
  Additionally, BibleQuotesCarouselRenderer captured screen width at module scope
  via Dimensions.get("window"), which remained stale after orientation changes.
---

# Centralize Mobile Typography with Responsive useTypography Hook

## Problem

The React Native mobile app had 12+ section renderers each hardcoding their own `fontSize` values in `StyleSheet.create()`. This produced two visible defects:

1. **Inconsistent body text sizing** — adjacent carousel sections rendered body text at different sizes because each renderer chose its own value (e.g., one used 16px, another 15px, another 20px for equivalent body content).
2. **No responsive scaling** — font sizes were absolute pixel values that didn't adapt to device screen width.

Across ~13 files, 12 distinct font sizes (11–32px) were scattered with no shared source of truth.

## Root Cause

No shared typography system existed. Every renderer independently defined font sizes as static numbers. There was no scale, no tokens, and no responsive factor. Each developer who built a renderer picked sizes by eye, leading to drift.

## Investigation Steps

1. **Audited all section renderers for `fontSize` declarations.** Found 12 distinct values (11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32) spread across ~13 files.
2. **Mapped sizes to semantic intent.** Discovered that "body text" alone was rendered at 14px, 15px, 16px, 18px, and 20px depending on the renderer.
3. **Identified non-text sizing to exclude.** Play button icons, decorative chevrons, and number badges use `fontSize` for icon sizing in fixed containers — these should stay hardcoded.
4. **Ran 7-agent code review** after migration — caught a `fontWeight: "700"` regression on featured titles in CardRenderer and a dead `bodyLead` token.

## Solution

### 1. Created `useTypography()` hook

**File:** `apps/mobile/src/hooks/useTypography.ts`

```typescript
import { useMemo } from "react"
import { type TextStyle, useWindowDimensions } from "react-native"

import type { TextHeadingLevel } from "../lib/sectionModels"

type TypographyToken = Required<Pick<TextStyle, "fontSize" | "lineHeight">>

const BASE_WIDTH = 375
const MIN_FACTOR = 0.85
const MAX_FACTOR = 1.15

const BASE_SCALE = {
  caption: { fontSize: 12, lineHeight: 16 },
  bodySmall: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 16, lineHeight: 24 },
  titleSmall: { fontSize: 18, lineHeight: 24 },
  titleLarge: { fontSize: 22, lineHeight: 28 },
  heading: { fontSize: 24, lineHeight: 32 },
  display: { fontSize: 32, lineHeight: 40 },
} as const satisfies Record<string, TypographyToken>

const HEADING_SCALE = {
  h1: { fontSize: 32, lineHeight: 40 },
  h2: { fontSize: 28, lineHeight: 36 },
  h3: { fontSize: 24, lineHeight: 32 },
  h4: { fontSize: 20, lineHeight: 28 },
  h5: { fontSize: 18, lineHeight: 24 },
  h6: { fontSize: 16, lineHeight: 22 },
} as const satisfies Record<TextHeadingLevel, TypographyToken>

export type TypographyScale = {
  caption: TypographyToken
  bodySmall: TypographyToken
  body: TypographyToken
  titleSmall: TypographyToken
  titleLarge: TypographyToken
  heading: TypographyToken
  display: TypographyToken
  headingScale: Record<TextHeadingLevel, TypographyToken>
}

export function computeTypographyScale(screenWidth: number): TypographyScale {
  const raw = screenWidth / BASE_WIDTH
  const factor = Math.min(Math.max(raw, MIN_FACTOR), MAX_FACTOR)

  const scale = (token: TypographyToken): TypographyToken => ({
    fontSize: Math.round(token.fontSize * factor),
    lineHeight: Math.round(token.lineHeight * factor),
  })

  return {
    caption: scale(BASE_SCALE.caption),
    bodySmall: scale(BASE_SCALE.bodySmall),
    body: scale(BASE_SCALE.body),
    titleSmall: scale(BASE_SCALE.titleSmall),
    titleLarge: scale(BASE_SCALE.titleLarge),
    heading: scale(BASE_SCALE.heading),
    display: scale(BASE_SCALE.display),
    headingScale: {
      h1: scale(HEADING_SCALE.h1),
      h2: scale(HEADING_SCALE.h2),
      h3: scale(HEADING_SCALE.h3),
      h4: scale(HEADING_SCALE.h4),
      h5: scale(HEADING_SCALE.h5),
      h6: scale(HEADING_SCALE.h6),
    },
  }
}

export function useTypography(): TypographyScale {
  const { width } = useWindowDimensions()
  return useMemo(() => computeTypographyScale(width), [width])
}
```

Key type decisions:

- **`Required<Pick<TextStyle, ...>>`** — `TextStyle` defines `fontSize`/`lineHeight` as optional; `Required<>` strips the optionality so tokens are guaranteed `number` values. Without this, consumers need `?? 0` fallbacks everywhere. See [typescript-pick-textstyle-required-wrapper.md](./typescript-pick-textstyle-required-wrapper.md).
- **`as const satisfies Record<...>`** — preserves literal types from `as const` while validating structure against `TypographyToken`. Catches typos in key names at compile time.
- **`computeTypographyScale` extracted as a pure function** — separates computation from the React hook, making it directly unit-testable without mocking hooks. The test file tests only this function.
- **`TextHeadingLevel` imported from `sectionModels.ts`** — heading levels are a CMS domain concept, not a typography concern. The hook consumes the type but does not own it.

Design decisions:

- **`BASE_WIDTH = 375`** — iPhone 13/14 logical width, most common device.
- **`MIN_FACTOR = 0.85`, `MAX_FACTOR = 1.15`** — clamps scaling to ±15% so text never becomes unreadably small or absurdly large.
- **`Math.round()`** — integer rounding avoids sub-pixel font sizes that cause blurry text on Android.
- **`useMemo` keyed on `width`** — recomputes only on rotation or window resize.
- **`useWindowDimensions()` (not `Dimensions.get()`)** — reactive to orientation changes.

### 2. Migration pattern (applied to all 12 renderers + 2 screens)

```typescript
// BEFORE:
const styles = StyleSheet.create({
  bodyText: { fontSize: 15, lineHeight: 22, color: "#333" },
})
<Text style={styles.bodyText}>{content}</Text>

// AFTER:
const typography = useTypography()
const styles = StyleSheet.create({
  bodyText: { color: "#333" },  // keep non-font styles
})
<Text style={[styles.bodyText, typography.body]}>{content}</Text>
```

Remove `fontSize` and `lineHeight` from `StyleSheet.create`, keep colors/padding/weights, spread the typography token into a style array.

### 3. Token mapping reference

| Hardcoded size(s) | Typography token           | Semantic role                     |
| ----------------- | -------------------------- | --------------------------------- |
| 11–13px           | `caption`                  | Labels, metadata, badges          |
| 14–15px           | `bodySmall`                | Secondary body text, descriptions |
| 16px              | `body`                     | Primary body text                 |
| 18px              | `titleSmall`               | Card titles, video titles         |
| 22px              | `titleLarge`               | Featured titles, section titles   |
| 24px              | `heading`                  | Page/section headings             |
| 28–32px           | `display` / `headingScale` | Hero text, h1 headings            |

### 4. Exclusions (kept hardcoded)

These use `fontSize` for non-typographic purposes:

- **Play button icons** — unicode chars sized to fill fixed 40×40 / 56×56 containers
- **Decorative chevron arrows** — fixed ornamental elements
- **Number badges** — digits inside fixed 28×28 circles
- **Size badge overlay text** — tightly fitted inside badge containers

### 5. Bug fix: BibleQuotesCarouselRenderer stale dimensions

```typescript
// BEFORE (broken): module-scope call, stale after rotation
const SCREEN_WIDTH = Dimensions.get("window").width

// AFTER (correct): reactive hook inside component
const { width: screenWidth } = useWindowDimensions()
```

### 6. Bug fix: CardRenderer lost fontWeight

During migration, `fontWeight: "700"` on featured titles was accidentally removed. The code review caught it. Fix: keep `fontWeight` in StyleSheet, only move fontSize/lineHeight to the token.

## Key Decisions

1. **Hook, not a context provider.** Avoids provider wrapper and re-render cascade. Cost is one `useMemo` per consumer — trivial.
2. **Proportional scaling with clamps, not device-class breakpoints.** Continuous ratio avoids visible jumps and handles unusual widths (split-screen iPad, foldables).
3. **Token spread in style array, not replacing StyleSheet.** Non-typography properties stay in static StyleSheet for React Native caching.
4. **Seven semantic tokens, not twelve arbitrary sizes.** Names describe role, not size — makes wrong usage obvious in review.

## Gotchas

1. **Do not remove `fontWeight` during migration.** Typography tokens deliberately exclude `fontWeight` because weight varies by context. Review every migrated style to confirm weight is preserved.
2. **`Dimensions.get()` at module scope is a time bomb.** Always use `useWindowDimensions()` inside component bodies. Grep for module-scope `Dimensions.get` periodically.
3. **Not every `fontSize` is typography.** Icons rendered as unicode characters in fixed containers should not scale — verify the element is readable text before migrating.
4. **`lineHeight` must scale with `fontSize`.** The hook scales both together. Do not set `lineHeight` independently in StyleSheet for migrated text.
5. **`Math.round()` is required for Android.** Sub-pixel font sizes render as blurry text on Android. All token values must pass through `Math.round()`.

## Prevention

- **Lint rule banning module-scope `Dimensions.get()`** — eliminates the stale-dimensions bug class entirely.
- **Unit test asserting critical token properties** (e.g., `titleFeatured.fontWeight`) — directly prevents silent property-loss regressions.
- **"No orphan tokens" rule** — every new token must ship with at least one consumer in the same PR.
- **Property-parity check during migration** — before deleting a style object, enumerate every property and confirm each is accounted for in the replacement.

## Related Documentation

- [Pick\<TextStyle\> Required wrapper](./typescript-pick-textstyle-required-wrapper.md) — why `Required<Pick<TextStyle, ...>>` is needed instead of bare `Pick`
- [Full-bleed video hero solution](./full-bleed-video-hero-with-scroll-over-content.md) — documents `useWindowDimensions()` vs `Dimensions.get()` anti-pattern and section renderer architecture
- [Expo GraphQL schema drift](../integration-issues/expo-graphql-schema-drift-and-fragment-validation.md) — documents section dispatcher/mapper patterns used by all renderers
- [Responsive typography requirements](../../brainstorms/2026-03-25-mobile-responsive-typography-requirements.md) — origin brainstorm document
- [Responsive typography plan](../../plans/2026-03-25-002-feat-mobile-responsive-typography-plan.md) — full implementation plan with token mappings
