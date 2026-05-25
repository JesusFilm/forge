---
id: "feat-136"
title: "Admin production search trace storage and retention"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-05-25"
duration: 4
depends_on:
  - "feat-135"
blocks:
  - "feat-137"
tags:
  - "admin"
  - "mastra"
  - "search"
  - "ai-pipeline"
  - "observability"
---

## Problem

Search quality work needs real production query traces, but Mastra should not
participate in live user search request handling. Admin must become the source
of truth for short-lived production search traces, then Mastra can sample those
traces later for eval generation and quality reports.

Raw per-query traces must be deleted after 30 days. Only aggregate metrics and
human-approved sanitized eval queries may survive beyond that window.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - R17-R20 trace storage and retention decisions.
2. `apps/admin/src/app/api/search/route.ts`
   - public REST search endpoint to instrument.
3. `apps/admin/src/graphql/queries/hybrid-search.ts`
   - public GraphQL search resolver to instrument.
4. `apps/admin/src/services/hybrid-search.service.ts`
   - shared search orchestration and result summary source.
5. `apps/admin/src/services/hybrid-search-retrievers.ts`
   - retrieval path metadata and failure/degradation signals.
6. `apps/admin/prisma/schema.prisma`
   - place for the trace storage model and retention indexes.
7. `apps/admin/src/config/env.ts`
   - retention and trace capture env configuration.
8. `apps/admin/src/services/search-eval/fingerprint.ts`
   - existing search-state fingerprint pattern for eval context.

## Grep These

```
rg -n "hybridSearch|search\\(|searchMode|query_embedding_failure" apps/admin/src/services apps/admin/src/graphql apps/admin/src/app/api/search
rg -n "model Search|@@index|deletedAt|expiresAt|retention" apps/admin/prisma/schema.prisma apps/admin/src
rg -n "fingerprint|search-eval|eval-search" apps/admin/src/services/search-eval apps/admin/src/scripts
```

## What To Build

1. Add Admin storage for production search traces with a maximum 30-day raw
   retention window. Store the query text and minimal execution metadata needed
   for eval sampling, quality analysis, and abuse labeling.
2. Instrument REST and GraphQL search paths so every production search query run
   records a trace without changing public response shapes.
3. Record non-sensitive execution facts such as locale, search mode, result
   count, latency bucket, degradation/failure class, and route source.
4. Add a purge mechanism that deletes raw per-query traces older than 30 days.
5. Add aggregate counters or rollups that can survive raw trace deletion without
   keeping the raw query text.
6. Add internal read/sampling access for later Mastra eval work through an
   authenticated Admin contract, not direct database access from Mastra.

## Constraints

- Do not place Mastra in the live search request path.
- Do not move live query embedding generation into Mastra.
- Do not retain raw per-query traces longer than 30 days.
- Do not store bearer tokens, cookies, IP addresses, or full user identifiers
  in the search trace table.
- Do not expose raw trace data through public GraphQL or public REST APIs.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Trace metadata should reference Admin/Core contracts only.
- Do not let trace write failures break live search responses.

## Verification

- REST search and GraphQL search both create a trace record for successful,
  degraded, and failed search attempts.
- Trace write failures are logged safely but do not fail live search.
- The purge job deletes raw traces older than 30 days and preserves only
  allowed aggregate data.
- Mastra can later sample traces through an authenticated Admin contract without
  importing Admin code or connecting to Admin's database.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/admin test -- hybrid-search.service.test.ts graphql/queries/hybrid-search.test.ts app/api/search/route.test.ts search-eval/fingerprint.test.ts
pnpm --filter @forge/admin typecheck
```
