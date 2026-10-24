# Bulk retirement of remaining legacy stage detail

## Scope and authority

On October 2 NZDT (October 1 UTC), the owner explicitly requested deleting all
remaining legacy rows without the previous per-cohort verification. This supersedes
the former preservation exclusions for legacy stage detail, including quality and
investigation samples and incomplete traces. It does not authorize deleting compact
payloads, profiles, events, requests, served items or attribution records.

The stopped unattended job removed 342,235 stage rows across 5,110 reconciled runs.
Its authority expired; do not restart it. The legacy relation still allocated
16,431,259,648 bytes at the last production measurement. DELETE did not reclaim
those files. The already-dropped expiry index is excluded from that allocation.

## Implementation

Migration `0127_recommendation_legacy_stage_bulk_retirement` locks only the stage
table, marks remaining legacy runs with the existing immutable retirement marker,
and truncates ONLY the stage table with RESTRICT, in one transaction. The table,
indexes and dual reader remain. Existing retired timestamps and compact payloads
stay unchanged. Requests and their operational descendants retain normal expiry.

The lock wait is bounded to one second and each statement to 30 seconds. A lock,
foreign-key or statement failure rolls back both retirement markers and truncate;
stop and diagnose a failed deploy rather than retrying or widening scope. No
per-record source/hold comparison, conversion campaign or full-table row count is
needed. Verify target, stopped cleanup process, compact writers and basic health
before normal PR-to-main deployment. Keep the current compact-capable image as the
rollback floor; restoring an old application cannot restore discarded detail.

## Validation and completion

Use the dedicated disposable PostgreSQL reclamation fixture to exercise actual
SQL, preserved compact detail and operational data, retired Admin presentation,
restrictive foreign-key refusal and bounded lock rollback. Record a representative
parent-update timing separately from production timing. Review the change, run
format/lint and required CI, then merge through the normal deployment path.

After release, check migration application, actual Admin HTTP/worker revisions,
health, stage allocation and filesystem availability. Report measured file recovery
separately from net filesystem change/WAL and do not double-count earlier indexes.
Close feat-555/575 only after actual disposal/reclamation. Feat-554 remains open
until two failure-free normal loaded retention cycles pass. Keep daily monitoring;
never resume the old unattended campaign.

## Recovery after the first production attempt

The first release (PR 2532, `4c8ae99d6`) hit the 30-second migration statement
budget. PostgreSQL logs associate the timeout with this migration; Prisma reported
an aborted transaction and left an unfinished migration entry without error text.
The other service also hit Prisma's ten-second advisory-lock wait. Fresh read-only
checks found no committed bulk markers, the stage relation still populated at the
same 16,431,259,648 bytes, and both prior Admin roles healthy on `1fde61c3a`.
Do not blindly retry or change the already published migration.

`legacy-stage-migration-recovery.ts` handles only P3009 for this exact migration
and verifies the unresolved ledger name and SQL checksum. It requires compact
format. A dedicated session advisory lock serializes HTTP and worker recovery
through preparation, Prisma resolution and final migration. Waiting for the other
deployer is capped at five minutes and does not lock serving tables.

Preparation scans candidate parents through the existing `(created_at,id)` index,
in pages of at most 500. Each page commits only missing legacy retirement markers,
with a five-second statement budget and one-second row-lock wait. Existing markers,
compact payloads, operational fields and all stage rows remain unchanged. A maximum
of 1,000 pages and five minutes bounds this one preparation pass; errors stop it.
Committed pages are idempotent if a later explicitly deployed recovery resumes.
This is the new owner-authorized bulk-disposal path, not renewal of the expired
unattended campaign or its old per-cohort authority.

After preparation completes, resolve the exact failed attempt as rolled back and
run the unchanged migration through normal predeploy. Its remaining parent update
should do no substantial writes, leaving the original bounded table lock and
restrictive truncate. No `CASCADE`, timeout widening, new ledger or row-detail logs.
If another deployer already completed that exact migration, the waiter verifies
its checksum and runs normal migration deployment without resolving it again.

Marker preparation can now commit before physical disposal; a stopped preparation
may show some legacy detail as retired while its stage rows still occupy disk.
Do not credit filesystem savings until the final migration actually commits.
