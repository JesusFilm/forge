---
id: "feat-756"
title: "Fortnightly anonymous Watch exposure retention"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-10-23"
duration: 7
depends_on: []
blocks: []
tags:
  - "admin"
  - "watch"
  - "recommendations"
  - "storage"
  - "retention"
---

## October 27 first expiry-wave evidence

The [ordinary-cycle and Watch-capacity report](../../reports/2026-10-27-recommendation-retention-cycle.md)
records 74,558 committed Watch deletions during the failure-free scheduled cycle.
A separate bounded 17:27 UTC read found 92,617 already expired rows, 285,843
further expiries by the October 28 daily wake, and 498,507 in the following day.
The 876,967-row horizon did not reach its cap. Oldest stored expiry was after
the completed cycle's success cutoff; no persisted expiry was rewritten.

Watch relation allocation was 8,483,897,344 bytes; PGDATA had 7,478,304,768 bytes
free, with WAL 201,326,592 bytes and no observed lock waiters or long transactions.
These dated measurements and estimated dead tuples do not prove physical
recovery, usable free pages or a causal capacity forecast. The collection had
complete frames and a successful exit but nonempty unclassified CLI stderr;
the report preserves the local receipt-classification correction and provenance
limits.

Keep this ticket in progress for the larger approaching wave's actual drainage
and capacity. The existing daily observer should reconcile its committed
deletions, remaining oldest/overdue rows and relation/PGDATA/WAL headroom, or
coordinate protection if margin is inadequate. No additional fixed count of
daily cycles is required. Feat-554's two-cycle gate is met, while its separate
continued operational-margin obligation also remains open.

## Problem

`watch_surface_exposure` occupied 7,247,331,328 bytes on October 22, 2026,
including 4,540,989,440 bytes of indexes. Its 29-day expiry is the largest
measured long-horizon recommendation growth source. The owner chose a
fortnightly window for this anonymous measurement data. The recommendation
request, trace, profile, event and operational retention contracts remain
separate. Shortening expiry alone does not return PostgreSQL relation files to
the filesystem.

## Entry Points — Read These First

1. `docs/plans/2026-10-23-watch-exposure-fortnight-retention.md` — staged scope,
   safety gates and dated capacity evidence.
2. `apps/admin/src/services/recommendations/watch-surface-exposure.service.ts`
   — served manifest and event expiry, V2 binding and replay.
3. `apps/admin/src/services/recommendations/retention.service.ts` — bounded
   exposure cleanup, durable counters and overdue health.
4. `apps/admin/src/services/recommendations/admin-ops/watch-exposure.service.ts`
   and `admin-ops/shared.ts` — exposure reporting and 29-day window semantics.
5. `docs/analytics-and-recommendation-policy.md` — retention cleanup and
   serving operate concurrently.
6. `docs/plans/2026-10-23-manual-recommendation-retention.md` — bounded
   operator trigger for records whose stored expiry has passed.

## Grep These

`watchSurfaceExposure|expiredWatchSurfaceExposures|readRecommendationRetentionHealth|resolveRecommendationOpsWindow|expiresAt`

## What To Build

- Give new anonymous Watch served and event rows one explicit 14-day policy,
  retaining exact V2 event-to-served expiry parity and replay/idempotency.
- Include exposures in overdue health with the existing 24-hour propagation
  convention; report backlog and last successful cleanup separately.
- Prove a bounded indexed cleanup page can drain realistic exposure cohorts
  under the existing five-second run deadline. Preserve truthful failures,
  durable counters, locks and bounded continuation.
- Reconcile existing 29-day rows separately and leave their persisted expiry
  intact. State the delayed benefit while the normal bounded job drains them;
  do not infer a safe old/new boundary from event timestamps.
- Make any shortened history explicit in the Admin exposure report. A 29-day
  selector must not imply complete 29-day raw coverage after this change.

## Constraints

- Keep the shared `RECOMMENDATION_RAW_RETENTION_DAYS = 29` and unrelated trace,
  request, profile, event and operational lifetimes unchanged.
- Do not issue one bulk expiry update/delete, hide genuine retention failures,
  widen the five-second deadline, or run `VACUUM FULL` to force file recovery.
- Production changes use independently reviewed, green PR-to-main releases.
  Measure actual Admin HTTP and worker revisions before attributing runtime
  behavior to a release. No direct Railway deployment.

## Verification

- Unit and native PostgreSQL tests cover V1 and V2 expiry, exact binding,
  replay/conflict, page limits, overdue health and a loaded backlog.
- Admin typecheck, lint, format and required CI pass.
- Bounded aggregate-only production reads reconcile the 14-day cohort,
  expiry throughput, both retention ledgers, oldest overdue age, WAL, relation
  allocation and PGDATA free bytes without exporting identifiers or payloads.
- The rollout report distinguishes deleted rows, reusable PostgreSQL pages,
  physical relation recovery and filesystem availability.
- An Admin-only, same-origin manual action queues one strict stored-expiry purge
  pass with a distinct manual workflow ledger. Its production receipt must
  prove actual committed deletions and cannot count toward feat-554's
  ordinary-cycle acceptance. Pre-policy rows keep their persisted expiry.

## October 23 checkpoint

The [rollout report](../../reports/2026-10-23-watch-exposure-fortnight-rollout.md#october-23-release-and-cleanup-checkpoint) records actual Admin HTTP/worker convergence on `64bb0872`, the existing daily 10:30 UTC scheduler and manual cleanup receipts. The earlier #2865 deployment wait is resolved. No Watch exposure rows were expired or deleted in the manual campaign; the old cohort still begins expiring October 27 at 01:54:46.228 UTC. Keep this ticket in progress for observed exposure deletion throughput and capacity evidence.

The strict manual repair [#2878](https://github.com/JesusFilm/forge/pull/2878) is now merged and deployed: both actual Admin roles ran `85e97f521` with correct roles, compact mode and health 200 at 09:03:53 UTC. The [later release receipt](../../reports/2026-10-23-watch-exposure-fortnight-rollout.md#strict-stored-expiry-release) preserves the interrupted window, scope uncertainty, independent review and the separate safe-resumption decision. This repair is separate from proof of the future exposure wave. At 09:05, the exposure relation occupied 7,369,523,200 bytes and still had no expired rows. No immediate filesystem recovery or feat-554 daily-cycle credit is claimed.
