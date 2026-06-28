---
title: "Admin semantic HNSW prototype parity gate"
date: "2026-06-28"
category: "performance-issues"
module: "apps/admin"
problem_type: "performance_issue"
component: "search"
root_cause: "query_shape"
resolution_type: "prototype"
severity: "medium"
tags:
  - "admin-search"
  - "semantic-video"
  - "pgvector"
  - "hnsw"
  - "result-parity"
---

# Admin Semantic HNSW Prototype Parity Gate

## Problem

The exact `semantic-video` query chooses the best transcript chunk per video
across the full eligible transcript corpus before applying the candidate window.
That protects recall and diversity, but it prevents pgvector from using the
existing transcript chunk HNSW indexes as the first retrieval step.

An HNSW-first window can be faster, but it changes which chunks are allowed to
compete before `DISTINCT ON (video_id)`. One long video can contribute many of
the nearest chunks and leave too few distinct videos after collapse.

## Solution

Keep the default query exact and add `semantic-hnsw-prototype` as an
internal-only Search Pipeline Mode. Public callers cannot select it; only
internal eval search calls with `allowInternalEvalModes: true` can run it.

The prototype:

- uses a nearest transcript chunk window before the per-video collapse;
- keeps the existing transcript provenance, language, visibility, display,
  image, dub, and row-mapping rules after that window;
- records a distinct `semantic-video-hnsw.query` DB timing label;
- uses transaction-scoped pgvector settings so `SET LOCAL` applies to the query;
- ships with a parity script that compares `semantic-only` and
  `semantic-hnsw-prototype` result signatures through the internal eval-search
  route.

## Promotion Gate

Do not make HNSW-first the default unless production-shaped evidence shows:

- top result signatures match, or any difference is accepted through search eval;
- distinct-video count stays high enough for duplicate-heavy transcript cases;
- service and DB timing improve under repeated cold and warm canaries;
- `EXPLAIN` confirms the HNSW index is used on production-shaped data.

## Related Issues

- `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
- `docs/solutions/performance-issues/admin-semantic-db-retrieval-visible-candidate-window.md`
- `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`
- `docs/solutions/database-issues/set-local-requires-transaction-for-pgvector-search.md`
