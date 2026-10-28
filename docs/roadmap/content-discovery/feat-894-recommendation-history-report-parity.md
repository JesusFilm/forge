---
id: "feat-894"
title: "Preserve live A/B and operator reporting across history stores"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-892", "feat-893"]
blocks: ["feat-897", "feat-895"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own CTR/engagement/history adapters, visit admission/archive integration and operator trace/exposure readers. Preserve the active experiment, sticky assignment, operational qualification/attribution, late cutoff, immutable revisions and archived counter fences. Fixed-as-of parity applies to successfully delivered/backfilled evidence, including duplicates/corrections; accepted live export loss must remain explicit coverage loss. Keep necessary compact A/B accounting and never label a partial analytical sample as complete. Preserve 14-day anonymous coverage disclosure, authorization/auditing and error visibility. Distinguish serving authority from ClickHouse history in storage inventories; there is no forwarding store.

## Context

- Parent: [feat-897](feat-897-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Anonymous Watch slice in progress: `event-history/clickhouse.ts` exposes a fixed,
typed `watchExposureBreakdown({start,end,asOf,now,filter})` query, backed by
`watch-exposure-query.ts`. It audits same-revision conflicts independently of the
registry filter and 128-group cap, chooses each event ID's latest accepted revision at
`asOf`, then applies current original expiry and terminal erasure. It ranks
facts by original occurredAt/receivedAt/rankId within exact
window/surface/block/presentation/placement/policy/position/path/kind partitions.
The received cutoff matches the existing PostgreSQL query. The in-window cohort
is implicit in the final fact filter, so the report no longer rescans all
canonical facts to construct a distinct window set. The HTTP
client uses fixed parameterized SQL, one operation deadline, a three-second
server query limit, 20-million physical-row scan / 1 GiB memory / 129-result
caps, and strict output decoding. The dated production snapshot's 391,960
Watch rows/day implies about 5.5 million rows in 14 days before corrections.
The local fixture does not qualify the 3-second query budget at that scale;
14-day production latency and memory remain an explicit feat-896 release gate.
Pre-cutover legacy duplicate corrections are backfilled with checkpoint
acceptance time because their original correction admission time is unavailable;
historical `asOf` reports before that checkpoint cannot reconstruct those
corrections exactly.

Capacity investigation on the isolated ClickHouse 25.8.15.35 container used
the actual typed reader and its unchanged 3-second operation/server deadlines,
20-million scanned-row limit, 1 GiB memory cap, and two-thread setting. On a
clean 400,000-row synthetic Watch fixture, removing the duplicate revision
aggregation and redundant cohort scan and enabling in-order aggregation
returned the expected 100,000 served/rendered/eligible/selected counts in
2,755 ms client elapsed. The main query read 400,000 rows in 2,117 ms with
491,497,847 bytes peak memory; the exact conflict audit separately read
400,000 rows in 601 ms with 365,693,203 bytes peak. The previous query
timed out at 400,000 rows in the same local setup. All ten real ClickHouse
Watch semantic tests pass, including historical acceptance, erasure, physical
same-revision conflicts, filtered conflicts and filter-before-cap.

This is a bounded improvement, not 14-day capacity qualification. At 1,000,000
synthetic rows, the actual reader still timed out at 3,005 ms; the
`system.query_log` main-query record was `ExceptionWhileProcessing`,
3,200 ms, 940,672 `read_rows`, 877,332,058 bytes `memory_usage`, exception
code 159. The 400,000-row result has only ~245 ms of client deadline
headroom and cannot support a production scale claim. The fixture has one
repeated surface/block and no correction density, and the local container's
CPU, memory, and load do not represent Railway sizing. The report scans history
and the independent conflict audit each time; this work adds no stored summary
or second authoritative stream. A same-table materialized tuple of Watch
JSON fields fed to `argMax` backfilled one million rows, but the main query
reached 1,011,484,933 bytes peak before timing out. A two-stage
`GROUP BY` on Watch item/kind followed by item aggregation removed window
sorting and passed the ten semantic tests, but at one million rows it reached
1,033,241,604 bytes peak after only 817,792 reads. Both experiments were
discarded and no projection or materialized column is in the shipped schema.
The generic real ClickHouse suite (six canonical/read/erase tests) and 16
client unit tests also pass. Before enabling the 14-day reader, feat-896 needs an actual
resource-sized load test and a design that preserves exact as-of revision and
conflict semantics within the existing budget. No production DDL was applied.

`admin-ops/watch-exposure.service.ts` maps this query to the existing anonymous
breakdown fields and returns `coverage: best_effort_incomplete`; V1 served stays
unknown. A default-off `RECOMMENDATION_WATCH_HISTORY_READER_ENABLED` gate selects
the new reader on the operator dashboard. Signed and anonymous reads still run
in parallel, but failures now render separate sanitized unavailable states,
preserving successful rows from the other source. The view discloses that
ClickHouse covers successfully delivered/backfilled facts only. No historical
watermark or complete-measurement claim is fabricated. The old PostgreSQL
anonymous reader remains available for parity and rollback.

Operator request detail has a separate default-off historical reader gate. It
uses the current permissioned page and access audit, fetches only IDs captured
from an active operational request, and displays missing exports as incomplete
coverage. The PostgreSQL transaction is closed during remote I/O and a fresh
request fence precedes the access audit and response. The existing PostgreSQL
detail remains the default for parity and rollback; no complete-history or
production-readiness claim follows from this bounded reader slice.

The isolated local `event_watch_reader_test` ClickHouse database (image
`clickhouse/clickhouse-server:25.8.15.35`) exercises corrections, physical
duplicates, reversed insertion/rank order, historical cutoffs, current expiry,
erasure, conflicts after `OPTIMIZE FINAL`, filtered conflicts, policy/path/window
separation, and filter-before-cap with 130 groups. The owned real ClickHouse
fixture runs in CI. Physical TTL and cross-store privacy fencing remain feat-895 gates.
The generic read-by-ID client now applies the later of report `asOf` and current
time to original expiry, so historical cutoffs cannot revive expired data.
Signed exposure, A/B CTR/engagement cutover, usefulness, and archive parity
remain unfinished in feat-894; keep this ticket in-progress.

Visit producer slice: `event-history/experiment-producers.ts` emits only
redacted A/B and incumbent-baseline visit revisions and request links. New
`history_revision` / `history_accepted_at` columns on operational visits are
nullable for pre-cutover rows, so unknown legacy correction times are not
backdated to admission. `visit-admission.ts`, `public-watch.ts`, and
`incumbent-baseline.ts` capture newly committed rows, monotonic delivery
summary changes, and new links inside the transaction, then start one
best-effort prepared export after commit. Replays, rejected links, and rolled
back transactions do not create a fresh fact. The current public path does
not persist early excluded outcomes; those remain unrecorded and are not
fabricated as historical visits. Export loss does not change operational
admission or the signed A/B report authority.

Next reader/retirement slice: `precomputed/ctr-evidence.ts` still reads raw
visits, request links, selections, and impressions; `engagement-evidence.ts`
joins links through requests, selections, episodes, and outcome revisions.
`visit-retention.ts` archives per-browser clustered counters before deleting
raw visits and links. Keep these active PostgreSQL accounting paths until a
transactionally maintained, bounded compact per-visit attribution state
preserves the eligibility/arm, browser cluster, exact linked-request cutoff,
fallback, click, impression, and playback/outcome counters needed by
`ctr-report.ts`, `engagement-report.ts`, and `incumbent-baseline.ts`.
ClickHouse can then serve explicitly incomplete historical drilldown, while
the compact state supports live/final reports and one-way archive without a
permanent second raw history store. No report authority has switched yet.

Compact measurement qualification slice (default off): migration `0167` adds
`recommendation_precomputed_ctr_measurement` with `(visit_id, revision)` key,
`accepted_at`, and a derived JSON summary. The summary contains the existing
per-visit CTR/engagement counters, eligibility/arm/delivery flags, pending
deadlines and cutoff ceiling; it does not copy browser, request, item, episode,
consent, session, token, or payload identifiers. The visit foreign key
cascades snapshots when the 29-day operational root is archived and purged;
the existing archive totals and PG-only browser clusters remain the long-lived
measurement authority. A flag gates transaction-local snapshots at admission,
delivery/link, evidence, selection, claim, and outcome commits. Snapshot
revision selection supports earlier report cutoffs; finalized pending counts
advance across hard-until time without another write and stop at the cohort
ceiling. Real PostgreSQL tests compare selected derived values with the native
reader for public selection and corrected playback outcome, and verify replay
and rollback do not advance snapshots.

This is shadow qualification, not a reader cutover. Legacy rows lack earlier
snapshot lineage, full differential parity and added transaction cost at
production scale remain unproven. `ctr-report.ts`,
`engagement-report.ts`, `visit-clicks.ts`, `ctr-evidence.ts`,
`engagement-evidence.ts`, and `visit-retention.ts` still read operational raw
evidence. Keep the flag off and feat-894 in-progress until those dependencies
and rollback safety are qualified; ClickHouse delivery loss is not a source
of live report authority.

Compact decoder qualification now reconstructs a typed live `RawCtrVisit`
from a revision accepted by the fixed report cutoff, joined only to the
operational visit's experiment/browser identity. It returns `null` for a
legacy visit without a snapshot and rejects malformed summaries rather than
turning either into zero. Real PostgreSQL comparisons cover corrected
engagement at two cutoffs, pending hard-until transition, eligible/excluded
and both-arm visit rows, and the raw-to-archive boundary. The existing report
revision and archive totals remain unchanged after purge; compact snapshots
are deleted with the visit. This is narrower than complete report parity.

Current snapshot capture still derives each revision from `rawCtrVisitSql`.
Therefore the operational visit's eligibility/arm/browser digest and exact
request links, served items, selections, impressions, playback episode state,
and accepted outcome revisions must remain available through the live
correction and archive horizons. Removing those raw rows before an incremental
compact updater and full differential report/cluster qualification would lose
future correction ability. A current-state-only backfill cannot invent earlier
`accepted_at` revisions for pre-cutover visits. No separate compact report
reader gate is added or enabled yet: complete browser-cluster moments,
legacy/backfill cutoffs, callback transaction latency at expected volume,
and archive/replay parity still need qualification. Published report revisions
remain immutable.

Further local qualification: the compact decoder now raises the existing
typed `RecommendationInternalStateError` for malformed internal state. A
fixed-cutoff coverage query reports missing live revisions as `unavailable`;
a current-state checkpoint can make its own acceptance instant available but
does not make an earlier interval available or alter any published report.
Captures serialize under the visit lock and clamp a late-arriving callback's
older clock to the last committed snapshot acceptance instant; the same
effective cutoff is used for raw derivation and pending deadlines. A real
PostgreSQL regression test caught the prior revision-2 backdating failure.
Real PostgreSQL tests compare full compact/native rows with unqualified and
future classifier outcomes, a late-event cutoff, and a post-report-cutoff click
whose first checkpoint is later than the earlier immutable report. A separate
test proves that an impression received after the cutoff increases matched
selections only in the later compact and native revisions. A five-visit fixture
across two control browsers, one challenger browser, and one excluded
visit agrees with raw CTR counts and independent-browser counts; archived
browser totals and the published report remain equal after the two oldest
visits cascade. The focused CTR/engagement PostgreSQL suites pass 21/21 with
the compact capture flag enabled.

A one-off local transaction measurement loaded 200 visits, 100 with a linked
selection, then measured 30 separate captures on linked visits in the owned
PostgreSQL 18 fixture: a trivial transaction plus `SELECT 1` had median
2.15 ms, while capture transactions had median 8.23 ms and p95 17.03 ms.
A second run loaded 10,000 visits (100 linked selections) and measured 30
linked captures: the trivial transaction median was 3.38 ms; capture median
was 16.15 ms and p95 was 33.81 ms. The fixture has no concurrent writers,
only 10,000 rows and no Railway resource limits; this is a local per-visit
cost receipt, not a production
latency qualification or a reason to enable the flag. The existing serving
budget remains 3 seconds. Full report cutover still needs an incremental
updater or retained operational lineage, a bounded bulk reader, legacy
coverage strategy, and representative high-volume/concurrent measurements.

Exact lineage required by the current recomputation query through the live
correction horizon: visit `id`, `experiment_id`, `browser_unit_digest`, `arm`,
`eligibility`, `qualification`, `exclusion_reason`, `delivery_result`,
`fallback_reason`, `created_at`, `expires_at`; experiment `ends_at` and
`challenger_manifest_id`; policy `late_event_cutoff_hours`; visit-request
`visit_id`, `request_id`, `created_at`; request `id`, `manifest_id`,
`generation`; served-item `id`, `request_id`; impression `item_id`,
`received_at`; selection `id`, `request_id`, `item_id`, `received_at`;
episode `id`, `selection_id`, `request_id`, `item_id`, `state`, `hard_until`,
`conflict_count`, `generation`, `claimed_at`, `discovery_source`; and outcome
`id`, `episode_id`, `request_id`, `item_id`, `classifier_version`,
`revision`, `created_at`, `generation`, `qualified_view`,
`active_coverage`, `active_playback_milliseconds`. Request/item payload
presentation, provenance, canonical path, capability/token material, and
client event payload digests are not read by CTR/engagement recomputation;
their separate serving, integrity, privacy and retention needs must be checked
before removal. The operational browser digest is needed for cluster
accounting and erasure, remains PostgreSQL-only, and is never exported in
the compact snapshot.

Default-off compact A/B report reader qualification: a single bounded
PostgreSQL query selects each live visit's latest accepted measurement at the
fixed report cutoff and decodes at most 100,000 visits; a missing pre-cutover
snapshot or a larger live cohort returns explicit `unavailable`, never a
partial sample or a fabricated earlier checkpoint. The separate
`RECOMMENDATION_PRECOMPUTED_COMPACT_REPORT_READER_ENABLED` gate uses these
derived rows for the same CTR/engagement totals and browser-cluster moments,
combined with the existing archived totals/clusters. The already-published
final report is returned before reader selection and remains immutable.
The real PostgreSQL CTR suite compares gated compact and native CTR arm rows,
engagement rows and uncertainty after live and archived cluster accounting;
it also checks missing legacy coverage, one-way finalization and a fixed
cutoff. All 11 full-file tests pass with compact capture enabled. A separate
10,000-visit local fixture bulk read took 466 ms in the owned PostgreSQL 18
container; the 100,000-visit cap, transaction timeout and this single-machine
measurement are bounded behavior, not production-scale latency proof.

Archive capture remains the existing native path: current snapshot capture
still recomputes from the exact operational lineage listed above, and
post-cutover correction, replay and retention safety are not yet proven for
retiring that lineage. The report reader gate is off in production. Legacy
visits without an accepted checkpoint at the requested `asOf` remain
unavailable; current state is never backdated. Qualification of the full
active cohort, concurrent callback cost, larger live volumes, and safe raw
retirement remain release work in feat-896/feat-895.

Archive cutoff guard: archived visit totals have no per-archive acceptance
timestamp. With the compact reader gate on, an explicit `asOf` and any
archived visit now return `archive_cutoff_unverifiable` before a new report
revision is written. A current cutoff sampled after the exclusive evidence
fence remains supported, and an already-published final report still returns
immutably. The real PostgreSQL regression archives evidence at a later clock
than the requested cutoff, checks unavailable/no new revision, then checks a
current report and published-final read. This guard does not invent archive
timing or change the native report authority.
