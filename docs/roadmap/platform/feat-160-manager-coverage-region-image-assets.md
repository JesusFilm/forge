---
id: "feat-160"
title: "Manager coverage region image assets"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-05"
duration: 1
depends_on:
  - "feat-114"
blocks: []
tags:
  - "platform"
  - "manager"
  - "coverage"
  - "ui"
---

## Problem

The Manager coverage language picker shows broken image icons on the region
tiles in production. The UI renders the region list and counts, but the tile
artwork points at root public PNG URLs such as `/region-africa.png`; production
currently returns 404 for those paths while the same service successfully serves
route-backed shell assets such as `/jesusfilm-sign.svg`.

## Entry Points - Read These First

1. `apps/manager/src/features/coverage/LanguageGeoSelector.tsx` - region tile
   image mapping and `next/image` usage.
2. `apps/manager/public/region-africa.png` and sibling region PNGs - current
   source images.
3. `apps/manager/railway.toml` - standalone build copy behavior for `.next`
   static and public assets.
4. `apps/manager/src/app/jesusfilm-sign.svg/route.ts` - prior production-safe
   shell asset route pattern.

## Grep These

- `REGION_THEMES`
- `region-africa.png`
- `renderRegionTile`
- `next/image`

## What To Build

1. Stop rendering region cards from root public image URL strings.
2. Bind the region card artwork through Next static image imports so production
   requests go through copied `/_next/static/media` assets.
3. Preserve the existing Studio visual design, region labels, counts, and
   selection behavior.
4. Verify the production symptom with a direct request and prove the local build
   no longer emits `/region-*.png` as the card source.

## Constraints

- Do not redesign the language picker.
- Do not change language filtering, URL state, or coverage data fetching.
- Do not add new colors or one-off visual tokens.
- Keep the fix inside `apps/manager` plus this roadmap/plan documentation.

## Verification

- `curl -I https://manager.jesusfilm.org/region-africa.png` before the fix shows
  the production root public asset path returns 404.
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager build`
- Local browser smoke for `/dashboard/coverage?languageId=cmokkxw5v03uyqsccis58pea6`
  with the language picker open and region images visible.

## Completion Notes

- Region cards now use Next static image imports, so rendered image URLs point
  at `/_next/static/media/region-*.png` through the Next image optimizer rather
  than root public `/region-*.png` paths.
- Production symptom was verified before the fix:
  `https://manager.jesusfilm.org/region-africa.png` returned 404 on
  2026-06-05.
- Local Helium smoke in mock mode confirmed the open language picker renders
  region artwork and browser image `src` values reference
  `/_next/static/media/region-*.png`.
