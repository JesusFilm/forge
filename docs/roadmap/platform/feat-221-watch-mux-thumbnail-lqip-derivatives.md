---
id: "feat-221"
title: "Store Watch Mux thumbnail LQIP derivatives"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-06-29"
duration: 2
depends_on:
  - "feat-220"
blocks:
  - "feat-235"
tags:
  - "web"
  - "graphql"
  - "cms"
---

## Problem

Watch chapter carousel cards use generated Mux thumbnail URLs. They do not have
the Core-synced `VideoImage.blurhash` metadata that editorial images carry, so
the cards can render without a crop-matched low-quality placeholder.

## Entry Points — Read These First

1. `apps/web/src/components/watch/SiblingCarousel.tsx` — chapter carousel image
   resolution.
2. `apps/web/src/lib/url.ts` — Mux thumbnail URL helper and poster fallback
   chain.
3. `apps/admin/prisma/schema.prisma` — `MuxVideo` and `VideoImage` storage
   models.
4. `apps/admin/src/graphql/types/video.ts` — Pothos exposure for `MuxVideo` and
   `VideoImage`.
5. `apps/web/src/lib/fragments/watch-video.ts` and `apps/web/src/lib/content.ts`
   — Watch query projection and normalization.

## Grep These

- `resolveMuxFrameThumbnailUrl`
- `muxPlaybackId`
- `VideoImage.blurhash`
- `model MuxVideo`
- `thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2`

## What To Build

- Add an admin-owned image derivative storage model keyed by Mux video plus
  thumbnail recipe.
- Generate a Base64 LQIP data URL from the crop-matched small Mux thumbnail
  URL.
- Expose the derivative through Admin GraphQL so web can read the relevant
  `blurDataUrl` beside `muxPlaybackId`.
- Pass the data URL to Next Image as `placeholder="blur"` / `blurDataURL` for
  Watch chapter carousel cards.

## Constraints

- Do not overload `VideoImage.blurhash`; it describes Core/editorial image
  records, not generated Mux thumbnail recipes.
- Do not perform client-side BlurHash decoding or add browser JavaScript for
  placeholders.
- Keep generated derivatives keyed by surface and params so the placeholder
  matches the visible crop.

## Verification

1. `pnpm --filter @forge/admin prisma migrate dev --name mux-image-derivatives`
2. `pnpm --filter @forge/admin schema:print`
3. `pnpm --filter @forge/admin-graphql generate`
4. `pnpm --filter @forge/web test -- SiblingCarousel.test.tsx`
5. `pnpm --filter @forge/admin test -- mux-image-derivative`
