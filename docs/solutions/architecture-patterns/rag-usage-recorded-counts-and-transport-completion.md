---
module: apps/rag
date: "2026-09-29"
problem_type: architecture_pattern
component: usage-accounting
tags: [rag, observability, http, recorded-counts]
---

# Recorded usage counts and transport completion

A usage report sums recorded requests and completed successes for one consumer
and the selected date range. The earlier independent-inventory/coverage solution
was a design mistake and is removed at the product owner's direction. Do not
require uninterrupted tracking, heartbeat watermarks, deployment declarations or
crash reconciliation to return stored counts. Never narrow or shift dates to
make a report appear. Existing consumers with no rows return zero; actual read
failure returns an error. Keep that distinction at the store, API, CLI and UI.

A Fetch Response proves the handler produced a response, not that Node completed
it. Count successes on `ServerResponse.finish` with a 2xx status; settle early
`close` as unsuccessful. Install listeners before asynchronous admission so early
disconnects cannot become successes. Deduplicate completion transactionally using
random pending attempt IDs; keep request totals keyed to authenticated admission.
Unfinished attempts remain counted requests, not guessed successes.

A failed accounting write logs a generic event and must not block retrieval or
hide other stored counts. Missing historical records cannot be reconstructed.
An additive nullable legacy collector reference permits old/new instances during
rolling deployment; preserve old tables/migrations as inert history for audit and
rollback. They do not create a maintenance requirement for current reporting.

Human report access and machine credentials are separate. Portal admission gives
all-consumer report access; ownership controls mutations only. Share date validation
and counting semantics while keeping cookie/bearer auth at their own boundaries.
Bound a portal batch to 20 consumers and one admission check. Serial reads bound
DB concurrency; each report uses a repeatable-read snapshot.

Load Usage only on navigation. Show numbers on every successful read, clear stale
totals on failed reads, and invalidate in-flight results on navigation/session loss.
Regression evidence: HTTP completion/disconnect tests, PostgreSQL concurrent
counts/role failures, the original seven-day range and interruption/boundary tests
in `usage-counts.integration.test.ts`, plus `portal-usage.e2e.ts` for actual table,
details, dates, read errors, lazy resource loading and narrow-screen behavior.
