# Precomputed recommendations: storage and retirement

The feature is still private. This page describes the measured baseline, the
local load fixtures, the retention rules, and the evidence needed before a
production build or public A/B test. Neither a fixture nor the Admin storage
page approves an operator capacity attestation.

## What is retained

The final connection JSON is saved once per generation and source, with every
accepted connection. Watch requests continue to use the existing mixed packed
and inline immutable served snapshot formats; the feature does not copy the
connection explanation or transcript passage into each visit. Raw visit and
request evidence keeps its request-owned 29-day expiry. Expired visits are
archived into compact CTR cluster/totals evidence before raw deletion. The
fixed-test result and configuration remain until their reference lifetime
ends; generation retirement cannot delete an experiment-pinned generation.

The ordinary retention runner now also handles private build storage. It
fails an incomplete build after 30 days of idle activity when no source lease
is live, clears failed/cancelled checkpoints and provisional choices in bounded
pages, and retains provider call receipts and unknown costs until the terminal
diagnostic expires. Terminal diagnostics have a 90-day horizon. An expired
generation enters non-servable `retiring` before any child deletion. Each
transaction drains at most 100 choices, 100 model calls, 100 history calls,
20 final source rows, and 20 build source rows. It protects the newest two
complete generations, every experiment reference, and an explicit rollback
hold. This applies to legacy v1, durable v2 and sealed-capture v3 generations. On deletion,
an identity-only proof survives for 365 days so Mastra can safely identify a
retired runtime snapshot. Unknown identities are not assumed safe to prune.
An operator who needs a particular rollback generation for longer must set
its `rollback_retention_hold` before it becomes eligible to retire.

V3 stores GA aggregates in private object storage, with a compact immutable
reference and upload receipt in PostgreSQL. Raw referrer URLs and query strings
are excluded. Objects remain while the generation is resumable or protected.
After generation retirement and the upload grace period, bounded post-commit
cleanup removes its objects and marks the retention proof. Failed remote
deletion remains retryable and does not block ordinary request/visit retention.
Proofs are retained until their object cleanup completes. Storage observations
report declared object bytes separately; they are not PGDATA allocation or
proof that an upload completed.

The Admin read-only report is at
`/dashboard/recommendations/precomputed/storage`. It displays PostgreSQL heap,
index, TOAST and auxiliary bytes per feature relation, raw visit count, and a
selected generation's row-value byte estimate. It also shows the current
seven-day recorded-request count and unverified bot basis, the 29-day
request-equivalent sensitivity, protected/held generation inventory, and
explicitly unknown retained-byte and live write/query projections. Shared
visit relation bytes divided by live rows are labeled as a ratio, not an
attributable unit cost. Relation totals cover
every generation, free/reusable pages and dead tuples; they are not attributable
to a selected generation. The `pg_column_size` row-value estimate reflects
stored-value compression but is not a physical per-generation allocation or a
complete charge for TOAST, indexes, WAL and dead space. `pg_stat_wal` is a **cluster-wide cumulative** observation, not
feature WAL. A missing statistic stays unknown. A controlled before/after
WAL LSN delta in an isolated fixture is separately labeled as such.

## Live read-only baseline, October 6

At 02:11:35 UTC the current catalog aggregate showed 1,031 eligible Videos,
859 with transcripts and 858 with English transcripts. It declared 164,639
transcript records and 280,046 chunks; one Video declared 80,248 chunks. This
was neither a cutoff-fenced snapshot nor an executed model build.

At 02:15:35 UTC Admin PostgreSQL measured 25,768,457,919 database bytes and
117,440,512 WAL bytes. The precomputed feature tables were not deployed. At
02:16:17 UTC the verified PGDATA volume measured 22,911,344,640 bytes free
out of 48,891,670,528 total. These are point-in-time baseline observations,
not current headroom approval or a growth forecast. The read-only receipts are
`/tmp/forge-feat-590-orchestration/catalog-build-dimensions.json`,
`catalog-build-storage-baseline.json`, and
`catalog-build-filesystem-baseline.txt` in the same directory.

A separate seven-day read-only Watch aggregate observed 38,458 below-player
recorded requests, 5,494 per day on average, a largest calendar group of
6,715, and 196,999 expected cards. A recorded request is **not** a verified
human or eligible experiment visit; first/last calendar groups can be partial.
The traffic receipt is
`/tmp/forge-feat-590-orchestration/2574-traffic-fixture-input.json`.

## Local load evidence

