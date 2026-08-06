---
title: "Typesense Watch Search payload projection latency"
date: "2026-08-04"
category: "performance-issues"
module: "apps/admin watch search"
problem_type: "performance_issue"
component: "service_object"
symptoms:
  - "Modern production server p95 remained above 500 ms after the first bounded-hydration change"
  - "Auckland end-to-end p95 reached 800 ms while isolated PostgreSQL and Typesense calls remained sub-second"
  - "Broad exact-title searches were much slower than generic semantic searches"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
tags:
  - "search"
  - "typesense"
  - "latency"
  - "payload"
  - "watchability"
  - "embeddings"
---

# Typesense Watch Search Payload Projection Latency

## Problem

The production Typesense Watch Search experiment initially appeared to have an
approximately 800 ms Typesense problem. That number was the Auckland browser-to-
GraphQL end-to-end p95, not one server operation. It combined WAN and GraphQL
overhead, Admin queueing, language resolution, query embedding, Typesense
retrieval, PostgreSQL watchability reads, response serialization, and occasional
live-replica stalls.

Typesense itself was fast for most queries, but Admin requested large relational
projections while converting candidates into the established public Watch Search
contract. Broad lexical queries amplified that work because they produced a
large preview window before fusion and final-page hydration.

## Symptoms

The production measurements below used five multilingual cases with ten warmed
runs per case and backend on 2026-08-04. `Server` is the `latencyMs` reported by
the Watch Search response. `E2E` is the Auckland probe's full GraphQL request.

| Measurement                       | Before projection fix p50 / p95 | After projection fix p50 / p95 |
| --------------------------------- | ------------------------------: | -----------------------------: |
| Modern public server              |                    191 / 503 ms |                   156 / 373 ms |
| Modern public E2E                 |                    470 / 800 ms |                   410 / 717 ms |
| Modern isolated server            |                    143 / 361 ms |                   142 / 354 ms |
| Modern metadata watchability lane |                    129 / 291 ms |                    97 / 208 ms |

The public run improved, especially in the metadata watchability lane, but the
near-flat isolated result shows that the narrow code fix did not eliminate the
broad-query bottleneck. For `JESUS`, isolated Modern server latency was 339 ms
p50 and 374 ms p95. A Spanish semantic query was only 47 ms p50 and 60 ms p95.

An empty authenticated GraphQL request from Auckland was independently measured
at 247 ms p50 and 366 ms p95. This network and platform floor cannot be removed
by changing the retrieval engine. A separate live request also spent 873 ms
before retrieval began even though isolated language SQL normally completed in
12-14 ms and remained 31-53 ms with 20 concurrent callers. That event is
consistent with transient event-loop, garbage-collection, queueing, or database-
pool delay, but the available trace did not distinguish those causes.

## What Didn't Work

- **Treating the 800 ms p95 as a single Typesense operation.** Typesense engine
  timing, Admin server timing, and browser-to-origin timing are different
  measurements and require separate budgets.
- **Assuming a smaller candidate count also meant a small response projection.**
  A 100-document `JESUS` lexical preview was approximately 1.84 MB. About
  1.32 MB came from `localesJson`, 358 KB from titles, and 215 KB from
  availability slugs. The engine completed that retrieval in roughly 39-44 ms,
  while the private service wall time was 120-126 ms.
- **Reading full catalog metadata for semantic-only preview misses.** The first
  bounded-hydration change still selected titles and localized metadata even
  when the preview only needed IDs and availability languages.
- **Using public p95 movement alone to attribute a code fix.** Public Modern p95
  improved after the fix, but the isolated p95 moved by only about 7 ms. Live
  traffic and replica-tail variance therefore explain part of the apparent
  improvement.
- **Immediately adopting ID-only Typesense results plus PostgreSQL hydration.**
  A first diagnostic of that design was inconclusive. It needs a clean,
  production-shaped benchmark before it can replace the current projection.
- **Trimming fields without changing the document boundary.** The bounded final
  fetch still returned `audioOptionsJson` and `subtitleOptionsJson` for every
  language on every selected video. A paired production trace completed
  `DEFAULT` GraphQL in 156.5 ms and `MODERN` in 213.7 ms; MODERN's final
  Typesense request occupied 92.2 ms even though the engine work was
  single-digit milliseconds. Removing unrelated fields did not remove that
  all-language payload.

## Solution

Keep the existing public contract and semantic retrieval, but bound relational
projection by the exact data needed at each phase:

1. Keep omitted mode and `DEFAULT` on PostgreSQL. `MODERN` remains the explicit
   Typesense experiment, so traffic rollback does not require an index mutation.
2. Keep transcript embeddings in Typesense and PostgreSQL. Do not turn Modern
   into metadata-only search to obtain a misleading latency improvement.
3. Bound broad lexical previews and hydrate the final result page separately,
   as implemented in the first production optimization.
4. For semantic-only catalog preview misses, select only `id`,
   `audioLanguageSlugs`, and `subtitleLanguageSlugs`. Titles and `localesJson`
   are not used in that phase. The change lives in
   `apps/admin/src/services/typesense-watch-search.service.ts` and is protected
   by its colocated service test.
5. Continue to emit separate stage timings for query embedding, language
   resolution, Typesense metadata retrieval, Typesense semantic retrieval,
   watchability, and total server latency. Network timing belongs in the caller
   harness, not in the server lane total.
