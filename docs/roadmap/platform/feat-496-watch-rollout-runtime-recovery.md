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
Admin delivery timeouts returned. The September 15 investigation reproduced distinct
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
`docs/operations/watch-runtime-followup-2026-09-16.md`; this ticket remained open at that checkpoint.

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
and four browser selection aborts (two correlated with server HTTP 200). At that checkpoint this
ticket remained in progress; see
`docs/operations/watch-admin-duration-recovery-2026-09-16.md`.

The continuation reproduced a second catalog scheduling component: Pothos
include mode expands 100 selected dubs into 3,660 wide subtitle objects and a
Prisma result with 5.5 million characters. Selecting requested subtitle/language
scalars preserves
the response and reduces local maximum loop delay from 153 ms to 31 ms. Neither
isolated subtitle experiment exceeded 700 ms; release verification must not
overstate that component result as complete recovery. See
`docs/solutions/performance-issues/pothos-subtitle-scalar-projection-stalls-admin-20260916.md`.

## Entry points

The September 18 continuation reproduces another catalog scheduling cost:
four image metadata reads per related Mux video produce hundreds of Prisma
operations despite SQL batching. The scoped correction reads both exact image
recipes in one service batch. Real PostgreSQL output equivalence and local
performance controls are documented in
`docs/solutions/performance-issues/prisma-batched-mux-metadata-call-overhead-20260918.md`.
PR #2342 merged normally and deployed automatically to Admin and worker revision
`32caef0f1cc2e9b59570bfb44fd1cd96f2df0c58`. Exact running revisions and the
compiled batch were verified at 03:17:41 UTC on September 18. Web remains on
`c813991ad3645aebdb50d6b1cac92a47b5aad250`; its service correctly skipped this
Admin-only release. The ticket remains in progress during separate sustained
HTTP/semantic acceptance. A temporary diagnostic observer caused an additional connection
incident, was removed, and its stranded connections were discarded; that
capture is excluded from causal evidence. See
`docs/operations/watch-api-stalls-diagnostic-2026-09-18.md` for the incident,
recovery and remaining uncertainty.

A sampled post-release browser acknowledgment failure has a separate native
Chrome renderer commit wait; feat-521 owns further attribution and field
verification. It must remain visible in browser outcomes and must not be
misclassified as an Admin HTTP 503. The underlying browser mechanism and the
other unread-body cases are not all established by that single trace.

The extended release check still confirms a selection HTTP 503 at 03:40:10 UTC
on September 18 (`6aacb29a000000003096dac941cd5f16`). Admin selection spends
2,341 ms in `consume_recommendation_capability_submissions` before its 81 ms
selection transaction. Driver/pool waiting, database locking/execution and
application scheduling still require separation for this new sample. The
48-selection ordinary cohort has 42 validated acknowledgments, five unread HTTP
200 bodies and this one server-correlated timeout; all 96 delivery bodies are
served, with no observed `delivery_timeout`. Keep this ticket open and preserve
the capability submission bound while investigating the remaining call.

A second server HTTP 503 at 03:45:42
(`6aacb3e6000000004bb08c6b3b2e20c3`) includes a 382 ms capability-budget call;
an independent PostgreSQL sample observes `IO / WalSync` during it. This proves
a durable-write contribution, not the cause of the entire delay. Existing Node
metrics do not support a 2.34-second scheduling pause in the first timeout;
checkpoint completion does not overlap either failure. A faster experimental
language-inventory query failed to reproduce or improve selection-probe latency
under the observed concurrency and was not shipped. Preserve these negative
controls and separate driver acquisition from database waits before the next
fix. Details and exact cohort denominators are in the operations report and
`docs/validation/watch-api-batch-release-20260918/browser-outcomes.json`.

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

## Completion — September 16 Admin continuation

PR #2319 corrected duration relation overfetch; PR #2322 narrowed requested
subtitle/language scalars. Both merged through normal PR/main and deployed
automatically. Admin and worker run `9533506f967496dea60c9a4b846bf7a70463772b`;
Web remains `469edc6f996db1c6bd729b9a1b9f0e2732a0cd58`. Final runtime checks
confirmed both corrections and a closed inspector at 04:29:47 UTC.

