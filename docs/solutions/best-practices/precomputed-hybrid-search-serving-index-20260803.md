---
title: Precomputed serving indexes for multilingual hybrid search
date: 2026-08-03
last_updated: 2026-08-05
category: best-practices
module: apps/admin watch search
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - Search combines lexical metadata, transcript vectors, and availability data
  - Request-time relational hydration threatens a one-second latency budget
  - A replacement backend needs an absolute multilingual quality gate before rollout
tags: [search, typesense, embeddings, multilingual, performance, indexing]
---

# Precomputed Serving Indexes For Multilingual Hybrid Search

## Context

Watch Search must preserve multilingual semantic recall while returning playable
video cards within one second. The PostgreSQL implementation can perform query
embedding, several retrieval lanes, and relational watchability hydration in a
single request. Datadog RUM showed that the broader production GraphQL endpoint
could exceed the browser's latency budget, but endpoint resource events could
not isolate GraphQL POST operations.

## Guidance

Evaluate a serving index with the complete corpus before replacing the default
backend. Separate records by both retrieval phase and fanout boundary:

- One catalog document per public video contains published lexical metadata,
  card fields, and compact availability slugs used during candidate ranking.
- One availability document per public video and language merges playable
  audio and subtitle state plus playback fields. Final hydration filters these
  documents to the target and ordered fallback languages.
- One transcript document per accepted native chunk contains the existing
  embedding, language, evidence text, video ID, start time, and an explicit
  `publiclyVisible` facet. Retain the broad semantic corpus; make every serving
  surface choose a visibility policy.
- Put locale-aware title and metadata fields in a small lexical collection; do
  not copy repeated titles/descriptions onto transcript chunks or insert
  vectorless catalog anchors into the vector collection. This lets routine
  metadata releases reuse the active HNSW index.
- Query embedding remains in the request path. Send title, metadata, and vector
  subqueries in one Typesense multi-search HTTP call, then combine their
  canonical-video ranks in Admin with explicit weights. Do not compare raw text
  and vector scores across collections or add sequential network requests.
- Group by a faceted canonical video identity with a small bounded group
  (`group_limit: 3` here). This suppresses repeated transcript chunks while
  retaining enough physical editions for hydration to select the best playable
  locale match. Emit only one result per canonical video after hydration.
- Hydrate the bounded candidate set from the catalog and availability indexes
  in one multi-search rather than joining availability tables during every
  search or transferring every language for each selected video.
- Build timestamped physical collections, validate every bulk-import row, then
  publish stable aliases. Restore prior aliases if a partial publication fails.
- Public Watch Search filters transcript retrieval with
  `publiclyVisible:=true`. A future AI surface must use a separate authorized
  policy rather than inheriting public or unrestricted access accidentally.
- Expose the experiment through an explicit API mode while leaving omitted or
  default mode on the established backend.

Benchmark both services against the same restored snapshot, with warmups,
alternating execution order, repeated multilingual exact and semantic queries,
and result-overlap reporting. Measure the complete service call, including query
embedding and language resolution, rather than only the search engine's internal
timer.

## Visibility And Service Boundaries

Corpus membership and frontend visibility are different decisions. For each
accepted native transcript vector, compute a visibility projection from the
current video, `noIndex`, and matching published-locale state:

```sql
v.deleted_at IS NULL
AND v.no_index = false
AND EXISTS (
  SELECT 1
  FROM video_locale vl
  WHERE vl.video_id = v.id
    AND vl.locale = vtc.language
    AND vl.status = 'published'
    AND vl.deleted_at IS NULL
)
```

Store that result as the faceted `publiclyVisible` field. Public semantic
retrieval must state its policy in the Typesense request:

```text
language:=[...] && publiclyVisible:=true
```

The vector lane keeps transcript language boundaries explicit:

```text
documentKind:=transcript && publiclyVisible:=true && language:=[...]
group_by=canonicalVideoId
group_limit=3
```

