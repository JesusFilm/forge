# Legacy trace cleanup: persistent-session production evidence

This is a historical checkpoint through September 30, 2026, 07:15 UTC. Reconcile
actual production revisions, health, private attempts, ledger and disk before
another operation. The aggregate receipts are in the task's local
`outputs/heartbeats/legacy-session-pilot-*` directories, referenced by
`outputs/heartbeats/latest.json`. No request identifiers or trace payloads are
published here.

## Completed finite cohorts

PR #2519 isolated CLI diagnostics from its NDJSON control stream. Both actual
Admin roles and the seven operator source files were verified at deployed revision
`f8f1a2ee3081d4b788e3aa4bd5d00d013fdb7d0c`. A local collector timestamp fix preserves
the original serving observation instant while serializing it as UTC `Z`. A local
launcher cache fix refreshes on either measurement age or serving-observation age;
it does not extend the 120-second serving guard or restamp stale evidence.

| Fixed master waves |  Runs | Converted losslessly | Detail retired | Stage rows removed | Session duration |
| ------------------ | ----: | -------------------: | -------------: | -----------------: | ---------------: |
| 16–21, 23–26       | 1,000 |                  720 |            280 |             65,315 |        203.796 s |
| 27–36              | 1,000 |                  101 |            899 |             76,871 |        174.711 s |
| 37–46              | 1,000 |                  138 |            862 |             79,921 |        181.393 s |
| 47–56              | 1,000 |                   79 |            921 |             73,426 |        175.167 s |

The first session completed at 06:49:21 UTC; independent read-only reconciliation
passed at 06:54:36. The second completed at 06:58:28; independent reconciliation
passed at 06:58:34. The third and fourth reconciled at 07:04:30 and 07:10:12.
Each had exactly 100 committed manifests with matching durable
ledger counts and typed SQL fingerprints for request roots, served items, run
metadata, original expiry and every retained observation. All four preserved all 64
original audit holdouts and their 8,621 observations. Each consumed approval and
execution attempt is terminal: never replay it.

The first cohort's compact payload columns occupied 5,467,284 bytes, compared with
30,721,711 bytes of logical JSON text. The second occupied 104,341 versus 362,167
bytes. These are column-value measurements; they exclude tuple, index and TOAST
page overhead and are not filesystem savings or a representative traffic mix.

## Reconciled partial session

The preceding 06:27 session processed 180 runs: 167 lossless conversions, 13
retirements and 11,873 removed stage rows. Its cached serving observation crossed
120 seconds while the collection itself was only 38.7 seconds old. The client
refused the next execute. A bounded aggregate query found four healthy requests
during the cached interval, confirming that the local cache needed refreshing.

Read-only reconciliation at 06:44:44 proved 18 exact committed ledgers and live
after-state parity. A nineteenth frozen and acknowledged manifest had no ledger,
no execute attempt and unchanged before-state for its ten runs. The other 810
runs were never frozen. All 64 holdouts and 8,621 observations matched. The new
sessions used fresh selections and approvals; this partial approval was not
replayed. Wave 15's last twenty runs remain deferred for a later explicit subset.

The launcher fix passed deterministic refresh, genuine-staleness, future-time,
wrong-order, disconnect, nonzero-final-exit and replay-refusal tests. Independent
review cleared the exact launcher, collector and client hashes before the next
production session. The separate read-only reconciliation helper passed nineteen
local checks, including corrupted ready/final frames, and independent review.

## Capacity and remaining scale

At 07:14:56 UTC, direct filesystem availability was **11,060,748,288 bytes**;
WAL allocation was 150,994,944 bytes. Both actual Admin roles were healthy,
compact writers were converged, retention health passed and no lock waiters were
observed. The bounded persisted-request sample had 52 observations, retrieval
p95 265 ms, maximum 349 ms and no unexpected outcomes. This is a small sample,
not universal latency or unpersisted-error proof.

The legacy relation still allocated **16,431,259,648 bytes**: 12,424,642,560 table
bytes, 4,003,151,872 index bytes and 3,465,216 auxiliary bytes. **No new filesystem recovery is credited to
these row deletions.** They make pages reusable inside PostgreSQL. Physical
reclamation requires exact emptiness and a separate reviewed guarded migration.

The immutable master's remaining membership after these verified operations is
221,389 runs, before reconciling ordinary expiry. The four observed session rates
imply roughly 11–13 hours of processing alone if the same rates held. This excludes
fresh reviews/admission, serving pauses, expiry, oversized or unrepresentable
records and the final reclamation release. It is not a completion promise or
approval for an unattended whole-population loop.

A separate bounded check at 07:09:30 found no resumed legacy writer or missing
compact payload among 17,471 post-convergence runs; its 100,001-row cap was not
reached. The last actual legacy write remains September 27 at 23:24:43.215 UTC,
with an original maximum expiry of October 26 at 23:24:43.126 UTC. Early selective
retirement does not change those original expiry timestamps.

Whole wave 22 still contains an original holdout and was excluded from the first
speed cohorts. Waves 1–3 were deferred because of expiry. These and partial-wave
remainders must be reconciled explicitly; none can be omitted from the eventual
exact-empty proof. Normal privacy expiry continues to apply to every holdout.

## Gates still open

The deployed operator at this checkpoint requires fixed 1,000-run cohorts, all
original holdouts present and a September 30 10:25 UTC stop. A separately reviewed
successor may support explicit partial cohorts and expired-hold accounting only
when both original run/root expiry have passed and the parent is actually absent.
Preparation is not deployment or permission to bypass the current operator.

The September 30 10:30 UTC retention run and following daily cycle still require
loaded ledger proof for feat-554. Earlier manual cleanup is not that evidence.
Feat-575 remains open through the finite cleanup; feat-555 through actual guarded
physical reclamation and filesystem verification. Feat-574 still requires
representative growth measurements of the deployed packed served items, shared
profile vectors and omitted first-empty generations/pointers.
