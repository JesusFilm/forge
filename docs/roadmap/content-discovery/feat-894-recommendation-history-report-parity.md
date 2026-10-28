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
The cohort and received cutoff match the existing PostgreSQL query. The HTTP
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

`admin-ops/watch-exposure.service.ts` maps this query to the existing anonymous
breakdown fields and returns `coverage: best_effort_incomplete`; V1 served stays
unknown. A default-off `RECOMMENDATION_WATCH_HISTORY_READER_ENABLED` gate selects
the new reader on the operator dashboard. Signed and anonymous reads still run
in parallel, but failures now render separate sanitized unavailable states,
preserving successful rows from the other source. The view discloses that
ClickHouse covers successfully delivered/backfilled facts only. No historical
watermark or complete-measurement claim is fabricated. The old PostgreSQL
anonymous reader remains available for parity and rollback.

The isolated local `event_watch_reader_test` ClickHouse database (image
`clickhouse/clickhouse-server:25.8.15.35`) exercises corrections, physical
duplicates, reversed insertion/rank order, historical cutoffs, current expiry,
erasure, conflicts after `OPTIMIZE FINAL`, filtered conflicts, policy/path/window
separation, and filter-before-cap with 130 groups. This new suite is not yet
wired to CI. Physical TTL and cross-store privacy fencing remain feat-895 gates.
The generic read-by-ID client now applies the later of report `asOf` and current
time to original expiry, so historical cutoffs cannot revive expired data.
Signed exposure, A/B CTR/engagement, usefulness, and archive parity remain
unfinished in feat-894; keep this ticket in-progress.

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
snapshot lineage, full differential parity for late/unqualified evidence,
cluster moments and archive transitions is not yet established, and added
transaction cost at production scale is unmeasured. `ctr-report.ts`,
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
reader gate is added or enabled yet: late/unqualified evidence, browser-cluster
moments, legacy/backfill cutoffs, callback transaction latency at expected
volume, and archive/replay parity still need qualification. Published report
revisions remain immutable.