The isolated PostgreSQL 18 fixtures below use synthetic content, visits and
actions. They establish DB behavior at the stated scale, not actual eligible
traffic, model output size, production write latency, or Railway throughput.

The opt-in `storage-retention-load.db.test.ts` ran against an isolated
PostgreSQL 18 database on an 8 GiB local tmpfs. It used the observed largest
calendar group, **6,715 recorded requests**, as a synthetic one-day cohort.
Each request had one visit/link and a candidate run. It created 34,395 served
items (five or six per request, chosen to approximate the observed 5.12
expected items/request), with 3,358 packed and 3,357 legacy inline request
snapshots. A synthetic 10% action assumption produced 672 selections. None of
these values is a measured human eligibility or click rate. All roots and
descendants had expired; the experiment reference remained protected.

The fixture inserted those rows in **16.174 s**. The PostgreSQL instance's
WAL-insert LSN advanced **75,160,336 B** during the write interval. Nine
measured request/visit/action/CTR relations grew by **49,733,632 B** in total
from their fixture baseline before cleanup. This is a local, controlled
interval; WAL LSN is still instance-wide and the relation total includes page
allocation and indexes. It is not a Railway byte-per-visit or write-rate
forecast.

The ordinary 100-root, five-second-budget retention function completed **68
successful passes** in **37.437 s** total, with a maximum pass of **659 ms**.
It removed all 6,715 expired request roots, 34,395 served items, 6,715
candidate runs, 672 selections, and 6,715 raw visits/links, while preserving
6,715 compact archived visit receipts. Packed and legacy presentation reads
were checked before cleanup. The test ran passes to completion explicitly;
this is not evidence of a production daily schedule, production lock pressure,
or concurrent Railway traffic. Bounded generation tests separately exercised
an interrupted `retiring` drain, a held concurrent generation-row lock, active
lease protection, newest-two and rollback holds, fixed-test references, and
the v1 retirement proof.

After logical deletion, those nine physical relations occupied **53,534,720 B
more than their empty-fixture baseline**, as archived/cluster evidence was
written and PostgreSQL kept allocated pages. For example, the raw visit
relation measured 2,785,280 B with rows present and 2,793,472 B after all
raw visits were deleted. No filesystem reclamation is inferred from the
successful row cleanup.

A smaller 1,000-visit fixture measured **458,752 B** of visit-relation growth
(459 B per synthetic visit, rounded), a **651,672-B** instance WAL-insert LSN
delta, and ten successful ordinary cleanup passes in **3.416 s**. This
isolates visit relation allocation better than the mixed cohort, but its
per-row result cannot be multiplied into a production retained-footprint
approval. The seven-day recorded-request baseline would imply 159,326
requests across 29 days at its observed average, or 194,735 at the largest
calendar day's rate sustained for 29 days. These are labeled sensitivity
scenarios, not verified eligible visits or a traffic forecast. Real visit
qualification, archive ratios, source mix and write amplification remain
unknown.

A separate catalog-shaped synthetic fixture inserted **1,030 new source rows
with eight accepted connections each** (8,240 new connections) alongside one
existing eight-connection source. Its source relation grew **1,089,536 B**,
including heap, indexes, TOAST and auxiliary allocation, or **132 B per new
synthetic connection**. The completed source relation parts were 851,968 B
heap, 237,568 B indexes, 8,192 B TOAST and 24,576 B auxiliary. Source-only
write WAL-insert LSN advanced **1,184,168 B** in **531 ms**; 100 warm source
lookups took **107 ms**. The Admin row-value estimate for the generation was
813,968 B. The repeated fixture text compresses well and does not represent
real model reasons, passage diversity, analytics receipts, or Mastra runtime.
It proves the eight-edge shape and native accounting path, not the actual
catalog generation footprint.

A second synthetic generation added **1,031 source rows, 8,248 accepted
connections, 1,031 build-source checkpoints, and 1,031 compact model-call
receipts**. Across the watched generation, source, build, and receipt
relations, physical allocation grew **2,531,328 B** (307 B per synthetic
connection, rounded). The instance WAL-insert LSN advanced **2,940,192 B**
during that write interval. Its selected-generation row-value estimate was
1,428,752 B. These are incremental local fixture observations, not a
production-generation reservation: source text is repeated, relation pages
are shared, and the instance WAL interval can include unrelated work.

