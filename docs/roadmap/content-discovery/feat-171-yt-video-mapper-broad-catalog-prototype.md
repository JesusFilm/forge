---
id: "feat-171"
title: "YouTube video mapper broad-catalog prototype"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-06-08"
duration: 10
depends_on:
  - "feat-170"
blocks: []
tags:
  - "content-discovery"
  - "video"
  - "analytics"
  - "backend"
  - "matching"
---

## Problem

Analytics needs the mapper backend to process a broad Forge/Admin catalog,
maintain a Core ID title map, index official media into compact signatures, and
return ranked Core-facing candidates for uploaded external videos.

## Entry Points - Read These First

1. `apps/yt-video-mapper-backend/docs/brainstorms/video-source-mapper-requirements.md`
   - product scope, candidate response shape, retrieval strategy, and v1
     boundaries.
2. `docs/plans/2026-06-08-001-feat-yt-video-mapper-broad-catalog-prototype-plan.md`
   - implementation sequencing and technical decisions.
3. `apps/yt-video-mapper-backend/src/server.ts`
   - current placeholder backend surface.
4. `apps/admin/src/graphql/types/video.ts`
   - current Admin video/dub GraphQL contract.
5. `apps/admin/prisma/schema.prisma`
   - `Video`, `VideoDub`, `VideoEdition`, `VideoSubtitle`, and embedding
     storage patterns.

## Grep These

```bash
rg -n "VideoDub|VideoEdition|VideoSubtitle|videosByCoreIds|dubs" apps/admin/src/graphql apps/admin/src/services
rg -n "yt-video-mapper|MatchResponse|coreId|videoVariantId|signature|catalog" apps/yt-video-mapper-backend
rg -n "scene embedding|transcript embedding|VideoScene|VideoTranscript" apps/admin/src apps/admin/prisma/schema.prisma
```

## What To Build

1. Add a bounded flat Admin mapper catalog projection that pages by Dub rows and
   exposes Core-facing video, variant, title, language, edition, duration, and
   media-source fields.
2. Add a mapper-owned Prisma schema for catalog maps, variants, index runs,
   signatures, match jobs, candidates, and internal evidence.
3. Add broad catalog sync that populates a `coreId` + title map and variant rows
   from Admin.
4. Add official media indexing that stores compact timecoded signatures and
   records per-variant failures.
5. Replace the placeholder matcher with async upload jobs, polling, staged
   retrieval, fusion scoring, and ranked candidates.
6. Add a validation harness for labeled uploaded samples.

## Constraints

- Do not call Core directly from the mapper.
- Do not import Admin app code from the mapper.
- Do not use nested all-video/all-dub GraphQL relation fan-out for broad catalog
  sync.
- Do not expose internal evidence in the public v1 response.
- Do not store raw uploaded videos long-term by default.
- Defer model-assisted video comparison.

## Verification

```bash
pnpm --filter @forge/admin test video-mapper-catalog
pnpm --filter @forge/admin schema:print
pnpm --filter @forge/admin-graphql generate
pnpm --filter @forge/admin-graphql typecheck
pnpm --filter @forge/yt-video-mapper-backend lint
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
pnpm --filter @forge/yt-video-mapper-backend build
```
