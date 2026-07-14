---
id: "feat-252"
title: "Scale Watch home portrait cards at smaller widths"
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

The Watch home Video Bible collection rail renders three portrait cards from
the medium breakpoint until the extra-large breakpoint. On tablets and small
laptops, that leaves each tile oversized compared with the six-card wide-screen
composition.

## Entry Points — Read These First

1. `apps/web/src/components/sections/MediaCollection.tsx` — builder-authored
   rail layout, responsive column classes, and portrait cards.
2. `apps/web/src/components/sections/MediaCollection.test.tsx` — component
   coverage for authored collection variants.
3. `apps/web/src/components/home/WatchHomeSection.tsx` — fallback Watch home
   section used to distinguish the authored surface from fallback content.
4. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
   — required performance proof for frontend layout changes.

## Grep These

- `grid-cols-2 md:grid-cols-3 xl:grid-cols-6`
- `media-collection-section`
- `MediaCollection`
- `xl:grid-cols-6`

## What To Build

1. Use four columns for tablet and small-desktop widths in Watch home rail
   sections.
2. Preserve the current two-column mobile and six-column wide-screen layouts.
3. Extend the focused Watch home test so the responsive class contract cannot
   regress.
4. Visually verify the Video Bible rail at compact and wide desktop widths and
   confirm the CSS-only change adds no runtime or network work.

## Constraints

- Do not change card content, order, links, image crop, aspect ratio, or hover
  behavior.
- Do not change non-rail Watch home grids.
- Do not add JavaScript viewport branching or a new dependency.
- Preserve server-rendered markup and existing Next Image loading behavior.

## Verification

- `pnpm --filter @forge/web test -- MediaCollection.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at 1024px and at least one 1280px-or-wider viewport with
  screenshots of the Video Bible collection section.
- Confirm the rendered page introduces no new scripts, requests, timers, or
  hydration work relative to the existing implementation.
