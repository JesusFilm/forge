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
