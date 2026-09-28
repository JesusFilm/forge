# Selective lossless legacy recommendation conversion

This operation changes only representation. It stores every representable legacy
stage observation in the existing version-1 payload, validates typed SQL parity,
then deletes those redundant stage rows in the same transaction. Request/run rows,
served items, source JSON, counters, versions, receipts, playback, outcomes and
original expiry remain. It changes no ranking and extends no retention lifetime.

Conversion can increase compact-table/TOAST allocation and WAL while old stage
files remain allocated. DELETE guarantees **no immediate filesystem-space relief**.
Empty-table reclamation belongs to feat-555. Do not rewrite a live table here.

## Prepare a reviewed private pilot

Before any conversion, freeze the original 64 quality-audit run IDs using the
unchanged population and sampling CTE from the September 28 quality audit's
`sampling.sql`. Replace its final redacted projection with internal `run_id`
selection; retain the exact selector SHA-256 and timestamp privately. Never
rediscover these holdouts from a population changed by conversion. Materialize
active investigation run IDs as well; absence of engagement is not a bot label.

The original private audit bundle is `legacy-recommendation-quality/outputs/`.
Its `sampling.sql` SHA-256 is
`c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1`.
The initial 64 unique IDs were frozen at `2026-09-28T01:42:55.049110Z`.
Keep that original private holds file and bundle together; this receipt contains
no run identifiers.

The frozen holds, manifest and verification receipts were also saved in the
private local investigation bundle
`recommendation-traffic-isolation/outputs/private-pilot/` under the September 28
Codex documents. The directory is mode 0700 and files are mode 0600; no database
credentials or trace payloads were copied. Use its original holds for later
review, rather than depending on temporary files or resampling changed data.

Create a mode-600 holds JSON file with `qualitySelectorSha256`, exactly 64 unique
`qualityRunIds`, and `activeInvestigationRunIds`. These exclusions protect against
this operation only: ordinary expiry/privacy deletion still applies. If evidence
must survive expiry, agree a separate bounded, privacy-safe preservation action.

### Identify a finite older candidate cohort

Use a read-only connection and bind `$1`/`$2` to a reviewed UTC interval of at
most one day, ending at least 14 days ago. Bind `$3` to the combined private
quality/investigation hold IDs. This query uses the indexed run creation window
and indexed request/run links; it neither scans stage payloads nor classifies
traffic retrospectively. Retain returned IDs only in the mode-600 private review
artifact. Keep the displayed review receipt to interval, generator, count and
counter totals. Never infer recoverable filesystem bytes from those counters.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
SELECT c.id AS run_id, c.generator_version, c.created_at,
       c.nominated_count+c.canonicalized_count+c.deduplicated_count+
       c.rejected_count+c.scored_count+c.ordered_count+c.composed_count
       AS generated_observations
FROM recommendation_candidate_run c
JOIN recommendation_request r ON r.id=c.request_id
WHERE c.created_at >= $1::timestamptz AND c.created_at < $2::timestamptz
  AND $2::timestamptz <= now()-interval '14 days'
  AND $2::timestamptz-$1::timestamptz <= interval '1 day'
  AND c.trace_format_version IS NULL AND c.trace_payload IS NULL
  AND NOT(c.id=ANY($3::text[]))
  AND c.evidence_complete AND c.composed_count>0
  AND c.generator_version<>'seeded-curated-empty-fallback-v1'
  AND r.result IN ('served','fallback') AND r.expires_at>now()
  AND r.experiment_assignment_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM recommendation_shadow_run s
                 WHERE s.request_id=r.id OR s.live_candidate_run_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM recommendation_experiment_exposure s WHERE s.request_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM recommendation_promotion_slate_fence s WHERE s.request_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM recommendation_conflict s WHERE s.request_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM recommendation_trace_access_audit s WHERE s.request_id=r.id)
ORDER BY c.created_at,c.id
LIMIT 10;
COMMIT;
```

Parameters must be bound by the read-only SQL client, not interpolated into
shell commands. Review one interval at a time; do not install a background loop.
Discovery is an inventory, not proof that the stage payload is representable.
Freeze performs the full indexed per-run shape/count/precision check. Use the
same original holds for every subsequent reviewed manifest, and add newly opened
investigations before freezing another pilot.

Review at most ten explicit run IDs in another private JSON array. Start with
complete positive seeded runs older than 14 days. The service rejects incomplete,
empty/unavailable, curated fallback, experiment-assigned, shadow-linked,
experiment-exposed, promotion-fenced, conflicted or previously accessed runs.
Invalid shape, inherited-expiry mismatch, generated/actual counter mismatch or
timestamp precision loss rejects a freeze. Existing compact traces are skipped
when replaying an already frozen manifest.

From `apps/admin`, with the reviewed database environment already configured:

```bash
pnpm exec tsx src/scripts/convert-legacy-recommendation-traces.ts \
  --freeze /private/pilot.json --holds /private/holds.json \
  --run-ids /private/pilot-run-ids.json \
  --created-before 2026-09-14T00:00:00Z --max-bytes 4194304
pnpm exec tsx src/scripts/convert-legacy-recommendation-traces.ts \
  --manifest /private/pilot.json
