---
title: "feat: Add responsive typography scale to mobile app"
type: feat
status: active
date: 2026-03-25
origin: docs/brainstorms/2026-03-25-mobile-responsive-typography-requirements.md
---

# feat: Add responsive typography scale to mobile app

## Overview

All 12 section renderers in the mobile app hardcode their own font sizes independently, producing inconsistent text sizes across sections — visible when two content cards appear side-by-side in a carousel. There is no shared typography system and no responsive scaling. This plan introduces a centralized `useTypography()` hook that provides a semantically-named, screen-width-scaled type ramp used by every renderer.

## Problem Statement / Motivation

The screenshots show two carousel sections ("The Real Easter story" and "The True Meaning of Easter") rendered with noticeably different body text sizes. This happens because each renderer defines its own `fontSize` values in `StyleSheet.create()`. The codebase has 12 distinct font sizes (11–32px) scattered across ~13 files with no shared constants. Font sizes are static and do not adapt to device screen width.

(see origin: `docs/brainstorms/2026-03-25-mobile-responsive-typography-requirements.md`)

## Proposed Solution

1. **Create a `useTypography()` hook** that reads `useWindowDimensions().width`, computes a scale factor from a 375pt reference width, and returns a typed record of semantic text tokens — each containing `fontSize` and `lineHeight`.
2. **Define ~8 semantic tokens** that collapse the current 12+ ad-hoc sizes into a clean type ramp.
3. **Migrate all section renderers** to consume tokens from the hook instead of hardcoded values.
4. **Exclude icon/badge sizes** — decorative unicode characters and text inside fixed-dimension containers remain hardcoded.

## Technical Approach

### Typography Token Scale

Collapse current sizes into 8 semantic tokens. At 375pt (reference width), base sizes are:

| Token        | Base Size | Line Height | Current Sizes Collapsed | Used For                                                                  |
| ------------ | --------- | ----------- | ----------------------- | ------------------------------------------------------------------------- |
| `caption`    | 12        | 16          | 11, 12, 13              | Category labels, badges, attribution, footer                              |
| `bodySmall`  | 14        | 20          | 14, 15                  | Card descriptions, subheadings, CTA link text                             |
| `body`       | 16        | 24          | 16                      | Default body text, quotes, button text, subtitles                         |
| `bodyLead`   | 20        | 30          | 20                      | Lead paragraphs (TextRenderer lead variant)                               |
| `titleSmall` | 18        | 24          | 18                      | Card titles, video titles                                                 |
| `titleLarge` | 22        | 28          | 22                      | Featured card titles                                                      |
| `heading`    | 24        | 32          | 24                      | Section headings (CTA, Bible quotes, related questions, media collection) |
| `display`    | 32        | 40          | 28, 32                  | Hero headings, h1, large date displays                                    |

**TextRenderer h1–h6 mapping:** The existing heading level record maps to tokens:

- h1 → `display` (32), h2 → `heading` + scale (28 → computed from display/heading), h3 → `heading` (24), h4 → `bodyLead` (20), h5 → `titleSmall` (18), h6 → `body` (16)

Since TextRenderer already has its own h1–h6 scale, the hook should provide both the token record AND a `headingScale` record that maps heading levels to sizes, maintaining the existing 32→16 progression but with responsive scaling applied.

### Scaling Formula

```typescript
const BASE_WIDTH = 375
const MIN_FACTOR = 0.85 // floor at ~319pt
const MAX_FACTOR = 1.15 // ceiling at ~431pt

const rawFactor = screenWidth / BASE_WIDTH
const scaleFactor = Math.min(Math.max(rawFactor, MIN_FACTOR), MAX_FACTOR)

// For a 16px body token:
// 320pt → 16 * 0.85 = 13.6px
// 375pt → 16 * 1.00 = 16.0px (reference)
// 393pt → 16 * 1.05 = 16.8px
// 430pt → 16 * 1.15 = 18.4px
// 768pt → 16 * 1.15 = 18.4px (clamped)
```

The `MAX_FACTOR` clamp at 1.15 prevents absurdly large text on iPads/tablets. The `MIN_FACTOR` at 0.85 keeps text legible on small phones and Galaxy Fold outer screens (~280pt).

### Hook API Shape

```typescript
// apps/mobile/src/hooks/useTypography.ts

type TypographyToken = {
  fontSize: number
  lineHeight: number
}

type TypographyScale = {
  caption: TypographyToken
  bodySmall: TypographyToken
  body: TypographyToken
  bodyLead: TypographyToken
  titleSmall: TypographyToken
  titleLarge: TypographyToken
  heading: TypographyToken
  display: TypographyToken
  headingScale: Record<TextHeadingLevel, TypographyToken>
}

function useTypography(): TypographyScale
```

The hook uses `useMemo` keyed on `screenWidth` so the returned object has stable identity when width doesn't change. All renderers spread tokens into their style arrays:

```typescript
// Migration pattern — keep static styles in StyleSheet.create,
// override only fontSize + lineHeight from the hook
const typography = useTypography()

<Text style={[styles.body, typography.body]}>...</Text>
```

### Exclusions from the Typography Scale

These remain hardcoded — they are decorative, not semantic text:

- `VideoHeroRenderer.muteIcon` (18px emoji)
- `VideoRenderer.playIcon` (22px unicode)
- `MediaCollectionRenderer.playIcon` (16px unicode)
- `EasterDatesRenderer.chevron` (22px unicode)
- `RelatedQuestionsRenderer.chevron` (18px unicode)
- Badge text inside fixed-dimension containers (`numberBadge` 28×28, `sizeBadge`, `playIconOverlay` 40×40)

### OS Font Scale / Accessibility

The hook does NOT multiply by `PixelRatio.getFontScale()`. React Native's default `allowFontScaling={true}` applies the OS font scale on top of the hook's computed sizes. This is the correct layering — width-based scaling for device adaptation, OS font scale for user accessibility preference.

## Acceptance Criteria

- [ ] A `useTypography()` hook exists at `apps/mobile/src/hooks/useTypography.ts`
- [ ] Hook returns typed tokens with `fontSize` and `lineHeight` for all 8 semantic roles + heading scale
- [ ] Font sizes scale proportionally with `screenWidth / 375`, clamped between 0.85× and 1.15×
- [ ] All section renderers use the hook instead of hardcoded font sizes for semantic text
- [ ] Icon/emoji font sizes and badge text remain hardcoded
- [ ] Two content sections side-by-side in a carousel show identical body text sizes
- [ ] Text is legible on ~320pt screens and not oversized on ~430pt+ screens
- [ ] `BibleQuotesCarouselRenderer` module-scope `Dimensions.get("window")` converted to `useWindowDimensions()` (fixes pre-existing stale-dimension bug)
- [ ] Static (non-font) styles remain in `StyleSheet.create` — only fontSize/lineHeight come from the hook

## Dependencies & Risks

- **Risk: Minor visual changes.** Normalizing sizes (e.g., 15px → 14px `bodySmall`, 13px → 12px `caption`) will subtly change some renderers' appearance at 375pt. This is intentional — the goal is consistency, not pixel-perfect preservation of current state.
- **Risk: Badge/icon boundary.** Some sizes are ambiguous (is `MediaCollectionRenderer.categoryLabel` at 12px semantic text or decorative?). The plan classifies it as semantic (`caption` token). If any specific case looks wrong, it can be reverted to hardcoded.
- **Dependency:** None — this is a self-contained mobile app change with no GraphQL or CMS dependency.

## MVP

### Phase 1: Create the hook

#### `apps/mobile/src/hooks/useTypography.ts`

```typescript
import { useMemo } from "react"
import { useWindowDimensions } from "react-native"

const BASE_WIDTH = 375
const MIN_FACTOR = 0.85
const MAX_FACTOR = 1.15

const BASE_SCALE = {
  caption: { fontSize: 12, lineHeight: 16 },
  bodySmall: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 16, lineHeight: 24 },
  bodyLead: { fontSize: 20, lineHeight: 30 },
  titleSmall: { fontSize: 18, lineHeight: 24 },
  titleLarge: { fontSize: 22, lineHeight: 28 },
  heading: { fontSize: 24, lineHeight: 32 },
  display: { fontSize: 32, lineHeight: 40 },
} as const

const HEADING_SCALE = {
  h1: { fontSize: 32, lineHeight: 40 },
  h2: { fontSize: 28, lineHeight: 36 },
  h3: { fontSize: 24, lineHeight: 32 },
  h4: { fontSize: 20, lineHeight: 28 },
  h5: { fontSize: 18, lineHeight: 24 },
  h6: { fontSize: 16, lineHeight: 22 },
} as const

export function useTypography() {
  const { width } = useWindowDimensions()

  return useMemo(() => {
    const raw = width / BASE_WIDTH
    const factor = Math.min(Math.max(raw, MIN_FACTOR), MAX_FACTOR)

    const scale = (token: { fontSize: number; lineHeight: number }) => ({
      fontSize: Math.round(token.fontSize * factor * 10) / 10,
      lineHeight: Math.round(token.lineHeight * factor * 10) / 10,
    })

    return {
      caption: scale(BASE_SCALE.caption),
      bodySmall: scale(BASE_SCALE.bodySmall),
      body: scale(BASE_SCALE.body),
      bodyLead: scale(BASE_SCALE.bodyLead),
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
  }, [width])
}
```

### Phase 2: Migrate renderers (ordered by complexity, ascending)

Migrate each renderer by:

1. Import `useTypography` at the top
2. Call `const typography = useTypography()` inside the component
3. Replace hardcoded `fontSize`/`lineHeight` in style arrays with the appropriate token
4. Keep icon/badge sizes hardcoded

**Migration order and token mapping:**

#### `CTARenderer.tsx` (3 sizes → 3 tokens)

- heading 24 → `typography.heading`
- body 16 → `typography.body`
- buttonText 16 → `typography.body`

#### `NavigationCarouselRenderer.tsx` (2 sizes → 2 tokens)

- category 11 → `typography.caption`
- title 16 → `typography.body`

#### `CardRenderer.tsx` (3 sizes → 3 tokens)

- title 18 → `typography.titleSmall`
- titleFeatured 22 → `typography.titleLarge`
- description 14 → `typography.bodySmall`

#### `VideoRenderer.tsx` (3 sizes → 2 tokens + 1 icon)

- title 18 → `typography.titleSmall`
- subtitle 14 → `typography.bodySmall`
- playIcon 22 → hardcoded (icon)

#### `BibleQuotesCarouselRenderer.tsx` (5 sizes → 4 tokens + fix Dimensions bug)

- heading 24 → `typography.heading`
- quoteText 16 → `typography.body`
- reference 14 → `typography.bodySmall`
- attribution 12 → `typography.caption`
- ctaText 14 → `typography.bodySmall`
- **Also:** Convert module-scope `Dimensions.get("window")` to `useWindowDimensions()`

#### `VideoHeroRenderer.tsx` (4 sizes → 3 tokens + 1 icon)

- heading 32 → `typography.display`
- subheading 14 → `typography.bodySmall`
- ctaText 16 → `typography.body`
- muteIcon 18 → hardcoded (icon)

#### `RelatedQuestionsRenderer.tsx` (4 sizes → 3 tokens + 1 icon)

- heading 24 → `typography.heading`
- questionText 16 → `typography.body`
- answerText 15 → `typography.bodySmall` (normalizes 15→14)
- chevron 18 → hardcoded (icon)

#### `EasterDatesRenderer.tsx` (5 sizes → 4 tokens + 1 icon)

- title 22 → `typography.titleLarge`
- dateLabel 16 → `typography.body`
- datePrimary 28 → `typography.headingScale.h2`
- dateSecondary 18 → `typography.titleSmall`
- chevron 22 → hardcoded (icon)

#### `TextRenderer.tsx` (7 sizes → hook's headingScale + 3 body tokens)

- h1–h6 scale → `typography.headingScale[level]`
- subtitle 16 → `typography.body`
- body default 16 → `typography.body`
- body lead 20 → `typography.bodyLead`
- body small 14 → `typography.bodySmall`

#### `MediaCollectionRenderer.tsx` (14 sizes → 8 tokens + 4 badge/icon)

- sectionTitle 24 → `typography.heading`
- subtitle 16 → `typography.body`
- description 14 → `typography.bodySmall`
- itemTitle 14 → `typography.bodySmall`
- itemSubtitle 12 → `typography.caption`
- categoryLabel 12 → `typography.caption`
- ctaLinkText 14 → `typography.bodySmall`
- footerText 12 → `typography.caption`
- sizeText 11 → `typography.caption` (normalizes 11→12)
- numberText 13 → hardcoded (badge in fixed 28×28 container)
- playIcon 16 → hardcoded (icon)
- numberBadgeText — hardcoded (badge)
- sizeBadge text — hardcoded (badge)

### Phase 3: Screen-level files (optional, low priority)

#### `WatchHomeScreen.tsx` and `ExperienceScreen.tsx`

- loading/error text 14 → `typography.bodySmall`

## Success Metrics

- Visual consistency: body text in adjacent carousel sections renders at the same size
- No text is illegible on a 320pt-wide device
- No text is oversized on a 430pt+ device
- All 12 renderers consume tokens from `useTypography()` — zero hardcoded semantic font sizes remain

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-25-mobile-responsive-typography-requirements.md](docs/brainstorms/2026-03-25-mobile-responsive-typography-requirements.md) — Key decisions: smooth proportional scaling over device-class presets; centralized typography scale as single source of truth.

### Internal References

- [TextRenderer.tsx](apps/mobile/src/components/sections/TextRenderer.tsx) — current heading scale and body variants
- [SectionColorSchemeContext.ts](apps/mobile/src/components/sections/SectionColorSchemeContext.ts) — only existing shared style context
- [BibleQuotesCarouselRenderer.tsx](apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx) — module-scope `Dimensions.get` anti-pattern to fix
- [NavigationCarouselRenderer.tsx](apps/mobile/src/components/sections/NavigationCarouselRenderer.tsx) — existing `useWindowDimensions()` usage as reference pattern
- [docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md](docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md) — institutional learning: always use `useWindowDimensions()`, not `Dimensions.get()` at module scope
