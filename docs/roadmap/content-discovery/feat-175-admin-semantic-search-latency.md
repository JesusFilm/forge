---
id: "feat-175"
title: "Admin semantic search latency recovery"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-06-12"
duration: 1
depends_on:
  - "feat-131"
  - "feat-172"
blocks:
  - "feat-203"
tags:
  - "admin"
  - "search"
  - "pgvector"
---

## Problem

After web opted into Admin `mode="keyword-first"`, production Watch semantic
search sometimes sits in the loading state until the web Admin GraphQL client
hits its 15 second timeout. Direct production probes showed the search action
can return correct semantic results, but cold keyword-first calls can cross the
caller budget.

The slow path is Admin video semantic retrieval. Production Web semantic
canaries through the real Admin GraphQL path took roughly 4.7-7.3 seconds, and
Railway HTTP logs showed Web `POST /watch` search-action requests near the 15
second Admin caller budget. The current safe slice keeps Admin's existing
best-evidence-per-video semantics, but removes expensive image/dub hydration
and `embedding::text` projection from the unbounded source-collapse work.

An HNSW-first raw nearest-neighbor window remains the likely next performance
lever, but it must be gated: if one long video contributes many top chunks, a
pre-dedup row window can collapse to too few distinct videos and degrade
semantic diversity.

## What To Build

- [x] Move image lookup, dub playback lookup, and `embedding::text` hydration
      after scene/transcript candidates are narrowed.
- [x] Preserve the existing per-source best-evidence-per-video semantics for
      the default path.
- [x] Keep the existing `semantic-video` retriever label and public search
      response shape unchanged.
- [x] Do not solve latency by timing out retrievers and returning degraded
      results as the primary behavior.
- [ ] Measure post-deploy Web/Admin semantic canaries and compare against the
      2026-06-12 baseline: `the bible project` 7.0s, `jesus` 7.3s,
      `hope when life is hard` 4.7s.
- [ ] Prototype HNSW-first source windows only with a distinct-video guarantee
      or duplicate-heavy Mastra no-regression proof.
- [ ] Prove any HNSW-first rewrite uses HNSW on production-shaped data with
      `EXPLAIN (ANALYZE, BUFFERS)`.

## Entry Points - Read These First

1. `apps/admin/src/services/hybrid-search-retrievers.ts` - video semantic SQL.
2. `apps/admin/src/services/hybrid-search.service.ts` - retriever fan-out and
   RRF orchestration.
3. `apps/web/src/lib/admin-client.ts` - 15 second Admin GraphQL caller budget.
4. `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`
   - pgvector HNSW planner failure modes and index expectations.

## Verification

- `pnpm --filter @forge/admin test -- src/services/hybrid-search-retrievers.test.ts src/services/hybrid-search.service.test.ts src/services/hybrid-search.keyword-first.test.ts src/services/hybrid-search.regression.test.ts src/services/transcript-embedding-ingest.contract.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint -- src/services/hybrid-search-retrievers.ts src/services/hybrid-search-retrievers.test.ts src/services/transcript-embedding-ingest.contract.test.ts`
- Mastra content-search eval gate for any ranking/windowing change that can
  alter candidate recall.
