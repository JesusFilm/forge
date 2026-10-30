# Recommendation storage production rollout

Rollout owner: Nisal, executed through the authorized Codex task with independent
GPT-6 Sol verification. The user authorized continuing release, activation, and
verification on September 28 NZDT. Production changes followed normal reviewed
PR-to-main Railway autodeploys. All storage figures below use decimal GB.

## Release and immediate savings

[PR #2429](https://github.com/JesusFilm/forge/pull/2429) merged September 27 at
23:00:09 UTC, revision `2cc8105ffb00a9f595cefe10594bd8537561099f`. Its required CI
passed, including the real-PostgreSQL integration tests. The separately scoped
[PR #2432](https://github.com/JesusFilm/forge/pull/2432) repaired pre-existing CI
blockers before release: Expo patch-version alignment and an expired fixture
clock. No hooks or required checks were bypassed.

Migrations 0100–0102 finished at 23:07:07 UTC. Read-only catalog checks confirmed
the compact trace constraint is validated, the redundant nonunique index is
absent, and the unique stage-ordinal index remains valid. All seven stage counts
matched in the latest 100 legacy runs; four already carried an explicit
`evidence_complete=false` flag. No trace payloads were deleted or rewritten.

| Measurement                | Before release |                    Reader release |
| -------------------------- | -------------: | --------------------------------: |
| Snapshot UTC               |    22:51:26–33 | 23:08:38 DB / 23:11:54 filesystem |
| PostgreSQL database        |      39.719 GB |                         37.371 GB |
| Filesystem used            |      40.037 GB |                         37.693 GB |
| Filesystem available       |       8.838 GB |                         11.182 GB |
| Filesystem displayed usage |            82% |                               78% |
| Redundant index            |       2.374 GB |                            Absent |

The removed index measured **2.374 GB** immediately before deployment. Net free
space increased **2.344 GB** over this interval; concurrent writes, WAL, and
other background changes explain why these measures are not identical. The
physical filesystem remains 48.892 GB on the nominal 50 GB Railway volume.

Evidence: [before runtime](./rollout/pre-reader-release-runtime.json),
[before database](./rollout/pre-reader-release-database.json),
[reader runtime](./rollout/reader-release-runtime.json),
[catalog and stage parity](./rollout/reader-release-verification.json), and
[reader database](./rollout/reader-release-database.json).

## Compatible fleet and rollback floor

At 23:11:54 UTC, independent service inventory and process SSH checks confirmed
one active successful replica per role at the exact reader revision, older
processes drained, HTTP 200 health on both roles, web workflow runner disabled,
and worker workflow runner enabled. Both effective compact flags were unset,
meaning legacy writes. Each service honored its own Railway config file.

| Role   | Deployment ID                          | Retained dual-reader image                                                |
| ------ | -------------------------------------- | ------------------------------------------------------------------------- |
| Web    | `87ac0bf2-dc32-4660-a531-a52ab6b65b88` | `sha256:361adb9f76af66596a3f39978fcc12108bde6163e8c0b22ed0118c08c6162324` |
| Worker | `f7f75852-8c8c-4630-a345-1048c974c42f` | `sha256:4c3978686c53166a2ad44d24fbc3e3e7071f6ba8f2b69eb59d31058c3cf68e8d` |

Rollback may stop new compact writes but must retain a dual-format reader while
any compact request remains. Do not deploy an older row-only reader, undo the
schema, or recreate the redundant index. Follow
[the runbook](./storage-remediation-runbook.md) and
[the Admin operating guide](../../../apps/admin/docs/recommendation-trace-storage.md).

## Compact activation

At 23:12 UTC, `RECOMMENDATION_CANDIDATE_TRACE_FORMAT=compact` was staged on both
production Admin services with `--skip-deploys`. Filtered configuration readback
confirmed the key on both services; this did not change existing processes or
trigger a deployment. [Staging evidence](./rollout/compact-staged.json).

[PR #2433](https://github.com/JesusFilm/forge/pull/2433) passed its required CI and
merged at 23:13:09 UTC, revision `ea13e146faf4c188f9fb8d40c2b9dc1e33440751`.
Its Admin-scoped operating guide triggered both normal autodeploys. The code
still defaults to legacy in environments without the production flag.

At **23:25:17 UTC / September 28, 12:25:17 NZDT**, both actual processes were
verified at the activation revision with effective flag `compact`, HTTP 200,
correct opposite workflow-runner roles, one active successful replica each,
and all previous deployments drained. Web deployment ID:
`0fbd2b49-1eeb-46e0-81c7-4966ae8c02b4`; worker deployment ID:
`526e03b5-514a-4dfd-b6a1-18c307c0622c`.

The first compact write was **23:24:53.328 UTC**. The last observed legacy write
was **23:24:43.215 UTC**, with run expiry **October 26, 23:24:43.126 UTC /
October 27, 12:24:43 NZDT**. This horizon must be rechecked after any rollback
or resumed legacy writing; expiry alone does not prove the rows were purged.

The initial sample contained three compact and 100 legacy runs. All seven
stage counters matched their stored observations. Compact runs had zero legacy
child rows and zero incomplete-evidence flags; eight legacy sample runs carried
an existing incomplete-evidence flag, reported separately. Mean stored compact
payload value was 6,200.67 bytes over only three runs averaging 54.33 stage
observations. This excludes tuple/index/TOAST overhead and is not a physical
per-run savings estimate or representative traffic sample.

At that snapshot, filesystem free space was 11.171 GB (78% displayed usage),
DB size was 37.387 GB, WAL was 0.252 GB, and expired/overdue roots were both zero.
There were no lock waiters or transactions older than 30 seconds in the probe.

Evidence: [compact runtime](./rollout/compact-release-runtime.json),
[compact/legacy parity and horizons](./rollout/compact-release-verification.json),
[compact database](./rollout/compact-release-database.json), and
[reproducible bounded SQL](./rollout/compact-verification-probes.sql).
The horizon query's 23:13 UTC cutoff includes the normal rolling deployment
before fleet convergence; legacy writes within that interval are not evidence
of a post-convergence regression.

## Final initial-release recheck

At **23:38:26 UTC**, both processes remained healthy at the activation revision
with compact flags and the expected runner roles. The latest 100 compact and
100 legacy runs had zero mismatches across all seven stage counters, and compact
runs had zero legacy child rows. Two compact and eight legacy runs carried
`evidence_complete=false`; their stored stage counts still matched. Storage
parity preserves the existing evidence state and does not turn incomplete
upstream evidence into complete evidence.

There were **zero legacy writes after fleet convergence at 23:25:17 UTC**.
The last legacy write and expiry were unchanged. The 107 compact writes and
77 legacy writes counted from the activation merge include the normal rolling
deployment interval; the separate post-convergence counter distinguishes that
interval from resumed legacy writing.

Latest-100 stored payload values averaged 9,369.52 bytes (minimum 25, maximum
35,289), with a mean 85.44 stage observations. The payload sample remains a
value-size measurement excluding tuple/index/TOAST-page overhead, not a physical
storage comparison or future capacity bound.

Filesystem availability was **11.199 GB**, displayed usage 78%. At 23:39:06 UTC,
the database occupied **37.392 GB**, the legacy stage relation **18.393 GB**,
and the candidate-run relation **0.203 GB**. WAL was **0.201 GB**, with no
replication slots. No expired or overdue request roots existed. The retention
ledger still showed its September 27, 10:30 UTC success with zero roots deleted;
loaded request purging remains unproven. Changes over this short interval,
including WAL recycling, do not establish a sustainable daily growth rate.

Evidence: [final runtime](./rollout/compact-observation-runtime.json),
[final parity and horizons](./rollout/compact-observation-verification.json),
[final database](./rollout/compact-observation-database.json), and
[final bounded SQL](./rollout/compact-observation-verification-probes.sql).

## Initial operational observation

The baseline log window was September 27, 21:33–22:03 UTC on Admin revision
`e7630a12629c3f4fa1507658bd5d290837fd7061`. It contained 471 web delivery events:
280 HTTP 200 and 191 expected HTTP 403 request rejections, with no observed 5xx
or delivery timeouts. The 280 seeded Admin completions comprised 243 served,
24 empty, 12 fallback, and one unavailable; five selection events resolved.
No runtime error code or timeout fallback was observed. Candidate inserts had
257 completed timings, zero timing errors, mean 122.96 ms, p95 267.77 ms,
and maximum 356.71 ms.

[Baseline evidence](./rollout/observer-baseline.json) is best-effort indexed
logging, not a complete HTTP denominator. Insert timings are application/driver
wall time, not isolated PostgreSQL execution. There were no independent database
wait samples in that window, so lock/I/O waits are unknown. No retention job
ran in the log window; the durable ledger provides retention evidence.

The populated post-activation window was **23:26–23:36 UTC** on exact Admin
revision `ea13e146faf4c188f9fb8d40c2b9dc1e33440751`, with observations in every
minute and indexing confirmed beyond the window. Web's release also changed
between windows, from `a7be679` to `08c7227`; these are different populations
and releases, not a controlled comparison.

| Observed measure                             |        Baseline: 30 minutes |      Compact: 10 minutes |
| -------------------------------------------- | --------------------------: | -----------------------: |
| Web delivery events                          |                         471 |                      132 |
| HTTP 200 / HTTP 403                          |                   280 / 191 |                  79 / 53 |
| Observed Web 5xx / delivery timeout          |                       0 / 0 |                    0 / 0 |
| Admin seeded completions                     |                         280 |                       79 |
| Served / empty / fallback / unavailable      |           243 / 24 / 12 / 1 |          67 / 10 / 1 / 1 |
| Selection resolved                           |                           5 |                        1 |
| Observed Admin error code / timeout fallback |                       0 / 0 |                    0 / 0 |
| Completed candidate-insert timings           |                         257 |                       78 |
| Insert mean / p95 / maximum                  | 122.96 / 267.77 / 356.71 ms | 14.84 / 39.25 / 44.75 ms |
| Unfinished insert timings / timing errors    |                       0 / 0 |                    0 / 0 |

The initial observation found no logged issuance-error or semantic-timeout
regression, and completed insert timings were lower. It does not establish a
complete error rate, causal latency improvement, sustainable daily storage
slope, or loaded purge capacity. Database wait-sampler events remained absent,
so wait behavior over the windows is unknown even though point-in-time SQL
found no lock waiters. [Post-activation evidence](./rollout/observer-postactivation.json).

## Capacity, retention, and remaining proof

The writer retains every observation and source-evidence field for the existing
29-day request lifetime. The isolated PostgreSQL fixture measured **75.1% less
trace storage** after excluding the redundant index from the legacy baseline;
this is not a measured 75.1% reduction in the whole production database.
Legacy table files remain allocated while new compact payloads accumulate.
The illustrative 10–17 GB overlap is not a production forecast or bound.

Current free space does **not** yet prove margin for the full 29-day transition.
The proposed nominal 75 GB Railway volume buffer has **not** been applied:
the available Railway browser session requires sign-in, and the supported CLI
and public API do not expose the resize action. Compact activation reduces
incoming storage compared with continued legacy writes, but does not close this
capacity obligation. Monitor the actual disk slope and secure the buffer
through the authenticated volume settings. The public Railway volume guidance
confirms resizing is managed from the volume panel, allocated ceilings cannot
be reduced, and billing follows used storage:
[volume reference](https://docs.railway.com/volumes/reference) and
[live resizing](https://docs.railway.com/volumes#live-resizing-the-volume).
Inspect the actual account settings and any applicable limits before applying it.

The first request expiry is September 30 at **00:20:47.858 UTC / 13:20:47 NZDT**.
Daily retention runs at **10:30 UTC / 23:30 NZDT**. Verify actual deleted roots,
descendant counts, batch time, continuation, oldest-expired age, errors, locks,
WAL, and capacity during the first nonempty purge and the following daily
cycle. The existing successful zero-root runs do not prove loaded throughput.

The active `recommendation-storage-follow-up` heartbeat checks every six hours
and reports meaningful changes or failures, including available space below
5 GB or projected exhaustion within seven days. It is a local Codex follow-up
and requires the computer to be on with the app running. It tracks feat-554
through the first two loaded cycles and capacity verification, then feat-555
through safe physical reclamation. These time-dependent checks remain open.

An authenticated production Admin UI trace-detail check also remains pending
sign-in. Real-PostgreSQL integration tests exercise the actual full detail
reader in legacy, mixed, compact-only, and empty-stage cases. Guarded production
SQL checks are separate storage evidence; neither is reported as a successful
production UI check. No authentication bypass or invented access-audit actor
was used.

After every legacy writer has drained, record its final write and expiry.
Any legacy rollback moves that horizon forward. Only after all legacy request
roots expire and are purged may feat-555 deploy its reviewed empty-table
reclamation migration. Ordinary purge/vacuum does not promise filesystem
shrinkage, and no retained trace is to be deleted to accelerate reclamation.
