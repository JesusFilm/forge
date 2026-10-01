# Recommendation storage rollout — September 30 NZDT

This record uses UTC timestamps from September 29. It records production evidence
separately from local benchmarks. The aggregate receipts are under the local task
artifact directory `outputs/heartbeats/20260929T2127-early-retirement-pilot` in the
September 28 recommendation-traffic-isolation workspace. No private selectors,
request identities or trace payloads are included here.

## Release state through 21:42 UTC

| Change                                   | Reviewed PR | Verified state                                                                                      |
| ---------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| Duplicate render/impression fact indexes | #2479       | Migration 0115 finished at 20:51:23.829; removed indexes measured 138,452,992 bytes at preflight    |
| Early legacy detail retirement           | #2480       | Migration 0114 finished at 20:58:09.222; retirement-aware readers live; finite pilot verified below |
| Packed served-item snapshots             | #2481       | Migration 0117 finished at 21:33:47.177; mixed readers live; writer remains legacy by default       |
| Owner-linked legacy protection           | #2483       | Both actual roles converged on `e8bf9e699` at 21:40                                                 |
| Standalone legacy stage expiry index     | #2482       | Migration 0118 finished at 21:39:14.392; catalog confirms index absent                              |
| Shared full-precision profile vectors    | #2484       | All final CI passed; merged at 21:42:22 as `2faa6145e`; deployment pending; default off             |

At 21:35:54 UTC, actual HTTP revision was `e8bf9e699`, worker `162f7f48d`;
both returned health 200, had their expected workflow role and used compact
candidate writers. Filesystem availability was 8,605,073,408 bytes on the existing
48,891,670,528-byte filesystem. The newer index release was still building.
These process observations do not establish later release convergence.

The duplicate fact indexes reduced allocation, but simultaneous unrelated writes
and WAL changes prevent attributing an equal filesystem increase. The stage expiry index occupied 1,961,811,968 bytes: it was **included** in the
18,393,112,576-byte legacy relation total, not additional savings to add twice.

Migration 0118 completed in 95.9 ms. Legacy allocation then fell exactly
1,961,852,928 bytes to **16,431,259,648 bytes** (index plus a 40,960-byte concurrent
relation difference). Between the 21:35:54 and 21:40:18 filesystem snapshots,
availability rose **1,992,564,736 bytes**, to **10,597,638,144 bytes**. Subsequent
WAL allocation was 1,023,410,176 bytes, 50,331,648 below the preceding reading;
these samples include concurrent workload and cannot attribute every net free
byte to the index drop. The schema change deleted no trace observations. Both
roles were healthy on `e8bf9e699`, while the final index release images were still
building; the migration completed through the normal deployment path.

## Finite early-retirement pilot

The user authorized early retirement of unprotected old stage detail. The reviewed
deployed CLI completed one ten-run manifest at **21:27:02.239 UTC**, in 1,099 ms,
on worker `85656b946`. HTTP and worker were both healthy on that revision before
execution. The operator implementation matched the reviewed deployed source.

- Nine unprotected runs had **1,062 observations retired**.
- One original quality holdout had **one observation preserved losslessly in
  compact format**. Total stage rows removed: 1,063.
- All original **64 quality holdouts and 8,621 observations** remained preserved.
- Exact request, served-item and retained run-metadata fingerprints matched for
  all 73 selected or held runs, with zero mismatches. Original expiry and issuance
  values were unchanged. Typed SQL fingerprints proved protected stage fidelity.
- The durable ledger recorded one converted run, nine retired runs, 1,063 removed
  stage rows and 719,050 encoded bytes.

All selected requests had no owner-release link. That extra source predicate was
checked before execution and covered by the locked root fingerprint, while the
general owner-link protection release was still deploying. The original 64-ID
private hold inventory and selector hash were verified; the operator rechecked
current links and source state under its normal locks.

One preparation was abandoned after a worker revision changed, before invoking
the mutating CLI. The fresh manifest's first execution attempt stopped before CLI
invocation at its transaction/capacity guard. Fresh health and capacity evidence
allowed one reviewed retry, which completed. Neither stopped attempt changed data.
The completed manifest must not be replayed or expanded; later finite cohorts
require fresh source, hold, target, capacity and serving review.

At 21:27:14, legacy allocation was still **18,393,112,576 bytes** and WAL was
1,073,741,824 bytes. This pilot credits **zero immediate filesystem savings**.

