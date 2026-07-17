---
id: "feat-252"
title: "Restore the Watch authored media carousel"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "ui"
  - "responsive"
---

## Problem

The Experience backend still authors the Video Bible collection as
`variant: "carousel"`, but web currently renders it as a wrapping grid. Restore
the drag-free horizontal rail used before June 20 so cards remain compact and
browsable without changing backend data.

## Entry Points — Read These First

1. `apps/web/src/components/sections/MediaCollection.tsx` — builder-authored
   carousel/grid variant dispatch and portrait cards.
2. `apps/web/src/components/sections/MediaCollection.test.tsx` — component
   coverage for authored collection variants.
3. `apps/web/src/components/home/WatchHomeSection.tsx` — fallback Watch home
   section used to distinguish the authored surface from fallback content.
4. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
   — required performance proof for frontend layout changes.

## Grep These

- `variant === "carousel"`
- `CarouselContent`
- `max-w-[200px]`
- `media-collection-section`
- `MediaCollection`
- `xl:grid-cols-6`

## What To Build

1. Render the authored `carousel` variant as a single drag-free horizontal row.
2. Restore the historical fixed-width portrait slides and trailing gutter.
3. Preserve current card visuals, behavior, links, and non-carousel variants.
4. Extend focused coverage and verify scrolling on the real Watch homepage.

## Constraints

- Do not change card content, order, links, image crop, aspect ratio, or hover
  behavior.
- Do not change non-rail Watch home grids.
- Reuse the existing Embla carousel; do not add a dependency.
- Preserve server-rendered markup and existing Next Image loading behavior.

## Verification

- `pnpm --filter @forge/web test -- MediaCollection.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at compact and wide viewports with screenshots of the Video
  Bible collection section and proof that the rail moves horizontally.
- Confirm the rendered page introduces no new data or media requests.