This lets publication and `noIndex` changes update a small projection without
regenerating valid embeddings. Hard-deleted transcript chunks still disappear
from the serving index when PostgreSQL removes the authoritative rows. Any AI
or administrative surface that later uses the broad corpus needs a separate,
explicit authorization and visibility policy.

Keep the lifecycle boundary equally explicit. PostgreSQL is authoritative,
Admin owns the public contract and orchestration, and Typesense is a private,
rebuildable projection. On Railway, the stateful process belongs in the
dedicated `@forge/admin/search` service with its own persistent volume. Do not
attach that volume to replicated `@forge/admin`; doing so couples API
availability and deploys to index memory, disk, and restart behavior.

## Why This Matters

Metadata-only search is fast but loses generic intent queries that AI clients
and people depend on. Moving vectors into a purpose-built index keeps semantic
recall while removing repeated relational hydration from the hot path. A mode on
the existing GraphQL field preserves contract parity and makes measurements
harder to accidentally run against the wrong implementation.

The full-data run is essential. A viewer-safe final-result set can be much
smaller than the semantic evidence corpus searched before the visibility gate.
Capacity the serving index from the broad corpus, then verify that the public
filter reproduces final-result safety. This validates vector dimensions,
multilingual handling, memory growth, import behavior, visibility gates, and
ranking overlap in ways a small projection cannot.

## When To Apply

- Search request paths repeatedly join stable display or availability metadata.
- A semantic index already exists, but ranking still needs lexical exactness.
- Candidate hydration dominates latency after retrieval.
- A bounded result count still has an unbounded payload because each result
  embeds a high-fanout locale, dub, subtitle, or entitlement array.
- An architecture change needs evidence without changing production traffic.

## Examples

On the 2026-08-03 first-pass Watch Search projection, Typesense indexed 1,107
viewer-visible videos and 17,118 public transcript vectors. Five warmed runs
across five multilingual cases measured a 158 ms p50 and 257 ms p95 end to end.
French `communion` returned `La communion des croyants` first with target audio
at a 168 ms p95 and 0.80 top-ten overlap with PostgreSQL. A later production
audit found 280,107 accepted native transcript vectors, proving that the first
projection was suitable for visibility testing but not broad-corpus capacity
planning.

The result does not prove Typesense is universally faster: local PostgreSQL was
119 ms p95 in the same run. It proves the precomputed hybrid architecture can
retain semantic retrieval. Production placement, synchronization, relevance,
and capacity require a separate rollout decision. On Railway, run Typesense as
the dedicated `@forge/admin/search` service: Admin is replicated and stateless,
while the serving index requires a persistent volume.

The broad-corpus vector memory term is:

```text
7 bytes × 1,536 dimensions × 280,107 records
= 3,011,710,464 bytes
= 2.80 GiB
```

That is not total process RSS. Facets, allocator overhead, working memory, and
two simultaneous generations during an atomic rebuild require additional
headroom. The deployed single-node shadow service has a 16 GiB memory limit.
The full rebuild must still replace planning estimates with measured resident
memory, process RSS, peak import memory, and disk use.

A later production trace exposed an important refinement: bounding final
hydration to 20 catalog documents was insufficient when those documents still
contained every audio and subtitle option. A broad result page transferred
about 994 KB; Typesense reported roughly 6 ms of engine work while private wall
time was about 53 ms. PostgreSQL DEFAULT was faster because its SQL already
projected only target/fallback rows. Normalizing video/language availability
restores that projection boundary without moving hydration back to PostgreSQL.

Traffic rollback and index rollback stay independent. Omitted mode and
`DEFAULT` continue through PostgreSQL, so disabling Modern restores the public
path without changing schema or deleting Typesense data. A bad index generation
can separately move its aliases or active-generation pointer back to the last
healthy collections.

## Separate Lexical And Semantic Lane Refinement

