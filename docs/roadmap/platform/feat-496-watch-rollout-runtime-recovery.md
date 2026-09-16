---
id: "feat-496"
title: "Resolve remaining Watch admission and database transaction timeouts"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-11"
duration: 3
depends_on: []
blocks: []
tags:
  - "web"
  - "recommendations"
  - "infrastructure"
---

## Problem and scope

Resolve production recommendation admission and database deadline failures using
reproductions, scoped fixes and actual request observations. This ticket was
renumbered from feat-486, then feat-495, after independently merged tickets reused
those IDs. Earlier rollout, rollback and partial recovery evidence remains in
`docs/operations/user-recommendations-rollout-2026-09-10.md`,
`docs/operations/watch-runtime-diagnosis-2026-09-14.md` and
`docs/operations/user-recommendations-activation-2026-09-14.md`.

A short healthy window did not establish recovery: Redis admission errors and
Admin delivery timeouts returned. The final investigation reproduced distinct
causes rather than attributing all failures to the homepage block or to Redis
transport. Final release identities and fixed-window evidence are recorded in
`docs/operations/watch-runtime-recovery-2026-09-15.md`.

## Changes

- #2276 drains concurrent Redis admissions before retiring a failed connection;
  #2278 batches preferred-dub lookup work to reduce homepage database contention.
- #2295 aligns browser retry/recovery with upstream budgets, bounds source-free
  delivery work and gates the optional row behind LaunchDarkly, default off.
- #2297 removes synchronous generated page ETag hashing while retaining ISR and
  Cache-Control. The local cached-inventory reproduction improves from 3/17
  failed profiles to 0/20 and maximum loop delay from 481 ms to 155 ms.
- #2298 combines contextual fallback catalog work while preserving every seed,
  exact ranking and complete output; production multilingual probes pass.
- #2299 refreshes an expired Redis clock sample once, only after Lua proves no
  mutation, using the original remaining budget.
- #2300 reads curated generation/pool/membership metadata in one snapshot while
  preserving live video eligibility, interests and history rules.
- #2301 isolates Redis admission I/O from Web page processing on one bounded
  native Node worker. Real Redis fails with the main loop blocked for 350 ms on
  the old path and succeeds with a 650 ms block on the worker path. Existing
  no-late-write, atomic-limit and concurrent-draining guarantees remain intact.
- #2302 returns known failed issuance callbacks while Prisma finishes rollback.
  Callback work retains its original deadline; successful commit acknowledgment
  is still awaited so a committed ISSUED request returns its issued response.

Two cache experiments were rejected for remaining stalls or page-loading
regressions. No production cache policy changed as part of those experiments.

Account-authenticated Redis inspection on 2026-09-16 confirmed a separate
contention hazard: cache cleanup issues HDELs with 430,486–542,713 fields, taking
210–368 ms on the shared Redis server. A pnpm patch bounds cache deletions to
500 entries per awaited batch, preserving both metadata hashes and the original
deadline. In a 550,000-entry local reproduction, maximum independent TIME
latency fell from 435 ms to 9.78 ms and both runs removed every expired entry.
See `docs/solutions/performance-issues/shared-redis-cache-cleanup-blocks-admission-20260916.md`.
Those slow-log timestamps do not match the remaining 02:55/05:51 failures;
do not close this ticket solely on this additional fix or a short clean window.
PR #2311 contains that patch; the unrelated Expo compatibility repair in #2312
unblocked its automatic Web deployment. Both exports were verified in production
revision `0a1c585998a6dbb4bf1399fe4c5eed25310a5512` at 23:43:18 UTC on September 15,
and the production playback smoke passed. The follow-up report is
`docs/operations/watch-runtime-followup-2026-09-16.md`; this ticket remains open.

Post-deployment tracing reproduced a selection failure caused by stale receipt
ordering: an impression can commit after selection captures `now`, and the
selection attribution marker then predates its prerequisite impression.
`docs/plans/2026-09-16-003-fix-selection-impression-watermark-plan.md` owns the
scoped fix and regression. PR #2315 deployed automatically to Admin; the exact
`b96f5f738d3357e228da1d05bb79ec9ea2d02d68` revision and both compiled corrections
were verified at 00:24:29 UTC on September 16. Separate 700 ms application delays
remain open.

