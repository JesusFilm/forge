# Finite legacy recommendation detail campaign

This is preparation for a separately reviewed, finite production campaign. It
does not authorize executing a cohort, promoting the empty-table SQL, or
claiming filesystem recovery. The September 29 pilot manifests cannot be
replayed. Root owns production probes and mutation through the normal reviewed
release path.

## Admission

Refresh the source census, exact stage-row existence, original 64 holdouts,
active investigations, all linked protections, database target, both Admin
roles, compact writer flags, retention backlog, free filesystem bytes, WAL,
latency, and rollback image immediately before admitting a cohort. The
September 30 00:25 UTC census found 255,811 legacy runs, 21,130,665 declared
observations, 26,367 incomplete runs, and 46,322 zero-composed runs. These are
historical counts, not an eligibility or exact-row proof. The stage relation
remained 16,431,259,648 bytes and free filesystem space was 11,023,593,472
bytes. Actual retirement throughput, WAL amplification, and headroom must be
measured on a small reviewed cohort before increasing the finite roster.

Use a private, mode-0600 JSON array of explicit, **unexpired** run IDs from the
reviewed read-only source selection. Include all current protected and uncertain
unexpired runs in the roster if the goal is exact emptiness; the operator converts their
stored detail only after typed, bidirectional row parity. It retires only
unprotected runs that pass the existing strict selective predicate. A run with
an incomplete flag, zero composed items, or another selective failure is
preserved in compact form when exact representation succeeds. A row that
cannot be represented exactly remains in the legacy table and stops the
campaign. Expired roots are deliberately excluded: the operator rejects them
and normal bounded retention must clear their stage rows. Never skip a
retained row or broaden the deletion predicate to reach emptiness.

The reviewed roster is finite and ordered. Its plan pins a database identity
hash, cutoff, stop time, minimum free bytes, maximum WAL bytes, and SHA-256
digest. The plan can contain at most 300,000 IDs and live for at most 72 hours.
Each invocation handles at most 1,000 batches; each batch keeps the existing
ten-run, 4,000-row, 16 MiB and 30-second transaction bounds. The private batch
manifest is frozen just before execution and checks source fingerprint,
protection, counts, expiry and target again under locks. An aggregate-only
database receipt makes a committed batch replay idempotent. Private progress
and manifest files are mode 0600; they must stay outside Git and logs.

## Prepared commands

From `apps/admin`, with the reviewed database environment configured, the
operator can freeze a plan from the private roster:

```bash
pnpm exec tsx src/scripts/retire-legacy-recommendation-campaign.ts \
  --freeze-plan /private/campaign.json --run-ids /private/run-ids.json \
  --created-before 2026-09-28T00:00:00.000Z \
  --stop-after 2026-10-01T00:00:00.000Z \
  --min-free-bytes REVIEWED_MINIMUM --max-wal-bytes REVIEWED_MAXIMUM
```

Review the generated plan digest and target with the current fleet and source
evidence. The execution requires that digest, the target hash and a fresh
external capacity/fleet receipt before every ten-run batch:

```bash
pnpm exec tsx src/scripts/retire-legacy-recommendation-campaign.ts \
  --plan /private/campaign.json --holds /private/holds.json \
  --capacity /private/capacity.json --batch-dir /private/batches \
  --max-batches REVIEWED_BATCH_LIMIT \
  --confirm-plan REVIEWED_PLAN_DIGEST \
  --confirm-target REVIEWED_TARGET_DATABASE_HASH --execute
```

The capacity file is an independently refreshed, aggregate-only JSON object
with `measuredAt`, `targetDatabaseHash`, `filesystemAvailableBytes`,
`walBytes`, and boolean-true `httpHealthy`, `workerHealthy`,
`compactWritersConverged`, and `retentionHealthy`. It is rejected after two
minutes, on a target mismatch, below the reviewed free-space floor, above the
reviewed WAL ceiling, or if either role/retention gate fails. It is checked
again immediately after each freeze, before execution.