The 03:29:13–04:29:02 browser observation recorded 66 selection HTTP 200s with
no aborts (414–671 ms); the final 48 also validated acknowledgment bodies.
All 132 inspected deliveries served six cards with no HTTP failure or semantic
timeout fallback. The separate 03:29–04:30 HTTP population contains 70 selection
200s and no recommendation 5xx; 400/403 rejections are recorded separately.
One React HTML hydration error made the aggregate no-JavaScript-errors browser
gate fail. RUM confirms this error class predates both Admin fixes; feat-517 owns
its unresolved cause. Do not describe the browser run as entirely clean.

The causal reproductions, live row/string-length reductions and sustained
outcome evidence complete this demonstrated Admin scheduling recovery. This
bounded window does not prove all rare failures impossible or assign historical
Redis incidents to the Admin causes. The detailed report is
`docs/operations/watch-admin-duration-recovery-2026-09-16.md`.

After incorporating newer main and its lockfile, validation passed 7,255 Admin
tests, 28 focused tests including ten real PostgreSQL cases, types, production
build and formatting. Both code PRs had green checks. The subsequent main run
has an unrelated Web test failure; its 70-case file passed locally. No deadline,
authorization, attribution, integrity, rate-limit or launch-state guarantee changed.

## Earlier validation and release attempts

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
but a later 02:55:34 Redis delay caused four HTTP 503s. That earlier window
therefore left this ticket open for the subsequent investigations above. The
detailed EVAL
timeout is in Railway worker stdout; Datadog contains only the generic caller
failure. Read the recovery report before interpreting a clean short window.
Use Web APM env:prod and Admin APM env:production, actual primary-host traces,
revision-scoped request populations and structured delivery outcomes.

## Separate follow-ups

- feat-513 tracks the separately observed workflow enqueue/listener ownership
  issue. Its contribution to Watch latency is not yet causally established.
- feat-516 tracks a near-startup profiler pause that has no matched request
  failure and was not reproduced in later timing-only observations.
- feat-517 tracks the browser hydration error observed without a recommendation
  failure during the extended window; its initiating cause remains unproven.
- feat-464 owns broader playback evidence transport/reconciliation reliability.
- feat-487/feat-488 own curated coverage and homepage launch configuration.
- feat-506 tracks pre-existing diagnostic command noise from missing ps/cache
  paths; it is separate from the recommendation request timeouts.

## Reopened by later evidence — September 18

The earlier release window remains valid evidence for its reproduced catalog
fixes. It is not the current overall recovery verdict. On September 17 at
23:48:41, after worker isolation PR #2337 deployed to Admin, trace
`e3c73fbba25d1f77b5c137ec7115347a` records Web HTTP 503 at 750 ms and an Admin
selection mutation continuing for 1,432 ms. Its browser aborted at 801 ms.
That batch's 12 recommendation deliveries all served six cards without semantic
fallback. A later browser abort had server HTTP 200 and a short Admin request,
so those two aborts must not be assigned one cause.

This ticket is reopened for the remaining proven deadline failure. feat-513's
runner isolation is independently verified; feat-516's cold-profiler correction
and feat-517's autoplay hydration correction are deployed and independently
verified. None establishes global
selection recovery. Read `docs/operations/watch-followups-verification-2026-09-18.md`
for dates, revisions, separate outcome populations and diagnostic cleanup.

After profiler PR #2339 deployed as `c813991ad3645aebdb50d6b1cac92a47b5aad250`,
trace `b0e7eb73435b3df258c9f5c2a91ab5cf` at September 18 00:27:55 still
records selection Web HTTP 503 at 705 ms and an Admin mutation continuing for
1,469 ms. It occurred about nine seconds after the ordinary 157 ms profile
collection. That batch's 12 deliveries served six cards without fallback;
five selections acknowledged successfully and one browser request aborted.
This observation prevents an overall recovery claim and is not attributed to
profiling or PostgreSQL locks without a causal reproduction.

The 00:36:57–00:38:02 bounded observer further measured actual pg pool
acquisitions up to 741 ms with over 100 queued waiters. Independent PostgreSQL
sampling also observed a 444 ms advisory-lock wait while other transactions
waited on the application. The browser batch contained three HTTP 200
`delivery_timeout` fallbacks, two separate `in_flight` fallbacks and one
trace-confirmed selection HTTP 503. Prisma batches many image-derivative calls
into one SQL query, confirmed both
locally and by production row counts; span count alone therefore does not prove
SQL fan-out. The workload causing the remaining pool pressure is unresolved.
Pool, lock and scheduling costs remain distinct; no new correction is claimed.