```

Freeze performs no database writes and creates a new mode-600 file without
overwriting. The manifest records target database identity hash, exact selector
cutoff, holds, candidate source fingerprints, row/byte budgets and a SHA-256
digest. Do not commit manifests, hold IDs or raw traces. Output contains only
aggregate counts, manifest digest and the target hash, never connection secrets.

## Execution gate and finite bounds

Before executing, review the exact manifest and zero unexpected skips; verify
disposable-DB parity/rollback tests and compact reader/writer fleet convergence.
Refresh filesystem free bytes, candidate-run/TOAST allocation, WAL/replication
state and serving latency. The old ~11.2 GB free reading is not current evidence.
Agree a conservative free/WAL headroom floor and sample representative compact
bytes/peak WAL; no universal threshold can be inferred from logical tuple bytes.

Only after those gates, explicitly confirm the manifest's database identity hash:

```bash
pnpm exec tsx src/scripts/convert-legacy-recommendation-traces.ts \
  --manifest /private/pilot.json --execute \
  --confirm-target REVIEWED_TARGET_DATABASE_HASH
```

One invocation processes one finite manifest and one atomic transaction. Bounds
are ten runs, 4,000 actual stages, a default 4 MiB encoded payload budget and hard
16 MiB ceiling, 1-second lock timeout, 10-second statement timeout and 30-second
transaction deadline. There is no automatic whole-cohort loop. Coordinate the
retention advisory lock first, then lock root and run; recheck all exclusions and
fingerprints. Any parity, update or deletion-count mismatch rolls back the entire
pilot. Retention contention returns `retention-busy`; stop and retry deliberately.

Stop on serving latency/error growth, new legacy writers, unexpected eligibility
changes, lock waits, serialization errors or headroom below the agreed floor.
Execution rechecks every candidate and can commit eligible runs while skipping
changed, expired or already converted runs. Any unexpected skip means stop before
another manifest and inspect the private bounded cohort. A rerun of a fully
converted manifest is expected to skip every run. No skip deletes source data.
Do not automatically retry an ambiguous failure: inspect the bounded manifest's
format/count state. Version 1 is the committed checkpoint; rerunning skips it.
Confirm no legacy stages remain for converted runs, unchanged parent counts and
expiry, and equal Admin detail. Measure peak WAL/new payload allocation, free
bytes and deletion duration before reviewing another finite pilot.

Save this baseline privately immediately before execution, binding `$1` to the
manifest's at-most-ten IDs. Compare it after execution. The hash intentionally
excludes only the two representation fields that conversion changes. A concurrent
ordinary expiry can remove a root; investigate that separately from parity.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
SELECT c.id AS run_id, md5(jsonb_build_object(
  'request',to_jsonb(r),
  'run',to_jsonb(c)-'trace_format_version'-'trace_payload',
  'items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
    FROM recommendation_served_item i WHERE i.request_id=r.id),'[]'::jsonb)
)::text) AS preserved_parent_hash,
c.trace_format_version,
(SELECT count(*) FROM recommendation_candidate_stage_evidence e
 WHERE e.run_id=c.id) AS legacy_rows,
CASE WHEN c.trace_format_version=1
  THEN valid_recommendation_candidate_trace_v1(c.trace_payload)
  ELSE NULL END AS valid_compact
FROM recommendation_candidate_run c
JOIN recommendation_request r ON r.id=c.request_id
WHERE c.id=ANY($1::text[]) ORDER BY c.id;
COMMIT;
```

For each converted run expect the same parent hash, version 1, zero legacy rows,
and `valid_compact=true`. Keep both snapshots private. The service itself compares
every original stage value in both SQL directions before committing deletion.

## Disposable capacity observation

On September 28, one checkpointed local PostgreSQL pilot converted ten synthetic
semantic runs (40–64 candidates each), totaling 2,720 stage rows and 1,698,797
encoded bytes. Freeze took 1,198 ms, dry run 1,160 ms and execution 2,565 ms.
Candidate-run allocation including TOAST/indexes grew by 237,568 bytes; WAL insert
position advanced by 1,771,896 bytes. Stage allocation remained 2,211,840 bytes
despite zero remaining stages for the pilot. All ten request/run parents and 60
served items retained their original values and expiry.

This is one synthetic observation, not a production capacity forecast or a
continuous peak measurement. Production needs its own bounded receipt and fresh
free-space/WAL/serving checks; do not multiply these figures into promised GB.

## Completed production pilot

The first frozen ten-run manifest was converted on September 28 at 02:54:53 UTC
from reviewed PR #2441 after both Admin roles converged on `392c71f8a`. It removed
689 redundant stages and retained all 519,932 encoded bytes of observations,
with zero skips. Subsequent SQL checks matched all ten original fingerprints,
all parent/item/expiry hashes, and all 689 retained observations. The original
64 quality holdouts remained excluded. No further batch followed.

The operator required 10,000,000,000 free bytes and a 64 MiB global WAL review
threshold. The measured interval generated 4,983,336 global WAL bytes; available
filesystem space afterward was 11,207,565,312 bytes. Legacy relation allocation
was unchanged. These include concurrent production work and do not establish
isolated cost or peak bounds. This receipt does not authorize automatic replay,
larger batches or a table rewrite. Review fresh conditions for any later batch.
See the [validation receipt](../validation/recommendation-traffic-isolation-20260928/README.md)
for exact measurement times and limits.

## Rollback order

If traffic isolation needs reverting, release Web/shared operation documents
first and verify Web convergence before reverting the additive Admin contract.
Old Admin cannot accept the new operation arguments. Failed conversion
transactions roll back atomically. After a committed conversion, retain the
compact-compatible reader and stop further batches; this command does not
implement reverse conversion.

## Verification

Root serializes tests against its disposable PostgreSQL database with all
migrations. Set `RECOMMENDATION_DB_TEST=1` only for that owned database and run
the conversion service/CLI unit tests and conversion DB suite. Cases cover nested
JSON/numeric precision, exact typed stage equality and full reader parity,
dry-run, rerun, exclusions, changed source/holds/target, deletion-count rollback
and retention contention. Existing compact validator coverage supplies malformed
payload checks; conversion additionally compares both SQL row sets, including
IDs, timestamps and original inherited expiry.
