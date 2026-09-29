# Early legacy recommendation detail retirement

This is a finite, reviewed exception to the normal 29-day lifetime for **unprotected
legacy stage detail only**. It does not change request roots, candidate-run metadata,
historical issuance counters, served items, events, profiles, audits, attribution,
expiry, or erasure. A retired run shows its original counts and an explicit
retirement timestamp in Admin. Protected runs retain exact stage observations in
the version-1 compact payload. Unrepresentable or uncertain runs retain their
legacy rows and therefore block whole-table reclamation.

## Release and protection gates

1. Merge and deploy the additive migration and retirement-aware Admin reader
   through the normal PR-to-main path **before any early stage deletion**.
   Establish exact HTTP and worker revisions, health, drained old processes and
   a rollback image that understands both compact and retired states. Confirm
   the effective candidate trace write format on both roles. Never run this
   operator against production from a local worktree.
2. Refresh the original 64 quality-audit holdout IDs from the existing private
   holds artifact, retaining its original selector SHA-256. Add every active
   investigation run ID. Keep these files mode 0600 outside Git. The operator
   compares the sorted original 64 IDs with a pinned SHA-256 from that audit;
   a replacement 64-ID list fails even if its selector hash matches. Review
   current assignment, owner-release, shadow, experiment-exposure,
   promotion-fence, conflict and access-audit links; the operator checks those
   links again under row locks.
   Include other uncertain investigations in the private active list.
3. Select at most ten explicit, still-active legacy runs per reviewed manifest.
   Include protected runs so they are converted losslessly; unprotected runs
   may be retired. The freeze rejects any run whose full stage row set cannot
   be encoded and decoded with typed bidirectional `EXCEPT ALL` parity, whose
   counters or inherited expiry disagree, or whose source cannot be frozen.
   Such runs remain untouched. The manifest pins DB identity, root/run/stage
   fingerprint, protection set, cutoff, row/byte bounds and SHA-256 digest.
4. Review fresh free bytes, candidate-run TOAST allocation, WAL margin, DB
   write/error latency and retention backlog. DELETE frees tuples for database
   reuse; it does not promise filesystem-space recovery and conversion creates
   compact payload and WAL. Set a concrete stop threshold from current capacity.

## Finite operation

With the reviewed DB environment configured, run from `apps/admin`:

```bash
pnpm exec tsx src/scripts/retire-legacy-recommendation-detail.ts \
 --freeze /private/manifest.json --holds /private/holds.json \
 --run-ids /private/run-ids.json --created-before 2026-09-28T00:00:00Z
pnpm exec tsx src/scripts/retire-legacy-recommendation-detail.ts \
 --manifest /private/manifest.json
pnpm exec tsx src/scripts/retire-legacy-recommendation-detail.ts \
 --manifest /private/manifest.json --execute \
 --confirm-target REVIEWED_TARGET_DATABASE_HASH
```

The last command must run within 15 minutes of freezing. It processes one
manifest atomically: retention advisory lock first, then request and run locks,
then fresh protection and typed source checks. A changed link, stage row,
counter, root or expiry aborts the entire manifest. It writes an aggregate-only
receipt keyed by manifest digest; a replay reports `already-completed`.
Contention reports `retention-busy`; investigate before a deliberate retry.
There is no autonomous cohort loop. The database trigger rejects stage writes
to retired or compact runs if an old writer resumes. It locks the parent before
checking either state, so a writer queued behind conversion or retirement sees
the committed format. The operation reassesses source rows with a fresh
statement snapshot after waiting for any earlier stage writer to finish.

After each manifest, compare aggregate counts and original expiry, verify
protected Admin detail and access audit, verify retired Admin state and preserved
issuance counts, and measure latency/WAL/free bytes. Keep identifiers, payloads
and private manifests out of logs and tickets. Stop on an unexpected skip,
error, writer revision, headroom breach or retention backlog.

Physical reclamation is separate. Only after the stage table is **exactly
empty**, a separately reviewed migration may lock with a short bound, assert
emptiness in that transaction and restrictively truncate the table without
`CASCADE`. Do not infer that this operator made the table empty.
