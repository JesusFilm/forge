---
id: "feat-657"
title: "Enforce Watch search hard request deadline"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "watch"
  - "search"
  - "latency"
---

## Problem

The public default-mode Watch GraphQL search already bounds semantic embedding
to one second and records per-lane outcomes, but language resolution, database
retrieval, watchability, and result hydration can still keep the request open
beyond the documented 2.5 second hard budget.

## Entry Points — Read These First

- `apps/admin/src/services/watch-search.service.ts`
- `apps/admin/src/services/watch-search.service.test.ts`
- `apps/admin/src/graphql/queries/watch-search.ts`
- `apps/admin/src/graphql/queries/watch-search.test.ts`
- `docs/roadmap/platform/feat-254-watch-universal-multilingual-search.md` —
  existing request and lane behavior.

## Grep These

- `assertBeforeDeadline`, `semantic_retrieval`, and `watch_search_deadline_exceeded`
  in `apps/admin/src/services/watch-search.service.ts`.
- `enqueueWatchSearchTrace` and `watchSearch:` in
  `apps/admin/src/graphql/queries/watch-search.ts`.

## What To Build

- Enforce a whole-operation deadline below the public 2.5 second budget only
  for the public GraphQL default-mode path, with time reserved for response
  handling.
- Degrade unfinished exact, metadata, and semantic lanes at a shared
  request-start-derived cutoff, retain only candidates with completed
  watchability data, and reserve up to 400ms for final catalog and image
  hydration.
- Map the timeout to a typed HTTP 504 GraphQL error and emit a query-free
  warning with request ID and elapsed time when the deadline is exceeded.
- Preserve the existing semantic embedding timeout, lane status signals, and
  exact/lexical fallback behavior when semantic work times out.
- Do not change search ranking, GraphQL response schema, or query retention.

## Constraints

- Apply the total-request deadline only to the public GraphQL default-mode
  service call. Modern, shadow, offline evaluation, benchmark, and agent callers
  keep their prior behavior.
- Do not include query text or content in timeout logs.

## Verification

- A controlled stalled service dependency fails with the deadline error before
  the configured timeout is exceeded.
- Stalled retrieval or watchability lanes degrade before the hard deadline;
  completed actionable exact/lexical results survive without presenting
  unknown availability as unavailable. Final hydration uses the reserved time.
- Existing tests continue to prove exact/lexical results survive semantic
  embedding timeout and that the response is marked degraded.
- Run scoped Admin tests, typecheck, lint, and formatting checks.

## Limits

The deadline does not apply to shadow, offline evaluation, benchmark, or agent
service callers. The race bounds the public response wait but does not cancel a
Prisma operation already submitted to the database; query cancellation and
production percentile/alert validation remain follow-up work.