feat-515 subsequently recovered and explained the separate ten-second headless
paint case through Chrome toolbar surface synchronization, with a production
browser-feature control. That investigation does not resolve these Admin
deadlines. Additional retained APM spans at 00:50–01:20 include playback/evidence
HTTP 503s; sampled delivery HTTP 200 spans alone cannot establish their body
semantics. See `docs/operations/watch-paint-surface-sync-2026-09-18.md` and the
distinct non-headless post-response paint follow-up feat-520.

Final checks on Web/Admin `c813991ad` also reproduce a `delivery_timeout` HTTP
200 fallback and trace-confirmed selection HTTP 503 at 00:47:19 without any
temporary production instrumentation. Trace
`75f0d58d57ea0aa72f431b2f84e78f0c` has upstream timeout at 700 ms and an Admin
mutation continuing for 1,710 ms. This is still unresolved.

## Sustained corpus review — September 21

Follow-up implementation adds a bounded Web delivery outcome event for both
delivery handlers. It distinguishes HTTP failures from HTTP 200 timeout envelopes
and records the final card count plus the upstream result before contextual
recovery. [The event contract and verification procedure](../../operations/watch-delivery-outcome-observation-2026-09-21.md)
document privacy boundaries, ingestion reconciliation and browser-receipt limits.
Local validation: 54 focused tests; the full Web suite, lint and typecheck passed.
PR #2352 deployed automatically to Web as
`4e31f822781f44df06e91c8194142a6c4b51646a`, verified in the running service.
The first identical revision/window comparison reconciled 22 indexed delivery
events to 22 primary HTTP requests, distinguishing a coverage fallback from
timeout fallbacks. [Extended release observations](../../operations/watch-ticket-execution-2026-09-21.md)
record population and window limits. This is an observability correction, not a
selection latency fix; the ticket stays in progress.

The read-only [64-hour 35-minute production review](../../operations/watch-recommendation-corpus-review-2026-09-21.md)
keeps this ticket in progress. From September 18 04:15 through September 20 20:50
UTC, primary Web request metrics contain 256 selection HTTP 200, 13 HTTP 400 and
one HTTP 503. The additional September 18 06:26 failure has a 406.9 ms
capability-budget call (275.9 ms inner query span), but no corresponding server
wait sample proves WAL sync, lock contention, pool starvation or application
scheduling as the complete cause. No later selection 503 appears in that window;
that does not establish root-cause recovery.

Delivery has 28,931 HTTP 200 and one HTTP 503, reported separately from 36,572
HTTP 403 admission responses. The number of HTTP 200 `delivery_timeout` envelopes
is unknown: failed issuance can bypass persistence, and the reviewed telemetry
has no complete envelope-outcome counter. Add bounded, privacy-safe outcome
measurement before claiming zero semantic fallbacks.

The persisted cohort has 28,678 deliveries, 257 selections, zero invalid receipt
orderings and 3,508 hybrid personalized deliveries. Current Admin/worker run
`2fe115f075064669df9ece2f84022acc73ae9351`; Web runs
`964c1e3cde7ecd2ea1f3253817770527213ac11f`. These are reviewed identities, not a new
runtime fix. Remaining field hydration errors are tracked separately in
[feat-523](feat-523-watch-field-hydration-mismatch-attribution.md).

## September 21 closeout continuation

The [latest release investigation](../../operations/watch-closeout-release-2026-09-21.md)
separates the deployed reconciliation scan correction from this ticket's remaining
selection cause. Historical scheduler heartbeats reject reconciliation overlap
for the sampled 03:40, 03:45 and 06:26 failures. The 06:26 trace includes several
slow reads, a 406.9 ms capability call and application gaps; neither a single
WAL-sync sample nor a healthy current pool establishes the complete cause.

Current bounded wait sampling sees real catalog/database activity and transient
I/O waits, without an observed blocker, while correlated browser selections
succeed. Query age is not wait duration and this is not a pool-acquisition trace.
No additional selection fix, increased deadline or ambiguous retry is justified.
HTTP failures, final semantic envelopes and browser response handling remain
separate populations. Keep this ticket in progress.

