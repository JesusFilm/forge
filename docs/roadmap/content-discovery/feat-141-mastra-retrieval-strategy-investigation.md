---
id: "feat-141"
title: "Mastra retrieval strategy ownership investigation"
owner: "nisal"
priority: "P0"
status: "cancelled"
start_date: "2026-05-29"
duration: 2
depends_on:
  - "feat-140"
  - "feat-142"
blocks: []
tags:
  - "admin"
  - "mastra"
  - "search"
  - "ai-pipeline"
  - "observability"
  - "evals"
---

## Problem

The brainstorm intentionally deferred query-time retrieval migration. The
possible future strategy is: Mastra owns retrieval strategy, while Admin
executes deterministic retrieval primitives. That could be valuable if evals
prove strategy iteration benefits from Mastra-owned orchestration, but it is
risky for latency, reliability, and public search contracts.

This ticket is an investigation and design proof only. It should not move live
user search orchestration into Mastra.

This ticket should run after feat-142, not before it. The evidence source must
be native Mastra Evaluation: promoted Datasets, Scorers, and Experiment results
from feat-142. Custom JSON artifacts can remain supporting evidence, but they
should not be the only operator-quality source once native Experiments are
populated.

## Closure Decision

Closed on 2026-06-01. The current decision is to keep live retrieval strategy
owned by Admin and not run a separate P0 investigation now. Mastra remains on
the offline evaluation/orchestration side of the boundary; future retrieval
strategy experiments should be opened only when promoted native Experiments show
a concrete quality or operator-iteration need that Admin-owned orchestration
cannot cover.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - future strategy option and no-live-search V1 boundary.
2. `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
   - artifact-backed reports and native Evaluation projection metadata.
3. `docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md`
   - promoted regression truth that should feed native Datasets.
4. `docs/roadmap/content-discovery/feat-142-mastra-search-eval-suite-operator-workflow.md`
   - native Dataset/Scorer/Experiment convergence for search evals.
5. `apps/admin/src/services/hybrid-search.service.ts`
   - current deterministic live search orchestrator.
6. `apps/admin/src/services/hybrid-search-retrievers.ts`
   - current retrieval primitives and pgvector SQL.
7. `apps/admin/src/services/hybrid-search-fusion.ts`
   - current fusion/ranking logic.
8. `apps/admin/src/graphql/queries/hybrid-search.ts`
   - public GraphQL contract that must remain stable.
9. `apps/admin/src/app/api/search/route.ts`
   - public REST contract that must remain stable.
10. `apps/mastra/src/mastra/index.ts`
    - Mastra runtime and route constraints.

## Grep These

```
rg -n "hybrid|keyword-first|semantic-video|semantic-experience|fuseRankedLists|RRF" apps/admin/src/services
rg -n "searchMode|HybridSearchResponse|public search|q \\(search query\\)" apps/admin/src/graphql apps/admin/src/app/api/search
rg -n "strategy version|eval report|baseline|candidate" apps/admin/src/services/search-eval apps/mastra/src
rg -n "Dataset|Experiment|compareExperiments|startExperiment|search-eval" apps/mastra/src apps/mastra/node_modules/@mastra/core/dist/datasets
```

## What To Build

1. Analyze promoted native Datasets and native Experiment results to decide
   whether moving retrieval strategy ownership into Mastra has measurable
   value. Use custom artifact reports only as supporting evidence or as a
   fallback before feat-142 is complete.
2. Define the smallest possible Admin primitive contract Mastra would need if
   strategy ownership moves later. Examples: run semantic video retrieval, run
   semantic transcript retrieval, run experience retrieval, run keyword
   retrieval, fuse supplied ranked lists.
3. Prototype offline only if useful: Mastra composes Admin primitives during an
   eval run, never during live user traffic.
4. Compare offline Mastra-owned strategy results against current Admin-owned
   live strategy using promoted native Datasets and native Experiment
   comparisons.
5. Produce a recommendation: keep Admin-owned live orchestration, plan a staged
   migration, or reject the strategy based on latency/reliability/quality risk.

## Constraints

- Do not move live user search orchestration into Mastra in this ticket.
- Do not move live query embedding generation into Mastra in this ticket.
- Do not change public search REST or GraphQL response shapes.
- Do not add a free-form agent to production query-time retrieval.
- Do not let Mastra query Admin's database directly; use authenticated Admin
  primitives only for any offline prototype.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Any primitive contract must be Admin/Core-owned.
- Do not proceed before feat-142 has created native Dataset/Scorer/Experiment
  records for search evals.
- Do not proceed using only raw artifact reports once native
  Dataset/Experiment records are available.

## Verification

- A written recommendation exists with evidence from native Evaluation
  Experiments and promoted Datasets, with artifact reports cited only as
  supporting context when needed.
- Any prototype runs offline only and uses authenticated Admin primitives.
- Public search behavior remains Admin-owned and unchanged.
- The follow-up path is explicit: no-op, staged migration proposal, or rejected
  strategy.
- Run focused validation only if a prototype is added:

```
pnpm --filter @forge/mastra test
pnpm --filter @forge/admin test -- hybrid-search.service.test.ts hybrid-search-retrievers.test.ts hybrid-search-fusion.test.ts search-eval/runner.test.ts
```
