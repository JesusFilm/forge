---
title: "Admin mapper catalog projection with narrow bearer access"
date: 2026-06-09
last_updated: 2026-06-09
category: architecture-patterns
module: apps/admin
problem_type: architecture_pattern
component: authentication
severity: medium
applies_when:
  - "An internal service needs to page a broad Admin catalog projection for sync"
  - "The projection includes whole-catalog media URLs or other sensitive operational fields"
  - "A variant-level catalog must avoid nested all-video/all-dub GraphQL fan-out"
  - "Existing bearer principals are either too broad, too narrow, or shared by other callers"
tags:
  - admin-graphql
  - yt-video-mapper
  - bearer-auth
  - cursor-pagination
  - raw-sql
  - catalog-sync
  - rate-limits
  - media-urls
related_components:
  - apps/admin
  - service_object
  - database
  - testing_framework
  - packages/admin-graphql
  - apps/yt-video-mapper-backend
---

# Admin mapper catalog projection with narrow bearer access

## Context

The yt-video-mapper needs a mapper-owned catalog of official Forge/Admin media
records before it can index signatures and attribute uploaded or reuploaded
videos. The Admin side of that contract is not a normal watch query: it needs
to page through many variants, include media source URLs, and expose both the
source `coreId` and the variant-level `videoVariantId`.

The tempting shortcut is to add a nested GraphQL selection under `Video` and
let the mapper ask for every video's dubs, downloads, editions, and language
records. That repeats the same shape that previously caused over-fetching for
large dub sets. The other tempting shortcut is to put the new query behind an
existing metadata permission, but whole-catalog media URLs are a different
surface than one-off metadata lookups.

YTM-002 solved this as a flat, service-mediated `VideoDub` projection with a
dedicated service principal.

## Guidance

Expose catalog sync as a root query over the variant-level entity, not as a
nested relation under every source video.

```graphql
type Query {
  videoMapperCatalog(first: Int, after: String): VideoMapperCatalogConnection!
}
```

The resolver should be thin. Put the projection, cursor validation, page-size
rules, and media-selection logic in a service method such as
`VideoService.listMapperCatalogVariants`.

Use a stable cursor order on the variant table. Keep the first-page and
cursor-page SQL shapes separate so later pages get a clean index range instead
of a nullable `OR` predicate:

```text
-- first page
ORDER BY video_dub.id ASC LIMIT pageSize + 1

-- cursor page
WHERE video_dub.id > afterId
ORDER BY video_dub.id ASC LIMIT pageSize + 1
```

Validate well-formed cursors before running the page query. An unknown
`VideoDub.id` cursor should fail as an invalid cursor instead of silently
becoming a query from the beginning or an arbitrary lower bound. Keep the page
size bounded with a conservative default and a hard maximum.

Project only fields the mapper needs:

- `Video.coreId` as `coreId`
- source title and title locale for the mapper's `coreId + title` map
- `VideoDub.coreId` as `videoVariantId`
- Admin video and dub ids for diagnostics
- language, locale, edition, duration, and selected media source
- published, deleted, no-index, and derived `indexable` state

Prefer one flat SQL projection over Prisma relation fan-out when the shape is
sync-oriented and broad. Compute page-local video metadata once per distinct
video in the page, then join it back to each dub; do not run identical
published/title lookups once per dub for videos with many dubs. A lateral
lookup is still appropriate for selecting the single best download per dub.
Keep those SQL invariants under test by scraping the Prisma tagged template
text: assert the `ORDER BY`, cursor lower bound, `LIMIT`, page-local video CTEs,
lateral download join, and media guards are present.

Wrap the raw catalog query in a read-only transaction that sets
`SET LOCAL statement_timeout`, with a Prisma transaction timeout slightly above
that database timeout. Mapper sync is broad by design; a bad plan should fail
boundedly instead of occupying an Admin connection indefinitely.

Media semantics should be explicit. In YTM-002, the primary source selection is:

1. downloadable HTTP(S) download URL when `VideoDub.downloadable` permits it
2. HLS URL
3. DASH URL
4. `NONE`

Expose `shareUrl` only as diagnostic data unless the downstream mapper enum has
a real `SHARE` value. Do not let a share-only variant become `indexable` by
accident.

Treat broad catalog sync as a separate authorization surface. Add a dedicated
permission and bearer role instead of widening an existing shared principal:

```ts
// apps/admin/src/auth/permissions.ts
const VIDEO_MAPPER_PERMISSIONS = new Set(["read:video-mapper-catalog"])

// apps/admin/src/graphql/types/video.ts
authScopes: {
  hasPermission: "read:video-mapper-catalog"
}
```

Back the bearer with an optional env-CSV keyring such as
`VIDEO_MAPPER_ADMIN_API_KEYS`, timing-safe comparison, boot-time disjointness
across all bearer CSVs, and a distinct rate-limit identity:

```ts
if (ctx.user?.role === "VIDEO_MAPPER") {
  return "service:video-mapper"
}
```

That service identity is intentionally not an editorial tier. It should not
satisfy `VIEWER`, `EDITOR`, workflow-trigger, or consumer-bearer permissions.

Mapper cursor and page-size validation errors should surface as typed GraphQL
`BAD_USER_INPUT` errors, not generic masked production failures. That gives the
mapper a stable signal to reset a cursor or fix its request instead of retrying
an opaque error.

