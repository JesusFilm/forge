---
title: Core GraphQL unbounded relation fan-out crashes deep selections
date: 2026-05-04
last_updated: 2026-05-04
category: integration-issues
module: apps/admin
problem_type: outage
component: graphql_resolver
severity: high
scope: platform
applies_when:
  - Querying Core via `videos { variants { downloads, muxVideo, videoEdition }}`
    or any `Video.variants` walk that does not constrain `take`.
  - Adding a new Core sync phase that fetches a relation-heavy nested entity.
  - Diagnosing a Core 200 OK response carrying `{ "errors": [{ "message":
    "Unexpected error.", "extensions": { "code": "INTERNAL_SERVER_ERROR" }}] }`
    after ~50 seconds.
tags:
  - admin
  - core-api
  - core-sync
  - graphql
  - pothos
  - prisma
  - postgres
  - statement-timeout
  - hive-gateway
  - n-plus-one
related:
  - docs/solutions/platform/admin-core-sync-entity-coverage.md
  - docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md
  - docs/solutions/cms/core-sync-incremental-delta-sync.md
  - docs/solutions/cms/core-sync-per-page-upsert-pattern.md
  - docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md
  - docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md
  - docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md
  - docs/solutions/database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md
---

# Core GraphQL unbounded relation fan-out crashes deep selections

## Symptom

Core's gateway (`api-gateway.central.jesusfilm.org`) returns HTTP 200 with
the following error envelope after ~50 s on deeper-than-trivial nested
selections against `Query.videos`:

```json
{
  "errors": [
    {
      "message": "Unexpected error.",
      "path": ["videos"],
      "extensions": { "code": "INTERNAL_SERVER_ERROR" }
    }
  ]
}
```

The message is the Apollo / Hive Gateway catch-all wrapper for any
unhandled exception in the resolver pipeline; in production the real
exception is stripped before reaching the client. The `path: ["videos"]`
attribution narrows it to the top-level resolver, not a per-row failure.

`apps/admin`'s Core sync `video-dubs` phase hit this exact shape on every
full sync attempt during 2026-05-03 / 2026-05-04: only the first ~125
videos' dubs were synced before the loop aborted on a `coreQuery` rejection
that the orchestrator surfaced as `core-sync.phase.error`.

## Diagnostic probe

Five queries run sequentially from the admin devcontainer against the same
Core endpoint with the same auth token disambiguate the failure mode:

| Probe                                                                                        | Result   | Wall time  |
| -------------------------------------------------------------------------------------------- | -------- | ---------- |
| `videos(limit:1, where:{ids:["1_jf6101-0-0"]}){ id }`                                        | ok       | 1.0 s      |
| `videoVariants(limit:1){ id }`                                                               | ok       | 1.4 s      |
| `languages(limit:1){ id }`                                                                   | ok       | 0.2 s      |
| `videos(limit:5, where:{ids:[…5 jf_*…]}){ id variants { id }}`                               | ok       | 0.2 s      |
| `videos(limit:25, where:{ids:[…25 jfNNNN…]}){ id variants { id muxVideo{id} downloads{id}}}` | **fail** | **50.4 s** |

Three things this rules out and one it isolates:

- **Auth / IP / quota:** small queries land sub-second, so it is not a
  rate limit, not a per-IP block, not an auth regression.
- **Specific videoIds:** the same IDs that failed inside a 25-batch
  succeed inside a 5-batch — no poison-pill data at the boundary.
- **Resolver wedged for our identity:** the 1-ID `videos` query and a
  1-row `videoVariants` query both work concurrently with the failing
  25-batch, so Core's resolver is healthy in general.
- The 50.4 s wall time + identical recurrence on retry pin the failure
  on a **server-side execution timeout** when result-set serialization
  exceeds Postgres's `statement_timeout` budget.

## Root cause (Core-side)

Core's `Query.videos` is a Pothos `t.prismaField` whose `Video.variants`
relation has no `take` cap. The Pothos Prisma plugin collapses the entire
GraphQL selection set into a single nested-include `prisma.video.findMany`
graph:

```ts
prisma.video.findMany({
  where: { id: { in: [...25 ids...] }, published: true, … },
  take: 25,
  include: {
    variants: {
      where: { published: true },        // ← NO take, NO skip
      include: {
        muxVideo: true,
        downloads: true,                 // ← NO take
        videoEdition: true,
      },
    },
  },
})
```

