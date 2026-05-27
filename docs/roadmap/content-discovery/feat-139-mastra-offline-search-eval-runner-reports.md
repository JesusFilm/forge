---
id: "feat-139"
title: "Mastra offline search eval runner and reports"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-05-25"
duration: 5
depends_on:
  - "feat-138"
blocks:
  - "feat-140"
tags:
  - "admin"
  - "mastra"
  - "search"
  - "ai-pipeline"
  - "observability"
  - "evals"
---

## Problem

Mastra should own eval retrieval only, not live query-time retrieval. The
offline eval runner should let Mastra execute generated and promoted eval cases,
call Admin's deterministic search APIs, compare strategy versions, and produce
quality reports without affecting public search latency or reliability.

This is the point where Mastra starts orchestrating search-quality work, but
only outside the live request path.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - "Mastra owns eval retrieval only" decision and no-live-search boundary.
2. `docs/roadmap/content-discovery/feat-138-mastra-eval-query-generation.md`
   - candidate eval source and storage contract.
3. `apps/admin/src/services/search-eval/runner.ts`
   - current eval runner composition.
4. `apps/admin/src/services/search-eval/search-client.ts`
   - Admin search client used by evals.
5. `apps/admin/src/services/search-eval/judge.ts`
   - pairwise judge and calibration behavior.
6. `apps/admin/src/services/search-eval/reporter.ts`
   - current report output shape.
7. `apps/admin/src/scripts/eval-search.ts`
   - current CLI entry point and modes.
8. `apps/mastra/src/mastra/index.ts`
   - Mastra workflow registration and protected route patterns.

## Grep These

```
rg -n "runEval|SearchEval|createJudge|renderReport|eval-search" apps/admin/src/services/search-eval apps/admin/src/scripts
rg -n "search-client|ADMIN_BASE_URL|hybrid search|searchMode" apps/admin/src/services/search-eval apps/admin/src/services
rg -n "createWorkflow|createStep|registerApiRoute|observability" apps/mastra/src
```

## What To Build

1. Add a Mastra offline search eval workflow that loads seed baseline prompts,
   candidate/promoted eval cases, and calls Admin search APIs as the execution
   primitive.
2. Preserve or port the existing judge calibration behavior so reports do not
   confuse judge drift with search regressions.
3. Track eval run metadata in Mastra: strategy version, query set version,
   prompt-set source, Admin search endpoint/version, judge model, locale mix,
   and cost summary.
4. Produce reports that separate wins, losses, ties, both-irrelevant cases,
   judge disagreements, search failures, and trace-derived candidate behavior.
5. Support comparing a baseline strategy to a candidate strategy without
   changing the live public search contract.
6. Leave Admin's live search orchestration as the production authority.

## Constraints

- Do not place Mastra in the live search request path.
- Do not move live query embedding generation into Mastra.
- Do not change public search REST or GraphQL response shapes.
- Do not let eval runner failures affect live search availability.
- Do not promote generated candidate queries into regression gates in this
  ticket.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Eval runs should call Admin/Core-backed APIs only.
- Do not bypass Admin's search APIs by querying Admin's database from Mastra.

## Verification

- Mastra can run an offline eval against Admin search and produce a report.
- Reports identify strategy/query-set versions and judge calibration status.
- Eval runs can compare baseline and candidate strategies without changing live
  search behavior.
- Admin search remains usable if Mastra eval workflows are disabled or failing.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin test -- search-eval/runner.test.ts search-eval/search-client.test.ts search-eval/judge.test.ts search-eval/reporter.test.ts
```