6. Store a compact `localeCodes` array aligned with `titles`, but do not index
   it. Broad lexical previews can then exclude the approximately 1.32 MB
   `localesJson` field while preserving exact-locale, base-language, English,
   and first-locale title selection. Keep one batched legacy re-fetch until the
   active alias has been rebuilt, so deploying Admin code before the new index
   cannot change ranking.
7. Keep full localized descriptions in final-page hydration. The compact
   preview changes candidate classification only; semantic transcript snippets
   and the public response continue to use the fully hydrated catalog document.
8. Add observability around request admission, event-loop delay, and database-
   pool acquisition so a future pre-retrieval stall can be attributed rather
   than inferred.
9. Normalize watchability into a third versioned Typesense collection,
   `watch_search_availability`, with one compact document per video and
   language. Merge audio and subtitle availability for the same language at
   build time. Final hydration sends the bounded catalog lookup and only the
   target plus ordered fallback language IDs in one `/multi_search` request.
10. Keep the all-language catalog option JSON temporarily for rollback, but do
    not request it on the steady-state path. If the availability alias is
    missing during a code-first migration or index rollback, retry the bounded
    final catalog lookup using the legacy fields. Only the explicit missing-
    alias condition activates this compatibility path.
11. Treat metadata and transcript vectors as separate release units. Routine
    releases rebuild the small catalog and availability projections while
    retaining the active transcript collection. A first deployment bootstraps
    vectors automatically; later vector/schema migrations require the explicit
    `--rebuild-transcripts` operation.

## Why This Works

The first implemented change removed unused values from one hot-path read
without changing candidate IDs, Typesense ranking, semantic vectors, final
hydration, or the GraphQL response. The production metadata-watchability lane
fell from 129 / 291 ms to 97 / 208 ms p50 / p95 in the next warmed comparison.

The remaining difference was a serving-document mismatch. `DEFAULT` already
uses SQL predicates to project only the requested locale and target/fallback
playback rows. MODERN downloaded every locale and every playback option, parsed
them in Admin, and discarded nearly all of them. The separate availability
collection gives Typesense the same query-specific projection boundary while
keeping PostgreSQL authoritative and Typesense responsible for serving the
indexed data. Unit tests pin target audio, target subtitles, ordered related-
language fallback, public response fields, request batching, and legacy alias
rollback. Production latency improvement remains a measurement gate after the
new collection is rebuilt; it is not inferred from the tests.

The read-only production projection contains 176,294 video/language records
and about 57.7 MiB of complete compact JSON. It adds no vectors and indexes only
filter fields, so the fix is a small capacity addition relative to the existing
2.80 GiB vector-memory term and 16 GiB process limit.

The more important lesson is measurement scope. The public E2E p95 fell from
800 ms to 717 ms, but the isolated Modern p95 only fell from 361 ms to 354 ms.
The change was beneficial and safe, yet it did not satisfy the sub-200 ms full-
round-trip goal. Broad-title projection, the Auckland network floor, and
unattributed live-replica stalls remain separate optimization problems.

The next compact-preview change is intentionally measured only after a new
versioned catalog collection is imported and its alias is swapped. Against an
old collection, the compatibility path performs a second request for
`localesJson`; benchmarking that transitional state would measure rollback
safety, not the intended steady-state design.

## Prevention

- Report engine, private-service wall, Admin server, and browser E2E latency as
  distinct series. Never label one as another.
- Benchmark per query as well as across the whole suite. A healthy aggregate can
  conceal an exact-title tail such as `JESUS`.
- Record projection byte size beside latency for large candidate windows.
- Require result-contract and ranking-parity tests for projection changes.
- Pin locale selection as explicit equivalence classes: exact locale, base
  language, English, first locale, and a legacy or misaligned projection.
- Rebuild the shadow alias before collecting the steady-state benchmark. Keep
  the legacy request until the rollback window no longer includes an old schema.
- Keep `DEFAULT` unchanged until relevance and production-load evidence support
  a rollout decision.
- Preserve versioned Typesense collections, checked imports, aliases, rollback
  protection, and PostgreSQL as the authoritative source.
- Model high-fanout nested data as filterable serving records. A final-page
  bound does not bound bytes when each page document contains hundreds of
  language options.
- Publish and roll back catalog plus availability as one metadata generation.
  Leave a reused transcript alias untouched; move and roll it back only during
  an explicit transcript rebuild. Keep the missing-availability compatibility
  path until the rollback window no longer includes a two-collection
  generation.
- Do not claim a proposed hydration architecture is faster until a clean
  production-shaped comparison proves it.

## Related Issues

- [PR #1825: bound Typesense preview and hydration payloads](https://github.com/JesusFilm/forge/pull/1825)
- [PR #1826: narrow semantic-only preview projection](https://github.com/JesusFilm/forge/pull/1826)
- [Precomputed serving indexes for multilingual hybrid search](../best-practices/precomputed-hybrid-search-serving-index-20260803.md)
- [Admin search pool and keyword-first fanout](admin-search-pool-and-keyword-first-fanout.md)
- [Admin search result-preserving latency optimization](admin-search-result-preserving-latency-optimization.md)
- [Typesense Watch Search local comparison](../../operations/typesense-watch-search-local.md)
- [Typesense Watch Search production readiness](../../operations/typesense-watch-search-production-readiness.md)
- [Typesense Watch Search experiment plan](../../plans/2026-08-03-001-feat-watch-search-typesense-parallel-backend-plan.md)
