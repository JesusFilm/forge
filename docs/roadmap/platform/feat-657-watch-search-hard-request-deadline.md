---
id: "feat-657"
title: "Enforce Watch search hard request deadline"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks:
  - "feat-678"
tags:
  - "platform"
  - "watch"
  - "search"
  - "latency"
---

## Problem

Public Watch GraphQL search bounds semantic embedding to one second and records
per-lane outcomes, but language resolution, retrieval, availability hydration,
and result assembly can still keep a request open past the documented 2.5
second hard budget (feat-254), while the response says `degraded: false`.

Two primaries serve `Query.watchSearch`:

- **MODERN (Typesense)** serves the canonical Web browser surface. Admin's
  `WATCH_SEARCH_PRIMARY_MODE` defaults to `MODERN`, and a production probe with
  `Origin: https://www.jesusfilm.org` returned
  `searchMode: watch-search-typesense`. This is the path real viewers hit.
- **DEFAULT (Postgres)** serves omitted-mode callers without the canonical
  Origin, authenticated non-fleet callers, and the operator rollback to
  `WATCH_SEARCH_PRIMARY_MODE=DEFAULT`.

The first revision of this ticket bounded DEFAULT only. Both primaries now
share the deadline.

## Entry Points — Read These First

- `apps/admin/src/services/watch-search-request-deadline.ts` — MODERN budget
  split, strict deadline-settling helpers, stage boundary check, typed lane
  reason.
- `apps/admin/src/services/typesense-watch-search.service.ts` — `search`,
  `executeSearch`, `retrieveCandidates`, and
  `searchResolvedTypesenseWatchSearch` (serving-profile proxy).
- `apps/admin/src/services/index.ts` — candidate serving proxy wiring.
- `apps/admin/src/services/watch-search.service.ts` — DEFAULT deadline.
- `apps/admin/src/graphql/queries/watch-search.ts` — resolver passes
  `hardTimeoutMs` to both primaries and maps the timeout to HTTP 504.
- Tests: `typesense-watch-search.service.test.ts` (`request deadline`),
  `watch-search-request-deadline.test.ts`,
  `watch-search.service.test.ts`, `watch-search.test.ts`, and
  `watch-search.yoga.test.ts` (real Yoga HTTP status).
- `docs/roadmap/platform/feat-254-watch-universal-multilingual-search.md` —
  existing request and lane behavior.

## Grep These

- `WATCH_SEARCH_HARD_TIMEOUT_MS` and `WatchSearchTimeoutError` across
  `apps/admin/src`.
- `watch_search_deadline_exceeded`, `request_budget_exceeded`, and
  `retrievalDeadlineAtMs` in both search services.
- `withinStage`, `assertBeforeDeadline`, `embeddingOutcomeBeforeCutoff`, and
  `DEADLINE_TRANSPORT_ABORT_GRACE_MS` in
  `apps/admin/src/services/typesense-watch-search.service.ts`.
- `enqueueWatchSearchTrace` and `watchSearch:` in
  `apps/admin/src/graphql/queries/watch-search.ts`.

## What To Build

Shared:

- One 2,300ms deadline measured from request start, below the 2.5 second
  budget. Optional lanes stop at a retrieval cutoff that reserves
  `min(400ms, 30%)` of the budget for availability hydration and response
  assembly.
- The resolver passes the same `hardTimeoutMs` to MODERN and DEFAULT. A
  timeout becomes a typed `WATCH_SEARCH_TIMEOUT` GraphQL error with HTTP 504.
  A query-free warning logs the request ID and elapsed time.
- `degraded: true` whenever a lane is degraded. A lane that misses its share
  reports `request_budget_exceeded`.
- No change to ranking, the GraphQL response schema, query retention, or
  telemetry fields.

MODERN (Typesense):

- The deadline starts when the serving proxy is called, and the service reuses
  that start. A candidate serving-profile refresh (every 30 seconds) consumes
  the same budget.
