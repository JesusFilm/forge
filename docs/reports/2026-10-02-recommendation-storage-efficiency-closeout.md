# Recommendation storage efficiency: implemented scope and remaining gate

October 2 NZDT owner review of platform feat-554/574. The production observations
below were collected October 1 at 22:51–22:53 UTC through read-only,
ten-second-bounded aggregate queries and an actual PGDATA-bound filesystem read.
No request, viewer, trace payload or credential values were exported. Admin HTTP
and worker processes were healthy compact writers on `755345a92`; a newer Admin
release was building, so this does not assert that it was already serving.

## U1–U3 are deployed for new writes

**U1 — indexes and exposure IDs.** [PR #2479](https://github.com/JesusFilm/forge/pull/2479)
removed two redundant fact indexes, previously allocated 138,452,992 B.
The narrower Watch exposure index was installed through the reviewed
[operator PR #2516](https://github.com/JesusFilm/forge/pull/2516) and
[schema reconciliation PR #2521](https://github.com/JesusFilm/forge/pull/2521):
118,685,696 fewer index bytes at the matched checkpoint and 106,725,376 more
directly available filesystem bytes across the operation. [PR #2522](https://github.com/JesusFilm/forge/pull/2522)
made future exposure IDs CUIDs; an equal 100,000-row native fixture used 8.18%
less total relation allocation. Migrations 0115 and 0121 are applied. Only the
narrow window index is present. All latest 1,000 exposure IDs are CUID-shaped,
with 1,000 distinct internal/event IDs and no invalid expiry. Existing old rows
were not rewritten, so no causal production growth reduction from CUIDs is
measured. Independent uniqueness and retention indexes remain.

**U2 — served snapshots.** [PR #2481](https://github.com/JesusFilm/forge/pull/2481)
introduced compatible packed reads/writes; [PR #2495](https://github.com/JesusFilm/forge/pull/2495)
activated them. Native same-schema fixtures measured 49.7% less relation
allocation for six-item requests and 61.1% less for 20-item requests; one-item
slates stay inline because packing made them 5.0% larger. Exact snapshots,
lineage and attribution were tested. Migration 0117 is applied. Of the latest
1,000 requests, 857 carry packed payloads; none has a bad version or an
unexpected inline multi-item served result. The 2,595,676,160-B served-item
relation still contains historical allocation and indexes. No full-retention-cycle
production per-request saving is isolated.

**U3 — shared vectors and first-empty profiles.**
[PR #2484](https://github.com/JesusFilm/forge/pull/2484) and
[PR #2491](https://github.com/JesusFilm/forge/pull/2491) share byte-exact
full-precision vectors. Native fixtures saved 52.3% at 3.36 interests per vector
and 90.5% at 20. [PR #2511](https://github.com/JesusFilm/forge/pull/2511)
avoids a generation/pointer for a truly first-empty durable projection; a
100,000-profile native fixture allocated 137,551,872 B less for those relations.
Latest 1,000 published generations have 2,391 shared interests over 212 distinct
vectors, zero inline or invalid shapes. Of 154 recent durable projection runs,
129 completed with the typed first-empty result, 25 published and none failed
or fenced. The latest 1,000 typed first-empty runs had no prior generation.
Existing historical generations and inline vectors were not rewritten. No
population-wide production byte reduction is inferred.

All relevant native PostgreSQL and service tests, scoped lint/type/format checks
and required CI passed on the linked implementation PRs. The local percentages
measure their controlled fixtures; production samples confirm format activation,
integrity and operational health. The observed production relation and filesystem
deltas for the narrow index are measurements of that operation interval, with
concurrent traffic, not a pure growth-rate estimate. This completes the
implemented U1–U3 scope of feat-574. A further exposure identity-index rewrite
was assessed and rejected under the unchanged independent uniqueness contracts;
the playback digest rewrite was also deferred because its expected benefit did
not justify the WAL and data-migration risk. Neither is a hidden requirement.

## Current capacity and retention

The legacy stage relation remains empty at 24,576 B following the separate
[reclamation](2026-10-02-legacy-stage-reclamation.md). PGDATA has
25,630,932,992 B directly available on the same verified database binding; WAL
files allocate 553,648,128 B. Current database allocation is 22,617,757,375 B.
There were no lock waiters or active legacy cleanup operations. These values are
from one snapshot and do not establish monthly growth or a seven-day exhaustion
forecast. The earlier reclamation recovered 16.431 GB of relation files and
16.144 GB net filesystem availability; do not add that recovery to the separate
index interval as if they were one measurement.

The October 1 normal scheduled retention day has 78 successful and four failed
durable/wrapper entries. The durable ledger totals **7,846 committed request
roots, 27,216 served items, 7,846 candidate runs and 5,893 legacy stages**;
wrapper elapsed time totals 118,291 ms. Two failure texts match
transaction-timeout/closed categories; two remain unclassified from safe
aggregate patterns. There were no recorded lock-not-acquired entries. The two
ledgers have no direct shared batch reference, so the matching day totals do
not prove a per-batch join. At 22:51 UTC, 3,337 newly expired request roots
awaited the next daily cycle, oldest expiry 10:59:28.840 UTC, still within the
24-hour propagation threshold. Recovery cleared the earlier backlog, but it
does not count as a failure-free loaded cycle.

Feat-554 remains open. A normal loaded run must delete real expired roots and
descendants **without failed attempts**, keep lock skips/backlog within the
existing bounds and retain safe disk/WAL margin. Two such daily cycles are
required to demonstrate repeatable throughput under real load, beyond a native
fixture or a catch-up that eventually succeeds after errors. If both next
cycles qualify, their scheduled starts are October 2 and 3 at **10:30 UTC**,
which is **23:30 NZDT on October 2 and 3**. An empty run cannot substitute.
The current four failures do not expose a single proved code path; changing
batch or timeout parameters before the first post-truncate cycle would be a
speculative production mutation. Monitor the normal cycle and investigate
any fresh error by bounded aggregate evidence. The active daily monitor remains
in place. No monthly whole-database growth or 5 GB/month target is claimed.

The [sanitized aggregate receipt](../validation/recommendation-storage-20261002/aggregate-readonly.json)
preserves the exact bounded production measurements, role states and failure
classifications without raw identities. The task-owned source receipts remain
under `/tmp/forge-storage-final-closeout-owned-20261002/`. Production
mutations: zero.
