---
id: "feat-138"
title: "Mastra eval query generation"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-25"
duration: 4
depends_on:
  - "feat-137"
blocks:
  - "feat-139"
tags:
  - "admin"
  - "mastra"
  - "search"
  - "ai-pipeline"
  - "observability"
  - "i18n"
---

## Problem

The existing search eval harness can generate and run synthetic cases, but the
Mastra migration needs a workflow-owned eval query generation loop. It should
produce candidate queries from catalog content, multilingual locale-quality
needs, and real viewer intent sampled from Admin traces.

Generated candidates are not durable benchmarks by default. They need source
anchoring, judge scoring for nuance, and later human promotion before becoming
regression gates.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - all-three eval query sources and hybrid truth model decision.
2. `docs/roadmap/content-discovery/feat-136-admin-search-trace-storage-retention.md`
   - Admin trace source and sampling contract.
3. `docs/roadmap/content-discovery/feat-137-search-query-quality-abuse-labeling.md`
   - quality labels and bad-actor filtering.
4. `apps/admin/src/services/search-eval/query-generator.ts`
   - current synthetic query generation implementation.
5. `apps/admin/src/services/search-eval/locales.ts`
   - locale tier and judge-confidence handling.
6. `apps/admin/src/services/search-eval/schemas.ts`
   - eval schema validation patterns.
7. `apps/admin/eval/README.md`
   - existing eval artifact model and regression/calibration guidance.
8. `apps/mastra/src/mastra/index.ts`
   - Mastra workflow registration and protected route patterns.

## Grep These

```
rg -n "query-generator|generate.*queries|HARNESS_LOCALES|regressions" apps/admin/src/services/search-eval apps/admin/eval
rg -n "SearchTrace|quality label|abuse|sampling" apps/admin/src apps/admin/prisma
rg -n "createWorkflow|createStep|registerApiRoute|MASTRA_SERVICE_API_KEYS" apps/mastra/src
```

## What To Build

1. Add a Mastra eval query generation workflow with three candidate sources:
   catalog-derived queries, locale-quality queries, and real viewer-intent
   queries sampled from Admin traces.
2. Add an authenticated Admin sampling/read contract that gives Mastra only the
   trace and catalog context needed for candidate generation.
3. Generate source-anchored expected-result hints where the catalog content
   makes them obvious.
4. Use judge scoring for nuanced candidates, but keep judge scores separate
   from human-promoted regression truth.
5. Store candidate evals with source, locale, label provenance, generation
   model, source anchors, judge summary, and promotion status.
6. Keep generated candidates out of permanent regression gates until `feat-140`
   promotes them.

## Implemented Flow

- Mastra workflow id: `eval-query-generation`; protected service route:
  `POST /forge-eval-query-generation`.
- Admin read contracts:
  `POST /api/internal/search-traces/sample` and
  `POST /api/internal/search-eval/catalog-context`.
- Admin write contract:
  `POST /api/internal/search-eval/candidates`.
- Candidate storage table: `search_eval_candidate`, with source, locale,
  source anchors, label provenance, generation provider/model, advisory judge
  summary, Mastra run id, promotion status, dedupe key, and optional trace
  retention expiry.
- Trace-derived candidates are stored only while raw trace retention allows it
  unless a later human promotion changes their status. Generated rows are not
  loaded by the committed eval harness as durable regression truth.

## Follow-Up Handoff

- `feat-139` should run offline search evals against named prompt sets,
  including the operator-authored seed baseline set from `feat-140`.
- `feat-140` should add editable seed baseline prompts and user-generated prompt
  submissions before durable regression promotion. The seed set exists so the
  team can establish and manually tune an initial baseline before allowing
  generated or user-submitted candidates into regression gates.

## Constraints

- Do not place Mastra in the live search request path.
- Do not move live query embedding generation into Mastra.
- Do not retain raw production query traces longer than 30 days.
- Do not treat generated production-trace candidates as durable benchmarks
  until sanitized and human-promoted.
- Do not sample traces labeled as obvious abuse, spam, prompt injection, or
  otherwise low-signal.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Candidate generation should sample Admin/Core-owned catalog
  context, not CMS document IDs or Strapi contracts.
- Do not let Mastra import Admin code or connect directly to Admin's database.

## Verification

- Mastra can generate candidate eval queries from catalog content, locale
  quality needs, and filtered production traces.
- Candidate evals include source/provenance metadata and promotion status.
- Generated candidates are not loaded as durable regression gates by default.
- Trace sampling respects quality/abuse labels and 30-day retention boundaries.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin test -- search-eval/query-generator.test.ts search-eval/locales.test.ts
pnpm --filter @forge/admin test -- search-eval/candidates.test.ts search-eval/catalog-context.test.ts app/api/internal/search-eval/catalog-context/route.test.ts app/api/internal/search-eval/candidates/route.test.ts app/api/internal/search-traces/sample/route.test.ts search-trace.service.test.ts search-trace-retention.service.test.ts search-trace-retention/job.test.ts workflows/searchTraceRetention.test.ts
pnpm --filter @forge/admin db:generate
pnpm --filter @forge/admin exec prisma validate
```
