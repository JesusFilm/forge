---
id: "feat-287"
title: "Watch shared card and eyebrow typography tokens"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "ui"
  - "design-system"
  - "typography"
---

## Problem

Watch media cards and section eyebrows use local font-weight and letter-spacing
utilities. That makes repeated typography drift between the generated Watch
home sections and other Watch section components, and prevents one approved
visual adjustment from applying consistently to every instance of the same
semantic role.

## Entry Points - Read These First

1. `apps/web/src/app/globals.css` - Tailwind theme and shared design tokens.
2. `apps/web/src/components/sections/MediaCollection.tsx` - Experience media
   card label, title, and section eyebrow used by the annotated content.
3. `apps/web/src/components/home/WatchHomeCard.tsx` - generated Watch home media
   card label and title.
4. `apps/web/src/components/home/WatchHomeSection.tsx` - generated Watch home
   section eyebrow.
5. `apps/web/src/components/watch/watch-section-styles.ts` - shared classes for
   synthetic Watch section eyebrows.
6. `apps/web/src/components/sections/` - authored Experience section eyebrow
   consumers.

## Grep These

- `watch-home-card-text-gradient`
- `WATCH_SECTION_EYEBROW_CLASS`
- `tracking-wider`
- `tracking-[0.18em]`
- `font-bold`

## What To Build

1. Add semantic Tailwind theme tokens for media-card title weight, media-label
   tracking, and section-eyebrow tracking.
2. Set authored and generated Watch media-card titles to weight 500 and card
   labels to 0.2px letter spacing through their shared card components.
3. Set all shared Watch and Experience section eyebrow variants to 0.2px
   letter spacing.
4. Add focused class-contract coverage for authored and generated Watch cards
   and section eyebrows.
5. Verify the annotated Watch page at 698x1114 and confirm computed typography
   values, layout health, and console health.

## Constraints

- Keep these values viewport-independent; they describe semantic typography
  roles rather than responsive layout behavior.
- Keep media-label and section-eyebrow tokens separate even when their current
  values match, so each role can evolve independently.
- Do not change card content, card sizing, section copy, routing, media
  behavior, or unrelated promotional eyebrow styles.
- Add no runtime JavaScript, request, effect, listener, or dependency.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home/__tests__/WatchHomePage.test.tsx`
- `pnpm --filter @forge/web exec vitest run src/components/sections/MediaCollection.test.tsx`
- Run focused Watch component tests that consume the shared eyebrow class.
- `pnpm --filter @forge/web typecheck`
- Run scoped lint, formatting, and `git diff --check`.
- Browser smoke `/watch` at 698x1114 with computed-style assertions and a
  screenshot.

## Completion Evidence

- Added semantic Tailwind theme tokens for media-card title weight,
  media-label tracking, and section-eyebrow tracking. Authored Experience cards
  and generated Watch-home cards now share the intended values while keeping
  their existing renderer ownership.
- Migrated the shared authored, generated, and synthetic Watch eyebrow family;
  unrelated button, badge, hero, and promotional tracking remains unchanged.
- Focused Vitest passed for 8 files and 222 tests, with 2 existing skipped
  tests. Full Web TypeScript and ESLint checks passed, and all changed files
  passed Prettier plus `git diff --check`.
- Browser proof at 698x1114 computed the selected title at font weight 500 and
  the selected card label and section eyebrow at 0.2px letter spacing. All 51
  rendered media-card titles, all 51 labels, and all 9 shared eyebrows used
  the same computed values; the page had no horizontal overflow or console
  errors.
- Browser screenshot:
  `/Users/o/.codex/visualizations/2026/07/22/019f8afc-560d-7f32-9e98-a6fa97a4c080/watch-shared-typography-698x1114.png`.
- Structured code review completed with no actionable findings and a ready
  verdict. Durable guidance is recorded in
  `docs/solutions/design-patterns/watch-semantic-tailwind-typography-role-tokens.md`.
