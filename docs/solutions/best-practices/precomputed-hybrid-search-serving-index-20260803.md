---
title: Precomputed serving indexes for multilingual hybrid search
date: 2026-08-03
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
  fields, and precomputed playable audio/subtitle options.
- One transcript document per accepted chunk contains the existing embedding,
  language, evidence text, video ID, and start time.
- Query embedding remains in the request path, while lexical and vector
  retrieval run concurrently.
- Hydrate the bounded candidate set from the catalog index rather than joining
  availability tables during every search.
- Build timestamped physical collections, validate every bulk-import row, then
  publish stable aliases. Restore prior aliases if a partial publication fails.
- Expose the experiment through an explicit API mode while leaving omitted or
  default mode on the established backend.

Benchmark both services against the same restored snapshot, with warmups,
alternating execution order, repeated multilingual exact and semantic queries,
and result-overlap reporting. Measure the complete service call, including query
embedding and language resolution, rather than only the search engine's internal
timer.

## Why This Matters

Metadata-only search is fast but loses generic intent queries that AI clients
and people depend on. Moving vectors into a purpose-built index keeps semantic
recall while removing repeated relational hydration from the hot path. A mode on
the existing GraphQL field preserves contract parity and makes measurements
harder to accidentally run against the wrong implementation.

The full-data run is essential. It validates vector dimensions, optional values,
multilingual text handling, memory growth, import behavior, visibility gates,
and actual ranking overlap in ways a small fixture cannot.

## When To Apply

- Search request paths repeatedly join stable display or availability metadata.
- A semantic index already exists, but ranking still needs lexical exactness.
- Candidate hydration dominates latency after retrieval.
- An architecture change needs evidence without changing production traffic.

## Examples

On the 2026-08-03 Watch Search snapshot, Typesense indexed 1,107 viewer-visible
videos and 17,118 transcript vectors. Five warmed runs across five multilingual
cases measured a 158 ms p50 and 257 ms p95 end to end. French `communion` returned
`La communion des croyants` first with target audio at a 168 ms p95 and 0.80
top-ten overlap with PostgreSQL.

The result does not prove Typesense is universally faster: local PostgreSQL was
119 ms p95 in the same run. It proves the precomputed hybrid architecture fits
the one-second serving budget and can retain semantic retrieval. Production
placement, synchronization, relevance tuning, and capacity still require a
separate rollout decision.

## Related

- [Typesense Watch Search local comparison](../../operations/typesense-watch-search-local.md)
- [Admin Watch Search production rollout checklist](admin-watch-search-production-rollout-20260720.md)
- [Universal multilingual Watch Search roadmap](../../roadmap/platform/feat-254-watch-universal-multilingual-search.md)