The September 16 continuation identified a reproducible scheduling cause:
`videoPrimaryDubDurationById` used nested Prisma `take: 5`, but PostgreSQL
returned 142,956 dub rows for a 216-video request. A bounded SQL scalar projection
preserves that loader's semantics and avoids application-side relation trimming.
Under matched local catalog load, small-transaction maximum latency fell from
738 ms to 89 ms and event-loop maximum delay from 419 ms to 15 ms. The real
PostgreSQL regression measures wire cardinality, not just mocked return values.
See `docs/solutions/performance-issues/prisma-nested-take-duration-stalls-admin-20260916.md`.
PR #2319 deployed automatically to Admin and worker revision
`8070374f6a6e3e892926112d5a6ca8f5f7480fa1`. Compiled code and bounded production
duration results were verified. The 02:15–02:45 observation still contained one
selection HTTP 503, one browser-observed HTTP 200 `delivery_timeout` fallback,
and four browser selection aborts (two correlated with server HTTP 200). This
ticket remains in progress; see
`docs/operations/watch-admin-duration-recovery-2026-09-16.md`.

The continuation reproduced a second catalog scheduling component: Pothos
include mode expands 100 selected dubs into 3,660 wide subtitle objects and a
5.5 MB Prisma result. Selecting requested subtitle/language scalars preserves
the response and reduces local maximum loop delay from 153 ms to 31 ms. Neither
isolated subtitle experiment exceeded 700 ms; release verification must not
overstate that component result as complete recovery. See
`docs/solutions/performance-issues/pothos-subtitle-scalar-projection-stalls-admin-20260916.md`.

## Entry points

- `apps/web/src/lib/recommendation-mutation-admission.ts` — identity, namespace
  and production worker dispatch.
- `apps/web/src/lib/recommendation-redis-admission.ts` — one shared Redis core.
- `apps/web/src/lib/recommendation-admission-worker-client.ts` — bounded worker
  lifetime, deadlines, message draining and per-request failure logging.
- `apps/web/src/lib/recommendation-admission-worker.ts` and
  `apps/web/tsconfig.admission-worker.json` — native worker and release packaging.
- `apps/admin/src/services/recommendations/delivery-runtime.ts` — transaction
  callback deadline and known-failure reporting, preserving commit acknowledgment.
- `apps/admin/src/services/recommendations/curated-pools.runtime.ts` — curated
  metadata snapshot.
- `docs/solutions/performance-issues/*20260915.md` — six cause-specific learnings.
- `apps/web/scripts/probe-recommendation-runtime.mjs` — local-only load probe.

## Invariants and launch state

- No deadline inflation, ambiguous mutation retries, weaker atomicity or new
  public API shape. Preserve profile identity, language eligibility, six-card
  profile-first fill, history, capabilities and existing rate limits.
- The authored English Homepage Recommendations Block stays removed per owner
  instruction. `forge.watch.homepageRecommendations` stays default off. Production
  targeting requires an LD server SDK key and authored block; do not substitute
  blanket enablement. Activation/curation ownership remains feat-487/feat-488.
- This recovery work changes Web and shared Admin runtime only. No mobile/TV
  frontend edits, account linking or curation republishing.
- Deploy through normal PR/main only. Preserve the original forwarded preview
  and unrelated worktrees.

## Validation and release status

Final Web CI passed 4,271 tests and eight real Redis cases, plus build, types,
lint, formatting and security analysis. Final Admin CI passed; the local full
suite passed 6,596 tests and four real PostgreSQL curation/issuance cases. Query
changes also have complete multilingual parity and real database regressions.
Sequential Compound Engineering review found no unresolved code findings.

Local production-build browser verification passed six stable cards, selection,
36 seconds playback, evidence/feedback and fresh homepage recommendations.
Matched rebuilt performance controls retained equivalent page throughput.

Web #2301 deployed at 02:19:07 UTC. The production browser smoke passed normal
playback and recommendations while confirming that the authored row and flag
remain off. Admin #2302 deployed at 02:34:45 UTC; fresh English, Spanish, French
and Hindi source-free probes and the final production playback journey passed.
The 02:19–02:49 window contains 2,863 recommendation calls with zero HTTP 5xx,
but a later 02:55:34 Redis delay caused four HTTP 503s. This ticket remains open
until that remaining delay is diagnosed and addressed. The detailed EVAL
timeout is in Railway worker stdout; Datadog contains only the generic caller
failure. Read the recovery report before interpreting a clean short window.
Use Web APM env:prod and Admin APM env:production, actual primary-host traces,
revision-scoped request populations and structured delivery outcomes.

## Separate follow-ups

- feat-513 tracks the separately observed workflow enqueue/listener ownership
  issue. Its contribution to Watch latency is not yet causally established.
- feat-464 owns broader playback evidence transport/reconciliation reliability.
- feat-487/feat-488 own curated coverage and homepage launch configuration.
- feat-506 tracks pre-existing diagnostic command noise from missing ps/cache
  paths; it is separate from the recommendation request timeouts.