Run the opt-in peak-day fixture only on an isolated database using
`RECOMMENDATION_DB_TEST=1 PRECOMPUTED_STORAGE_LOAD_TEST=1` and
`storage-retention-load.db.test.ts`; it drops its owned schema afterward.
With `DATABASE_URL` pointed at the owned local PostgreSQL fixture and the
local fixture ingest key configured, the exact benchmark command was:

```bash
RECOMMENDATION_DB_TEST=1 PRECOMPUTED_STORAGE_LOAD_TEST=1 pnpm --dir apps/admin exec vitest run --no-file-parallelism src/services/recommendations/precomputed/storage-retention-load.db.test.ts
```

The sanitized machine-readable [local benchmark receipt](../validation/precomputed-storage-20261006/local-benchmark.json)
contains the measured counts, durations and byte deltas without request or
visit identities.

## Admission and remaining evidence

The durable build protocol requires a fresh operator measurement of the
**PostgreSQL PGDATA volume**, a database/cluster identity match, at least the
implementation's 5 GB minimum reserve, and a measured source-sample
projection. The reserve is a floor, not an approved operational budget. Admin
accounts for other active reservations, recent terminal projections, and
database growth since the measurement without double-charging overlap. Current
PGDATA free bytes already reflect retained generations and any dead/reusable
pages; a new build's projection must fit alongside the two protected complete
generations and any rollback hold. Each additional required rollback hold
changes the overlap scenario. Admission blocks large paid/write work when the
attestation is stale or insufficient; it never truncates accepted connections.
See [the build procedure](precomputed-catalog-build.md) for the current
attestation contract.

The numeric production budget, projected retained footprint, and refresh
cadence remain **unapproved** until the first real catalog generation records
actual source/connection/model-call bytes and costs, a verified human traffic
baseline is available, the Mastra feature runtime and observability footprint
is attributed, and the measured retained/build/rollback overlap is compared
with current PGDATA headroom. The Mastra companion note is
[`precomputed-mastra-runtime-storage.md`](precomputed-mastra-runtime-storage.md).
Deletion makes pages reusable inside PostgreSQL; a smaller row count does not
prove that relation files or the Railway volume have shrunk. No destructive
production reclamation is part of this work.

## Exact real-cohort retained sample, October 7

The successful historical-v6 cohort saved 55 Magdalena and 18 Amharic-source
recommendations using the complete frozen 1,031-Video manifest. Its restore-tested
backup was copied into an owned disposable PostgreSQL 18.6 database using exact
source table/index/constraint/storage DDL. The source remained read-only; row
counts, logical sizes and digests matched before/after and in the sample.
The 1,031 Video-ID foreign-key stubs were measured before the baseline and are
excluded below. The sample database was removed after verification.

| Measurement                |    Before |     After |     Delta |
| -------------------------- | --------: | --------: | --------: |
| Recommendation heap        |       0 B | 237,568 B | 237,568 B |
| Indexes                    |  81,920 B | 286,720 B | 204,800 B |
| TOAST                      |  57,344 B | 155,648 B |  98,304 B |
| Auxiliary storage          |       0 B |  73,728 B |  73,728 B |
| Seven-table physical total | 139,264 B | 753,664 B | 614,400 B |

The isolated database-size delta also measured 614,400 B. This includes the real
1,031-row manifest, two finalized source payloads, 85 model receipts and 45 GA
receipts; no provisional build choices remain. It excludes older diagnostic
generations. Copying terminal rows does not reproduce original checkpoint/choice
churn, peak temporary storage, historical bloat, or WAL.

The prepared first-full-build forecast deliberately charges every pair of
sources the entire two-source physical sample, including its full manifest,
and adds twice the 311,296 B manifest/build-state allocation:

`ceil(2 × 614,400 × 1,031 / 2) + 622,592 = 634,068,992 B`.

At 05:13:07Z, the actual local clone's cluster `7693385351541764139` had
6,422,896,640 B available on PGDATA and no active reservations. After the
5,000,000,000 B reserve and this forecast, 788,827,648 B remained. This is an
intentionally inflated retained-storage scenario, not a statistical bound,
measured full-build peak, production capacity receipt, or launch approval.
Fresh admission and live capacity monitoring remain required.

Machine receipts and the reproducible script are preserved under
`/home/nisal/.local/share/forge/feat-590-evidence-20261007/` as
`v6-exact-retained-physical-sample.json`,
`physical-capacity-v6-exact-retained-20261007.json`, and
`sample-v6-retained-physical.py`. The prepared full-build runner explicitly uses
this new sample rather than the earlier mixed-generation measurement.
