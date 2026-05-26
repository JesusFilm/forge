---
id: "feat-141"
title: "Mastra retrieval strategy ownership investigation"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-05-25"
duration: 2
depends_on:
  - "feat-140"
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

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - future strategy option and no-live-search V1 boundary.
2. `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
   - eval reports that should justify whether strategy migration helps.
3. `docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md`
   - regression gates to evaluate any retrieval strategy proposal.
4. `apps/admin/src/services/hybrid-search.service.ts`
   - current deterministic live search orchestrator.
5. `apps/admin/src/services/hybrid-search-retrievers.ts`
   - current retrieval primitives and pgvector SQL.
6. `apps/admin/src/services/hybrid-search-fusion.ts`
   - current fusion/ranking logic.
7. `apps/admin/src/graphql/queries/hybrid-search.ts`
   - public GraphQL contract that must remain stable.
8. `apps/admin/src/app/api/search/route.ts`
   - public REST contract that must remain stable.
9. `apps/mastra/src/mastra/index.ts`
   - Mastra runtime and route constraints.

## Grep These

```
rg -n "hybrid|keyword-first|semantic-video|semantic-experience|fuseRankedLists|RRF" apps/admin/src/services
rg -n "searchMode|HybridSearchResponse|public search|q \\(search query\\)" apps/admin/src/graphql apps/admin/src/app/api/search
rg -n "strategy version|eval report|baseline|candidate" apps/admin/src/services/search-eval apps/mastra/src
```

## What To Build

1. Analyze eval reports and regression gates to decide whether moving retrieval
   strategy ownership into Mastra has measurable value.
2. Define the smallest possible Admin primitive contract Mastra would need if
   strategy ownership moves later. Examples: run semantic video retrieval, run
   semantic transcript retrieval, run experience retrieval, run keyword
   retrieval, fuse supplied ranked lists.
3. Prototype offline only if useful: Mastra composes Admin primitives during an
   eval run, never during live user traffic.
4. Compare offline Mastra-owned strategy results against current Admin-owned
   live strategy using promoted regression gates.
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
- Do not proceed without eval evidence from promoted regression gates.

## Verification

- A written recommendation exists with evidence from offline eval reports and
  promoted regression gates.
- Any prototype runs offline only and uses authenticated Admin primitives.
- Public search behavior remains Admin-owned and unchanged.
- The follow-up path is explicit: no-op, staged migration proposal, or rejected
  strategy.
- Run focused validation only if a prototype is added:

```
pnpm --filter @forge/mastra test
pnpm --filter @forge/admin test -- hybrid-search.service.test.ts hybrid-search-retrievers.test.ts hybrid-search-fusion.test.ts search-eval/runner.test.ts
```