## Why This Matters

A mapper catalog sync reads far more of Admin than a user-facing watch screen
or a one-off workflow lookup. If it is modeled as nested GraphQL relations, the
safe page boundary is the source video while the expensive cardinality lives
under each video. That can still fan out to thousands of dubs and their nested
media records in one page.

Paging directly by `VideoDub` makes the unit of work match the mapper's target
row: one catalog variant. The mapper can upsert `CatalogVideo` by `coreId` and
`CatalogVariant` by `coreId + videoVariantId`, while Admin keeps ownership of
the source of truth.

The dedicated bearer is the other load-bearing piece. Reusing
`read:video-metadata` would couple mapper sync to manager/workflow lookup
permissions and make future changes hard to reason about. A narrow
`VIDEO_MAPPER` principal keeps the catalog surface auditable, independently
rotatable, and separately rate-limited.

## When to Apply

- A service needs to sync a large Admin-owned catalog into its own tables.
- The synced row is naturally a variant, dub, rendition, locale, or other child
  entity rather than the parent entity.
- The projection includes media URLs or operational state not meant for broad
  public or workflow reuse.
- Existing bearer roles are shared by unrelated callers.
- Generated GraphQL outputs are part of the contract and must be regenerated
  with the schema change.

## Examples

Good projection shape:

```text
Query.videoMapperCatalog
  -> VideoService.listMapperCatalogVariants
  -> one row per VideoDub
  -> pageInfo { hasNextPage, startCursor, endCursor }
```

Avoid these shortcuts:

- `videos { dubs { downloads { ... } videoEdition { ... } } }` for broad sync.
- Reusing `read:video-metadata` because it already reaches video fields.
- Letting `WORKFLOW_TRIGGER` or `CONSUMER_BEARER` satisfy catalog sync.
- Treating malformed or unknown cursors as empty pages.
- Selecting `shareUrl` as a primary media source before the mapper models
  share URLs as an indexable source type.

Tests should cover both the public contract and the implementation boundary:

- GraphQL source tests for field args, return types, mapper-required fields,
  and `authScopes`. SDL alone does not expose Pothos auth scopes.
- Service tests for pagination, cursor encoding/decoding, page-size bounds,
  required field mapping, and SQL-shape invariants.
- A read-only real-DB integration test against a restored/local Admin database
  so the exact SQL proves it can return real `VideoDub` rows and real media
  branch outcomes without seeding or writing data. Locate branch representatives
  with targeted read-only predicates, then fetch those exact rows through the
  service cursor path; avoid scanning the first N pages and depending on
  incidental row distribution.
  Run it explicitly with:

  ```sh
  DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' VIDEO_MAPPER_CATALOG_DB_TEST=1 pnpm --filter @forge/admin test video-mapper-catalog.db
  ```

  It is skipped unless `VIDEO_MAPPER_CATALOG_DB_TEST=1` is set.

- Auth tests proving the mapper bearer mints `VIDEO_MAPPER`, only grants
  `read:video-mapper-catalog`, stays disjoint from other env CSVs, and uses a
  service-specific rate-limit bucket.
- Codegen verification: `schema:print`, admin-graphql `generate`, and
  admin-graphql `typecheck`.

Review hardening should explicitly cover the parts that are easiest to miss
when the unit tests already pass:

- Broad raw SQL should set a database statement timeout inside the transaction
  and a slightly larger Prisma transaction timeout around it.
- Derived reason values such as `nonIndexableReason` should come from one typed
  literal set, with tests proving the public contract exposes the expected
  values.

## Prior Learnings Applied

- The lean-bulk/lazy per-item GraphQL pattern and Core unbounded relation
  fan-out incident shaped the flat `VideoDub` page boundary.
- The PARITY_BEARER narrow carve-out, CONSUMER_BEARER rate-limit identity, and
  env-CSV credential matrix patterns shaped the dedicated `VIDEO_MAPPER`
  principal, disjoint bearer CSVs, and service-specific rate-limit bucket.
- The Pothos `objectRef` nullability note shaped explicit non-null GraphQL
  fields and schema/codegen verification.
- The raw-SQL invariant assertion note shaped tests that lock cursor ordering,
  media-branch CASE literals, CTEs, lateral download selection, and media
  guards.

## Related

- [Lean-bulk list query + lazy per-item heavy fetch for over-fetched relations](../design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md)
- [Core GraphQL unbounded relation fan-out](../platform/core-graphql-unbounded-relation-fan-out-20260504.md)
- [PARITY_BEARER narrow-carve-out pattern](./parity-bearer-narrow-carveout-pattern-20260513.md)
- [CONSUMER_BEARER identity-for-rate-limiting pattern](./consumer-bearer-rate-limit-identity-pattern-20260513.md)
- [DB-backed vs env-CSV credential storage](./db-backed-vs-env-csv-credential-storage-20260518.md)
- [Pothos `objectRef`-based fields default to NULLABLE](../graphql/pothos-objectref-fields-default-nullable-20260518.md)
- [Assert Prisma raw-SQL invariants by scraping the tagged-template text](../best-practices/prisma-raw-sql-invariant-assertions-20260423.md)
- [yt-video-mapper backend app durable match job upload poll process pattern](../platform/yt-video-mapper-backend-app-durable-match-job-upload-poll-process-pattern.md)
