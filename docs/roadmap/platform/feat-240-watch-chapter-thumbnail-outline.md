---
id: "feat-240"
title: "Watch Chapter Thumbnail Outline"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "ui"
---

## Problem

Watch page chapter thumbnails use a dark bottom caption gradient for title
legibility, but the hover/current indicator can read as interrupted along the
bottom edge.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SiblingCarousel.tsx` - chapter thumbnail
   overlay and outline layers.
2. `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx` - focused
   carousel regression coverage.
3. `apps/web/src/app/globals.css` - shared Watch card outline utility used by
   other card surfaces.

## Grep These

- `sibling-carousel-hover-outline`
- `sibling-carousel-active-outline`
- `sibling-carousel-caption`
- `watch-home-gradient-outline`

## What To Build

1. Keep the dark caption gradient for text readability.
2. Render the chapter hover/current indicator as an uninterrupted red outline
   above the caption and bevel layers.
3. Scope the change to the Watch chapter carousel, leaving shared home and media
   card outline treatments unchanged.

## Constraints

- Do not change Watch routing, data fetching, or Mux preview loading.
- Do not change shared `watch-home-gradient-outline` behavior for other cards.
- Preserve keyboard focus parity with hover behavior.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SiblingCarousel.test.tsx`
- Browser smoke the provided Watch URL and confirm hovering chapter thumbnails
  keeps the red outline visible along the bottom edge.
