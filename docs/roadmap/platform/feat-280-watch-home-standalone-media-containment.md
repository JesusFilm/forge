---
id: "feat-280"
title: "Contain standalone Watch home media blocks"
owner: "unassigned"
priority: "P2"
status: "in-progress"
start_date: "2026-07-21"
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

The Watch homepage renders top-level `VideoCarouselBlock` and `VideoBlock`
content at full viewport width, while neighboring Experience sections align to
the standard Watch content rail. This leaves the New Believer Course carousel
and the final invitation video visually uncontained.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` — Watch homepage
   Experience composition and the narrow ownership boundary for this fix.
2. `apps/web/src/components/sections/index.tsx` — shared Experience renderer;
   keep its generic route behavior unchanged.
3. `apps/web/src/components/sections/Section.tsx` — established parent-owned
   Watch content rail pattern.
4. `apps/web/src/lib/content-width.ts` — shared rail and carousel bleed tokens.
5. `docs/plans/2026-07-21-003-fix-watch-home-media-containment-plan.md` —
   requirements, scope boundaries, test scenarios, and browser proof contract.

## Grep These

- `WatchHomeExperiencePage`
- `ExperienceSectionRenderer`
- `WATCH_PAGE_CONTENT_CLASSES`
- `VideoCarouselBlock`
- `VideoBlock`
- `VideoSection`

## What To Build

1. Apply the standard Watch content rail to top-level homepage
   `VideoCarouselBlock` and `VideoBlock` content only.
2. Preserve full-bleed hero behavior and existing containment for nested or
   self-contained blocks.
3. Add focused composition coverage for selective wrapping and authored order.
4. Verify responsive geometry, document overflow, and real carousel movement
   on the local Watch homepage.

## Constraints

- Do not change generic Experience routes or Watch detail-page body rails.
- Do not change shared content-width or carousel bleed tokens.
- Do not change video or carousel behavior, content, order, links, or media
  loading.
- Preserve the existing dynamic renderer imports and server-rendered page
  composition.

## Verification

- Focused `WatchHomeExperiencePage`, `Video`, and `CarouselVideo` tests.
- Web typecheck, lint, and formatting checks for the touched scope.
- Compact and wide browser geometry proof with screenshots.
- Confirm no document overflow, real horizontal carousel movement, preserved
  terminal gutter, no new console errors, and no new data or media requests.
