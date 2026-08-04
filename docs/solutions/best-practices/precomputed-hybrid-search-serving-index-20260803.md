---
title: Precomputed serving indexes for multilingual hybrid search
date: 2026-08-03
last_updated: 2026-08-04
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
backend. Keep lexical metadata and transcript vectors in separate collections:

- One catalog document per public video contains every published locale, card
  field, and precomputed playable audio/subtitle option.
- One transcript document per accepted native chunk contains the existing
  embedding, language, evidence text, video ID, start time, and an explicit
  `publiclyVisible` facet. Retain the broad semantic corpus; make every serving
  surface choose a visibility policy.
- Query embedding remains in the request path, while lexical and vector
  retrieval run concurrently.
- Hydrate the bounded candidate set from the catalog index rather than joining
  availability tables during every search.
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
headroom. The production-readiness runbook currently budgets approximately
8 GiB for a single-node shadow service and requires the full rebuild to replace
that planning estimate with measured resident memory, process RSS, peak import
memory, and disk use.

Traffic rollback and index rollback stay independent. Omitted mode and
`DEFAULT` continue through PostgreSQL, so disabling Modern restores the public
path without changing schema or deleting Typesense data. A bad index generation
can separately move its aliases or active-generation pointer back to the last
healthy collections.

## Related

- [Typesense Watch Search local comparison](../../operations/typesense-watch-search-local.md)
- [Typesense Watch Search production readiness](../../operations/typesense-watch-search-production-readiness.md)
- [Admin Watch Search production rollout checklist](admin-watch-search-production-rollout-20260720.md)
- [Canonical language and exact-title ranking](../logic-errors/canonical-language-boundaries-and-lexicographic-search-ranking.md)
- [Result-preserving search latency optimization](../performance-issues/admin-search-result-preserving-latency-optimization.md)
- [Universal multilingual Watch Search roadmap](../../roadmap/platform/feat-254-watch-universal-multilingual-search.md)
