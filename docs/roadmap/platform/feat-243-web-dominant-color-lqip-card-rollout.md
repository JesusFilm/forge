---
id: "feat-243"
title: "Web card dominant-color and LQIP rollout"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-07-09"
duration: 1
depends_on:
  - "feat-221"
  - "feat-242"
blocks:
  - "feat-295"
tags:
  - "platform"
  - "web"
  - "graphql"
  - "media"
---

## Problem

Admin now stores useful `blurDataUrl` and `dominantColor` metadata for video
images and uploaded media assets, but Web cards still render with generic black
scrims and do not consistently pass the metadata into `next/image`.

## Entry Points

1. `packages/admin-graphql/src/fragments/blocks/media-collection.ts`
2. `apps/admin/src/graphql/types/blocks.ts`
3. `apps/web/src/lib/watch-home.ts`
4. `apps/web/src/lib/content.ts`
5. `apps/web/src/components/home/WatchHomeCard.tsx`
6. `apps/web/src/components/sections/MediaCollection.tsx`

## What To Build

- Expose media collection item image `blurDataUrl` and `dominantColor` through
  Admin GraphQL for video images and uploaded media overrides.
- Carry video-image metadata through Watch home, Watch page route children, and
  manual media collection cards.
- Use `blurDataURL` as the image placeholder while keeping real images rendered.
- Use readable dominant colors for card text scrims without replacing the
  image.

## Verification

- `pnpm --filter @forge/admin test src/graphql/types/blocks.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin-graphql typecheck`
- `pnpm --filter @forge/web test src/lib/readable-scrim-color.test.ts src/lib/enrichment.test.ts src/lib/__tests__/watch-home.test.ts src/components/sections/MediaCollection.test.tsx src/components/home/__tests__/WatchHomePage.test.tsx src/components/watch/__tests__/MuxHoverPreview.test.tsx src/lib/content.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web build`
