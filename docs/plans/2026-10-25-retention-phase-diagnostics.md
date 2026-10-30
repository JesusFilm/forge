# Bounded recommendation-retention phase diagnostics

## Problem and scope

The October 24 ordinary retention cycle cleared its fixed expired cohort but had genuine failed attempts. Existing wrapper errors identify the Prisma call that noticed an expired transaction, not necessarily the earlier work that consumed its budget. The durable ledger records committed counts and a broad error class but no phase timings. Add failure-only, privacy-safe timing evidence to the Admin retention runtime. Keep feat-554 in progress; this change is instrumentation, not a timeout repair or clean-cycle proof.

## Implementation

1. Give each existing bounded transaction phase a stable semantic label. Measure transaction callback acquisition, advisory-lock query, timeout configuration, operation, durable counter update, and completion/commit acknowledgement with a monotonic clock. Keep the authoritative expiry and five-second deadline on their existing `Date.now()` path.
2. Hold only a four-phase ring of completed timings, the slowest completed phase, the failed phase and terminalization timing. Emit one structured record on a genuine failure, rate-limited to 16 records per minute per process; the durable ledger still records every failure. Mark incomplete or unavailable stages as `null`; retain the stage at which the error surfaced and an elapsed-to-error observation without claiming it caused the delay. Distinguish original phase, terminal and fallback-ledger errors. Normalize only allowlisted error classes/codes/SQLSTATE. No raw error, SQL, parameters, viewer/profile/request identifier, trace or payload.
3. Preserve the original thrown error, committed counts, advisory-lock behavior, safe budget yields, unknown backlog, success watermark and all existing time/page limits. The diagnostic path must not turn terminal-ledger errors into success or overwrite an uncertain committed counter.
4. Test pure sanitizer, bounded history and error timing; use owned PostgreSQL fixtures for an admitted phase failure after committed work and for safe yielding. Run focused tests, Admin typecheck/lint/format and normal hooks. Measure recorder overhead locally. Submit a scoped PR for independent review; do not deploy directly.

## Evidence limits

The October 24 aggregate production receipt is under `outputs/heartbeats/20261024T-diagnostic/`. Its nine wrapper failures remain unlinked per attempt to durable rows. Next ordinary-cycle verification can read structured failure logs, both durable ledgers, backlog/oldest ages, WAL and filesystem headroom without triggering a purge. A diagnostic record will narrow the slow phase, not identify an individual SQL statement inside a multi-query operation unless later evidence supports that conclusion.

## Local verification

The focused unit suite passed 38 tests. Against disposable migrated PostgreSQL 18, all 14 composition and all eight standalone retention tests passed; the native slow-tail fixture verified that the failed operation is marked incomplete, committed request roots stay counted, rolled-back projection rows remain and the success watermark does not advance. A commit-acknowledgement fixture verified that the diagnostic marks that stage incomplete while the durable committed counters remain authoritative. Admin typecheck, touched-file lint, formatting and normal commit hooks are PR gates.

In a local 100,000-iteration microbenchmark, recording a completed phase took 30 ms total (about 0.30 microseconds per phase) and a representative failure JSON record serialized to 1,732 bytes. This measures only the in-memory recorder on this machine, not transaction-level overhead under production load. Logs are limited to 16 failure records per minute per process; suppressed count is reported on the next emitted record. Every failure remains in the durable ledgers regardless of log suppression.
