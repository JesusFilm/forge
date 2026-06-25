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
blocks: []
tags:
  - "admin"
  - "search"
  - "pgvector"
---

## Problem

After web opted into Admin `mode="keyword-first"`, production Watch semantic
search can sit in the loading state for several seconds. Historical probes were
framed against the default 15 second Admin GraphQL client, but the current Web
semantic-search path uses `semanticSearchAdminClient` with a 45 second bounded
timeout; treat this ticket as latency recovery, not only timeout avoidance.
Direct production probes showed the search action can return correct semantic
results, but cold keyword-first calls can still exceed an acceptable user-facing
budget.

The slow path is Admin video semantic retrieval. Production Web semantic
canaries through the real Admin GraphQL path took roughly 4.7-7.3 seconds, and
Railway HTTP logs showed Web `POST /watch` search-action requests near the
historical 15 second Admin caller budget. The current safe slice keeps Admin's
existing transcript best-evidence-per-video semantics, but removes expensive
image/dub hydration and `embedding::text` projection from the unbounded
candidate-collapse work. The semantic DB retrieval follow-up also keeps
published-locale visibility before the candidate limit while moving display
locale selection after the limit, because broad `video_locale.locale` is not a
unique row identity.

An HNSW-first raw nearest-neighbor window remains a possible follow-up
performance lever only if the safe slice and instrumentation show the semantic
SQL still dominates. It must be gated: if one long video contributes many top
chunks, a pre-dedup row window can collapse to too few distinct videos, preserve
diversity while losing recall, and degrade semantic relevance.

## What To Build

- [x] Move image lookup, dub playback lookup, and `embedding::text` hydration
      after transcript candidates are narrowed.
- [x] Gate published requested-locale visibility with a one-row-per-video
      `EXISTS` check before the semantic candidate limit, then hydrate one
      deterministic display locale row only after the limit.
- [x] Preserve the existing per-source best-evidence-per-video semantics for
      the default path.
- [x] Keep the existing `semantic-video` retriever label and public search
      response shape unchanged.
- [x] Do not solve latency by timing out retrievers and returning degraded
      results as the primary behavior.
- [x] Add safe timing logs for Admin search stages, retriever fan-out, raw
      retriever SQL, card hydration SQL, and trace-write overhead without
      changing the public search response.
- [ ] Measure repeated cold and warm Web/Admin semantic canaries after the
      safe-slice hydration/projection deploy and compare against the 2026-06-12
      baseline: `the bible project` 7.0s, `jesus` 7.3s,
      `hope when life is hard` 4.7s.
- [ ] Record p50/p95/p99/max latency, timeout/error count, response
      `searchMode`, top-N video IDs, evidence/snippet parity, and
      image/playback null-rate deltas. Exclude degraded keyword-only responses
      from semantic-latency success counts.
- [ ] Close this ticket if the safe slice meets the agreed user-visible latency
      target and preserves result quality; only move to HNSW-first work if the
      timing logs show semantic SQL remains the dominant bottleneck.

## Deferred Follow-Up

- [ ] Prototype HNSW-first transcript windows only with a recall, diversity,
      and duplicate-heavy Mastra no-regression proof against the current
      default path.
- [ ] Prove any HNSW-first rewrite uses HNSW on production-shaped data with
      `EXPLAIN (ANALYZE, BUFFERS)` and end-to-end Admin GraphQL timing under
      representative cold/warm cache states.
- [ ] Treat scene evidence as separate scope: restoring mixed scene/transcript
      semantic-video retrieval would require updating
      `hybrid-search-retrievers.ts`, transcript-only regression tests, Mastra
      relevance proof, and EXPLAIN proof.

## Entry Points - Read These First

1. `apps/admin/src/services/hybrid-search-retrievers.ts` - video semantic SQL.
2. `apps/admin/src/services/hybrid-search.service.ts` - retriever fan-out and
   RRF orchestration.
3. `apps/web/src/lib/admin-client.ts` - default 15 second Admin GraphQL client
   and 45 second semantic-search client.
4. `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`
   - pgvector HNSW planner failure modes and index expectations.

## Verification

- `pnpm --filter @forge/admin test -- src/services/hybrid-search-retrievers.test.ts src/services/hybrid-search.service.test.ts src/services/hybrid-search.keyword-first.test.ts src/services/hybrid-search.regression.test.ts src/services/transcript-embedding-ingest.contract.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint -- src/services/hybrid-search-retrievers.ts src/services/hybrid-search-retrievers.test.ts src/services/transcript-embedding-ingest.contract.test.ts`
- Mastra content-search eval gate for any ranking/windowing change that can
  alter candidate recall.
- Search timing logs include stage and DB-layer timings for keyword-first,
  hybrid, semantic-only, and degraded keyword-only probes.