Retained PostgreSQL checkpoint records provide no direct overlap for the last
failure: the previous checkpoint ran 06:24:37.751–06:24:45.857 UTC and the next
started 06:29:37.647, surrounding the 06:26:02.748 selection failure. Use the
PostgreSQL timestamp inside each record; Railway sometimes assigns starting and
completion records the same collector timestamp. This negative result does not
exclude independent WAL, file-I/O, pool or application stalls.

## September 21 startup reproduction and scoped correction

The [startup investigation](../../operations/watch-startup-readiness-2026-09-21.md)
records two new six-card HTTP 200 `delivery_timeout` envelopes at 03:11 UTC,
coincident with Admin startup. There are no selection 503s in that fixed window;
keep these populations separate. A local production-build CPU profile identifies
Next's unawaited background route preloader competing with the first GraphQL
requests after health already returns 200.

Five matched first selections take 926–949 ms with original readiness and
307–402 ms when readiness awaits the existing preload promise and GraphQL
initialization. Twenty delivery probes serve six cards without fallback. The
candidate uses a pinned Next patch; it preserves the 700 ms caller budget,
transaction/rate-limit guarantees and normal route preloading. All 7,286 Admin
unit tests pass. PR #2362 merged as `1cb15d6fc2b5cb0387e23b02afc24a05d4c1acaa`;
Railway and independent SSH reads confirm that revision on Admin and its worker.
See the release section of the linked investigation for exact deployment IDs.

Keep this ticket in progress. A first editor visit still delays concurrent
GraphQL by roughly 0.8–0.9 seconds on both controls, and the historical
capability-budget stall is not fully attributed. Neither the startup correction
nor a later short healthy window proves complete recovery. The
[durable learning](../../solutions/performance-issues/next-background-preload-can-outlive-readiness.md)
records rejected warming/disabled-preload controls and the remaining SSR work.

## September 21 server module reuse continuation

The same [investigation](../../operations/watch-startup-readiness-2026-09-21.md)
now proves the remaining local first-editor interference: separate server module
graphs construct three main and three sync Prisma clients and initialize bundled
Mastra copies. Cache the production clients globally while keeping separate
10/5 limits, and externalize only Mastra core/memory through Node's cache.
Five actual editor-concurrent selections improve from 854–960 ms to 472–552 ms,
with one main/one sync client, accepted receipts and no GraphQL errors. A new
production module-cache regression fails before the fix; all 7,288 Admin tests
pass afterward. The final build without counters passes 25 simultaneous-selection
checks during cold editor visits at 509–579 ms and 20 six-card deliveries without
fallback. Lint, typecheck, build and sequential Compound Engineering review pass.
PR #2363 merged as `850cd7b5b582c327deac8fa50a9e5ebd85abd438` after all
required CI checks, including 113 PostgreSQL and two Redis checks. Railway and
independent SSH verification confirm that exact Admin revision and built
core/memory externalization; see the linked release record for deployment IDs
and the worker/post-deployment observation.

Keep this ticket in progress. Historical capability-budget/WAL/pool latency is
not fully attributed. A newly observed playback HTTP 503 at 05:07:25 UTC has an
upstream `fetch failed` after 330 ms, separately from selection timeouts and
semantic delivery fallbacks. No larger deadline or ambiguous retry is added.

The next Admin handover also records a fast playback 503 at 05:40:18 UTC
(159 ms total, 154 ms upstream fetch failure). A bounded optional network-code
observation was subsequently deployed in PR #2364 to distinguish
socket/refusal/DNS causes in natural failures; this is not a latency fix. The verified post-module window
05:41–05:49 has 68 reconciled delivery envelopes, zero semantic timeouts, two
successful selections and 224 playback requests without 5xx. Its small size does
not establish recovery or explain the historical capability-budget wait.

The [diagnostic release record](../../operations/watch-transport-cause-release-2026-09-21.md)
verifies exact revision `d0c749b981b8c3cf777c6e62bd9e5eae1abbd2bf` on Admin,
worker and Web, including the field in Web's compiled playback route. It retains
separate HTTP/envelope populations and collector discrepancies. Keep the
capability-budget and transport cause questions open; installation of a
diagnostic is not proof that the remaining failures are fixed.

## September 22 sustained production verification

