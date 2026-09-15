---
title: "Failed recommendation issuance can exceed its deadline while awaiting rollback"
date: "2026-09-15"
category: "performance-issues"
module: "Recommendation delivery transactions"
problem_type: "performance_issue"
component: "service_object"
severity: "high"
symptoms:
  - "Admin keeps a failed semantic delivery request open while PostgreSQL rolls back."
  - "Web aborts the upstream request before beginning its contextual fallback."
root_cause: "async_timing"
resolution_type: "code_fix"
tags: ["recommendations", "prisma", "postgres", "deadlines", "rollback"]
---

## Cause and evidence

Primary-host trace `6aa8a5a80000000070cd728ca94d97f9` at 01:55:52 UTC records
a 1,065 ms served-item insertion and a 2,294 ms ROLLBACK. Web closes the original
Admin call at 3.5 seconds; contextual recovery then returns HTTP 200 at 4.15 seconds.
That recovered response does not make the original request deadline accurate.

`runRecommendationDeliveryTransaction` set Prisma transaction and PostgreSQL
statement timeouts but awaited the entire transaction promise. Prisma rejects
that promise after rollback finishes. The callback may already have failed and
be unable to commit, yet the caller still waits for database cleanup.

## Correction

The transaction helper bounds callback work with the existing absolute deadline.
When the callback fails, it reports that known failure through a separate promise
and rethrows so Prisma rolls back normally. The caller races that failure against
the transaction result; both promises remain observed. This allows normal failure
recovery while rollback continues and avoids an unhandled later rejection.

Do **not** put a timeout around successful commit acknowledgment. Once callback
work has succeeded, wait for the transaction's final outcome. A committed ISSUED
request must return its issued response, even when acknowledgment is slow. This
invariant is covered by the existing persistence regression and preserved here.

This corrects waiting after known failure; it does not claim that PostgreSQL can
never be slow. No retry, larger deadline, weaker atomicity or changed API shape
is needed. PostgreSQL statement limits and Prisma transaction limits remain in
place, and a callback rejected at its deadline cannot subsequently commit.

## Validation and monitoring

The red/green service regression simulates a statement failure followed by a
two-second rollback acknowledgment. The original response remains pending;
the corrected service returns the known failure and releases admission first.
A separate case lets callback work exceed its deadline, then confirms that late
work cannot make the rejected callback commit. Delayed rollback finishes without
unhandled rejection. Existing successful-commit behavior remains green.

Real PostgreSQL coverage writes a row, exceeds the callback budget with a slow
query and verifies the write is absent after the operation settles. Existing
six-item issuance and audit-failure tests preserve request/item/audit atomicity.

Admin APM uses `env:production`; Web uses `env:prod`. Verify positive traffic and
actual version tags before interpreting an empty error search. Workflow suspension
spans are handled control flow. Inspect actual request traces and expand database
descendants to distinguish a user-facing error, an upstream abort and a successful
fallback. Missing `trace.web.request.errors` data alone did not reveal the aborted
`next.request` in this incident.

See `docs/plans/2026-09-15-fix-failed-issuance-rollback-wait.md` and
`docs/operations/watch-runtime-recovery-2026-09-15.md` for final release evidence.
