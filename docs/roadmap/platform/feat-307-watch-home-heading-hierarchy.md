---
id: "feat-307"
title: "Simplify Watch home heading hierarchy"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "accessibility"
  - "seo"
---

## Problem

The Watch homepage hero adds a visually hidden brand H1 and repeats carousel
slide titles as headings in both the active overlay and thumbnail rail. The
builder-authored page topic already supplies the stable visible H1, so carousel
content makes the document outline noisy and unstable across rotations
(FGE-20, formerly WAT-254).

The single-H1 fix left one residual sequence skip: promotional Markdown
subheadings remained H3 when their Text block heading was the page H1, so the
outline reached H3 before the later section H2s.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` - hero overlay,
   transition copy, and thumbnail rail semantics.
2. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` -
   deterministic carousel DOM and rotation coverage.
3. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - composition
   boundary between the carousel and builder-authored page content.
4. `apps/web/src/components/sections/Text.tsx` - authored heading-level
   rendering, including the stable promotional H1.

## Grep These

- `pageTitle`
- `WatchHomeTvOverlayContent`
- `VideoThumbnailTitle as="h2"`
- `data-testid="watch-home-tv-carousel"`
- `aria-label`

## What To Build

1. Remove the carousel-owned brand H1 so the authored descriptive heading is
   the only page H1.
2. Keep one localized page-level fallback H1 when builder-authored content is
   unavailable. Keep the first authored TextBlock H1 and demote later authored
   H1 blocks to H2 so the page-level invariant remains deterministic.
3. Keep the active slide title visible and use it as the carousel region's
   accessible name without treating it as a document heading.
4. Keep leaving transition copy out of the accessibility tree and render rail
   titles as non-heading text inside the existing accessible buttons.
5. Add deterministic DOM coverage before and after slide selection, proving
   the carousel never exposes H1-H6 elements and always references the active
   title for its accessible name.
6. Verify the complete page outline and axe result at desktop and mobile
   widths without changing carousel styling, playback, or navigation.
7. Render promotional Markdown subheadings as H2 beneath the page H1 while
   preserving their H3 level beneath promotional H2 headings.

## Constraints

- Preserve all visible typography, layout, animation, and carousel behavior.
- Do not hard-code the authored marketing H1 in the carousel.
- Do not hide the active slide title or remove accessible button names.
- Do not change Experience content, data fetching, routing, or localization.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home/WatchHomeExperiencePage.test.tsx src/components/home/__tests__/WatchHomePage.test.tsx src/components/sections/Text.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter roadmap generate:readme`
- Server HTML and hydrated DOM expose exactly one stable H1.
- Promotional content under the page H1 proceeds to H2 before later section
  H2s, while other promotional blocks retain their H2-to-H3 hierarchy.
- Desktop and mobile browser checks show no carousel headings, one labelled
  active slide, and no critical or heading-related axe violations.
