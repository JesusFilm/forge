---
title: "Admin semantic HNSW prototype removal"
date: "2026-06-28"
last_updated: "2026-06-29"
category: "performance-issues"
module: "apps/admin"
problem_type: "performance_issue"
component: "search"
root_cause: "query_shape"
resolution_type: "rejected_prototype"
severity: "medium"
tags:
  - "admin-search"
  - "semantic-video"
  - "pgvector"
  - "hnsw"
  - "result-parity"
---

# Admin Semantic HNSW Prototype Removal

## Problem

The exact `semantic-video` query chooses the best transcript chunk per video
across the full eligible transcript corpus before applying the candidate window.
That protects recall and diversity, but it prevents pgvector from using the
existing transcript chunk HNSW indexes as the first retrieval step.

An HNSW-first window can be faster, but it changes which chunks are allowed to
compete before `DISTINCT ON (video_id)`. One long video can contribute many of
the nearest chunks and leave too few distinct videos after collapse.

## What We Tried

PR #1407 added `semantic-hnsw-prototype` as an internal-only Search Pipeline
Mode. Public callers could not select it; only internal eval search calls with
`allowInternalEvalModes: true` could run it.

The prototype used a nearest transcript chunk window before the per-video
collapse, kept the existing provenance/language/visibility/display/image/dub
rules after that window, recorded a distinct `semantic-video-hnsw.query` DB
timing label, and shipped with a parity script comparing `semantic-only` and
`semantic-hnsw-prototype` result signatures.

PR #1408 fixed the prototype's transaction-local pgvector settings by replacing
parameterized `SET LOCAL` with `set_config(..., true)`.

## Decision

Remove the runtime prototype and parity script. Production reruns after #1408
showed top-result parity for the sampled queries, but no meaningful end-to-end
latency improvement. The small DB-only timing improvement did not justify the
extra retriever, internal mode, eval script, and operational interpretation
burden. Some apparent max-latency wins were also confounded by eval ordering:
the exact run paid cold embedding/provider waits first, while the prototype ran
second with warmer caches.

The default `semantic-video` path remains exact: it still chooses the best
transcript chunk per video across the eligible corpus before applying the
candidate window.

## Reintroduction Gate

Do not reintroduce HNSW-first as a prototype or default unless
production-shaped evidence shows:

- top result signatures match, or any difference is accepted through search eval;
- distinct-video count stays high enough for duplicate-heavy transcript cases;
- randomized A/B service, client, and DB timings improve under cold and warm
  canaries;
- `EXPLAIN (ANALYZE, BUFFERS)` confirms the HNSW index is used on
  production-shaped data before merging the prototype.

## Related Issues

- `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
- `docs/solutions/performance-issues/admin-semantic-db-retrieval-visible-candidate-window.md`
- `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`
- `docs/solutions/database-issues/set-local-requires-transaction-for-pgvector-search.md`
