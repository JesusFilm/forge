---
id: "feat-049"
title: "Single-Video Template Related Media Collection"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-04-08"
duration: 2
depends_on:
  - "feat-047"
blocks: []
tags:
  - "web"
  - "cms"
  - "experiences"
---

## Problem

The generic single-video template can bind `Video` and `VideoHero` blocks to the current route video, but `MediaCollection` is still static. Editors cannot build a reusable single-video page that shows route-specific related content without manually authoring collection items per video.

## Entry Points — Read These First

1. `apps/web/src/lib/content.ts` — generic single-video route resolution and route-video normalization
2. `apps/web/src/components/sections/MediaCollection.tsx` — media collection runtime rendering
3. `apps/web/src/lib/enrichment.ts` — shared card item normalization
4. `apps/cms/src/components/sections/media-collection.json` — CMS media collection block contract
5. `apps/cms/src/api/video/content-types/video/schema.json` — curated `Video.children` relation

## What To Build

1. Add an explicit `MediaCollection` source mode so editors can choose manual items or route-video children.
2. Extend generic single-video route data to include normalized related child videos from `Video.children`.
3. Let `MediaCollection` render route-derived items when configured for that source, including nested render paths (`Section` and `Container`).
4. Keep manual collections unchanged and fail soft when the current route video has no related children.

## Verification

- `pnpm --filter @forge/graphql generate`
- `pnpm --filter @forge/cms build`
- `pnpm --filter @forge/cms typecheck`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web build`
- Manual smoke:
  - configure the single-video template with a route-driven media collection
  - verify at least two generic `/watch/[slug]` routes show different related items
  - verify a normal manual media collection remains unchanged

## Completion Notes

- Added `ComponentSectionsMediaCollection.itemsSource` with `manual` default and `routeVideoChildren` opt-in mode.
- Extended generic single-video route normalization to pass route-derived related items into `MediaCollection`.
- Verified local QA against `/watch/jesus` and `/watch/my-last-day`, which rendered different related card sets, while `/watch/christmas` kept its authored manual collection unchanged.