- The serving profile, language resolution, the candidate query plan, and the
  language-context reads must finish by the retrieval cutoff, or the request
  fails with the deadline error. They are required to build any retrieval
  request.
- The query embedding wait is capped at the retrieval cutoff. A miss degrades
  the semantic lane (`request_budget_exceeded`), and retrieval goes out
  lexical-only, so lexical and exact results still return.
- Retrieval stays one bundled `multi_search`. One native request cannot return
  its finished sub-searches separately, so a stalled retrieval answers HTTP 504.
  The issue accepts that outcome.
- Availability hydration has no safe partial result, because availability,
  playback, and action come from it. A hydration that misses the deadline
  fails the request. The service never shows unknown availability as
  unavailable.
- Each stage checks the budget BEFORE it starts a dependency call, and so does
  every Typesense dispatch. No later stage starts after the caller has the
  deadline error. A result that arrives at or after a deadline counts as
  timed out, even when it was already resolved.
- Each deadline-bounded Typesense request replaces the client's 2,000ms
  timeout with the remaining budget plus 50ms. The deadline error always wins,
  and the HTTP request is aborted after it.

DEFAULT (Postgres):

- Exact, metadata, and semantic lanes degrade at the shared cutoff, and only
  candidates with completed watchability data stay. Final catalog and image
  hydration uses the reserved time.

## Constraints

- Only the public GraphQL resolver passes `hardTimeoutMs`. Direct service
  calls without options stay unbounded: shadow work
  (`enqueueWatchSearchShadow`), offline evaluation
  (`/api/internal/search-eval/search`), `searchWithDiagnostics` (comparison,
  candidate evaluation, benchmarks), and agent tools.
- Do not include query text or content in timeout logs.

## Verification

- Real Yoga response: a MODERN or DEFAULT deadline answers HTTP 504 with
  `WATCH_SEARCH_TIMEOUT`, and a completed degraded response stays HTTP 200
  (`watch-search.yoga.test.ts`).
- MODERN, with controlled stalled dependencies:
  - An embedding that misses its capped budget returns lexical results with
    indexed availability and `degraded: true`.
  - A stalled bundled retrieval, stalled hydration, or a stalled serving
    profile fails with the deadline error within the scheduling margin, and
    the log names the stage.
  - Language or a serving profile that resolves after the retrieval cutoff
    dispatches no retrieval and no search.
  - Retrieval that resolves after the caller deadline starts no hydration.
  - Serving-profile time counts against the original budget.
- The helpers never return success once a budget has elapsed, even for a
  promise that has already resolved.
- MODERN with fast dependencies returns the same results, lane statuses, and
  bundled retrieval request as an unbounded call. Unbounded calls pass no
  per-request timeout.
- Falsify each guard once: revert it and confirm a test fails. Done 2026-10-09
  for: strict settlement, the stage boundary checks, the embedding cap, the
  serving-profile start, the language cutoff, the hydration stage, the
  resolver modern bound, and the HTTP 504 status.
- Run scoped Admin tests, typecheck, lint, formatting checks, and schema drift.

## Limits

- The deadline does not apply to shadow, offline evaluation, benchmark,
  comparison, or agent service callers.
- The deadline does not cancel Prisma work (serving profile, language
  resolution, and language context). The request stops waiting for it, and no
  later stage starts.
- A request that times out returns no response, so it writes no search trace.
  The query-free warning log is the only record. It is not in search-trace
  analytics.
- Production p50/p95/p99 by path, script, and degraded reason, and the
  alerts that FGE-29 asks for, remain follow-up work. These tests prove
  behavior, not production latency.
- Roadmap allocation checked on October 9: main had IDs through feat-639;
  all 307 cached origin refs contained only this feat-657 path, and all-ref
  history contained only its original f64b106 commit. This checks known refs,
  not future allocations.
- Residual FGE-29 production percentile, representative query-matrix, and
  monitoring/alert acceptance is tracked in feat-678; the Linear issue remains
  partially addressed until the normal PR-to-main deployment is validated.
