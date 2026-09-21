---
title: "Batch exact contextual recommendations without repeated catalog work"
date: "2026-09-15"
category: "performance-issues"
module: "apps/admin contextual recommendation recovery"
problem_type: "performance_issue"
component: "database"
severity: "high"
symptoms:
  - "ContextualSceneRecommendations continues querying after Web aborts at 6.5 seconds."
  - "Fallback latency grows with every transcript chunk in a long film."
root_cause: "logic_error"
resolution_type: "code_fix"
tags:
  - "recommendations"
  - "postgres"
  - "pgvector"
  - "materialized-cte"
  - "fallback"
  - "query-plan"
---

## Cause

Web's seeded recommendation adapter tries `sceneRecommendations` after primary
delivery is unavailable or empty. That compatibility service searched the
catalog separately for every seed transcript chunk. Production trace
`6aa884cf000000001196f4c3ad9f3914` shows the fallback spending 8.2 seconds in
34 raw queries, continuing after Web's 6.5-second upstream deadline.

The local catalog reproduced this: Augustine has 35 chunks and its complete
service request took 32.1 seconds across 37 statements. An analyzed single-seed
plan took 914 ms, including a playable-dub lateral lookup repeated 2,633 times.
That lookup repeatedly scanned language rows and intersected dub indexes. The
fallback multiplied this otherwise modest cost by the seed count precisely when
the primary delivery path was already struggling.

## Fix

`queryScenesSimilarMany` in
`apps/admin/src/services/scene-recommendations-retriever.ts` executes the exact
multi-seed retrieval in one statement:

1. Materialize preferred playable dubs by edition and eligible candidate chunks.
2. Materialize the parsed seed vectors once, retaining their order.
3. For each seed, retain the best chunk per candidate video and apply the
   existing per-seed limit.
4. Union those candidates and retain the highest similarity per video. Hydrate
   metadata and vector text after selecting the survivors.
5. Keep the shared core-ID, title and cosine identity deduplicator in the
   service. Single-seed retrieval remains on its existing query.

All seed chunks remain represented. The query does not change to approximate
nearest-neighbor retrieval or relax locale, publication, platform, active
embedding-contract, playback or family-exclusion rules. Ordering among equal
scores was previously unspecified; the combined result uses video ID as its
final tie-breaker.

## Verification

The final local complete-service comparison for Augustine returned an identical
six-item response in **933 ms with three statements**, versus **32,129 ms with
37 statements** for the original loop. This compares every returned field, not
only IDs. It is a local catalog observation, not a production percentile.

Additional complete-service comparisons also returned identical responses:

| Catalog input            | Original loop | Combined query | Statements before / after |
| ------------------------ | ------------- | -------------- | ------------------------- |
| JESUS / English          | 148,790 ms    | 4,091 ms       | 178 / 3                   |
| Chosen Witness / English | 3,751 ms      | 164 ms         | 6 / 3                     |
| JESUS / Spanish          | 30,801 ms     | 1,203 ms       | 125 / 3                   |
| JESUS / French           | 55,005 ms     | 1,922 ms       | 128 / 3                   |

The full Admin suite passed 6,594 tests. The production build (including type
checking and workflow registration verification), scoped lint and formatting
passed. A local fault proxy forced primary semantic delivery unavailable while
forwarding contextual recovery to the rebuilt Admin server: Web returned six
distinct scene-fallback cards for JESUS (5,269 ms), Chosen Witness (382 ms),
and Augustine (947 ms), inside the existing upstream/browser budgets.

The original and revised service ran sequentially on the same local catalog,
using one installed Prisma client and a one-connection pool. Builds and unit
tests were stopped during those comparisons. Absolute timings depend on host
and catalog state; the full-film control deliberately executes the slow loop.

`apps/admin/src/services/scene-recommendations-batch.db.test.ts` creates and
drops an isolated local Postgres schema. It compares combined retrieval with
the single-seed loop at different per-seed limits, tests best-scene selection,
language/playback/visibility/provenance/family exclusions, and checks that the
176th seed can still supply the strongest match. It runs with
`RECOMMENDATION_DB_TEST=1` and a local `DATABASE_URL`.

## Experiments that did not fix it

- Merely combining statements still took about 30.6 seconds. PostgreSQL
  inlined `embedding_text::vector` from the seed CTE and repeated that parse for
  each candidate comparison. `seeds AS MATERIALIZED` is load-bearing.
- Turning JIT off left the original request at about 31.8 seconds. The analyzed
  plan did not identify JIT as the dominant work.
- A first cross-worktree comparison mixed Prisma SQL-helper instances from two
  installs and failed to bind the composed SQL. The valid comparison uses the
  original service loop with the unchanged single-seed query in one dependency
  installation. Harness failures are not application regressions.
- A condensed APM view initially omitted the GraphQL/Prisma descendants. Expand
  the complete service path before interpreting their absence as no database
  execution.

## Prevention

Fallbacks need production-sized workloads and deadline tests too. A fast primary
retriever does not make an older recovery query safe. Inspect statement count,
inner-loop execution counts, cast placement and the actual query plan. A single
statement alone does not demonstrate bounded work.

The exact search still scales with seed and eligible-candidate counts. Retain
long-film catalog verification when changing this path. Keep primary delivery's
separate bounded ANN retriever and immutable deadline intact.

Related: [bounded semantic retrieval](semantic-recommendation-retrieval-bounded-pgvector-fanout.md),
[Web ETag starvation](watch-etag-hashing-starves-recommendation-admission-20260915.md).