The first implementation queried the catalog and transcript collections in
parallel and merged up to 40 chunks in Admin. That deduplicated too late: many
chunks from one video could consume the semantic candidate budget. It also
made Admin approximate ranking that Typesense already supports.

The refined serving contract keeps `watch_search_transcripts` vector-only and
adds `watch_search_lexical`. Vector documents retain the exact embeddings read
from PostgreSQL; the indexer never calls an embedding provider. A manual schema
rebuild is required only when the active transcript alias lacks canonical or
visibility facets. Routine releases reuse the vector/HNSW collection and build
catalog, availability, and lexical generations under the existing PostgreSQL
advisory lock. The request uses three subqueries in one HTTP call, fixed vector
`k:80`, default HNSW effort, canonical grouping, and deterministic 56/14/30
weighted RRF in Admin. Offset pagination remains bounded and does not repeat
sequential Typesense calls. Production latency and absolute eval gates must be
measured before changing these controls.

If query embedding misses its deadline, Admin sends title and metadata lanes in
one request and marks the semantic lanes degraded. If the lexical alias is
absent during code-first deployment, Admin reuses the already-created query
embedding and falls back to the previous bounded catalog/vector path. This
provides a deploy-order safety net without creating document embeddings or
paying for a second query embedding.

## Query Embedding Cache Evidence

Optimizing retrieval does not remove the query embedding from the hybrid
critical path. Repeated queries therefore use two bounded cache layers in
`apps/admin/src/services/watch-search.service.ts`:

- a 256-entry, one-hour process L1 removes PostgreSQL and provider work from a
  hot request;
- the existing PostgreSQL cache remains the shared L2 across Admin processes;
- identical concurrent misses coalesce so one provider request supplies every
  waiter;
- provider, model, dimensions, and normalized query remain part of the cache
  identity; returned vectors are cloned and dimension-checked before use.

The embedding lane reports `cache_l1_hit`, `cache_l2_hit`,
`cache_coalesced`, `cache_miss`, or `cache_l2_error`. Production latency reports
must use those outcomes as the cache authority. The first occurrence in a probe
process is not necessarily a cold miss because production traffic or L2 may
already have populated the value. Report first-seen and repeated samples
separately, but never label the former cold without the lane evidence.

## Production Relevance Tuning

Tune one native Typesense control at a time and evaluate the exact deployed
revision against a frozen baseline. The request contract is pinned in
`apps/admin/src/services/typesense-watch-search.service.ts:266-302` and its
colocated test. It remains one grouped hybrid request with the existing query
embedding; these query-time changes do not rebuild the index or create corpus
embeddings.

The fixed 100-query production suite on 2026-08-05 produced:

