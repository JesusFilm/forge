---
id: "feat-441"
title: "Watch Vertical Inventory Thumbnails"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-28"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "content-discovery"
  - "responsive-design"
---

## Problem

Compact episode rows on `/watch/{language}.html/videos` force every thumbnail
into a landscape box. Episodes from portrait collections therefore appear as
small landscape crops even when their catalog identifiers mark them as
vertical or `9x16`.

## Entry Points - Read These First

1. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
   - `CompactVideoRow` owns the affected thumbnail frame, image sizing hints,
     play affordance, and interaction frame.
2. `apps/web/src/components/watch-language-inventory/__tests__/LanguageInventoryPage.thumbnails.test.tsx`
   - dedicated component test seam whose `next/image` mock exposes thumbnail
     markup and props.
3. `apps/web/src/components/sections/MediaCollection.tsx`
   - existing `aspect-[2/3]` portrait Watch card treatment.
4. `apps/admin/src/services/typesense-watch-search-identifiers.ts`
   - existing Core ID aspect suffix vocabulary, including `9x16`.

## Grep These

- `CompactVideoRow` and `language-inventory-compact-thumbnail-frame` in the
  language inventory component and tests.
- `aspect-[2/3]` in Watch card components.
- `9x16` and `vertical` in catalog fixtures and identifier normalization.
- `resolveMuxFrameThumbnailUrl` to preserve the existing thumbnail request
  recipe.

## What To Build

1. Add a pure portrait-orientation predicate using fields already present on
   `WatchLanguageInventoryCard`.
   - Treat delimited `vertical` and `9x16` markers as portrait signals.
   - Check `coreId` and the video `slug` before `parentSlug`, `title`, and
     `parentTitle` fallbacks.
2. In `CompactVideoRow`, preserve `h-12 sm:h-14` and derive portrait width with
   `aspect-[2/3]`; leave the existing landscape width classes unchanged for
   ordinary videos.
3. Center portrait imagery and provide responsive image `sizes` matching the
   narrower frame while retaining the current left-top alignment and sizes for
   landscape rows.
4. Add focused tests for Core ID, child slug, parent slug, and the unchanged
   landscape branch.

## Constraints

- Do not change collection overview artwork, full grid cards, player posters,
  home cards, or Experience media collections.
- Do not add GraphQL fields, client effects, eager loading, media requests, or
  image derivative recipes.
- Preserve the play affordance, white hover/focus frame, links, numbering,
  metadata, and gradient fallback.
- Keep current compact row heights and density at phone and desktop widths.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch-language-inventory/__tests__/LanguageInventoryPage.thumbnails.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Run scoped formatting and lint checks for the touched Web files.
- `git diff --check`
- Browser smoke `/watch/english.html/videos` at desktop and narrow widths:
  portrait episodes use 2:3 frames, normal episodes remain landscape, links
  and interaction frames still work, and the console stays clean.
- Compare page resources before and after; this render-only change must add no
  requests, effects, eager images, or client initialization.

## Resolution

Implemented a render-only orientation branch in `CompactVideoRow`. Delimited
`vertical` and `9x16` markers from the existing card fields now select the 2:3
portrait frame, centered artwork, and a narrower responsive `sizes` hint;
ordinary rows retain their original landscape dimensions and alignment.

Verification completed on 2026-08-29:

- Focused Vitest coverage passes all 12 cases, including Core ID, child slug,
  parent slug, localized title, parent title, and the unchanged landscape
  branch.
- Web TypeScript, scoped ESLint, Prettier, and `git diff --check` pass.
- Browser proof against the production component with loaded fixture artwork:
  at a 1280 px viewport the portrait row measured 37.3 x 56 px (2:3) while
  the control row remained 96 x 56 px; at 390 px they measured 32 x 48 px and
  80 x 48 px respectively. Both retained their links, play affordances, and
  shared hover/focus interaction frames.
- Browser images completed successfully and the changed row emitted no console
  errors. The implementation adds no effects, queries, eager images, or image
  nodes; its responsive hint selects narrower candidates for portrait rows.
- The public inventory route could not load local data because the configured
  Admin GraphQL service was unavailable, so responsive browser proof used a
  temporary fixture route that rendered the same production component. The
  fixture was removed before final validation.
