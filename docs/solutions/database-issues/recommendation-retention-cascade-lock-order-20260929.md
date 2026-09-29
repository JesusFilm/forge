---
title: "Retention must lock the full cascade authority before deleting roots"
date: "2026-09-29"
module: "Admin Recommendations"
problem_type: "database_issue"
component: "background_job"
severity: "high"
symptoms:
  - "Retention and privacy invalidation can deadlock on graph/protocol authority"
  - "Shared retained sources can reach graphs outside the initial lock set"
  - "A committed deletion can lose its durable count after process or acknowledgement loss"
root_cause: "async_timing"
resolution_type: "code_fix"
tags: [recommendations, retention, postgres, privacy, concurrency, accounting]
---

# Retention must lock the full cascade authority before deleting roots

## Failure

A single retention transaction first deleted expired composition observations,
locking their protocol through a trigger, and later deleted a graph. Concurrent
privacy invalidation held that graph and waited for the same protocol. Native
PostgreSQL reproduced SQLSTATE `40P01`.

Simply moving one purge was insufficient. Deleting a source can suppress retained
aliases of its outcome, then affect other episodes from those captured sessions
and invalidate sibling graphs. Evaluation deletion can cascade through an
observation to its protocol while terminal evaluation holds that protocol before
writing its decision. Assignment deletion can conflict with a profile reset's
study fence. SQL trigger and foreign-key dependencies are part of the lock order.

## Repair

`retention.service.ts` commits bounded phases, reacquiring its transaction-scoped
advisory lock for each phase. It never holds a coordinator connection while asking
for another transaction, so a one-connection pool can make progress. Request roots
are processed in chunks of 50 under the existing overall five-second budget.

`retention-locks.ts` discovers the selected roots' dependency closure, locks it in
shared authority order and rereads it before mutation. Discovery includes retained
outcome aliases and unique sessions; a many-to-many join must not turn 225 unique
episodes into more than 50,000 apparent roots. The explicit bound applies to each
dependency family. Overflow refuses the phase; it never truncates the authority
set. The request-leading shadow-run index keeps request discovery bounded.

Count and delete each admitted set inside the same phase, then persist its counts
before commit. Later failure must preserve already-committed counters and must not
publish a success watermark. A rejected transaction promise does not prove that
COMMIT failed: failure handling must not overwrite durable counters from an
accepted commit whose acknowledgement was lost.

Post-admission time limits use PostgreSQL's transaction timeout in addition to
statement timeout. This setting terminates the connection on expiry, so exercise
pool replacement and use the setting only within the retention transaction.
Production PostgreSQL 18.6 was verified in the storage owner's September 29
04:36 UTC receipt. See the [PostgreSQL transaction timeout documentation](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-TRANSACTION-TIMEOUT).

## Proof boundary

`retention-composition.db.test.ts` owns loopback fixtures and exercises concurrent
invalidation, shared-source graph closure, single-connection progress, loaded
profile erasure and durable failure accounting. Final passing counts and review
results belong in `docs/validation/recommendation-live-20260929/`. These fixtures
do not prove the first nonempty production purge or provide storage clearance.
