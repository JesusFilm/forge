# Production database storage investigation

Investigated on September 28, 2026 NZDT, with production measurements taken
September 27 at 20:37–20:40 UTC. Branch: `codex/investigate-prod-db-storage`.
Source baseline: `7bfed3f9f`. Investigation ticket: feat-552. Remediation: feat-553.

## Finding

Recommendation observability is the dominant consumer of the Admin production
database. Recommendation tables and their indexes occupy **28.38 GB, or 71.8%
of the 39.51 GB database**. The candidate-stage evidence table alone occupies
**20.60 GB (52.1%)**, including **8.27 GB of indexes**.

Every admitted seeded recommendation delivery persists detailed candidate
observations at nomination, canonicalization, deduplication, rejection,
scoring, ordering, and composition. The same candidate and its source metadata
appear at several stages. This happens for ordinary traffic without a trace
sampling gate. Each row is individually bounded, but the total is requests ×
candidate observations × 29 days × row/index bytes.

The tracing design and duplicate index were introduced by **PR #1976**, authored
by **Nisal Cottingham / Kneesal**, merged August 31. Production applied the
relevant migrations that day, and the earliest retained request is September 1.
It is therefore accurate to connect the growth to that recommendation rollout.
This evidence identifies the technical change; it does not establish sole
personal responsibility for deployment, review, or capacity planning.

## Fresh production evidence

All decimal GB values below use 1,000,000,000 bytes. GiB values, where explicitly
shown, use 1,073,741,824 bytes. Relation totals already include their indexes.

| Measurement                                                     |                                               Result |
| --------------------------------------------------------------- | ---------------------------------------------------: |
| Filesystem usage at 20:39:56 UTC (`df -B1`)                     | 39.783 GB used / 48.892 GB filesystem; 82% displayed |
| Filesystem available space                                      |                                             9.092 GB |
| PostgreSQL database size                                        |                                            39.511 GB |
| All 53 `recommendation_*` tables, including indexes             |                                            28.381 GB |
| `recommendation_candidate_stage_evidence`, including indexes    |                                            20.598 GB |
| Candidate-stage table data, including TOAST/free-space metadata |                                            12.323 GB |
| Candidate-stage indexes                                         |                                             8.275 GB |
| `recommendation_served_item`, including indexes                 |                                             2.378 GB |
| `recommendation_playback_fact`, including indexes               |                                             1.369 GB |
| `video_transcript_chunk`, including indexes                     |                                             4.064 GB |
| `workflow.workflow_events`, including indexes                   |                                             2.251 GB |
| WAL directory                                                   |                     0.201 GB; zero replication slots |
| Requests in preceding 24 hours                                  |                                               10,580 |
| Retained request roots, exact count in follow-up snapshot       |                                              255,244 |
| Candidate-stage live rows, statistics estimate                  |                                       20.287 million |

The evidence table has only 312 estimated dead tuples and a recent autovacuum.
These are approximate statistics, not a physical bloat measurement, but the
observed growth is well explained by live retained evidence. WAL/replication-slot
retention is not the dominant source in this snapshot.

The Railway `DISK_USAGE_GB` series rose **39.624 → 41.174 GB** between September
26 and 27 at 20:36 UTC: **+1.550 GB in 24 hours**. Its absolute value differs
from `df` and `pg_database_size`; these are separate accounting surfaces, not
interchangeable totals. Using `df` available space and that measured growth
gives **5.9 days** of linear headroom. Using the reported 50 GB allocation and
Railway's metric gives 5.7 days. These are scenarios, not exhaustion-date
guarantees: traffic, purge, vacuum, and other writes can change the slope.

Raw aggregate evidence: [production measurements](./production-measurements.json),
[amplification measurements](./amplification-measurements.json),
[volume series](./railway-volume-metrics.json), and
[filesystem measurement](./filesystem-measurement.json).

## Why one recommendation produces so much data

`apps/admin/src/services/recommendations/orchestration.ts` constructs a separate
row at each candidate-processing stage. `delivery.service.ts` persists every
entry in `platform.evidence`, including repeated `sourceEvidence` JSON.
`candidate-evidence-persistence.ts` bulk-inserts those rows; batching reduces
application overhead but does not reduce their number or storage.

