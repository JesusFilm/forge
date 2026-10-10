---
id: "feat-295"
title: "Restore Watch MediaCollection video image metadata generation"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on:
  - "feat-243"
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "graphql"
  - "watch-page"
---

## Problem

Production Watch MediaCollection items can link to Core videos whose
`VideoImage` rows have renderable URLs but missing `blurDataUrl` and
`dominantColor`. The Watch web animation still runs, but the consumer fallback
collapses to generated purple SVG gradients, so hover/focus cross-fades look
static instead of photographic. The production Acts of the Apostles collection
exposed this gap for `6_Acts0401`, `6_Acts0402`, `6_Acts0403`, and
`6_Acts0404`.

## Entry Points — Read These First

1. `apps/admin/src/services/core-sync/phases/sync-video-images.ts` — Core image
   URL ingestion; currently persists URLs but does not own metadata generation.
2. `apps/admin/src/graphql/types/blocks.ts` — MediaCollection item resolvers
   for linked video image metadata.
3. `apps/admin/src/services/video-image-blur-data-url.service.ts` — strict
   fetch/decode/persist path for blur data and dominant color.
4. `apps/admin/src/scripts/backfill-video-image-blur-data-url.ts` — explicit
   operator repair path for existing rows.
5. `apps/web/src/lib/enrichment.ts` and
   `apps/web/src/components/sections/MediaCollection.tsx` — consumer fallback
   and backdrop rendering behavior.

## Grep These

- `getOrScheduleVideoImageBlurDataUrl`
- `getOrCreateVideoImageBlurDataUrl`
- `videoImageBlurDataUrl`
- `videoImageDominantColor`
- `demoBlurDataUrl`
- `selectRenderableVideoImage`

## What To Build

1. Restore a safe lazy-generation path for MediaCollection-linked video images
   so missing `blurDataUrl` or `dominantColor` is scheduled when the GraphQL
   fields are read.
2. Keep existing reads non-blocking: return currently stored metadata and let
   generation repair the row for subsequent reads.
3. Add structured logging for generator skips/failures so "never invoked" can
   be distinguished from "invoked but blocked or failed".
4. Keep the explicit backfill script as the immediate production repair tool
   for the four Acts slugs / eight image rows.

## Constraints

- Do not modify production data from this worktree.
- Do not depend on search traffic for image metadata generation.
- Do not overwrite existing valid `blurDataUrl` and `dominantColor` values.
- Do not hand-edit generated GraphQL env outputs unless the Admin schema
  changes.

## Verification

- Admin tests cover MediaCollection resolver scheduling for missing video image
  metadata and repair of missing dominant colors.
- Video image generator tests continue to cover URL guards, content-type
  guards, byte caps, decode failures, and successful persistence.
- Production repair remains a separate operator action: run the focused
  `backfill:video-image-blur-data-url` command, verify all eight Acts rows have
  both metadata fields, invalidate/revalidate Watch homepage cache, and browser
  verify photographic backdrop cross-fades.
