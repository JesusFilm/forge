---
title: "Mapper Admin catalog sync local projection pattern"
date: 2026-06-10
category: architecture-patterns
module: "apps/yt-video-mapper-backend, packages/admin-graphql"
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - "A service needs to sync Admin-owned catalog data into local matcher/index tables"
  - "The source catalog is exposed as a bounded GraphQL projection rather than direct database access"
  - "Rows must be idempotently keyed by source identity plus variant identity"
  - "Failed pages or malformed rows need retry-safe diagnostics without leaking secrets or large media payloads"
tags:
  - admin-graphql
  - catalog-sync
  - local-projection
  - node-next
  - prisma
  - yt-video-mapper
related_components:
  - apps/admin
  - apps/yt-video-mapper-backend
  - packages/admin-graphql
  - database
---

# Mapper Admin catalog sync local projection pattern

## Context

YTM-002 established an Admin-owned `videoMapperCatalog(first, after)` GraphQL
projection for broad yt-video-mapper catalog reads. YTM-003 consumed that
projection inside `apps/yt-video-mapper-backend` and populated mapper-owned
`CatalogVideo`, `CatalogVariant`, and `CatalogSyncRun` rows for local matching
and future signature indexing.

The tempting shortcuts are to read Admin's database directly, hard-delete local
rows that disappear from a page sequence, or define a one-off GraphQL string in
the mapper. Those shortcuts weaken source-of-truth ownership, make retries
destructive, and bypass the shared Admin GraphQL contract package.

## Guidance

Keep the mapper sync as service-layer code with three boundaries:

1. A small Admin GraphQL HTTP client that sends the service bearer, calls only
   `videoMapperCatalog(first, after)`, validates the response envelope, and
   normalizes failures into safe summaries.
2. A catalog sync service that owns page traversal, per-page row validation,
   idempotent upserts, counters, cursor persistence, and terminal run status.
3. A repository boundary that adapts those sync decisions to Prisma writes.

Use Admin GraphQL as the only catalog source. The mapper tables are a local
projection for matching, not a replacement catalog. Upsert source videos by
`coreId`, and upsert variants by the Core-facing composite identity:

```text
CatalogVideo.coreId
CatalogVariant.coreId + CatalogVariant.videoVariantId
```

Persist Admin's derived indexability state instead of re-deriving it locally.
Store video/dub publication flags, deletion flags, `videoNoIndex`,
`indexable`, and `nonIndexableReason` on the variant row. When a completed
snapshot does not include a previously synced variant, mark it non-indexable
with a local missing reason instead of deleting it. That preserves later
candidate/evidence foreign keys and keeps the row inspectable.

Record sync runs as first-class state. Update the run cursor and counters after
each successful page so a failed later page leaves enough context to retry or
diagnose. Failure summaries should include a code, message, cursor, page index,
and bounded malformed-row identifiers such as `coreId`, `videoVariantId`, and
Admin dub id. Do not store bearer tokens, request headers, full row payloads, or
bulk media URLs in the failure summary.

Consumer apps should define Admin operations with `@forge/admin-graphql`, even
for backend scripts or workers. In NodeNext consumers, the shared package must
expose NodeNext-compatible `.js` internal re-exports so importing the public
entrypoint does not make TypeScript fail on extensionless source imports.

```ts
import { adminGraphql } from "@forge/admin-graphql"
import { print } from "graphql"

const VIDEO_MAPPER_CATALOG = adminGraphql(`
  query VideoMapperCatalog($first: Int, $after: String) {
    videoMapperCatalog(first: $first, after: $after) {
      nodes {
        coreId
        videoVariantId
        indexable
        nonIndexableReason
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`)

const body = JSON.stringify({
  query: print(VIDEO_MAPPER_CATALOG),
  variables: { first, ...(after ? { after } : {}) },
})
```

## Why This Matters

Broad catalog sync is a boundary between two ownership models. Admin owns
editorial and Core-synced truth; the mapper owns matching state, retry state,
and local indexes. Keeping the boundary GraphQL-only avoids coupling the mapper
to Admin's database schema while still giving YTM-004 a queryable local map of
`coreId`, title, and variant media state.

Non-destructive sync also matters because future match results and evidence
will reference variants by composite identity. Hard-deleting a variant because
it is currently deleted, unpublished, no-index, media-missing, or absent from a
later snapshot would erase diagnostic context and can break referential
integrity. Marking it non-indexable preserves history while making indexers
skip it.

Typed Admin GraphQL operations close the contract loop. The mapper can stay a
small backend app, but it still benefits from the shared generated
introspection and catches field drift during typecheck instead of discovering
it in a long-running production sync.

## When to Apply

- A backend service needs a local projection of Admin-owned catalog data for
  matching, indexing, analytics, or search.
- The source projection pages a child or variant entity and local rows need
  idempotent upserts.
- The consumer needs operational run state with page cursors, counters, and
  safe failure summaries.
- The consumer uses NodeNext TypeScript and imports shared GraphQL document
  helpers from a package authored with bundler-style module resolution.

## Examples

Good sync shape:

```text
sync run starts
  fetch Admin GraphQL page
  validate page envelope and row identities
  upsert unique CatalogVideo rows by coreId
  upsert CatalogVariant rows by coreId + videoVariantId
  persist cursor and counters
repeat until hasNextPage=false
mark older local variants non-indexable as missing_from_admin
complete run
```

Avoid these shortcuts:

- Reading Admin tables directly from the mapper database connection.
- Keying local variants only by `videoVariantId` when future evidence joins
  need the parent `coreId` too.
- Treating deleted, unpublished, no-index, or missing variants as hard deletes.
- Storing raw GraphQL payloads, request headers, bearer tokens, or long media
  URL lists in failure summaries.
- Defining Admin GraphQL operations as untyped local strings when
  `@forge/admin-graphql` already exposes generated Admin introspection.

Tests should cover both the protocol edge and the local projection edge:

- Admin pagination variables and bearer header behavior.
- Safe GraphQL, HTTP, and malformed-response errors.
- Repeated syncs updating existing rows without increasing row counts.
- Indexable and non-indexable state mapping from Admin to local variants.
- Failed page summaries preserving the last successful cursor.
- Malformed-row summaries that include bounded identifiers but omit payloads.
- Completed snapshots marking missing variants non-indexable without deletion.
- NodeNext consumer typecheck against `@forge/admin-graphql`.

## Related

- [Admin mapper catalog projection with narrow bearer access](./admin-mapper-catalog-projection-narrow-bearer-pattern-20260609.md)
- [yt-video-mapper backend app durable match job upload poll process pattern](../platform/yt-video-mapper-backend-app-durable-match-job-upload-poll-process-pattern.md)
- [Dual client gql.tada multi-schema codegen pattern](./dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md)
- [Mobile admin data-layer cutover pattern](./mobile-admin-data-layer-cutover-pattern-20260525.md)
- [Mocked-vs-real testing discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