The [September 22 sustained production check](../../operations/watch-production-verification-2026-09-22.md)
finds a new selection HTTP 503 at 08:37:29 UTC on September 21:
trace `6ab0ecc9000000002cc67b5b00886e66`, Web 706.20 ms, Admin resolver
759.40 ms, capability-budget call 701.12 ms (adapter SQL 697.29 ms). Existing
loop/GC metrics do not explain the whole budget delay; native pool, database
execution/lock/WAL and scheduling remain distinct.

A separate 12:49–12:50 playback burst contains 63 HTTP 503s, a PostgreSQL 53100
shared-memory error, 206 repeated catalog error logs, a measured 38.55-second
event-loop delay, and one episode-lock exhaustion. Error-handling amplification
has a subsequent isolated reproduction: pinned Yoga/Next plus the deployed
source-map structure stalls for 10.86–11.46 seconds over 206 errors; preserving
the logs as existing stack strings takes 36–39 ms. This establishes a local
formatting mechanism, not full production-build attribution or a shipped fix.
The larger corpus has
70 selection 200s, four 400s and one 503. Both collectors observe zero semantic
timeouts among 4,280 delivery 200s, but three primary 200s remain unmatched.
Keep this ticket open; no larger deadline, ambiguous retry or speculative
production setting change is justified.

## September 22 error-amplification correction

The [actual-build reproduction](../../operations/watch-error-formatting-recovery-2026-09-22.md)
now establishes a complete error-handling interference path: the catalog failure
fans out through Yoga and Next repeatedly inspects source maps, delaying unrelated
real mutations. Production GraphQL logging now uses native Error inspection while
retaining every error, masking, severity, causes and normal log forwarding.
Twenty fixed-build selections acknowledge in 135–208 ms during 206 catalog errors,
versus five control selections around 75.8 seconds. The separate control HTTP 408
is retained. All 7,293 Admin tests, lint, typecheck and build pass.

Keep this ticket in progress until exact automatic deployment and sustained
observations pass. The initiating shared-memory failure and separate 701 ms
capability-budget call still require independent investigation; neither is closed
by the logging correction.

## September 22 catalog shared-memory correction

PR #2369 merged the error-inspection correction as
`9492f01e92572777def7432d65b73f9910410fc4`; automatic release verification
remains separate from merge. The [catalog investigation](../../operations/watch-catalog-memory-recovery-2026-09-22.md)
also reproduces the initiating SQLSTATE 53100 with concurrent reads. The Mux
playback loader's nested `take: 5` transfers the entire eligible dubbed catalog
and can parallel-hash the Mux table. A bounded scalar LATERAL projection uses
existing indexes, preserves playback choices and removes that hash plan.
Actual Prisma calls improve from 20/40 shared-memory failures to 40/40 successes
in 32–83 ms. In the actual Next build, 30 simultaneous-workload catalog reads
have no GraphQL errors; all 15 concurrent selections acknowledge in 239–330 ms.
Real PostgreSQL semantics/cardinality regressions and all 7,293 Admin tests pass.

Keep status in progress until the exact automatic deployments and sustained
production evidence are recorded. The separate capability-budget delay remains
unattributed. Another task restored the homepage pilot in PR #2370; this task
received the user's instruction to keep it removed. The single-block rollback
requires an authenticated publishing connection; no authored-content or flag
change has yet been made by this task.

## September 22 exact runtime release and independent wait evidence

PR #2371 merged as `ce421561ee9bcf89991dea5a060a656e45c3434b`; Admin and
worker now independently verify that exact revision and both compiled fixes.
The [release verification](../../operations/watch-runtime-release-verification-2026-09-22.md)
records the indexed final production query at 9.982 ms for 206 rows, the initial
logger-only HTTP and semantic populations, and the remaining acceptance gates.
Current production PostgreSQL has a 64,000,000-byte shared-memory mount, which
supports the bounded local allocation reproduction; historical concurrency
remains unknown. No memory limit, deadline or durability setting was changed.

The failed selection's persisted budget transaction timestamp is near the start
of its 697 ms SQL span, arguing against assigning the whole call to native pool
acquisition. A later read-only sample observes a 264.884 ms-old budget statement
in `WalSync`; that is query age, not measured total WAL-wait duration, and does
not establish the full incident cause. Keep this independent question open and
do not describe the short healthy release window as complete recovery.

