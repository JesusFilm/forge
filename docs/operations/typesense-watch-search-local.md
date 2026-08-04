# Typesense Watch Search Local Comparison

This experiment runs the current PostgreSQL Watch Search and the parallel
Typesense backend against the same production-like `video-search` snapshot. It
does not switch Web traffic or provision production infrastructure.

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

## Build The Full Index

```bash
DATABASE_URL=postgresql://forge@127.0.0.1:5434/forge_admin_typesense \
TYPESENSE_HOST=http://127.0.0.1:8108 \
TYPESENSE_API_KEY=forge-typesense-local-key \
  pnpm --filter @forge/admin index:typesense-watch-search
```

The builder creates timestamped physical collections, validates every JSONL
import response, and only then moves the stable aliases. A failed build deletes
its incomplete collections and leaves the previous aliases intact.

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
top-ten Jaccard overlap. Its fixed cases cover French `communion`, an exact
English title, generic semantic discovery, Spanish forgiveness, and French
grief.

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

The 2026-08-03 full snapshot contained 1,107 viewer-visible catalog documents
and 17,118 accepted transcript vectors. Across five warmed runs of each of five
multilingual cases, the local wall-clock measurements were:

| Backend    |    p50 |    p95 |
| ---------- | -----: | -----: |
| PostgreSQL |  79 ms | 119 ms |
| Typesense  | 158 ms | 257 ms |

French `communion` returned `La communion des croyants` first with target audio;
its Typesense p95 was 168 ms and top-ten overlap with PostgreSQL was 0.80. These
numbers compare local serving architecture, not production network placement.

For context, a read-only Datadog RUM sample of the latest 100 Forge Web requests
to Admin GraphQL in the preceding 24 hours showed a 1.30 s p50 and 24.82 s p95.
RUM resource events do not include GraphQL POST operation names or bodies, so
that endpoint-wide sample cannot be narrowed to `watchSearch` or a query term.

## Stop Typesense

```bash
scripts/typesense-watch-search-local.sh stop
```
