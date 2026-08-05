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
  - A replacement backend needs a full-data comparison before rollout
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
- Put small vectorless video documents in the same serving collection and copy
  only compact titles onto transcript documents. This lets Typesense apply its
  native keyword/vector rank fusion at the document level without duplicating
  card or availability payloads across transcript chunks.
- Query embedding remains in the request path. Once available, send one native
  hybrid candidate request with the external vector, lexical fields, a bounded
  vector `k`, and canonical grouping. Do not add sequential strict, typo, and
  broad queries unless measured relevance requires them.
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

The native hybrid form admits vectorless metadata documents while keeping
transcript language boundaries explicit:

```text
publiclyVisible:=true && (documentKind:=video || language:=[...])
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

## Native Hybrid Refinement

The first implementation queried the catalog and transcript collections in
parallel and merged up to 40 chunks in Admin. That deduplicated too late: many
chunks from one video could consume the semantic candidate budget. It also
made Admin approximate ranking that Typesense already supports.

The refined serving contract upgrades `watch_search_transcripts` into a
backward-compatible superset. Vector documents retain the exact embeddings
read from PostgreSQL; the indexer never calls an embedding provider. A manual
schema rebuild is required once. Routine releases then reuse the vector/HNSW
collection, refresh vectorless video documents, and PATCH changed copied titles
without sending embeddings. The production entrypoint holds a PostgreSQL
advisory lock for the whole publish-and-retire operation so concurrent releases
cannot race aliases or cleanup. The request uses rank
fusion with `alpha: 0.3`, a minimum `k` of 80 capped at 1,000 for deep offsets,
default HNSW search effort, token dropping disabled, hybrid reranking disabled,
and canonical grouping. Offset pagination remains one vector search rather than
repeating the 1,536-value vector over many page requests. These settings
prioritize a bounded, single retrieval operation; production latency and eval
gates must be measured before changing them.

If query embedding misses its deadline, Admin performs one lexical catalog
query and marks the semantic lanes degraded. If the native fields are absent
during migration, Admin reuses the already-created query embedding and falls
back to the previous dual Typesense requests. This provides a deploy-order
safety net without creating document embeddings or paying for a second query
embedding.

## Related

- [Typesense Watch Search local comparison](../../operations/typesense-watch-search-local.md)
- [Typesense Watch Search production readiness](../../operations/typesense-watch-search-production-readiness.md)
- [Admin Watch Search production rollout checklist](admin-watch-search-production-rollout-20260720.md)
- [Canonical language and exact-title ranking](../logic-errors/canonical-language-boundaries-and-lexicographic-search-ranking.md)
- [Result-preserving search latency optimization](../performance-issues/admin-search-result-preserving-latency-optimization.md)
- [Universal multilingual Watch Search roadmap](../../roadmap/platform/feat-254-watch-universal-multilingual-search.md)
