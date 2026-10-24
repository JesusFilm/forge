---
id: "feat-279"
title: "Experience carousel empty copy rendering"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "experiences"
  - "admin"
  - "web"
  - "watch-page"
---

## Problem

New Experience video carousels persist starter title, subtitle, and description
copy even when the editor has not authored those fields. Web correctly hides
the carousel copy wrapper for absent strings, but the persisted starter values
make placeholder text such as `Video carousel` and `Carousel description`
appear as public content.

## Entry Points — Read These First

1. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts` — `createTemplateBlock` starter payloads for manual and route video carousels.
2. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.test.ts` — starter-schema and serialization coverage.
3. `apps/web/src/components/sections/CarouselVideo.tsx` — conditional copy wrapper around authored title, subtitle, and description.
4. `apps/web/src/components/sections/__tests__/CarouselVideo.test.tsx` — rendered carousel behavior.

## Grep These

- `rg -n 'Video carousel|Carousel description|Related videos|Keep watching' apps/admin/src/app/dashboard/experiences/experience-editor`
- `rg -n 'subtitle \|\| title \|\| carouselDescription' apps/web/src/components/sections/CarouselVideo.tsx`
- `rg -n 'createTemplateBlock\("(route)?videoCarousel"' apps/admin/src/app/dashboard/experiences/experience-editor`

## What To Build

1. Stop seeding public-facing title, subtitle, and description values in new manual and route-video carousel blocks.
2. Preserve Admin-only block summaries and input placeholders so blank authored fields remain understandable in the editor.
3. Add regression tests proving starter payloads omit copy fields and Web renders no copy wrapper when all three fields are absent.

## Constraints

- Do not remove or hide authored carousel copy.
- Do not change the Experience schema or generated GraphQL artifacts.
- Do not remove Admin-only labels, summaries, or field placeholders.
- Do not alter video item rendering, route-video child resolution, or carousel interaction behavior.

## Verification

- `pnpm --filter @forge/admin test --run src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`
- `pnpm --filter @forge/web test --run src/components/sections/__tests__/CarouselVideo.test.tsx`
- Add a blank-copy video carousel in the Experience editor and confirm the Watch preview shows carousel media without the title/subtitle/description block.
