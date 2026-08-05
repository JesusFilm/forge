# Typesense Watch Search Local Comparison

This experiment runs the current PostgreSQL Watch Search and the parallel
Typesense backend against the same production-like data. It does not switch Web
traffic or provision production infrastructure. The catalog remains
viewer-safe; the transcript index retains the broad native embedding corpus and
marks every chunk with `publiclyVisible`.

This guide is optional for small developer experiments. Do not run the
production-sized 280,107-vector corpus on a developer workstation; perform that
capacity and relevance run on the isolated `@forge/admin/search` shadow service
after the normal PR merge.

## Prerequisites

- Node and pnpm versions required by the repository
- PostgreSQL client/server tools with pgvector and pg_trgm
- Railway CLI authentication for downloading the approved snapshot
- Admin query-embedding provider variables for semantic benchmark queries

## Start Typesense

The helper downloads the pinned ARM64 or AMD64 Typesense binary into `.tmp`,
stores all data locally, and is safe to run repeatedly.

```bash
scripts/typesense-watch-search-local.sh start
scripts/typesense-watch-search-local.sh status
```

The default runtime contract is:

```text
TYPESENSE_HOST=http://127.0.0.1:8108
TYPESENSE_API_KEY=forge-typesense-local-key
```

## Prepare PostgreSQL

Create a local database, apply Admin migrations, then restore the latest
`video-search` backup through the existing reviewed restore command. The restore
refuses production targets and only replaces the profile's catalog/search
tables.

```bash
DATABASE_URL=postgresql://forge@127.0.0.1:5434/forge_admin_typesense \
  pnpm --filter @forge/admin exec prisma migrate deploy --schema prisma/schema.prisma

TARGET_DATABASE_URL=postgresql://forge@127.0.0.1:5434/forge_admin_typesense \
BACKUP_DOWNLOAD_API_KEY=... \
  pnpm --filter @forge/admin restore:video-db:latest -- \
  --profile=video-search --target-env=development
```

`BACKUP_DOWNLOAD_API_KEY` is one entry from Admin's
`BACKUP_DOWNLOAD_API_KEYS`; do not persist it in the repository. Operators with
direct bucket variables can use the same command with `RAILWAY_S3_*` variables.

## Build Or Refresh The Index

```bash
DATABASE_URL=postgresql://forge@127.0.0.1:5434/forge_admin_typesense \
TYPESENSE_HOST=http://127.0.0.1:8108 \
TYPESENSE_API_KEY=forge-typesense-local-key \
  pnpm --filter @forge/admin index:typesense-watch-search
```

The first run has no transcript alias, so this command bootstraps timestamped
catalog, per-video-language availability, and transcript collections. The
transcript collection is also the native hybrid candidate index: it contains
the stored transcript vectors plus small vectorless video documents used for
title and description matching. Both document kinds carry a canonical video
identity so Typesense can group multilingual and aspect-ratio variants before
returning candidates.

On later runs the command rebuilds catalog and availability, reuses the
physical transcript collection selected by `watch_search_transcripts`, and
upserts only the lightweight video documents. It also PATCHes copied transcript
titles when the catalog title projection changed, including clearing removed
titles; these partial updates never include `embedding`. Stale video documents
are deleted after the upserts finish. Existing transcript vectors are not read,
regenerated, or imported during this routine path.

The command holds a dedicated-session PostgreSQL advisory lock from before the
build starts through alias publication and old-collection retirement. A
concurrent release fails fast instead of racing aliases or cleanup.

Force a new transcript generation only when transcript vectors, visibility,
model dimensions, or the transcript schema need to change:

```bash
DATABASE_URL=postgresql://forge@127.0.0.1:5434/forge_admin_typesense \
TYPESENSE_HOST=http://127.0.0.1:8108 \
TYPESENSE_API_KEY=forge-typesense-local-key \
  pnpm --filter @forge/admin index:typesense-watch-search -- \
  --rebuild-transcripts
```

The CLI rejects unknown or misspelled arguments instead of silently falling
back to transcript reuse.

The native hybrid schema is a one-time transcript-schema upgrade. If the final
JSON reports `hybridReady: false`, the active alias still points at the legacy
vector-only schema. Admin will fall back to the previous catalog-plus-vector
retrieval for compatibility, but the native grouped path remains degraded.
Run one deliberate `--rebuild-transcripts` on the isolated search service to
import the embeddings already stored in PostgreSQL and activate the new
schema. Do not add this flag to routine application deploys.