For a typical 25-video batch with ordinary cardinality the query returns
quickly. For a batch containing a megavideo like `JFP-Classic` (~2,000
variants × ~5 downloads each) the result set balloons to ~25,000 rows
that Prisma must materialise + Pothos must walk + Apollo must serialise.
On Railway Postgres the work crosses `statement_timeout` (commonly 50 s
in managed PG) and the underlying exception bubbles up into Hive
Gateway, which rewrites it to `"Unexpected error."` because that's
what Apollo does in production.

The Core-side fix recommended by the Core-team agent's analysis is a
default `take: 200` on `Video.variants` (and ideally pagination args on
the field), with a similar cap on `VideoVariant.downloads`. Until that
ships, every consumer of `videos { variants { … }}` is exposed to the
same wall.

## Why this matters beyond dubs

Any admin code path that reaches into a Core relation with unbounded
cardinality is exposed to this same failure mode. Today's risks include
`Video.subtitles`, `Video.keywords`, `VideoEdition.subtitles`, and any
future per-video fan-out the embed pipeline or scene catalogue might
introduce. The closest in-repo precedent is the Strapi-side analogue at
`docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`
(silent truncation of nested relations to a default page size + per-parent
N+1 fan-out); the Strapi case truncates silently while Core's case
crashes loudly, but the design lesson is identical: never compose
unbounded nested includes against an upstream you do not control.

## Client-side mitigation

Three changes together unblock dub sync without waiting for Core:

1. **Use Core's flat top-level paginated query** (`videoVariants(offset,
limit, input)`) instead of `videos { variants { … }}`. The flat shape
   bounds per-page cost by `limit`, not by per-video variant cardinality,
   so a megavideo's variants are spread across multiple pages instead of
   blowing up one nested response.
2. **Pick a `PAGE_SIZE` inside the per-call cost ceiling.** Per the
   probe data above, limit=5 returns in 240 ms, limit=25 times out at
   50.4 s. We picked `PAGE_SIZE = 100` for `videoVariants` because the
   flat query has no per-video include fan-out; the per-row cost is the
   variant + its `muxVideo`/`videoEdition`/`downloads` (~5 downloads
   each). Raise the page size if Core lands a `take` cap on
   `Video.variants` and the flat query starts feeling small.
3. **Wrap the per-page `coreQuery` in try/catch** so a single failing
   page logs `core-sync.video-dub.page.error`, increments `stats.errors`,
   advances `offset`, and continues. Without this, one transient Core
   hiccup mid-pagination kills the entire phase. The existing soft-delete
   safety guard (`!since && stats.errors === 0`) ensures a phase that
   collected page errors does not mass-delete rows from a partial seen
   set.
4. **Soft-delete via array-bound raw SQL.** Once full pagination
   succeeds, the seen-id set can exceed Postgres's 32,767 prepared-
   statement parameter limit (`PG_INT16_MAX`); `prisma.videoDub
.updateMany({ where: { coreId: { notIn: [...seenCoreIds] }}})` then
   throws "too many bind variables in prepared statement". Bind the seen
   set as a single PG array literal cast inline (`NOT (core_id =
ANY(${literal}::text[]))`), via the existing `toPgArray()` helper in
   `apps/admin/src/db/pgvector.ts`.

The combination is implemented in
`apps/admin/src/services/core-sync/phases/sync-dubs.ts`. The same shape
is the right starting template for any future Core sync phase that
fetches a relation-heavy nested entity.

## Validation

A local full sync against the in-container Postgres after the mitigation:

| Metric            | Result                                          |
| ----------------- | ----------------------------------------------- |
| Videos with dubs  | 1,088 / 1,088                                   |
| Total dub rows    | 209,297                                         |
| Page-level errors | 0                                               |
| Wall time         | 2,104 s (~35 min — JFP-Classic alone dominates) |

Pre-mitigation, the same DB consistently capped at 125-175 videos with
dubs before Core's resolver wedge aborted the phase.

## Follow-up

- File the upstream Core issue with the diagnostic probe table and the
  Core-team agent's analysis. The right fix is a `take` cap on
  `Video.variants` (and a pagination arg) plus surfacing the real
  exception text in stage so client teams aren't flying blind on
  `"Unexpected error."`. Owner: nisal.
- Re-evaluate `PAGE_SIZE = 100` once Core ships the cap. With a 200-
  variant ceiling per video the flat query's per-page cost ceiling
  rises, and we can probably use a larger page size to cut total
  request count without re-introducing timeout pressure.
- If a sibling phase (`subtitles`, `keywords`) starts hitting similar
  symptoms after schema growth, apply the same mitigation pattern
  rather than chasing batch-size knobs.