## Authenticated reader verification

On release `85656b946`, one retired run displayed its original stage counts and six
served cards. Its expanded disclosure explained that historical stage detail was
retired while issued-item data and counts remain. No stage rows were rendered.
One protected run displayed its preserved observation with no retirement notice.
Both real page accesses created their expected audit rows, verified at 21:31:11.
No permission change was needed. This bounded smoke does not prove universal
recommendation quality or replace verification on the eventual reclamation release.

## Remaining work at 21:42 UTC

The packed served-item and shared profile-vector implementations must pass actual
reader-fleet and rollback-image gates before writer activation through normal
PR-to-main deployment. Local six-card served storage fell 49.7%; a separate local
profile fixture fell 52.3%. Neither number is a measured whole-family production
saving or a monthly database-growth forecast. Existing records are not rewritten.

The narrower exposure index is deferred: its ordinary build exceeded the allowed
write-blocking budget. See the separate feasibility report. No replacement index
was installed in production.

Feat-554 still requires the first nonempty scheduled purge and the following
daily cycle, including throughput, descendants, backlog, failures and headroom.
First natural request expiry is September 30 at 00:20:47.858 UTC; daily retention
is scheduled for 10:30 UTC. A successful zero-root run is not loaded proof.

Feat-575 (formerly feat-572) tracks the remaining finite retirement work.
Early retirement remains a finite exception for unprotected stage detail only.
Remaining protected or uncertain legacy data keeps its normal lifetime. Feat-555
requires exact emptiness, no legacy writer, loaded-retention/capacity gates and a
separate reviewed reclamation migration with bounded locking. No whole-table
reclamation or additional financial commitment occurred in this rollout.

## Remaining legacy scale at 21:48 UTC

A guarded aggregate census found 255,811 nonretired legacy runs with 21,130,665
declared observations across 27 days. Of those runs, 26,367 had incomplete
evidence. Counters are not an exact physical-row count or representability proof.
The earliest 100 runs per day yielded a 2,700-run sample with 257 incomplete runs,
one linked protected run and zero owner links; original hold membership was not
classified in that sample. It is not a random sample or an eligibility census.

At ten runs per manifest, processing the whole population would require at least
25,582 manifests before byte/row limits and ineligibility. Preserved incomplete or
uncertain detail would still prevent exact emptiness. Additional tiny deletes
therefore cannot promise physical recovery of the remaining 16.431 GB. No further
cohort was executed. A larger campaign needs a separately reviewed finite plan
and a concrete reclamation benefit; prioritize new-write reductions and scheduled
retention while retaining normal protected/uncertain expiry.

## Shared-vector activation at 22:30 UTC

PR #2491 passed 18 successful checks at reviewed head `d04bb12ca` and merged
normally at 22:17:12 as `f8d388d97`. At 22:30:35, deployed configuration imports
from both actual Admin containers reported profile sharing `true`, served format
`legacy` and trace format `compact`, with no explicit profile/served override.
At 22:30:47 both actual HTTP and worker processes ran `f8d388d97`, returned health
200 and had their expected runner roles. Compatible mixed-reader rollback images
remain recorded in the receipt. Unrelated later descendant releases were building
and were not treated as current serving evidence.

The latest 200-generation sample at 22:30:13 included 175 interests, eight shared
references and five distinct shared vectors, with zero invalid shapes, missing
snapshots or digest mismatches. The sample crosses the activation boundary, so
the other inline interests are retained history. A separate post-convergence
cohort starts at 22:31. At 22:34:29 it contained 14 generations and 16 interests,
all shared, with no inline writes or shape/digest/missing/expiry mismatches.
The projection ledger had 18 completed jobs, one pending and no failure reasons
or expired claims. Eight persisted served requests had retrieval p95 272.45 ms;
one fallback took 169 ms and none exceeded 1,500 ms. The small sample excludes
unpersisted failures and is not representative loaded-capacity proof. Latest
100 served requests remained legacy as intended. Packed-item activation PR #2495
is now in CI and remains separately gated.

Direct filesystem availability was 11,140,534,272 bytes at 22:30:47. This includes
concurrent WAL/workload changes and is not credited as profile savings. Existing
inline interests are not rewritten. See
`docs/reports/2026-09-30-recommendation-profile-footprint.md` for the new measured
profile-family breakdown and the gated initial-empty bootstrap follow-up.

