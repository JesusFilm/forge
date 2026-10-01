# Bulk legacy stage disposal preparation

Owner scope: `docs/plans/2026-10-02-001-bulk-legacy-stage-reclamation.md`.
Production deployment and physical savings remain pending at this preparation.

## Native PostgreSQL results

All 10 tests in `legacy-stage-reclamation.db.test.ts` passed against a dedicated
loopback `forge_legacy_reclamation_bulk_20261002` database with current delivery
and Co-watch migrations and a freshly generated isolated Prisma client.

The added cases execute the exact numbered migration against populated legacy
and compact data. They prove legacy retirement presentation, preservation of
request/run/item/expiry values except the intended marker, unchanged compact detail,
rejection of later stage writes on retired parents, stable prior retirement
markers, restrictive foreign-key refusal with atomic rollback, and one-second
lock refusal with unchanged data. The existing six database cases and connection
query guard also pass. The empty-relation fixture reclaimed 1,220,608 relation
bytes (1,245,184 to 24,576); these are local test bytes, not production savings.

A separate LIKE-table fixture retained current candidate-run columns, constraints,
indexes and the retirement rewrite trigger. Updating 226,669 synthetic legacy
parents completed in 12.178 seconds including Docker/connection overhead, under the
30-second statement budget. This excludes production concurrency, hardware and
16 GB relation allocation; it is not a production timing guarantee. Timeout or
contention must abort deployment rather than widen the budget automatically.

## Review

Sequential review covered correctness, tests, simplicity, project standards,
agent accessibility, prior storage learnings, data migration safety, contention
and performance. No new API/schema contract or agent-only action is introduced.
The existing reader recognizes retired detail; normal expiry and compact writers
remain compatible. Root-only production target/health checks confirmed both Admin
roles on `1fde61c3a951e4dc8c05be51461441e797e8d585` with compact format, health 200,
no cleanup operation and no lock waiters. That release is the retained rollback
floor. Code rollback cannot recover discarded stage detail.

The pre-release aggregate snapshot at October 1 21:27 UTC allocated
16,431,259,648 stage bytes. A directly bound filesystem observation at 21:25 UTC
had 9,756,712,960 free bytes. These are historical measurements to compare with a
fresh predeploy/postdeploy pair, not a claim of release or reclamation.

ESLint and whitespace checks passed. Required PR CI and actual production release
must still complete before closing feat-555/575; feat-554 retains its separate
normal loaded-cycle acceptance criteria.

## First deployment failure and bounded recovery proof

PR 2532 merged normally at October 1 21:39:31 UTC. Its first migration attempt
started at 21:47:37.461515 UTC and PostgreSQL logged a statement timeout at 21:48:11.
The HTTP predeploy reported an aborted transaction; worker predeploy reported
Prisma advisory-lock timeout P1002. Both releases failed before serving traffic.
The failed `_prisma_migrations` entry has no error text, so it is not itself the
source of the timeout classification. The same-backend PostgreSQL log context
contains the exact bulk SQL. At 21:50, aggregate checks found no committed bulk
markers and no inbound stage foreign keys. Prior Admin HTTP/worker remained
healthy on `1fde61c3a`; stage allocation did not fall. No production savings.

The follow-up keeps migration 0127 byte-identical and adds checksum-bound recovery
in the existing predeploy wrapper. Sequential safety review covered partial durable
marker commits, precise cursor ordering, existing marker immutability, bounded row
locks/statements/total work, and concurrent deployer serialization. Unknown failed
migrations or checksum changes refuse recovery before any marker updates.

All 33 tests across the reclamation, recovery identity and deploy-wrapper suites
pass, including 12 dedicated PostgreSQL cases and the connection guard. Added
native cases prove bounded-page preparation leaves stage rows intact, preserves
compact detail, resumes without resetting earlier markers after a blocked page,
and serializes two actual recovery connections until migration completion. The
wrapper tests refuse resolution after preparation failure and avoid re-resolving
an already completed concurrent attempt.

A separate current-shape fixture prepared 226,669 synthetic legacy parents in 454
pages in 15.756 seconds. The original public parent table was temporarily renamed
only in this dedicated local database and restored afterward. This fixture proves
bounded progress locally, not production timing. Per-page and total caps remain
unchanged for release; no production retry was performed during these tests.
