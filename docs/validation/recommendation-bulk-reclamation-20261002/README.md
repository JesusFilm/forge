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
