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

The first run has no transcript alias, so this command bootstraps four
timestamped projections: display catalog, per-video-language availability,
localized lexical metadata, and transcript vectors. The lexical collection has
one document per public physical-video language identity. Forge's unique
`Language.slug` keys and filters the document; BCP-47 remains a tokenization and
negotiation label because multiple languages may share it. Every valid
two-letter base language present in the catalog gets locale-specific searchable
fields (`title_zh`, `metadata_th`, `title_mi`, and so on). Three-letter,
private, and other long-tail tags use generic searchable fields. A normalized
locale identity is used only for legacy rows without a language slug.
Display-only card data remains in the unindexed catalog projection.

On later runs the command rebuilds catalog, availability, and lexical metadata
while reusing the physical collection selected by `watch_search_transcripts`.
It does not upsert vectorless video documents, copy titles into transcript
chunks, read stored vectors, or call an embedding provider. This separation is
what lets routine catalog releases finish without an hour-long 280k-vector
import or a duplicate HNSW generation in memory.

Reuse is allowed only when the active transcript schema contains
`videoEditionId`. If an older alias lacks that field, the command fails before
publishing any catalog, availability, or lexical alias and directs the operator
to rerun with `--rebuild-transcripts`; it never publishes a mixed generation
that cannot preserve edition-scoped subtitle routing.

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

If the final JSON reports `hybridReady: false`, the active alias still points at
a legacy vector-only schema. Admin retains its bounded compatibility path, but
the grouped semantic lane is not release-ready. Run one deliberate
`--rebuild-transcripts` on the isolated search service to import the embeddings
already stored in PostgreSQL and activate the required canonical and visibility
facets. Do not add this flag to routine application deploys, and do not call an
embedding provider during this operation.

Every built collection is imported with checked JSONL responses before its
stable alias moves. A failed routine refresh restores catalog, availability,
and lexical aliases and leaves the reused transcript collection untouched. A
failed explicit transcript rebuild also restores the transcript alias. After a
successful publication, the indexer deletes older and orphaned managed
collections, retaining only the four active projections. This bounds RAM
instead of keeping duplicate vector generations; traffic rollback remains the
unchanged `DEFAULT` PostgreSQL backend and does not depend on an alias move.

The final JSON reports `transcriptReused`, `hybridReady`,
`lexicalDocuments`, `lexicalSearchableBytes`, the 2x/3x keyword RAM estimate,
`retiredCollections`, any `retirementFailures`, all four physical collection
names, transcript/public-transcript counts, and `estimatedVectorMemoryBytes`
(7 bytes × 1,536 dimensions × accepted transcript documents). Capture measured
memory after the build as well:

```bash
curl -fsS \
  -H 'X-TYPESENSE-API-KEY: forge-typesense-local-key' \
  http://127.0.0.1:8108/metrics.json
```

For the audited 2026-08-04 production corpus, expect approximately 1,175
catalog documents, 176,294 availability documents, and 280,107 transcript
documents. The localized lexical count is intentionally higher than the catalog
count and normally equals the number of distinct accepted published
video/language identities. Multiple rows with the same stable language identity
are merged without dropping their searchable text. Capture the count from the
completed metadata refresh rather than assuming one lexical document per video.
Public Watch Search does
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

## Run The Absolute Mastra Evaluation

After the reviewed revision is deployed to the isolated shadow services,
configure Mastra's `ADMIN_SEARCH_EVAL_SEARCH_URL` to Admin's private
`/api/internal/search-eval/search` route and use the registered
`absolute-search-eval` workflow in Mastra Studio. Development is the safe
iterative partition:

```json
{
  "split": "development",
  "backendMode": "modern",
  "searchLimit": 10,
  "runPointwiseJudge": true
}
```

The workflow sends only repository seed queries and public result projections
to the configured pointwise judge. It does not read generated candidates,
trace-derived/raw production queries, repository code, diffs, credentials, or
vectors. It reports success@1/@10, MRR, NDCG@10, language correctness,
canonical duplicates, degradation, full round-trip percentiles, pointwise
usefulness, model/token use, and the exact backend/query-set identity.

The repository judgment set intentionally starts empty and therefore fails the
quality gate. During development, supply a reviewed judgment set with
`querySetVersion: "public-watch-absolute/v2"`; each case maps stable canonical
video IDs to integer relevance grades from 0 through 3. This keeps the real
Studio workflow operable without allowing missing or invented qrels to pass.

Freeze the revision before the one held-out run. Held-out execution refuses to
start without `"acknowledgeHeldOutReleaseGate": true`; baseline promotion also
requires complete relevance judgments, the exact Admin revision and all four
physical Typesense collection names in `candidateIdentity`, and explicit
`operatorReview` with reviewer and notes. The report compares the declared
revision with the revision observed on every response. Obtain collection names
from the checked index-release stats; do not use aliases as the physical
identity. Pairwise agreement with `DEFAULT` remains diagnostic only.

## Stop Typesense

```bash
scripts/typesense-watch-search-local.sh stop
```
