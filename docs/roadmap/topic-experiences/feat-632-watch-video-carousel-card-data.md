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

## Current Evidence — 15 October 2026

- Native production DOM at `/watch/spanish-castilian.html` confirms all ten
  `Curso para nuevos creyentes` cards have empty headings, `Mostrar ` accessible
  labels and no image elements. The browser snapshot/screenshot tool failed;
  the DOM receipt is `/tmp/watch-loop-browser-m4-production.json`.
- Admin MCP `experience.locale.read` returns the published Spanish home locale
  `cmrv6ijsg04cbo601hrd8sxel`, updated 14 September, with ten identity-only
  `videoId`/`languageId` entries in `video-carousel-10` and no authored overrides.
- The current English home uses `MediaCollectionBlock` for these same ten video
  IDs. Its titled links are a content control, not the same renderer. Its image
  loading was not established by the DOM probe.
- Linked Spanish titles/images/dubs were reported by the original 8 October
  investigation. This run cannot independently reread those protected records:
  Admin MCP returns `403 insufficient_scope` for `video:read`; no scope bypass
  or CMS mutation was attempted.
- Current Web passes the raw Admin block to a renderer that reads retired
  `item.video.title`/`item.video.images` fields. The canonical query cannot supply
  those fields. Current-main regression checks reproduce the resulting empties.

## Resolution

- Added Admin `resolvedTitle(locale:)` and `videoImage`, reusing the published
  title resolver and the batched image loader. The poster field uses the existing
  pure image-selection helper and does not trigger unused blur-metadata reads or
  generation work.
- Regenerated `apps/admin/schema.graphql` and admin-graphql introspection through
  the normal printer and generator. Local Prisma/Pothos prerequisites were
  generated into private scratch output from the current schema; shared installed
  dependencies and generated clients were left unchanged.
- Web queries localized titles and linked poster URLs only in its primary
  projection. A recognized older-schema retry preserves category and
  recommendation blocks. Mixed carousel/category-copy errors retain the existing
  complete-copy-set requirement instead of forcing the broad legacy fallback.
- Carousel cards prefer authored overrides, then linked localized data, then
  legacy data; Mux fallbacks retain the shared cached frame and hero recipes.
  The selected poster follows course-card selection. Its direct Mux fallback uses
  the cached 1280px hero derivative, preserving authored/linked poster precedence.
- Red/green coverage: four Web display cases and six Admin field/resolver cases
  fail on current-main implementations; two mixed-schema retry cases fail on the
  prior PR implementation and pass after the narrowed classifier.
- Focused verification: 68 Web and 125 Admin tests pass. A ten-item real-DataLoader
  fixture with missing blur/color metadata takes three shared title/poster reads
  and no per-image lookups. This is a query-fanout bound, not a production latency
  measurement.
- Full Web, focused Admin and admin-graphql TypeScript checks pass.
- Full production after-proof and image-load/performance measurement remain
  pending an authorized preview or normal PR-to-main deployment.
- PR: https://github.com/JesusFilm/forge/pull/2611 (existing issue-of-record PR).