The private holds file is an envelope containing `reviewedAt`,
`sourceReceiptSha256`, and a `holds` object with the original
`qualitySelectorSha256`, `qualityRunIds`, and current
`activeInvestigationRunIds`. Reconcile the protected inventory from its real
source before each review; copying an old holds file with a fresh timestamp is
not a new source review. The envelope is rejected after two minutes. The
operator reopens it after freeze and before execution; a changed source digest
or hold set stops an uncommitted batch. Current database links are still
rechecked inside the transaction. The command logs only aggregate totals and
never self-selects a new cohort. Stop on a source/parity mismatch, expired
run, stale manifest, lock contention, stale receipt, latency regression or
shrinking headroom.

After a crash between database commit and progress-file replacement, resume
with the same reviewed plan. A saved manifest is validated against its plan
and the read-only aggregate ledger; a matching completed receipt advances
private progress without replaying deletion, even if current holds or capacity
changed afterward. An **uncommitted** saved manifest older than its 15-minute
freeze lifetime fails closed. Root must first prove its ledger receipt is
absent, reconcile current source/holds/capacity, quarantine the old private
file, and freeze a new batch under review. Never automatically overwrite an
uncertain or committed manifest, and never reuse the September 29 pilot files.

## Batch-aware two-phase CLI preparation

`apps/admin/src/scripts/retire-legacy-recommendation-detail-wave.ts` is a
prepared speedup for a separately reviewed operator release. It calls the
existing v2 freeze and execute service functions with **one Prisma process per
wave phase**. It does not change the ten-run, 4,000-row, 16 MiB or transaction
budgets, decide which IDs enter the fixed master, or retry a stopped wave.
The existing one-manifest CLI remains available.

The local operator must first prove the exact fixed-master membership and a
fresh, typed source baseline for the complete wave. Its frozen private input
pins the master and wave digests, target database, cutoff, deployed revision,
six source-file hashes, this CLI's own source hash, current hold-source review,
capacity/serving receipt, and a wave deadline shorter than 15 minutes. Every
run and root must expire more than five minutes after that deadline. The CLI
rechecks these gates before each freeze, dry run and ten-run execution. A
revision change requires a fresh explicit source review; neither the CLI nor
the operator silently accepts a new image.

The freeze phase writes one mode-0600, fsynced v2 manifest per batch without
database writes. The local operator must archive **every** manifest privately
and fsync an acknowledgement binding their ordered digests and file hashes
before invoking the execute phase. Execution requires that complete
acknowledgement, dry-runs every manifest first, then calls the existing
service once per ten-run transaction. The local operator creates an exclusive,
fsynced execution-attempt marker before spawning the remote process. Direct
CLI invocation or a transport retry after an uncertain result is not an
admitted production path. A transport failure requires read-only durable-ledger
and live typed-parity reconciliation before a new root-reviewed plan; expired
or uncommitted manifests are quarantined, never replayed automatically.

The final CLI receipt means only that its ten-run calls returned completed;
the independent read-only ledger/live proof remains required before crediting
progress. Expired members of the fixed master remain pending ordinary
retention, with no replacement IDs. An exact empty stage relation and a
separately reviewed restrictive reclamation migration are still required to
return the remaining allocation.

## Physical reclaim remains separate

Completing the roster proves only that its listed runs were processed. Reprobe
the entire stage relation with an exact existence check; any remaining row
blocks the prepared restrictive `TRUNCATE`. Even when exact emptiness is
observed, require a separately reviewed migration that locks with a short
budget and repeats `NOT EXISTS` under that lock in the same transaction before
truncating the single table without `CASCADE`. Keep the mixed reader and
compatible rollback image. Measure filesystem, relation, WAL and serving
health before and after the normal PR-to-main deployment. Feat-554's first two
loaded normal retention cycles and capacity proof remain open regardless of an
earlier physical reclaim.
