---
title: "Increase Experience Title Font Size"
type: feat
status: completed
date: 2026-03-30
---

# Increase Experience Title Font Size

Increase the font size of the Experience title text (e.g., "Easter") displayed in the video hero section of the mobile app. The current `display` typography token uses a 32px base size — bump it to make the title more prominent.

## Acceptance Criteria

- [ ] Experience title text in `VideoHeroRenderer` is visibly larger than the current 32px base
- [ ] `lineHeight` scales proportionally with the new `fontSize`
- [ ] No other text in the app is affected (verified: `typography.display` is only used in `VideoHeroRenderer.tsx:48`)
- [ ] Text renders correctly on both iOS and Android (no blurry text — `Math.round()` is already applied by the typography hook)

## Context

### Current State

The experience title uses `typography.display` from `useTypography()`:

```typescript
// apps/mobile/src/hooks/useTypography.ts:19
display: { fontSize: 32, lineHeight: 40 },
```

Applied in:

```typescript
// apps/mobile/src/components/sections/VideoHeroRenderer.tsx:48
style={[styles.heading, typography.display]}
```

With responsive scaling (0.85x–1.15x of 375px base), the actual rendered size ranges from ~27px to ~37px.

### Proposed Change

Increase the `display` token in `BASE_SCALE` within `apps/mobile/src/hooks/useTypography.ts`:

```typescript
// Before
display: { fontSize: 32, lineHeight: 40 },

// After (suggested — adjust to taste)
display: { fontSize: 40, lineHeight: 48 },
```

Also update the `h1` entry in `HEADING_SCALE` if it should stay in sync with `display` (both are currently 32/40):

```typescript
// Before
h1: { fontSize: 32, lineHeight: 40 },

// After (if syncing with display)
h1: { fontSize: 40, lineHeight: 48 },
```

### Files to Change

- `apps/mobile/src/hooks/useTypography.ts` — update `display` (and optionally `h1`) base sizes

### Institutional Learnings

- Always use `useTypography()` hook, never hardcode font sizes (from `docs/solutions/mobile/responsive-typography-hook.md`)
- `lineHeight` must scale with `fontSize` — never set independently
- `Math.round()` required for Android — already handled by the hook