Persisted run counters report 20,962,692 stage observations across 254,360 runs:
**82.4 per run over the full retained period**. This is a sum of stored counters,
not an exact count of the large stage table. An indexed 100-run spot check
confirmed actual rows across all seven stages. The latest 1,000-run sample
averaged **113.4 observations** for **4.55 composed items**; this recent sample
is not a whole-period average.

| Run cohort          |    Runs | Mean observations/run | Mean observations/day |
| ------------------- | ------: | --------------------: | --------------------: |
| September 1–15 UTC  | 134,652 |                  63.8 |               572,488 |
| September 16–26 UTC | 111,042 |                 103.6 |             1,045,710 |

Current persisted generator summaries further distinguish the cost:

| Generator                     |    Runs | Mean stage observations/run |
| ----------------------------- | ------: | --------------------------: |
| Semantic                      | 222,235 |                       62.86 |
| Semantic/profile hybrid       |  26,638 |                      195.88 |
| Curated empty-result fallback |   5,487 |                      323.57 |

The curated fallback retrieves up to 64 nominations. Repeating that pool across
stages explains why this path can write hundreds of rows to deliver a handful
of cards. Its first production run was September 16 at 01:53:50 UTC, after
PR #2317 introduced it. The before/after cohorts show increased amplification;
they do not isolate every contributor to that increase or prove one PR explains
all additional bytes.

## Duplicate index: verified and avoidable

Both indexes are valid B-trees over exactly `(run_id, stage, ordinal)`:

| Index                                          | Purpose                             |                 Size |
| ---------------------------------------------- | ----------------------------------- | -------------------: |
| `recommendation_candidate_stage_ordinal_key`   | Backs the UNIQUE constraint; retain |             2.357 GB |
| `recommendation_candidate_stage_run_stage_idx` | Duplicate non-unique access path    | 2.358 GB / 2.196 GiB |

Migration `0058_recommendation_candidate_platform/migration.sql` declares the
UNIQUE constraint and then explicitly creates the second index. Prisma's
`RecommendationCandidateStageEvidence` model likewise declares both
`@@unique` and `@@index` on the same columns. PostgreSQL already creates an
index for the unique constraint. Removing the non-unique duplicate can reclaim
its current 2.36 GB and stop maintaining a second copy on new inserts. It buys
roughly 1.5 additional days at the observed slope; it does not address the
remaining tracing volume. Preserve the unique constraint and its index.

