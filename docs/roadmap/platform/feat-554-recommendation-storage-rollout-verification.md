---
id: "feat-554"
title: "Roll out compact recommendation traces and verify production headroom"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-09-28"
duration: 2
depends_on:
  - "feat-558"
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "database"
  - "capacity"
  - "operations"
---

## October 6 phase-budget repair in progress

The October 5 ordinary scheduled cycle still had four failed attempts amid
3,498 successful attempts on the deployed descendant of the five-episode-page
repair. Successful attempts committed 9,505 request roots and 33,123 served
items; failed attempts separately committed 100 roots and 390 served items.
The later full health read found zero rows beyond the 24-hour propagation
limit, but the cycle is not failure-free. No normal daily cycle yet qualifies.
The reported expired-transaction operations vary, so the exact production
slow statement remains unproved.

An owned PostgreSQL fixture demonstrated a separate avoidable failure: a new
phase was admitted with 287 ms left before a 500 ms deletion and then timed
out. The scoped repair requires minimum remaining time before another phase,
including after a delayed lock acquisition. A safe pre-work yield records exact
committed counters as `SKIPPED` / `budget_yield`, leaves the oldest-expired
state unknown, and asks the existing bounded scheduler to continue. Actual
transaction and terminal failures stay FAILED. Local proof is complete; a
reviewed release remains pending. Neither replaces the required two later
ordinary failure-free loaded cycles with descendants, backlog, lock and
headroom evidence. Repeated yields under sustained load remain possible, so
the oldest-expired age and successful-completion watermark remain live gates.

## October 5 follow-up after the episode-page release

The October 4 ordinary loaded cycle had six failed attempts amid 438
successful attempts; a later read found zero overdue rows. It is not a
qualifying failure-free cycle; the count remains zero. PR #2556 reduced only
the pre-root standalone episode page from ten to five under the existing
five-second whole-run budget. It deployed to both Admin roles on October 4 at
20:38:17 UTC. The October 5 loaded cycle still had four failed attempts, as
recorded above; the page change was not a complete cure.
An owned mixed PostgreSQL fixture measured 4,467 ms versus 2,767 ms on its
first attempt, while total fixture time rose about 6.0%; a separate slow-tail
fixture still failed at the deadline, preserving earlier committed root work
and rolling back the tail transaction. Neither fixture proves the production
failure's exact statement or a complete cure.

