---
title: "YTM-002 Admin Flat Catalog Projection"
type: feat
status: completed
date: 2026-06-09
origin: apps/yt-video-mapper-backend/docs/brainstorms/video-source-mapper-requirements.md
---

# YTM-002 Admin Flat Catalog Projection

## Summary

Add a non-public Admin GraphQL query that lets the yt-video-mapper page through a bounded, flat `VideoDub`-level catalog projection. The projection supplies Core-facing `coreId` and `videoVariantId` identifiers, source titles, Admin debug IDs, language/edition/duration/media fields, and explicit indexability state without traversing every nested video relation.

## Problem Frame

YTM-001 deployed the mapper backend and created mapper-owned `CatalogVideo` and `CatalogVariant` tables. YTM-003 needs to sync those tables from Admin, but using existing `Video { dubs { downloads ... } }` shapes would repeat the unbounded relation fan-out documented in `docs/solutions/design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md`. This slice creates the Admin-side sync contract only; the mapper sync job remains deferred to YTM-003.

## Requirements

- R1. Expose an Admin GraphQL root query for mapper catalog sync that is gated by a dedicated service-readable permission, not `public`.
- R2. Page by `VideoDub` rows, using stable cursor ordering and a bounded page size.
- R3. Return a flat row shape containing `Video.coreId`, selected source title, `VideoDub.coreId` as `videoVariantId`, Admin video/dub IDs, language, locale, edition, duration, and media source URL fields.
- R4. Include published, deleted, no-index, media availability, and computed `indexable` state so the mapper can skip or mark bad variants.
- R5. Avoid all-video/all-dub nested relation fan-out; the service must select only per-row bounded fields needed by the mapper.
- R6. Cover pagination and mapper-required field mapping in tests runnable by `pnpm --filter @forge/admin test video-mapper-catalog`.
- R7. Regenerate `apps/admin/schema.graphql` and `packages/admin-graphql` outputs after the schema change.

## Key Technical Decisions

- KTD1. **Cursor over `VideoDub.id`:** Use `VideoDub` as the variant-level sync unit and order by `video_dub.id ASC`. The cursor is opaque to callers and decodes to the last seen dub ID, making the next page a simple `id > cursor` scan.
- KTD2. **Manual connection envelope:** Define explicit `VideoMapperCatalogConnection`, `VideoMapperCatalogPageInfo`, and row objectRefs instead of introducing a new Pothos connection plugin. Admin has no existing connection helper, and this query only needs forward sync pagination.
- KTD3. **Service-owned flat projection:** Put selection, cursor normalization, page-size clamping, media priority, and indexability computation in `apps/admin/src/services/video.service.ts`. The resolver should only pass `first` and `after`.
- KTD4. **Raw SQL with lateral one-row lookups:** Prefer a single service query with `LEFT JOIN LATERAL ... LIMIT 1` for selected source title and selected download URL. This keeps title/download lookups bounded per dub without hydrating nested Prisma graphs.
- KTD5. **Dedicated mapper catalog permission:** Gate the query with `authScopes: { hasPermission: "read:video-mapper-catalog" }`. Human ADMINs satisfy the key through the editorial ladder; the mapper satisfies it through a dedicated `VIDEO_MAPPER` bearer principal backed by Admin's optional `VIDEO_MAPPER_ADMIN_API_KEYS` receiver CSV. This avoids letting VIEWER-tier users or generic `WORKFLOW_TRIGGER` bearers page whole-catalog media URLs.

## Scope Boundaries

- This plan does not implement mapper-side GraphQL fetching, catalog upserts, sync-run counters, or missing-row reconciliation; those remain YTM-003.
- This plan does not index official media signatures; that remains YTM-004.
- The projection should expose selected media URLs and a primary media source, not every subtitle, scene, transcript, image, or nested download relation. `shareUrl` is diagnostic/operational context only; the mapper's deployed media enum supports `DOWNLOAD`, `HLS`, `DASH`, and `NONE`, so share-only variants remain non-indexable until a later mapper schema slice adds first-class share support.
- The query may include soft-deleted or otherwise non-indexable variants when needed for state reconciliation, but it must mark them as non-indexable and keep the row shape flat.

