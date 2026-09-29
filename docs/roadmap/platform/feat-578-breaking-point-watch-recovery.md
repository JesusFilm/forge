---
id: "feat-578"
title: "Recover Breaking Point on Watch after Core sync repair"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-30"
duration: 1
depends_on:
  - "feat-579"
  - "feat-577"
blocks: []
tags:
  - "admin"
  - "core-sync"
  - "search"
---

## Problem

Holly's series `7_KnowGodBP` and four episodes were published in Core on
September 14 but never imported into Admin. Production's Videos watermark is
August 3; the September 29 worker log confirms a publisher-field authorization
error. PR #2476, merged by Tanner at commit `1403be0a4`, removes that field and
caps dependent watermarks. The deployed recovery and Watch verification remain.

The optional Bearer/JWT mismatch is dormant because production has no Core
token. Core already filters the anonymous `watch` catalog. No publisher
credential or content restriction override is needed.

## Entry Points — Read These First

1. `apps/admin/src/app/api/core-sync/scheduled/route.ts`: authenticated full or
   incremental scoped dispatch.
2. `apps/admin/src/services/core-sync/orchestrator.ts`: lock, phase order,
   checkpoint cap, and manifest/cache refresh.
3. `apps/admin/src/services/core-sync/phases/sync-videos.ts`: public catalog
   import and guarded full-run removal of absent Core videos.
4. `apps/admin/src/scripts/index-typesense-watch-search.ts`: serving projection.
5. `docs/plans/2026-09-30-breaking-point-watch-recovery.md`: execution scope.

## Grep These

`core-sync.phase.error`, `core-sync.phase.complete`, `7_KnowGodBP`,
`watch_route_manifest.refresh`, `watch-search-typesense`.

## What To Build

Use the merged repair rather than duplicate it. Verify its production rollout,
dispatch the supported full recovery outside the nightly slot, verify all
phase results, and refresh the serving index if it does not update itself.
Record the exact run, deployment, and live acceptance evidence.

## Constraints

Use normal main deployments and existing workflow locks. Preserve Manager-owned
content and restriction enforcement. Never persist credentials in evidence.
Historical onset before the August 10 field addition remains unproven.

## Verification

Videos and dependent phases succeed. All five Core IDs have active Admin rows.
The series lists four children with playable English dubs and images. English
Watch search finds Breaking Point; the public series route renders. Record any
remaining operational gap separately rather than asserting recovery from a
merged PR alone.

## Historical recovery checkpoints

- Production Admin deployment `c40c3a39-444d-47bc-a75c-50e0bcc090d1` and worker
  `4ef58ec0-3d1e-4b6f-ab7d-fa3a3e2e0fd5` reached `SUCCESS` on merged
  `1403be0a4b46258efcc0c03d13db0881dce3ff3a`. No deployment was triggered from
  local code.
- The exact merged Videos query succeeds against live Core without credentials
  for all five Breaking Point IDs. The first 25-row full page passes the real
  Zod schema. The Bible Books query returns all 66 records successfully.
- A subsequent read-only full scan validated all 1,134 Watch-eligible Core
  videos with the merged query and real Zod schema, with no GraphQL or schema
  errors. This verifies the upstream contract, not successful database writes.
- All 116 Core-sync tests pass locally. PR #2476's CI gate, Admin lint, tests,
  build, schema drift, and formatting checks passed.
- Full workflow dispatch `wrun_01M3QC1M1DYHHZ3J4MYBW67RZY` was accepted but
  ledger `cmun3p0yv009rnt0s7n30hh24` correctly records `SKIPPED`: another full
  sync already held lock `sync-1790711952046`, acquired September 29 at
  19:59:12 UTC. That external run is being observed, not duplicated or stopped.
- The external run stopped heartbeating at `20:04:39.038Z`; no video rows had
  committed with a fresh `syncedAt`. Its standard 15-minute stale-lock recovery
  becomes available after `20:19:39.038Z`. No manual lock clearing was used.
- Watch serves immutable Candidate generation
  `candidate-revision-v4-curations-v2-20260908t210300z`, with 1,175 catalog
  documents. Refreshing Current aliases alone will not change the serving pin.
  The missing automatic catalog publication path is tracked in feat-579.
- After the external lock became stale normally, scoped full recovery workflow
  `wrun_01M3QD5PSDVWS3RSPRDK2FXRRB` acquired `sync-1790713191409` at
  `20:19:51Z`. Videos began committing successfully. Its step failed at
  `20:24:55Z` after 303,517 ms with `fetch failed`, but the original phase kept
  writing. A second and third execution began at `20:24:59Z` and `20:30:09Z`.
  Native Workflow cancellation was confirmed at `20:30Z`. This bounded-step
  gap is feat-577.
