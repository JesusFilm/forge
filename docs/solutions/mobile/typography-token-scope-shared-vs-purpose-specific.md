---
title: "Distinguish purpose-specific vs shared semantic typography tokens before modifying"
category: mobile
date: 2026-03-30
tags:
  - typography
  - design-tokens
  - react-native
  - heading-scale
  - semantic-tokens
severity: medium
modules:
  - apps/mobile/src/hooks/useTypography.ts
  - apps/mobile/src/components/sections/VideoHeroRenderer.tsx
  - apps/mobile/src/components/sections/TextRenderer.tsx
---

# Distinguish Purpose-Specific vs Shared Semantic Typography Tokens

## Problem

When increasing the Experience title font size in the mobile app, both the `display` token in `BASE_SCALE` and `h1` in `HEADING_SCALE` were changed from `{ fontSize: 32, lineHeight: 40 }` to `{ fontSize: 56, lineHeight: 68 }`. Code review revealed that this broke the heading scale progression and would cause 56px headings in standard CMS content sections.

**Symptom:** The heading scale jumped from h2 (28px) to h1 (56px) — a 2x multiplier — while every other step uses increments of 2–4px. CMS-authored `h1` headings in `TextRenderer` would render ~5 characters per line on an iPhone SE.

## Root Cause

The `display` and `h1` tokens happened to share the same value (32/40), creating **incidental coupling**. They serve fundamentally different architectural purposes:

- **`display`** (in `BASE_SCALE`) — a purpose-specific token used exclusively by `VideoHeroRenderer` for the hero/experience title overlay. Safe to scale aggressively.
- **`h1`** (in `HEADING_SCALE`) — a shared semantic token consumed by `TextRenderer` for any CMS-authored heading. Must maintain a consistent progression relative to h2–h6.

When bumping `display` for the hero, `h1` was blindly kept in sync without recognizing these are independent tokens that happened to share a value.

## Solution

Only change `display` in `BASE_SCALE`. Leave `h1` in `HEADING_SCALE` untouched.

```typescript
// apps/mobile/src/hooks/useTypography.ts

// BASE_SCALE — display is ONLY used by VideoHeroRenderer
const BASE_SCALE = {
  caption: { fontSize: 12, lineHeight: 16 },
  bodySmall: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 16, lineHeight: 24 },
  titleSmall: { fontSize: 18, lineHeight: 24 },
  titleLarge: { fontSize: 22, lineHeight: 28 },
  heading: { fontSize: 24, lineHeight: 32 },
  display: { fontSize: 56, lineHeight: 68 }, // ✅ changed — only affects VideoHeroRenderer
} as const satisfies Record<string, TypographyToken>

// HEADING_SCALE — shared across all CMS text sections via TextRenderer
const HEADING_SCALE = {
  h1: { fontSize: 32, lineHeight: 40 }, // ✅ unchanged — preserves heading progression
  h2: { fontSize: 28, lineHeight: 36 },
  h3: { fontSize: 24, lineHeight: 32 },
  h4: { fontSize: 20, lineHeight: 28 },
  h5: { fontSize: 18, lineHeight: 24 },
  h6: { fontSize: 16, lineHeight: 22 },
} as const satisfies Record<TextHeadingLevel, TypographyToken>
```

Update test expectations for `display` only — all `h1` assertions stay at 32/40.

## Investigation Steps

1. Traced consumers of `display` token: only `VideoHeroRenderer.tsx:48`
2. Traced consumers of `headingScale.h1`: `TextRenderer.tsx:21` (used for all CMS headings)
3. Confirmed original values were identical (both 32/40), explaining the assumption they should stay in sync
4. Reviewed heading progression: h6=16, h5=18, h4=20, h3=24, h2=28, h1=32 — smooth scale with +2 to +4 steps. Replacing h1 with 56 creates a +28 jump
5. Code review agents (TypeScript, architecture, pattern recognition) all independently flagged the h1 change

## Key Principle

**Incidental value equality ≠ intentional coupling.** Two tokens can have the same numeric value for completely independent design reasons. When changing one, always ask: "Do the consumers of the _other_ token actually need this change too?"

## Prevention

### Before changing any typography token

1. **Grep for consumers** to understand blast radius:
   - 1 consumer → purpose-specific token, safe to change in isolation
   - 2+ consumers across components → shared semantic token, evaluate every consumer
2. **Classify the token:** Is it in `BASE_SCALE` (named/purpose-specific) or `HEADING_SCALE` (structural/shared)?
3. **Check the scale progression** if modifying `HEADING_SCALE` — each level should step smoothly from the next

### Code review checklist for typography changes

- [ ] Consumer audit performed (grep results listed in PR)
- [ ] Shared vs purpose-specific classification stated
- [ ] No coincidental coupling — if two tokens with the same old value both changed, each consumer independently justified
- [ ] Heading scale progression verified (no jumps > 2x between adjacent levels)

## Gotchas

1. **`TextRenderer` is CMS-driven** — any change to h1–h6 tokens affects all CMS-authored content across the entire app, not just one screen
2. **`display` is intentionally isolated** — it exists in `BASE_SCALE` (separate from `HEADING_SCALE`) so it can scale independently for hero contexts
3. **Responsive scaling amplifies the gap** — at MAX_FACTOR (1.15x), a 56px token renders at 64px. Verify large tokens don't cause layout overflow
4. **Line-height must scale with fontSize** — the `useTypography` hook handles this automatically via `Math.round()`, but verify the ratio is appropriate for the use case (tighter ratios like 1.2x are fine for large display text)

## Related Documentation

- [responsive-typography-hook.md](responsive-typography-hook.md) — primary docs for the `useTypography` hook and token system (note: contains old display value of 32/40, needs refresh)
- [typescript-pick-textstyle-required-wrapper.md](typescript-pick-textstyle-required-wrapper.md) — `Required<Pick<TextStyle, ...>>` pattern used by `TypographyToken` type