The bounded October 4 expiry histogram counted 26,071 surviving standalone
episodes through October 6 10:30 UTC without reaching its 50,001-row cap.
A conservative conditional half-rate prefix calculation found no modeled
24-hour-deadline shortfall for those surviving cohorts. Created-at counts are
not expiry inflow. Continue to measure live deletion throughput,
oldest-age/backlog and headroom. Keep this ticket in progress until two later
ordinary failure-free loaded cycles pass. See the
[normal release receipt](https://github.com/JesusFilm/forge/pull/2556#issuecomment-5984170981).

## October 4 query release: natural catch-up snapshot

[PR #2553](https://github.com/JesusFilm/forge/pull/2553) merged normally as
`e8e7fb3475af975835856a9f9380805f83d2f3b1` after independent exact-head review
and green required CI. Both actual Admin HTTP and worker processes converged
at October 3 22:05:59 UTC, healthy and compact, with HTTP runner disabled and
worker runner enabled. Post-merge CI passed too. The change affects only the
eligibility child-count query; expiry, deletion order and execution limits remain.

Natural attempts at 22:06:07 and 22:07:40 failed after committing work, with four
successful attempts between them. The first failure committed 12,746 expired
profile-session links; that is not proof that their deletion was the failing
statement. A durable-ledger receipt collected around 22:17:02 counted 28
successful and two failed attempts, with 2,800 roots committed by successes
and another 200 by failures. No new failure had occurred since 22:07:40.
A separate 22:17:23 backlog read found overdue request roots and projection
runs clear, but 1,387 standalone episodes and 961 eligibility decisions kept
the full serving gate overdue. At that snapshot, further natural catch-up
was required; do not infer full recovery from root progress or HTTP health.

At **22:47:11 UTC**, the full 21-type retention-health read found zero rows
beyond the 24-hour propagation limit, with latest success watermark
22:47:06. The accompanying ledger receipt had 204 scheduled successes and the
same two earlier failures, with 10,080 roots committed by successes and 200 by
failures. A separate 22:49:11 read again found zero overdue rows; the later
ledger had 212 successes and no additional failures. Serving-health recovery
is now observed on `e8e7fb3`.

The 22:47 receipt still had 18,169 younger expired standalone episodes, 12,046
eligibility decisions and one projection run inside the propagation window.
Their normal catch-up continued; the scheduler is a persistent loop, so its
running status does not mean an incomplete purge attempt or resumed daily-only
cadence. Direct PGDATA measurement at 22:47:59 found 24,396,324,864 free bytes on
a 48,891,670,528-byte filesystem, 100,663,296 WAL bytes, and no lock waiters or
long transactions. The legacy stage relation stayed empty at 24,576 bytes.

At 22:51:26, a bounded post-clearance read found ten naturally created requests,
all issued: nine served and one fallback, with zero unavailable/issuance-failed
results and the cap not reached. This is a small observed sample, not universal
serving proof. A separate 22:51:49 ledger snapshot counted 228 scheduled
successes and the same two earlier failures, no scheduler error and three
freshly expired request roots inside the propagation window. No synthetic
writes or production mutations were used for verification.

This is not a qualifying clean daily cycle. Keep the ticket in progress until
two later ordinary, failure-free, loaded daily cycles
provide descendant, throughput, lock, backlog/oldest-age and headroom evidence.
No manual purge or production fault injection may manufacture acceptance.
See the timestamped receipts on #2553 and the consolidated closeout report.

## October 4 pre-release follow-up: deployed episode cap did not restore root progress

Historical snapshot before PR #2553 merged. Pending-release statements in this
section describe that earlier state; use the release receipts above for current
deployment evidence.

Both Admin HTTP and worker were verified on PR #2551's merge revision before
the October 3 21:02 UTC natural scheduled attempt. That attempt failed at the
unchanged five-second deadline after durably deleting ten request-free episodes
and nineteen direct actions, with **zero expired request roots** deleted. The
older October 4 incident section below describes the pre-#2551 backlog and
local episode-cap proof; that proof did not establish production recovery.

The next scoped repair changes only the request-root eligibility child count.
The emitted Prisma `LEFT JOIN ... OR` SQL was captured on a local fixture with
dummy IDs. Bounded read-only production plans for the equivalent shape and a
request-parent-driven `UNION` count took 329.175 ms and 2.548 ms respectively
on the same oldest-fifty-root cohort. These are read-plan measurements, not
delete timings or proof that the complete retention run will pass. An owned
PostgreSQL fixture deleted twelve expired roots in 1,138 ms while its first page
also deleted ten standalone episodes; the fixture is not production recovery.
The query-only PR is pending review and normal release. Feat-554 remains
in-progress: verify natural root/descendant progress and backlog recovery
after actual release, then require two later ordinary failure-free loaded daily
cycles with lock, backlog and headroom evidence before closure.

## October 4 pre-release standalone-episode incident and scoped repair

Historical snapshot before PR #2551 merged. The local repair and future release
steps below describe what was known before its observed production attempt.

The October 3 normal scheduled cycle failed on every observed attempt before
deleting expired request roots. A bounded read of the durable and workflow
ledgers found 125 failed wrappers at roughly the fixed five-second deadline;
each attempt committed 24–56 request-free playback episode deletions but no
request roots. The oldest expired request exceeded the 24-hour propagation
limit, so the retention serving gate is unhealthy. At 20:07 UTC, no new
recommendation request row had been recorded in either of the prior two hours;
that is a bounded serving-impact signal, not a synthetic delivery test.

The new scoped repair caps the pre-root standalone episode selection at ten
while preserving each episode's existing full dependency lock/recheck and
atomic transaction, the 50,000-dependency guard, five-second deadline and
29-day expiry. A full page requests normal catch-up. An owned native PostgreSQL
test reproduces the deadline failure under controlled per-row latency and
verifies first-pass request-root progress, descendants, graph invalidation,
live lineage, continuation and failure accounting. The prior October 3
profile-tail release was deployed on both Admin roles, but this earlier phase
prevented that repair from being reached.

This local repair is not production recovery or ticket completion. After a
reviewed PR-to-main release, verify actual Admin HTTP/worker revisions and a
natural catch-up attempt that deletes request roots, reduces the backlog and
restores the serving retention gate. Then require two later ordinary,
failure-free, loaded daily cycles with descendants, lock/backlog and headroom
proof. Keep this ticket in progress until the separately reviewed evidence
closeout merges.

## October 3 repair in progress

The October 2 scheduled run again recovered only after an initial transaction
deadline failure. The failed wrapper committed 100 expired request roots, 371
served descendants and 8,265 expired projection runs, then exhausted the fixed
five-second whole-run budget before the next phase could commit. A scoped repair
pages the four previously unbounded projection-tail deletes and live generation
reference detachments under the existing batch size. Native PostgreSQL fixtures
cover root-free continuation, contributions, interests, live run and decision
references, and eventual generation expiry. This local repair is not production
acceptance. Feat-554 remains in progress until two subsequent normal,
failure-free, loaded cycles meet the existing backlog and headroom criteria.

## October 2 NZDT status: loaded retention still open

The October 1 22:51 UTC production read confirmed 25,630,932,992 B of direct
PGDATA availability, 553,648,128 B of WAL files, healthy compact Admin HTTP and
worker processes, zero recent legacy writes/missing compact payloads, and an
empty 24,576-B legacy stage relation. Feat-555/575 are complete; U1–U3 storage
efficiency is complete in feat-574. See
`docs/reports/2026-10-02-recommendation-storage-efficiency-closeout.md` for exact
format, capacity and retention evidence.

October 1's scheduled retention eventually committed 7,846 roots and 27,216
served descendants, but four attempts failed first. That day is **not** a
qualifying failure-free loaded cycle; neither was September 30. Current count:
zero. The next normal starts are October 2 and 3 at 10:30 UTC (23:30 NZDT each
date). Each must remove actual expired roots and descendants without failure,
with acceptable lock skips, backlog and headroom. Do not substitute a manual or
zero-deletion run. The daily monitor remains active. No supported monthly growth
forecast follows from the post-reclamation snapshot. If a new defect is proved,
repair it and then re-establish two qualifying normal loaded cycles.

## Problem

The remediation preserves full 29-day trace history and reduces new trace
storage. PR #2429 is deployed on both production Admin roles, migrations
0100–0102 passed, and removing the redundant index returned approximately
2.37 GB of allocation (2.34 GB net additional filesystem space over the measured
interval). PR #2433 activated compact writes through the normal release path; both
actual processes were verified on the new revision with compact flags and
healthy roles at 23:25:17 UTC.
A local synthetic benchmark and immediate disk relief do not prove live
cascade deletion throughput or full-transition headroom.

## Entry Points — Read These First

1. `docs/reports/2026-09-28-production-db-storage/storage-remediation-runbook.md`.
2. `docs/reports/2026-09-28-production-db-storage/README.md` and `probes.sql`.
3. `apps/admin/prisma/migrations/0100_recommendation_candidate_compact_trace/migration.sql`.
4. `apps/admin/prisma/migrations/0102_recommendation_candidate_stage_duplicate_index_drop/migration.sql`.
5. `apps/admin/src/config/env.ts` — `RECOMMENDATION_CANDIDATE_TRACE_FORMAT`.
6. `apps/admin/src/workflows/recommendationRetention.ts` — bounded continuation.

## Grep These

- `RECOMMENDATION_CANDIDATE_TRACE_FORMAT|trace_format_version`
- `recommendation_candidate_trace_format_check`
- `recommendation_candidate_stage_run_stage_idx`
- `batchLimitReached|catchUpNeeded|overdueAfterRun`

## What To Build

- Refresh read-only disk, relation, index, WAL, and growth measurements. Coordinate
  capacity protection before the remaining operational headroom is exhausted.
- Deploy through PR-to-main with the default legacy writer; verify migrations,
  constraints, duplicate-index removal, and legacy detail on every Admin replica.
- Confirm a reader-capable rollback image, then enable compact writes through
  the normal configuration/deployment process. Verify representative complete
  traces, outcomes, evaluation, and default behavior on all serving lanes.
- Measure write latency, error rate, daily storage growth, purge batch duration,
  deleted roots and descendants, WAL, lock waits, oldest expired age, and vacuum
  reuse through the first nonempty production request purge and the next daily
  cycle. Preserve 29-day retention and all detail.
- Record the last legacy write and any rollback. Once all legacy traces expire,
  plan a separate migration to retire old storage and reclaim its allocation.
  Do not rewrite a nearly full live table or perform unreviewed retained-trace
  backfills. The separately reviewed feat-560 ten-run lossless conversion pilot
  preserved all observations and expiry; it does not authorize bulk conversion
  or establish immediate filesystem savings.

## Verification

- Migrations 0100–0102 are finished; compact check is validated; the unique
  stage-ordinal index remains and the duplicate index is absent.
- Mixed-format detail matches the established Admin contract. Compact runs have
  complete payloads and no new legacy rows; default-legacy rollback remains
  readable on the reader-capable release.
- Loaded retention removes expired roots and their descendants at a rate above
  incoming volume without request errors or transaction-budget failures.
- Available disk and its slope support the 29-day overlap with explicit margin.
- Store timestamps, measurements, release versions, activation time, operator,
  rollback trigger, and final decision in the storage investigation report.

## Constraints

No production deployment, index change, deletion, or capacity change is authorized
by a local test result. Follow the normal release process and existing access
policy. Wider recommendation capacity graduation remains feat-396.

## Rollout Record and Open Gates

`docs/reports/2026-09-28-production-db-storage/production-rollout.md` is the
timestamped release and evidence record. The reader-compatible rollback floor
is `2cc8105ffb00a9f595cefe10594bd8537561099f` on both roles; production activation
release is `ea13e146faf4c188f9fb8d40c2b9dc1e33440751`. Compact fleet convergence
and bounded parity passed for the latest 100 compact and 100 legacy runs,
with no new legacy writes after fleet convergence. Initial operational logs
showed no observed recommendation errors/timeouts in the ten-minute window;
see the report for sample sizes, latency, and coverage limits. The last observed legacy
write expires October 26 at 23:24:43.126 UTC, subject to a later legacy rollback
and actual retention purge; feat-555 must re-establish the live horizon.

Keep this ticket in progress until the remaining gates are demonstrated:

- Authenticated compact detail smoke passed September 28; protected compact and
  retired-detail smoke passed September 29. Repeat against the eventual
  reclamation release; these bounded samples do not prove universal quality.
- Full 29-day capacity margin; the proposed nominal 75 GB buffer is not applied.
- September 30's first nonempty purge and the following daily cycle, including
  actual deletion throughput, continuation, errors, oldest-expired age, and WAL.

The existing `recommendation-storage-follow-up` local Codex heartbeat checks
every six hours and reports meaningful changes or failures. It requires the
computer to be on and Codex running. Physical empty-table reclamation remains
feat-555: it may follow proven natural expiry/purge or the separately authorized
finite early retirement and lossless conversion path. Feat-554 still requires
two loaded normal retention cycles and capacity monitoring before it can be
marked complete, even if feat-555 reclaims a proven-empty relation first.

## October 2 Reclamation and Remaining Retention Gate

`docs/reports/2026-10-02-legacy-stage-reclamation.md` records completed owner-authorized
bulk legacy disposal: 16.431 GB relation recovery and 25.512 GB available filesystem
space. Feat-555 and feat-575 are complete; this ticket stays in progress.
September 30 and October 1 normal loaded cycles recovered after failures, so neither
qualifies as failure-free acceptance. Require two normal loaded cycles with no
failures, sufficient descendant throughput, acceptable expired backlog/lock skips
and continued headroom. The next scheduled cycle is October 2 at 10:30 UTC.

The active `recommendation-storage-daily-check` monitor runs every 24 hours and
supersedes the earlier heartbeat schedule described above. The old finite deletion
job is permanently stopped. Follow `unattended-latest.json` and its bulk-disposal
receipt; never restart the expired campaign. No new monthly steady-state forecast
or universal quality claim follows from the reclamation measurement.

## September 30 Supplement

`docs/reports/2026-09-30-recommendation-storage-rollout.md` records further index
work and the first owner-authorized early-retirement pilot. Feat-575 (formerly
feat-572) permits early retirement of unprotected legacy stage detail only; all
protected evidence and operational records keep normal expiry. This exception
does not satisfy the two loaded-retention cycles or capacity gates above.
