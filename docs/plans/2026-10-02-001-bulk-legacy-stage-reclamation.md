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
