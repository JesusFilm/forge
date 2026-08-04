---
title: "feat: Watch Search Typesense parallel backend"
type: feat
status: completed
date: 2026-08-03
origin: "docs/roadmap/content-discovery/feat-334-watch-search-typesense-parallel-backend.md"
---

# Watch Search Typesense Parallel Backend

## Problem And Scope

Build a locally runnable, full-dataset Typesense implementation beside the
current PostgreSQL Watch Search. The implementation must preserve transcript
semantic search and produce the current `WatchSearchResponse` contract, while
moving localized metadata and watchability work out of the request path.

The existing `watchSearch` field gains an optional `mode: DEFAULT | MODERN`
input. Omitted or `DEFAULT` preserves the current backend; `MODERN` selects
Typesense while a benchmark script provides explicit comparison.
Production provisioning, traffic switching, continuous synchronization, and Web
UI selection are outside this experiment.

## Requirements Trace

- Full catalog and transcript data: feat-334 items 1-2.
- Semantic retrieval remains first-class: universal search R4, R13, R14.
- Exact metadata matches retain ranking priority: universal search R2.
- Target audio, subtitle, related-language, and unavailable states remain
  explicit: universal search R18, R18a, R22c.
- Public visibility gates and no vector leakage remain enforced: universal
  search R18c and feat-334 constraints.
- Side-by-side latency and relevance evidence: feat-334 items 3-5.

## Architecture Decisions

1. Use two aliased collections. `watch_search_catalog` stores one compact
   document per video with localized metadata and precomputed availability;
   `watch_search_transcripts` stores one document per embedded transcript chunk.
   This avoids repeating card and availability payloads for every chunk.
2. Full rebuilds create timestamped collections and swap stable aliases only
   after every import row succeeds. This follows Typesense's documented
   zero-downtime schema-change and reindex pattern.
3. Use the REST API through a narrow local client. Typesense's official clients
   are thin wrappers, and direct fetch keeps runtime dependencies and error
   behavior explicit.
4. Run lexical and vector retrieval concurrently. Deduplicate semantic chunks
   by video, fuse exact/metadata/semantic candidates, then fetch one bounded set
   of catalog documents from Typesense. PostgreSQL is used only for language
   interpretation and query-embedding cache/provider behavior.
5. Preserve the existing GraphQL output type and route the optional mode at the
   resolver boundary. Existing callers remain on the default backend without a
   client change, while comparison callers opt into `MODERN` explicitly.

## Implementation Units

### U1. Typesense Client And Versioned Schemas

- **Goal:** Provide typed health, collection, alias, import, search, and document
  lookup operations with bounded timeouts and useful failures.
- **Files:** Create `apps/admin/src/services/typesense-client.ts`,
  `apps/admin/src/services/typesense-client.test.ts`, and
  `apps/admin/src/services/typesense-watch-search-schema.ts`.
- **Approach:** Use `fetch`, JSONL bulk import validation, timestamped physical
  collection names, and stable aliases. Define a 1536-dimensional transcript
  vector field and only index fields used for query/filter/rank.
- **Test scenarios:** URL/header construction; timeout and non-2xx failures;
  HTTP-200 partial import failures; schema dimensions; alias swap payload.
- **Verification:** Focused Vitest suite.

### U2. Full Viewer-Safe Index Builder

- **Goal:** Build both collections from the restored Admin snapshot without
  loading all transcript vectors into memory.
- **Files:** Create `apps/admin/src/services/typesense-watch-search-indexer.ts`,
  `apps/admin/src/services/typesense-watch-search-indexer.test.ts`, and
  `apps/admin/src/scripts/index-typesense-watch-search.ts`; modify
  `apps/admin/package.json`.
- **Approach:** Read catalog rows with publication/no-index/deletion gates;
  aggregate localized metadata, images, playable dubs, subtitles, child counts,
  and language fallbacks. Page transcript chunks by stable ID in bounded batches,
  serialize vectors inside PostgreSQL, import JSONL, validate every response,
  and swap aliases only when complete.
- **Test scenarios:** unpublished/no-index exclusion; best dub ordering;
  subtitle edition linkage; empty optional metadata; malformed/wrong-dimension
  vectors; pagination; failed import prevents alias swap.
- **Verification:** Focused Vitest suite plus full local index counts matching
  source viewer-safe rows/chunks.

### U3. Contract-Compatible Search Service And GraphQL Field

- **Goal:** Return `WatchSearchResponse` from Typesense with current language,
  ranking, availability, evidence, pagination, and card fields.
- **Files:** Create `apps/admin/src/services/typesense-watch-search.service.ts`
  and test; modify `apps/admin/src/services/index.ts`,
  `apps/admin/src/graphql/queries/watch-search.ts`, and GraphQL resolver tests.
- **Approach:** Reuse language signal resolution and current query embedding;
  search catalog and transcript aliases concurrently; exact matches outrank
  metadata and semantic candidates; derive watchability from indexed options;
  degrade cleanly when semantic embedding/retrieval fails; expose a parallel
  optional `MODERN` input mode on the existing query field.
- **Test scenarios:** French `communion`; exact outranks semantic; semantic-only
  generic query; target audio/subtitle/related fallback; pagination; semantic
  timeout degradation; Typesense unavailable error; result-type filtering.
- **Verification:** Focused service/resolver tests, Admin typecheck, schema print,
  and Admin GraphQL client generation.

### U4. Local Runtime And Direct Comparison

- **Goal:** Make the full experiment repeatable on a machine without Docker and
  report latency/relevance evidence.
- **Files:** Create `scripts/typesense-watch-search-local.sh`,
  `apps/admin/src/scripts/benchmark-watch-search-backends.ts`, and
  `docs/operations/typesense-watch-search-local.md`; modify root or Admin package
  scripts as appropriate.
- **Approach:** Download a pinned ARM64/AMD64 Typesense binary into `.tmp`, start
  it with local data/API key paths, document local PostgreSQL initialization and
  latest `video-search` restore, run full indexing, and benchmark both services
  over multilingual exact and semantic queries with warmups and repeated runs.
- **Test scenarios:** start/status/stop idempotence; unsupported architecture;
  percentile calculation; overlap calculation; backend failure reporting.
- **Verification:** Run the complete local setup, index full snapshot, execute
  benchmark, and retain a privacy-safe JSON summary under `.tmp`.

## Sequencing And Risks

U1 precedes U2 and U3. U2 and U3 share document contracts and should be executed
serially. U4 follows a working index and service. The largest execution-time
unknowns are snapshot size, Typesense ARM64 binary availability, and memory use
while importing 1536-dimensional vectors; bounded keyset pagination and JSONL
batches address the latter. If local query embedding credentials are absent, the
benchmark may prewarm via the configured production-equivalent provider without
persisting credentials.

## Final Verification

Run focused tests after each unit, then Admin lint/typecheck/schema generation,
`packages/admin-graphql` generation, full local indexing, collection/source count
checks, and repeated side-by-side benchmarks. Review the diff for accidental
vector exposure, production-default routing, or unbounded in-memory operations.