## Packed served snapshots active at 22:56 UTC

PR #2495 passed 19 successful checks at reviewed head `2be6a809d`, then merged
at 22:41:56 as `8ecca9c7`. At 22:55:28 both actual Admin HTTP and worker ran
that revision with health 200, correct runner roles and one active successful
deployment each. Old processes had drained. Imports of each deployed config at
22:56:16 reported packed served snapshots, shared vectors and compact traces,
with no profile/served environment override. Compatible mixed-reader rollback
images remain recorded in the aggregate activation receipt.

The separate cohort beginning 22:56:30 contained twelve requests at 22:59:46:
nine packed multi-item requests, one inline single-item request and two empty
results. There were no format, membership, placeholder, count or expiry
mismatches, and no unexpected inline multi-item served requests. Ten seeded
served requests had retrieval p95 280.25 ms; none exceeded 1,500 ms. No For You
request occurred in this cohort; its independent gate was not changed.

The authenticated Admin full-detail smoke displayed six cards with presentation
titles and all 198 stored/declared observations for one packed request. One
disclosure expanded to eight stage entries. The exact request's normal
`trace_detail` access audit increased by one. The temporary browser tab and
private selector bridge were closed. Only aggregate results were emitted.

Filesystem availability was 11,037,532,160 bytes at 22:55:28. At 22:59:46 the
database allocated 37,287,720,639 bytes and WAL 603,979,776 bytes. Request and
item relations allocated 250,912,768 and 2,566,553,600 bytes respectively. There
were no lock waiters, old transactions or expired request roots. No filesystem
saving is credited to the new formats: existing rows were not rewritten.

These small persisted samples exclude unpersisted errors. Retrieval latency
does not include persistence; `pg_stat_statements` is absent. Native write
benchmarks are recorded separately. Representative loaded latency, a comparable
growth window and the first two nonempty scheduled retention cycles remain open.
Receipt: `outputs/heartbeats/20260929T2242-served-snapshot-activation` in the
task artifact directory.

## Shared-vector observation through 23:02 UTC

The post-22:31 cohort at 22:59:47 contained 123 generations and 75 interests,
all shared, referencing 36 distinct vectors with zero inline, shape, digest,
missing-snapshot or expiry mismatches. There were 149 completed projection jobs
and one fenced job. Its reason was `pointer_generation_fenced`, and the same
scope had a completed run at or after its creation. This is a concurrent
publication fence, not an unexplained failed vector write. Eighty-five persisted
served requests had retrieval p95 284.2 ms; none exceeded 1,500 ms. The longer
sample still does not establish representative loaded capacity or monthly growth.

The initial-empty bootstrap optimization remains disabled. Review requires an
atomic pending-run reservation with the first eligible source decision so failed
asynchronous feedback cannot strand a newly evidenced profile. This preserves
the existing reconciliation mechanism without creating a record for every empty
profile. Native failure/recovery, concurrency and loaded cost checks remain
activation gates; no retained profile history is rewritten.

## Legacy drain throughput preparation at 03:24 UTC

The first fixed-master calibration wave completed 100 runs and 21,687 stage
rows on the published per-manifest v2 CLI. All ten manifests had matching
durable ledgers and live parity; the reviewed operator credited no pending or
mismatched batch. Freeze plus durable private acknowledgement took 25.633
seconds, dry-run plus execution 43.206 seconds, and read-only reconciliation
5.244 seconds. These are production observations for this one wave, not a
whole-master throughput projection or filesystem saving.

A separate, not-yet-deployed batch-aware CLI preparation reuses the same
ten-run service calls in one Prisma process per phase and leaves the fsynced
private acknowledgement and exclusive execution-attempt marker with the
local operator. On an isolated PostgreSQL 18 fixture containing two batches
and protected, complete-unprotected and incomplete-unprotected runs, the old
two-process freeze took 2,828 ms and the new one-process freeze 1,598 ms.
The new one-process dry-run plus execution took 1,471 ms. The native proof
checked unchanged request roots and served items, removed stage rows, all
three v2 actions and two exact durable ledgers. Local process timings do not
predict production WAL, throughput, serving latency, or the eventual physical
reclamation date. Broad fixed-master admission and the separate exact-empty
migration remain open.
