# Protected legacy-detail retirement validation

This change prepares the owner-authorized early retirement of unprotected legacy
stage detail. It does not perform production cleanup on deployment, shorten any
operational record lifetime, or claim disk space recovered. Feat-572 and feat-555
remain in progress until their production criteria are met.

## Representation and protection

The operator pins the original 64 quality-audit holdouts by the digest of their
canonical sorted ID list, with IDs held outside source control. Linked evidence
and active investigations are preserved. Protected conversion uses the existing
version-1 compact representation, SQL fingerprinting and typed bidirectional
`EXCEPT ALL` comparisons. Parent/item/expiry values and original issuance counts
remain unchanged. Unprotected retired detail receives an explicit timestamp;
Admin distinguishes retirement from evidence that was never recorded.

A manifest is finite: at most ten runs, 4,000 observations and 16 MiB encoded
payload. It expires after 15 minutes. Execution requires its database identity
confirmation, acquires the retention guard before parent locks, rechecks source
and protection, and commits its aggregate receipt atomically. This first release
has no automatic cohort loop or physical reclamation migration.

## Review-driven concurrency proof

Native PostgreSQL tests first reproduced a queued stage writer leaving a child
behind retired state under the earlier stale transaction snapshot. The final
operator uses READ COMMITTED so assessment sees a fresh snapshot after acquiring
request/run locks. The stage-write trigger locks the parent unconditionally
before testing whether it is retired or compact. Retired markers cannot be
cleared or replaced with invented compact evidence.

The independent review also identified the Admin access-audit race. Reader guard
and retry coverage is part of the final validation: a detail read that wins the
guard establishes its access audit before retirement reassesses protection;
retirement that wins forces a stale reader to retry and show retired state.

The native retirement cases are imported by the existing CI-selected
`admin-ops/detail.db.test.ts` suite; they are not a separately collected test
file. This keeps the race and preservation checks in the required PostgreSQL CI
job.

## Frontend loading check

On the existing hybrid detail fixture expanded to 448 stage rows, ordinary HTML
was byte-identical between base 1403be0a4 and the retired-state-aware component.
An alternating 100-sample server-render comparison after 20 warm-up iterations
measured median 28.18 ms before and 27.77 ms after; p95 was 102.74 ms before and
102.64 ms after. No server-render regression was observed. This synthetic local
check includes both candidate evidence and final slate, not authentication,
network or a full browser navigation. The UI adds no fetching, hydration,
client-side initialization, or new library. The retired-state test verifies
explicit disclosure and preserved issued slate counts.

## Production gates

Follow `docs/operations/early-legacy-recommendation-detail-retirement.md`.
Before an operation, prove deployed HTTP/worker reader convergence, a compatible
rollback image, compact writers and healthy serving. Refresh private holds and
review each finite manifest against current capacity/WAL. Verify exact protected
observation parity and original parent/item/expiry values after execution.
DELETE only releases reusable tuples; physical reclamation needs a separate
reviewed migration after exact emptiness under a bounded exclusive lock. No
loaded-retention proof, production deletion or filesystem saving is claimed by
this local validation.