| Experiment                                          | PR                                                    | Same top result | Empty lists | Top-ten Jaccard | Decision                          |
| --------------------------------------------------- | ----------------------------------------------------- | --------------: | ----------: | --------------: | --------------------------------- |
| Initial native hybrid                               | predecessor                                           |             42% |          29 |           0.339 | Diagnose                          |
| Remove the 0.5 vector-distance threshold            | [#1842](https://github.com/JesusFilm/forge/pull/1842) |             42% |          30 |           0.312 | Reject                            |
| Restore threshold; enable controlled token dropping | [#1843](https://github.com/JesusFilm/forge/pull/1843) |             44% |           6 |           0.392 | Retain                            |
| Enable hybrid reranking                             | [#1844](https://github.com/JesusFilm/forge/pull/1844) |             44% |           6 |           0.392 | Reject: no relevance gain, slower |
| Reduce vector `alpha` from 0.3 to 0.1               | [#1845](https://github.com/JesusFilm/forge/pull/1845) |             44% |           6 |          0.3917 | Reject: no top-one gain           |
| Restore `alpha: 0.3`                                | [#1846](https://github.com/JesusFilm/forge/pull/1846) |       Not rerun |   Not rerun |       Not rerun | Restore measured-best config      |

Controlled token dropping was the only tested parameter that materially
recovered recall: empty result sets fell from 29 to 6 and product-title empties
fell to zero without adding another Typesense request. Removing the distance
threshold admitted weaker neighbors without recovering recall. Hybrid
reranking left every deterministic relevance metric unchanged while increasing
latency, and lower vector alpha changed none of the 100 top results relative to
the retained candidate.

Parity metrics are necessary but not sufficient. Same-top-result and Jaccard
measure resemblance to the established backend, not absolute intent quality.
The Mastra comparison therefore judges each result list in both orders
(`apps/mastra/src/services/offline-search-eval/runner.ts:597-617`) and reports
order-sensitive verdicts as disagreements
(`apps/mastra/src/services/offline-search-eval/report.ts:42-64`). For the #1845
candidate, that judge returned 24 Modern wins, 30 losses, 8 ties, and 38
disagreements with no judge or search failures. The main slices were:

| Query slice   | Wins | Losses | Ties | Disagreements |
| ------------- | ---: | -----: | ---: | ------------: |
| Product title |    2 |     10 |    0 |            10 |
| Scene-like    |    2 |      8 |    1 |             4 |
| Multilingual  |   11 |      2 |    6 |             6 |

This did not establish baseline-or-better public relevance. Same-top, Jaccard,
and bidirectional pairwise preference now remain diagnostics only: `DEFAULT` is
a rollback backend, not the definition of correctness.

The promotion authority is the versioned 104-case
`public-watch-absolute/v2` corpus in
`apps/mastra/src/services/offline-search-eval/absolute-query-set.ts`. Development
queries may be rerun during tuning; held-out cases run only after the candidate
is frozen. The gate requires reviewed canonical-video qrels, overall NDCG@10 at
least 0.80, MRR at least 0.85, success@10 at least 0.90, product-title
success@1 at least 0.90, semantic-intent success@10 at least 0.80,
multilingual success@10 at least 0.90, honest no-result accuracy of 1.00,
language correctness of 1.00, zero canonical duplicates, at least 85%
pointwise-useful judgments, at most 5% unacceptable judgments, and full
round-trip p95 at most 550 ms. The separate production probe still requires
server p95 at most 250 ms, exactly 100 accepted internal requests plus 100
GraphQL requests, analytics correlation IDs, and zero unexplained degradation.

An unreviewed run fails closed. The repository relevance set starts empty;
Mastra accepts a strict versioned reviewed set through the real workflow input.
Held-out reports also name the exact Admin revision and the physical catalog,
availability, lexical, and transcript collections, reject missing or mixed
observed revisions, record the pointwise judge provider/model/cost, and require
named operator review. Strict artifact schemas prevent arbitrary observations
or invented metric shapes from being persisted as release evidence.

The next experiments should measure how many distinct canonical videos survive
native retrieval before hydration, especially for product-title and scene-like
losses. Do not assume that increasing `k` or HNSW `ef` fixes the problem: the
earlier PostgreSQL HNSW prototype showed how repeated chunks from one long video
can consume an approximate-neighbor window before per-video collapse. Record
distinct-video counts and result-list truncation before widening either knob.

## Related

- [Typesense Watch Search local comparison](../../operations/typesense-watch-search-local.md)
- [Typesense Watch Search production readiness](../../operations/typesense-watch-search-production-readiness.md)
- [Admin Watch Search production rollout checklist](admin-watch-search-production-rollout-20260720.md)
- [Canonical language and exact-title ranking](../logic-errors/canonical-language-boundaries-and-lexicographic-search-ranking.md)
- [Result-preserving search latency optimization](../performance-issues/admin-search-result-preserving-latency-optimization.md)
- [Admin semantic HNSW prototype parity gate](../performance-issues/admin-semantic-hnsw-prototype-parity-gate.md)
- [Mastra offline search eval orchestration](../architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md)
- [Universal multilingual Watch Search roadmap](../../roadmap/platform/feat-254-watch-universal-multilingual-search.md)