- All three active Videos attempts completed with zero errors: `20:33:58Z`,
  `20:38:23Z`, and `20:43:09Z`, each updating 1,134 records. The first pass
  soft-deleted 46 Core records absent from the Watch catalog; the later passes
  deleted zero. Breaking Point and all four episodes now exist, and the parent
  has four child links. The subsequent dependent replay is recorded below.
- Sequential baseline evaluation of the existing search snapshot completed
  all 83 development cases without request failures. Four responses were
  degraded. Its private endpoint round-trip p95 was 2,988 ms. Earlier concurrent
  evaluations are retained as failed evidence: the private lease machinery
  rejected concurrent requests. These results do not qualify a new snapshot.
- Deployed CLI run `sync-1790714671288` completed the full dependent replay:
  images 2,248; editions 1,623; subtitles 12,224; dubs 212,013; downloads
  1,376,600. Every phase reported zero errors. Total CLI runtime was 469,784 ms.
- Route/SEO manifests refreshed, but the worker lacked Web revalidation
  configuration. Replayed the existing webhook from Admin's configured
  runtime: route manifest, video, and SEO invalidations each returned HTTP 200.
  A transient manifest-fetch timeout cleared after Web's 60-second cache
  interval. The live series page now renders all four episodes. Created, Sin,
  Jesus, and Invited each played in English. Invited reached its full
  232.64-second duration with no media error.
- Built `breaking-point-recovery-20260930` with the deployed Candidate indexer
  and the existing transcript revision `1`: 1,134 catalog documents, 180,907
  availability documents, and 24,590 lexical documents. The shared transcript
  collection was reused. Only EVALUATION moved; SERVING remains unchanged.
- The refreshed private search returns Breaking Point first, followed by its
  episodes, with `degraded: false` and measured Admin search latency 78 ms.
  Public search promotion is still pending.
- Candidate development evaluation completed 83 cases using the deployed
  Mastra runner sequentially. Three private endpoint requests failed; 80 were
  judged, with 49 useful/excellent, 21 weak, and 10 unacceptable. Caller p95
  was 8,307 ms; successful Admin search p95 was 206 ms. No successful response
  was degraded or duplicated. Of 80 successful paired cases, 76 retained the
  same top result and 67 retained the same complete top-ten order; no previously
  nonempty case became empty. These are actual observations, not a passed
  relevance or capacity gate. The repository has no reviewed relevance labels.
- The frozen held-out set ran once: 21 requests succeeded, with 15 rated
  useful/excellent, five weak, and one unacceptable. Caller p95 was 2,617 ms;
  Admin p95 was 342 ms. The final private Breaking Point probe returns the
  series and its four episodes in the first five positions, each with an
  image and playable English dub. Admin latency was 76.7 ms, with no degraded
  response. Canonical-origin public search still reads the old snapshot.
- Operator acceptance was requested against
  `apps/admin/docs/breaking-point-watch-recovery.md`, which records failed and
  missing gates, exact snapshot identity, and the coordinated release plan.
  No acceptance has been recorded, no qualification stored, and SERVING has
  not moved. Recovery was still in progress at that checkpoint.

## Public recovery after automatic catalog publication

PR #2493 deployed through main and automatically published
`core-catalog-6eac2756e41ad0517ca9b31b1cf9c68f`. At `2026-09-29T22:35:24Z`,
requested, search, and Web versions were all `1`, with no error or retry.
Route and SEO manifests were regenerated and Web invalidations acknowledged.
SERVING remained the qualified September 8 baseline at version `5`;
EVALUATION remained version `10`. No failed qualification was accepted.

Canonical-origin public search returned the series first and all four episodes
next, with `degraded: false`. Autocomplete and the live Watch UI independently
contained the five records. Opening Jesus from search at the current
`/watch/bp-3-jesus.html` route succeeded, and playback advanced beyond 59 seconds
with no media error. Earlier playback evidence covers the other episodes.

The executed `7_KnowGodBP` localized-metadata backfill processed one video and
22 locales with zero errors. It automatically queued version `2`, and search
and Web both acknowledged it by `22:36:50Z`. See the automatic publication plan
for the full-import verification and final completion evidence. That full import
subsequently succeeded with 1,134 updates and zero errors, automatically queued
version `3`, and completed both deliveries by `23:04:40Z`. Final public search
still returned the series and four episodes without a degraded response.
