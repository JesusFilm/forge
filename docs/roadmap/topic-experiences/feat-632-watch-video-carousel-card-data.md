---
id: "feat-632"
title: "Render linked video data in Watch experience carousels"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-07"
duration: 1
depends_on: []
blocks: []
tags: [watch, experiences, localization]
---

## Problem

Published Admin `VideoCarouselBlock` items expose authored overrides and
playback dubs, but not the linked video's localized title or poster. The Web
renderer still reads the retired nested `video.title` and `video.images`
shape, so the Spanish New Believer Course carousel renders ten empty cards.

## Entry Points

- `apps/admin/src/graphql/types/blocks.ts`
- `packages/admin-graphql/src/fragments/blocks/video-carousel.ts`
- `apps/web/src/lib/fragments/watch-experience.ts`
- `apps/web/src/components/sections/CarouselVideo.tsx`

## Scope

Expose the linked video's poster through the Admin VideoCarousel item shape and
resolve its display title in the requested Watch UI locale, retaining authored
title and image overrides. Update Web to render the current Admin shape while
keeping legacy blocks readable. Preserve the selected VideoDub as the playback
source.

## Verification

- Admin resolver and schema tests cover localized title and linked-video image
  projection.
- Web component test verifies a Spanish localized title and poster render from
  Admin-shaped carousel data with authored overrides absent.
- Compare the Spanish course with the English home and a neighboring locale on
  production; run Web and Admin tests/typechecks/lint plus schema/typegen,
  formatting, and PR CI.

## Current Evidence

- Production `/watch/spanish-castilian.html` renders ten New Believer Course
  cards with empty headings, no poster images, and empty accessible names.
- Public Admin GraphQL returns ten linked Spanish-Latin-American dubs, video
  images, and Spanish (`es`) VideoLocale titles. The authored carousel items
  have no title or image overrides.
- The current `VideoCarouselItem` GraphQL type omits those linked title/poster
  fields, while Web still reads legacy `item.video.title` and `item.video.images`.

## Resolution

- Added Admin `resolvedTitle(locale:)` and `videoImage` fields and regenerated
  `apps/admin/schema.graphql` plus gql.tada introspection.
- Web queries those fields only on the primary projection. A schema-lag retry
  removes only the new carousel extension and preserves homepage recommendation
  and category rail blocks.
- Carousel cards now prefer authored image/title overrides, then localized
  linked video data, then legacy data; Mux fallback URLs use the shared cached
  card and hero poster recipes.
- Regression coverage: Web carousel/content tests and Admin block schema tests.
- PR: https://github.com/JesusFilm/forge/pull/2611
