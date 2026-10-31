---
title: "Automatically deliver Core imports and backfills to Watch"
type: fix
status: complete
date: 2026-09-30
---

The user explicitly requests automatic search indexing and Watch manifests/cache
refresh after Core imports and backfills, plus verification of the recurring
import frequency. Continue the Breaking Point recovery in the existing isolated
worktree. Implement without changing the daily 07:00 UTC schedule.

## Design

Successful import/backfill -> durable coalesced delivery request -> worker builds
an immutable catalog snapshot -> atomic active-catalog reference -> regenerate
route/SEO manifests -> acknowledged Web invalidation. Failed delivery retries
independently from the import. No embeddings are generated for metadata changes.

Change detection is at the catalog-snapshot level, not a per-video mutation
outbox. An unchanged digest reuses the existing READY index. Relevant changed
content rebuilds the full catalog, lexical, and availability collections, while
reusing the transcript collection and embeddings. The daily Core pull remains
incremental. No Core-upload webhook or per-video search-diff path is added.

Production's selected Candidate remains the reviewed search-engine baseline.
Automatic catalog refreshes are explicitly content publications, not new passing
relevance qualifications. Each refresh records the exact baseline, index/ranking
contract and shared transcript identity. Serving first validates the selected
baseline's existing qualification, then resolves its compatible active catalog.
Neither SERVING nor EVALUATION is repurposed. Switching the baseline or ranking
invalidates the refresh match; it never inherits unrelated approval. Keep old
physical collections immutable and protect active references from retirement.

Long Core phases must leave Workflow's HTTP execution path. Durable steps enqueue
or observe one phase execution and sleep while the dedicated worker performs it.
A database session lock serializes execution; a process crash releases that lock
and another worker resumes the same idempotent phase. A completed phase result
is reused on transport retries. Preserve Core ownership, successful-parent
watermark caps, full-import deletion guards, scope ordering and progress logs.

## Implementation units

1. **Import execution:** durable phase queue, native worker recovery, bounded
   Workflow polling, keep the full CLI path. Characterize/retest scheduled,
   incremental, full and failed runs. Verify no duplicate phase writer and no
   early watermark advancement. Reconcile new parent/child links after the
   final video page so a first import does not need a second pass.
2. **Catalog publication:** coalesced request counters and worker, exact baseline
   identity, reuse the existing validated Candidate builder without moving
   EVALUATION, activate only complete snapshots, preserve old serving data on
   failure, bound retained generations. Test failures before/after publication,
   retries, no-op digests, concurrent requests and baseline changes.
3. **Watch delivery:** queue after successful relevant import phases and executed
   metadata/relation backfills; never on dry runs or failed imports. Regenerate
   manifests and inspect webhook outcomes; retry missing configuration and
   failed HTTP responses. Wire worker Web credentials through normal release
   configuration. Verify late dubs update parent-series availability.
4. **Verification/release:** meaningful unit and real-database integration tests,
   existing Core/backfill regression suites, format/lint/type checks, adversarial
   review. Use normal PR-to-main deployments. Verify actual canonical-origin
   public search and Watch UI, not only private evaluation or HTTP status.

## Assumptions and limits

"Core importer" means Forge's importer reading published Core data; this work
does not change Core's upstream editorial/upload schedules. "Webbox" refers to
the existing Web revalidation webhook. Catalog refresh is authorized as normal
content delivery; schema/ranking/embedding changes retain existing review gates.
Do not claim that a content refresh passes the prior failed broad quality gate.

## Acceptance

A new published video and a new playable episode imported in one run appear in
live search, the series route, and regenerated manifests without an operator
reindex or redeploy per upload. Full/scoped backfills use the same delivery path.
Failure is visible and retryable; an incomplete build cannot replace serving
collections. Production schedule evidence and remaining limits are documented.

## Release verification

PR #2493 merged as `a0fc474b31e14d9ea6229c8a8a909ae3d036e097` through the
normal main release flow. CI passed 7,819 Admin tests, lint, formatting, the
production build, schema checks, and database integration checks. Six additional
Core delivery tests passed against a disposable PostgreSQL database, including
concurrent enqueue, worker exclusion, recovery, and first-import series links.

Forge's native Core scheduler runs daily at **07:00 UTC** (20:00 NZDT / 19:00
NZST). This is Forge's polling schedule, not Core's editorial upload schedule.
The native catalog publisher polls every 30 seconds and also reconciles after
24 hours without a request. Delivery latency includes index construction,
manifest generation, webhook acknowledgment, and reader cache expiry.

The first production request was created automatically at `22:31:00Z` on
September 29. Generation `core-catalog-6eac2756e41ad0517ca9b31b1cf9c68f` became
READY and active at `22:35:01Z`; both delivery versions reached `1` at
`22:35:24Z`, with zero retries and no error. Route and SEO manifests were
regenerated and Web acknowledged their invalidations. The qualified SERVING
baseline remained version `5`; EVALUATION remained version `10`.

Canonical-origin public search returned Breaking Point first and its four
episodes next, with `degraded: false`. Autocomplete returned the same five
content records. The live Watch search UI independently showed those results.
Opening the Jesus episode from search at `/watch/bp-3-jesus.html` succeeded;
playback advanced beyond 59 seconds with `readyState: 4` and no media error.

A scoped, executed localized-metadata backfill for `7_KnowGodBP` processed one
video and 22 locales with zero errors and queued publication version `2`.
Search acknowledged that version at `22:36:27Z`; Web completed at `22:36:50Z`.
The content digest was unchanged, so the existing READY catalog was reused.

The full Videos verification uses deployed workflow
`wrun_01M3QN1PG8MNWBKXNG5JHB4M7J`, Core run `sync-1790721451244`, dispatched
through `/api/core-sync/scheduled` with `scope: ["videos"]` and
`incremental: false`. Its execution crossed the previous five-minute transport
limit with one native attempt and continued committing pages. A separate main
deployment (`8ecca9c7d`, PR #2495) restarted the worker after at least 1,000 rows;
the same persisted execution recovered on attempt `2`. Recovery repeats the
idempotent phase rather than resuming at an exact page offset. The phase then
completed at `23:03:42Z`: 1,134 updated, zero created, zero soft-deleted, and zero
errors. The successful attempt took 741,181 ms (12 minutes 21 seconds). The
workflow ledger reached SUCCEEDED at `23:03:43Z`, and import completion itself
queued publication version `3` before releasing the Core lock.

Version `3` reached search acknowledgment at `23:04:19Z` and Web acknowledgment
by `23:04:40Z`, with zero publication retries and no error. The unchanged digest
reused the same READY generation. The publisher released its lock. A final
canonical-origin public query again returned Breaking Point and all four episodes
first, with `degraded: false`. This completes the import-to-search-to-Web check.