## September 22 budget timing diagnostic

The separate 701 ms capability-budget call remains unattributed. The supported
single-statement diagnostic now brackets one function invocation with server
clocks and compares it with the complete monotonic client call. Slow completed
calls emit bounded, identifier-free timings. The remainder includes possible
pool, planning, commit, transport and scheduling time; it is not labelled WAL
duration. No function, commit boundary, deadline, retry or durability setting
changes. See the [measurement guidance](../../solutions/best-practices/separate-budget-function-time-from-driver-latency-20260922.md).

All 7,305 Admin tests and 17 real PostgreSQL tests pass, including concurrent
budgets, independent durability and injected local server/client delay checks.
The 2,000-call comparison preserves every charge with approximately 0.07–0.36 ms
warm median overhead. An actual Next build accepts all 15 concurrent selections
in 237–341 ms and all three playback mutations in 259–339 ms during 30 concurrent
catalog requests. [Validation artifact](../../validation/watch-budget-timing-20260922/results.json)
retains individual rounds and their limits. This is a diagnostic change, not a
proven fix for the remaining selection delay. Exact deployment verification and
naturally slow-call attribution remain required; keep status in progress.

## September 22 diagnostic release and natural WAL evidence

PR #2374 is independently verified on Admin and worker at
`92a597ee03074bf4d79b0eb21db4499046ecd09f`, including the compiled diagnostic
and both preceding fixes. Bounded read-only captures now correlate 212–312 ms
budget calls with near-zero measured function execution, WAL sync/write waits,
and database-volume I/O pressure despite little nearby write traffic. A final
254 ms call repeats that pattern. No sampled row/advisory blocker is present.
Separate 406–1,708 ms calls lack simultaneous server-wait evidence; do not assign
their remainder or the historical 701 ms selection failure to WAL by inference.
The underlying storage cause and a demonstrated corrective change remain open.

The normal public-browser canary supplies two six-card served envelopes, one
selection HTTP 200 with a matching attributable database row, and accepted
playback evidence. Missing browser responses remain explicit. No terminal 409
was exercised. See the [release record](../../operations/watch-runtime-release-verification-2026-09-22.md)
for observation populations, runtime revisions, temporary-observer cleanup and
the remaining authenticated homepage rollback. Keep the ticket in progress.

## September 22 exact contextual scoring continuation

The resumed investigation identifies another concrete query inefficiency:
`queryScenesSimilarMany` evaluates cosine distance twice for every eligible
chunk/seed pair. A production contextual query took 2,262 ms while other Admin
connections were idle. The isolated PostgreSQL regression fails with 16 distance
calls and passes with 8 after moving similarity projection outside the inner
`DISTINCT ON`. Exact outputs and all 176 seeds remain represented.

The correction reduces three concurrent long-film queries from 5,332–5,525 ms to
3,376–3,407 ms in the documented synthetic fixture, without changing deadlines,
pool sizes, ranking or eligibility. Concurrent small writes stayed below 34 ms
before and after, so it is not proof of the historical selection timeout's
cause. The bounded production wait capture did not catch a slow budget call;
all observers stopped and no global diagnostic settings changed.

[Learning and verification](../../solutions/performance-issues/contextual-recommendations-repeat-catalog-work-20260915.md#september-22-count-distance-evaluations-not-just-statements)
retain the rejected vector-copy experiments and workload limits. This entry
records local validation; exact automatic deployment and production observation
remain required. Keep this ticket and its independent acceptance gates open.

The completed 21:55–23:55 UTC window has 23 selection 200s, two selection
400s and no selection 503s; playback has zero 5xx / 8,725 requests. Independent
Railway delivery outcomes reconcile all 1,524 delivery requests and retain
**one HTTP 200 `delivery_timeout` among 761 delivery 200s**, at 23:48:30.
Its final persistence transaction/rollback is delayed. A bounded task-owned
read diagnostic overlaps the incident and may have contributed; the trace
does not resolve server execution, native pool, lock or storage attribution.
No traffic is excluded. This is not a clean final-release recovery window.
Admin/worker remain independently verified at `92a597ee…` at September 22
00:10:27. The [release record](../../operations/watch-runtime-release-verification-2026-09-22.md)
retains the exact revisions, collector gaps, transient pointer audit and cleanup.
