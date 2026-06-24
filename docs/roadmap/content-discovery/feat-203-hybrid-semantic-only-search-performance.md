---
id: "feat-203"
title: "Hybrid and semantic-only search performance investigation"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-06-24"
duration: 3
depends_on:
  - "feat-175"
  - "feat-193"
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "hybrid"
  - "semantic-search"
  - "performance"
  - "evals"
---

## Problem

`feat-175` focuses on the production Watch path that opts into Admin
`mode="keyword-first"`. The same Admin search service also serves default
`hybrid` callers and internal `semantic-only` diagnostics through the Mastra
search eval suite. Those modes can still inherit the expensive semantic-video
retrieval path, retriever fan-out costs, trace persistence costs, and Admin
transport latency.

The team needs a separate performance pass for `hybrid` and `semantic-only`
searches so AI experience generation, diagnostics, and future callers do not
ship with hidden latency problems after the public keyword-first path is fixed.

## Entry Points - Read These First

1. `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
   - current keyword-first latency recovery and pgvector/HNSW guardrails.
2. `docs/roadmap/content-discovery/feat-193-watch-search-readiness-eval-suite.md`
   - existing eval tracks for `public-watch`, `ai-experience-generation`, and
   `semantic-diagnostic`.
3. `apps/admin/src/services/hybrid-search.service.ts`
   - mode selection, retriever fan-out, RRF orchestration, trace metadata, and
   result mapping.
4. `apps/admin/src/services/hybrid-search-retrievers.ts`
   - semantic-video, keyword, trigram, exact-title, and experience retriever SQL.
5. `apps/admin/src/app/api/internal/search-eval/search/route.ts`
   - internal eval route that accepts mode-specific eval calls.
6. `apps/admin/src/graphql/queries/hybrid-search.ts`
   - public GraphQL search boundary for `hybrid` and `keyword-first` callers.
7. `apps/mastra/src/services/offline-search-eval/runner.ts`
   - mode/caller-track eval runner behavior.
8. `apps/mastra/src/services/offline-search-eval/types.ts`
   - caller-track defaults and suitable modes.
9. `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`
   - pgvector planner and index-selection failure modes.

## Grep These

- `rg -n "mode.*hybrid|semantic-only|keyword-first" apps/admin/src apps/mastra/src`
- `rg -n "semantic-video|searchVideoSemantic|searchExperienceSemantic" apps/admin/src/services`
- `rg -n "retriever|elapsed|timing|trace|recordSearchTrace" apps/admin/src/services apps/admin/src/app/api`
- `rg -n "callerTrack|ai-experience-generation|semantic-diagnostic" apps/mastra/src/services/offline-search-eval apps/mastra/src/mastra/workflows`
- `rg -n "EXPLAIN|ANALYZE|BUFFERS|hnsw|embedding <=>" docs apps/admin`

## What To Build

1. Capture baseline latency for default `hybrid` and internal `semantic-only`
   searches using representative canary queries and the existing Mastra eval
   caller tracks:
   - `ai-experience-generation` with `mode="hybrid"`;
   - `semantic-diagnostic` with `mode="semantic-only"`.
2. Compare total latency and per-stage timings for retriever fan-out,
   semantic-video SQL, semantic-experience SQL, RRF/fusion, hydration, mapping,
   trace persistence, and Admin transport. Do not measure or report embedding
   latency as a separate field.
3. Identify which slow paths are shared with `feat-175` and which are unique to
   broad `hybrid` or `semantic-only` execution.
4. Fix scoped bottlenecks that can be changed without degrading relevance or
   changing public response contracts. Likely candidates include mode-specific
   retriever dispatch, bounded semantic windows, post-collapse hydration,
   corpus-health skips, trace write overhead, and redundant query work.
5. For any SQL/index change, collect production-shaped
   `EXPLAIN (ANALYZE, BUFFERS)` evidence before and after the change.
6. Keep `semantic-only` internal-only unless a separate product/API ticket
   explicitly promotes it. Public REST and GraphQL mode behavior should stay
   stable.
7. Save a concise performance proof that names the search mode, caller track,
   query set, p50/p95 or per-canary timings, and any remaining bottleneck.

## Constraints

- Do not broaden `feat-175`; this is a follow-up for non-keyword-first modes.
- Do not solve speed primarily by timing out retrievers and returning degraded
  results.
- Do not change public REST, GraphQL, or Web result shape.
- Do not let `semantic-only` become a public mode as part of this work.
- Do not add a separate embedding latency measurement.
- Do not delete old vectors or scene tables as the first performance lever.
- Do not ship HNSW-first rewrites without a distinct-video guarantee or
  duplicate-heavy Mastra no-regression proof.
- Keep provider-bound semantic correctness: query and stored vectors must share
  provider, model, dimensions, native dimensions, and transform-version
  semantics.

## Acceptance Criteria

- Baseline timings exist for `hybrid` and `semantic-only` canaries before any
  fix is claimed.
- The investigation identifies whether latency is dominated by embedding,
  semantic-video SQL, semantic-experience SQL, retriever fan-out, fusion,
  hydration, trace persistence, or Admin transport.
- Any implemented fix preserves relevance and response-shape contracts.
- Mastra evals for `ai-experience-generation` and `semantic-diagnostic` show no
  relevance regression.
- Post-fix timings improve or a clear documented blocker explains why no safe
  optimization landed.
- Remaining follow-up work is captured as narrower tickets if this pass finds
  larger indexing, data cleanup, or API-design changes.

## Verification

- `pnpm --filter @forge/admin test -- src/services/hybrid-search-retrievers.test.ts src/services/hybrid-search.service.test.ts src/services/hybrid-search.regression.test.ts`
- `pnpm --filter @forge/admin test -- src/app/api/internal/search-eval/search/route.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint -- src/services/hybrid-search.service.ts src/services/hybrid-search-retrievers.ts src/app/api/internal/search-eval/search/route.ts`
- Run Mastra search evals for:
  - caller track `ai-experience-generation`, mode `hybrid`;
  - caller track `semantic-diagnostic`, mode `semantic-only`.
- Capture production-shaped canary timings and, for SQL changes,
  `EXPLAIN (ANALYZE, BUFFERS)` before/after evidence.