See [PostgreSQL unique-index documentation](https://www.postgresql.org/docs/18/indexes-unique.html).
The supplied 2.15 GiB figure is consistent with an earlier, smaller snapshot;
the fresh measurement is 2.196 GiB.

## Retention is running, but its main deletion workload has not started

- Code sets an immutable request expiry 29 days after issuance begins. Children
  inherit that expiry and cascade from the request through its candidate run.
- Oldest request creation: **September 1, 00:20:48.742 UTC**.
- First expiry: **September 30, 00:20:47.858 UTC**, or **13:20:47 NZDT**.
  The sub-second difference from creation reflects the earlier application
  timestamp used to compute expiry.
- There are **zero expired and zero overdue request roots**.
- The retention ledger has **29 successful runs, zero request roots deleted**,
  and 10 lock-skipped runs. The latest success is September 27 at 10:30 UTC.
- Cleanup is deleting other expired data: the latest run removed 8,707 profile
  projection runs and 13,789 profile session links, among other records.
  Therefore “cleanup deletes nothing” is true only of the request-root traces.

The scheduler runs at **10:30 UTC daily (23:30 NZDT)** with 500 request roots
per purge transaction. It can process up to eight batches or 30 seconds per
catch-up step, then continue after one minute while overdue roots remain.
It is incorrect to describe its total capacity as only 500 roots/day.

However, catch-up uses `overdueAfterRun`, which becomes true only when the oldest
remaining expired record is **24 hours past expiry**. Newly expired backlog
does not trigger continued draining. This can leave records that cross the
overdue threshold before the next daily run; retention health can then refuse
attributed delivery. The actual cascade throughput and locking behavior under
production-size deletion load remain untested. No delete or rollback-delete
benchmark was run on production.

Even perfect deletion throughput will not immediately balance writes:
September 1's cohort contains about **487,000** stage observations, whereas
September 26 added **1.02 million**. The first expiring cohorts are smaller than
the current incoming cohorts. The original 29-day storage envelope no longer
reflects the current request mix.

Deleting rows also does not guarantee a falling disk-usage chart. Ordinary
vacuum generally makes their space reusable inside PostgreSQL. Table rewrites
such as `VACUUM FULL` need locks and additional disk space and are not the
default response on an almost-full live volume. See
[PostgreSQL vacuum documentation](https://www.postgresql.org/docs/18/routine-vacuuming.html#VACUUM-FOR-SPACE-RECOVERY).

## Change attribution

| Change                                                                                                                   | Evidence                                                                                                                                                  | Assessment                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #1976](https://github.com/JesusFilm/forge/pull/1976), `96dc3aeee`, merged August 31 03:23 UTC                        | Introduced migrations 0052/0058/0069, 29-day retention, per-stage persistence, and the duplicate index. Production applied those migrations at 03:30 UTC. | Origin of the observed storage mechanism. Author: Nisal Cottingham.                                                                                              |
| [PR #2317](https://github.com/JesusFilm/forge/pull/2317), `3028f3305`, merged September 16 01:27 UTC                     | Added curated empty-result fallback; up to 64 nominations traverse the same evidence pipeline. The generator first appears in production at 01:53 UTC.    | Verified additional high-amplification path. Cohort growth also reflects traffic and generator mix. Author: Nisal Cottingham.                                    |
| [PR #2388](https://github.com/JesusFilm/forge/pull/2388), `4ec1f9820`, merged September 22 22:45 UTC / September 23 NZST | Replaced Prisma `createMany` with a bound JSON bulk insert for the same `platform.evidence` mapping.                                                      | Did not introduce this table, retention policy, or duplicate index. End-to-end effects on successful traffic volume were not isolated. Author: Nisal Cottingham. |

## Recommended actions

1. **Secure capacity now.** Review a volume increase or the documented serving
   control as an immediate contingency. Size headroom for ongoing writes,
   purge WAL, and maintenance. No capacity or serving setting was changed.
2. **Remove the redundant non-unique index through the normal PR-to-main
   migration process.** Remove its Prisma declaration, retain the UNIQUE
   constraint, and use a reviewed migration/locking strategy. Do not edit the
   already-applied migration.
3. **Reduce ongoing tracing storage.** Preserve request outcomes, served-item
   attribution, and stage counters while reviewing shorter detail retention,
   sampled detailed traces, or compact per-candidate evidence. This changes the
   current complete-trace contract; define the new contract explicitly and
   check Admin detail, evaluation, and privacy dependencies before changing it.
4. **Exercise retention before September 30.** On an isolated production-shaped
   fixture, verify cascade correctness, purge rate above incoming volume,
   bounded transactions, vacuum reuse, and continued scheduling with younger
   expired backlog. Add evidence of actual deleted roots to health reporting.

Tracked in [feat-553](../../roadmap/platform/feat-553-production-recommendation-storage-remediation.md).

## Verification and limits

Production access was read-only: `df`, Railway volume metrics, PostgreSQL
catalog/statistics reads, aggregate counts, and a 100-run indexed sample. SQL
connections enforced `default_transaction_read_only=on`, a 10-second statement
timeout, and a 1-second lock timeout. The public database connection attempt
did not complete; probes succeeded through Railway SSH using the service's
local `psql`. No credentials, viewer identifiers, or raw payloads were retained.

[probes.sql](./probes.sql) and [amplification-probes.sql](./amplification-probes.sql)
are the repeatable measurement inputs. Source/migration history and GitHub PR
metadata corroborate attribution. SQL results are separate short snapshots,
so counts can differ slightly as traffic arrives. Row estimates are labeled;
no full scan of the large evidence table was required. This is a completed
investigation, not a completed capacity remediation.

Local verification passed: Prettier formatting, ticket ID uniqueness and
required frontmatter, reciprocal dependencies, all 15 expected production probe
results, aggregate arithmetic, read-only SQL checks, and report artifact links.
Application tests were not run during that investigation-only phase because no
application code had changed. The subsequent implementation and its application
tests are recorded in [implementation-validation.md](./implementation-validation.md).
See [storage-remediation-runbook.md](./storage-remediation-runbook.md) for the
reader-first rollout; production verification remains feat-554.