Every collection that is built is imported with checked JSONL responses before
its stable alias moves. A failed routine refresh restores the catalog and
availability aliases and restores the previous vectorless video documents in
the reused transcript collection. It also restores any copied transcript title
projections patched by the failed run. It never moves or deletes that collection.
A failed explicit transcript rebuild also restores the transcript
alias. After a successful publication, the indexer deletes older and orphaned
Watch Search physical collections that existed before the run, retaining only
the active catalog, availability, and transcript collections. This bounds RAM
instead of keeping duplicate vector generations; rollback remains the unchanged
`DEFAULT` PostgreSQL backend or a manual transcript rebuild, not an inactive
Typesense generation. The enriched transcript schema remains compatible with
the previous vector-only Admin query, so application rollback does not require
an index rebuild. The final JSON object reports `transcriptReused`,
`hybridReady`, the number of vectorless `videoDocuments`,
`retiredCollections`, any `retirementFailures`, the selected physical
transcript collection, catalog, availability, and transcript counts plus
`estimatedVectorMemoryBytes`, calculated as 7 bytes times 1,536 dimensions
times the accepted transcript document count. Capture
Typesense's measured memory after the build as well:

```bash
curl -fsS \
  -H 'X-TYPESENSE-API-KEY: forge-typesense-local-key' \
  http://127.0.0.1:8108/metrics.json
```

For the audited 2026-08-04 production corpus, expect approximately 1,175
catalog documents, 176,294 availability documents, and 280,107 transcript
documents. Public Watch Search does
not expose the whole transcript collection: its hybrid request includes
`publiclyVisible:=true`, limits transcript documents to resolved evidence
languages, and groups by `canonicalVideoId` with `group_limit: 3`. The bounded
group keeps enough physical editions to select a playable locale match during
hydration; the API still emits only one result per canonical video. Confirm
both the broad count and the public subset before treating the build as valid.
Also record the availability count and verify that one video/language document
merges audio and subtitle flags while retaining the selected playback ID and
duration. Do not benchmark the optimized path until
`watch_search_availability` points to the completed generation; the temporary
missing-alias path intentionally performs a second legacy catalog request.

## Compare Backends

Load the same query-embedding provider variables used by Admin, then run:

```bash
DATABASE_URL=postgresql://forge@127.0.0.1:5434/forge_admin_typesense \
TYPESENSE_HOST=http://127.0.0.1:8108 \
TYPESENSE_API_KEY=forge-typesense-local-key \
WATCH_SEARCH_BENCHMARK_RUNS=5 \
  pnpm --filter @forge/admin benchmark:watch-search-backends \
  > .tmp/typesense-watch-search/benchmark.json
```

The benchmark warms both engines once per case, alternates execution order, and
reports wall-clock p50/p95, result count, degradation, top-five results, and
top-ten Jaccard overlap. Its fixed cases cover French `communion`, English exact
title and generic-care queries, Spanish forgiveness, and French grief.

To select the local backend through GraphQL, keep the existing query and add the
optional mode:

```graphql
query CompareWatchSearch($input: WatchSearchInput!) {
  watchSearch(input: $input) {
    searchMode
    latencyMs
    results {
      id
      title
    }
  }
}
```

```json
{
  "input": {
    "query": "communion",
    "targetLanguageSlug": "french",
    "mode": "MODERN"
  }
}
```

Omit `mode` or send `DEFAULT` to use PostgreSQL. `MODERN` fails explicitly when
Typesense is not configured, so comparison runs cannot silently measure the
wrong backend.

## Recorded Baseline

The 2026-08-03 first-pass snapshot contained 1,107 viewer-visible catalog
documents and 17,118 public transcript vectors. Across five warmed runs of each
of five multilingual cases, the local wall-clock measurements were:

| Backend    |    p50 |    p95 |
| ---------- | -----: | -----: |
| PostgreSQL |  79 ms | 119 ms |
| Typesense  | 158 ms | 257 ms |

French `communion` returned `La communion des croyants` first with target audio;
its Typesense p95 was 168 ms and top-ten overlap with PostgreSQL was 0.80. These
numbers compare local serving architecture, not production network placement.
They predate the exact whole-title ranking correction and the broad
280,107-vector transcript collection. Replace them with the full-corpus shadow
service result before enabling `MODERN` traffic.

For context, a read-only Datadog RUM sample of the latest 100 Forge Web requests
to Admin GraphQL in the preceding 24 hours showed a 1.30 s p50 and 24.82 s p95.
RUM resource events do not include GraphQL POST operation names or bodies, so
that endpoint-wide sample cannot be narrowed to `watchSearch` or a query term.
The operation-specific APM, synchronization, capacity, topology, and rollback
investigation is recorded in
`docs/operations/typesense-watch-search-production-readiness.md`.

## Stop Typesense

```bash
scripts/typesense-watch-search-local.sh stop
```
