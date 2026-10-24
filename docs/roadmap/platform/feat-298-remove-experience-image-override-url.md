---
id: "feat-298"
title: "Remove Experience image override URL fields"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "mobile"
  - "tv"
  - "media"
---

## Problem

Experience media collection and video carousel items kept a parallel
`imageOverrideUrl` field family alongside normal `imageUrl` / `imageAssetId`
fields. That duplicate path made Watch home data harder to reason about and let
real media assets appear as opaque override URLs instead of associated assets.

## Entry Points

1. `apps/admin/src/domain/blocks.ts` — persisted block validation.
2. `apps/admin/src/graphql/types/blocks.ts` — public block GraphQL contract.
3. `packages/admin-graphql/src/fragments/blocks/*` — shared consumer fragments.
4. `apps/web/src/lib/enrichment.ts` and `apps/web/src/lib/watch-home.ts` — Watch
   home authored image resolution.
5. `apps/mobile/src/lib/watchHome/experienceAdapter.ts` and
   `apps/tv/src/lib/watchHome/experienceAdapter.ts` — native Watch home
   adapters.
6. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — editor
   media picker writes.

## What Changed

1. Removed `imageOverrideUrl`, `imageOverrideAssetId`,
   `imageOverrideBlurDataUrl`, and `imageOverrideDominantColor` from block
   schemas, GraphQL types, fragments, generated introspection, and app
   consumers.
2. Routed authored item images through the normal `imageUrl` / `imageAssetId`
   fields.
3. Removed the mobile-only helper that rewrote legacy seed override URLs.
4. Migrated local `watch-home` Experience block JSON from
   `imageOverrideAssetId` to `imageAssetId` and deleted the old override keys.
5. Added a production-safe dry-run/execute backfill for persisted
   `ExperienceLocale.blocks` JSON.
6. Updated focused admin, web, mobile, and TV tests to protect the new contract.

## Verification

- `pnpm --filter @forge/admin test -- domain/blocks.test.ts media-asset.service.test.ts graphql/types/blocks.test.ts experience-ai-normalize.test.ts experience-ai-exemplar-outline.test.ts experience-editor.test.tsx block-helpers.test.ts`
- `pnpm --filter @forge/web test -- enrichment.test.ts watch-home.test.ts MediaCollection.test.tsx CarouselVideo.test.tsx`
- `pnpm --filter @forge/mobile test -- experienceAdapter.test.ts`
- `pnpm --filter @forge/tv test -- experienceHydration.test.ts experienceAdapter.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/web exec next typegen && pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/mobile typecheck`
- `pnpm --filter @forge/tv typecheck`
- `pnpm --filter @forge/admin lint --max-warnings=0 && pnpm --filter @forge/web lint --max-warnings=0 && pnpm --filter @forge/mobile lint --max-warnings=0 && pnpm --filter @forge/tv lint --max-warnings=0`
- `pnpm run format:check`
- `pnpm turbo run schema:print --filter=@forge/admin`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/admin backfill:experience-image-override-fields`