## Implementation Units

### U1. Add Mapper Catalog Service Projection

- **Goal:** Add service-layer cursor pagination and flat row mapping over `VideoDub`.
- **Files:** Modify `apps/admin/src/services/video.service.ts`; add `apps/admin/src/services/video-mapper-catalog.test.ts` or equivalent Admin test file matched by `video-mapper-catalog`.
- **Patterns:** Follow `VideoService.getByCoreIds` for service-owned raw SQL, statement-free projection mapping, and SQL-shape tests; follow `apps/yt-video-mapper-backend/prisma/schema.prisma` for target field names.
- **Approach:** Add exported row/envelope types, a bounded `VIDEO_MAPPER_CATALOG_MAX_PAGE_SIZE`, cursor encode/decode helpers, and `listMapperCatalogVariants({ first, after })`. Query `video_dub` joined to parent `video`, `language`, `video_edition`, and bounded lateral selected title/download rows. Compute `mediaSourceType`, `mediaSourceUrl`, `indexable`, and `nonIndexableReason` in the service output.
- **Test Scenarios:** Verify page-size bounding and `take + 1` behavior; verify `endCursor` and `hasNextPage`; verify using an `after` cursor advances by `VideoDub.id`; verify returned rows include `coreId`, `videoVariantId`, Admin IDs, language/locale, edition, duration, selected media URLs, and indexability fields; verify SQL does not call `prisma.video.findMany` or nested relation loading.
- **Verification:** `pnpm --filter @forge/admin test video-mapper-catalog`.

### U2. Expose GraphQL Query and Regenerate Outputs

- **Goal:** Register the Admin GraphQL query and generated contracts.
- **Files:** Modify `apps/admin/src/graphql/types/video.ts`, `apps/admin/src/graphql/schema.test.ts`, `apps/admin/schema.graphql`, and `packages/admin-graphql/src/admin-graphql-env.d.ts`.
- **Patterns:** Follow `VideoForEnrichmentRef` in `apps/admin/src/graphql/types/video.ts` for objectRef projection types and `videosByCoreIds` for service-mediated, permission-gated root queries.
- **Approach:** Add `VideoMapperCatalogItem`, `VideoMapperCatalogPageInfo`, and `VideoMapperCatalogConnection` objectRefs. Add a root query such as `videoMapperCatalog(first: Int, after: String)` returning the connection and resolving through `ctx.services.video.listMapperCatalogVariants`.
- **Test Scenarios:** Verify the Query root exposes the new field; verify the mapper row type exposes required non-null IDs and nullable operational fields with expected names; verify the field is not added to the public resolver manifest because it is intentionally non-public.
- **Verification:** `pnpm --filter @forge/admin test video-mapper-catalog`; `pnpm --filter @forge/admin schema:print`; `pnpm --filter @forge/admin-graphql generate`; `pnpm --filter @forge/admin-graphql typecheck`.

## Risks & Dependencies

- RISK1. The selected title rule can affect operator readability in mapper logs. Prefer a published title when present, then a deterministic fallback, and expose `sourceTitleLocale` so the mapper can store provenance.
- RISK2. Media source priority affects later indexing. Prefer a downloadable URL when present, then HLS, then DASH. Expose `shareUrl` separately for diagnostics, but do not use it as `mediaSourceUrl` in YTM-002 because the mapper's deployed `MediaSourceType` enum has no `SHARE` value.
- RISK3. A non-public query must not accidentally appear in `INTENDED_PUBLIC_RESOLVERS`; schema tests should assert the field exists, while public resolver tests should remain unchanged.

## Sources / Research

- `docs/prototypes/yt-video-mapper/tickets/ytm-002-admin-flat-catalog-projection.md`
- `docs/prototypes/yt-video-mapper/tickets/ytm-003-mapper-catalog-sync.md`
- `apps/yt-video-mapper-backend/docs/brainstorms/video-source-mapper-requirements.md`
- `apps/yt-video-mapper-backend/prisma/schema.prisma`
- `docs/solutions/design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md`
- `apps/admin/src/graphql/types/video.ts`
- `apps/admin/src/services/video.service.ts`
