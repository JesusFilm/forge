# Watch runtime recovery — 15 September 2026

Status: six fixes deployed; investigation remains open after an additional
Redis admission failure at 02:55:34. The clean 30-minute window below does not
establish that the remaining failure has been resolved.
All times are UTC.

The authored English Homepage Recommendations Block remains removed. The
`forge.watch.homepageRecommendations` flag remains default off. Targeted Web
launch configuration is separate from runtime recovery; production currently
lacks an LD server SDK key. The shared Admin API, normal Watch playback and local
six-card experience can be verified independently. No mobile or TV frontend was
changed and no curated pools were republished in this recovery pass.

## Causes and deployed changes

| PR                                                    | Reproduced cause                                                                                                                                | Correction                                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#2297](https://github.com/JesusFilm/forge/pull/2297) | Next synchronously hashed a 9.5 MB cached inventory response for its generated ETag, starving unrelated request callbacks.                      | Disable generated page ETags, retaining ISR and Cache-Control.                                                                                            |
| [#2298](https://github.com/JesusFilm/forge/pull/2298) | Contextual fallback repeated catalog-wide work for every source scene; one production request ran 34 queries after the primary provider failed. | Materialize all seed vectors once and combine the exact per-seed search, retaining all seeds, ranking and deduplication.                                  |
| [#2299](https://github.com/JesusFilm/forge/pull/2299) | A delayed Redis TIME response could make the conservative Lua deadline expire before the original command budget.                               | Refresh once only after Lua explicitly proves no mutation occurred, within the original remaining budget.                                                 |
| [#2300](https://github.com/JesusFilm/forge/pull/2300) | Serial curated-generation, pool and membership reads consumed the source-free delivery budget.                                                  | Read that metadata in one bound SQL snapshot; retain live variant eligibility and issuance atomicity.                                                     |
| [#2301](https://github.com/JesusFilm/forge/pull/2301) | Remaining page processing still blocked Redis callbacks on the shared Web event loop, producing artificial admission timeouts.                  | Run the existing small Redis admission operation on one bounded native Node worker and accept timestamped results completed before the original deadline. |

These are separate defects. The first four changes did not by themselves resolve
the remaining Web failures. The worker does not eliminate synchronous page CPU
work; it prevents that work from making healthy admission I/O expire.

A further trace exposed unnecessary waiting after failed issuance: the callback
had failed but Admin still awaited a 2,294 ms ROLLBACK before returning. The
follow-up reports known callback failure while Prisma rolls back, and bounds
callback work to the existing deadline. Successful callbacks still await commit
acknowledgment; an outer timeout must not turn committed ISSUED data into a
reported failure. The fix merged in [#2302](https://github.com/JesusFilm/forge/pull/2302); release
observations are recorded below. Its full Admin suite passed 6,596 tests and four
real PostgreSQL cases, including callback deadline rollback. Build, types, lint,
formatting, sequential review and required CI checks passed.

### Deployment identities

| Service/change         | Main SHA                                   | Railway deployment                     | Successful at |
| ---------------------- | ------------------------------------------ | -------------------------------------- | ------------- |
| Web ETag               | `4487a97c461b2881141c87ab0101ce8cdb6b30c9` | `67d6a6cd-fe5b-4e1e-b3e8-c37dd04c7636` | About 00:11   |
| Admin contextual query | `dfbea3507a8699ad83f40ae0a1ab2d45694dd126` | `8412b894-a136-48ee-aea3-a31ce7643bdb` | About 00:32   |
| Web Redis clock        | `cc252f9d5869547d4c47b267169464df12538fc2` | `ca4053b7-93bb-4568-850d-5858e84b5bc5` | 01:07:39      |
| Admin curated metadata | `6e97237b744b1e09329425dd9a8658bdf755ab01` | `6d0fc99b-4c88-40e3-a31a-dc99330b6032` | 01:24:40      |
| Web admission worker   | `5a2009df5f366c740a3d05573524c207e81d5dfa` | `ac4dfc83-addf-4845-bcce-b99987281bb5` | 02:19:07      |

Admin rollback follow-up: main `3cc4017af0912f460b7a26c65138e097ed2eadb7`,
Railway `b99f39ae-106e-427e-bf22-09e80ae9c27c`, successful at 02:34:45.

All deployments followed reviewed PRs, passing CI and normal main autodeployment.
No manual Railway redeploy or local worktree publication was used.

## Discriminating tests and compatibility

- The original Redis core fails with untouched counters when the main loop is
  blocked for 350 ms after issuing TIME. The same core on the worker succeeds
  while the main loop is blocked for 650 ms and increments each bucket once.
  The overdue main-thread watchdog drains already-completed messages before
  rejecting a request. Startup and queueing consume the existing total budget.
- Real Redis tests retain late initial/retried EVAL no-write guarantees, atomic
  limits, separate privacy capacity and concurrent admission draining. The
  existing CI Redis entrypoint now runs eight tests. Six worker lifecycle tests
  cover capacity, late completion, worker exit, backoff, concurrent playback and
  correct per-request AsyncLocalStorage logging.
- Final #2301 CI passed 4,271 Web tests (eight skipped, one todo), real Redis,
  type/build checks, lint, formatting and security analysis. The full Admin suite
  passed 6,594 tests for the query changes, with real PostgreSQL regression tests.
- Complete contextual responses are identical before and after the query change.
  Local Augustine improves from 32,129 ms / 37 statements to 933 ms / three;
  JESUS English improves from 148,790 ms / 178 statements to 4,091 ms / three.
  A regression test includes a strongest match at the 176th seed so an arbitrary
  seed cap cannot silently return incorrect recommendations.
- Curated retrieval retains the complete 64-candidate output for English,
  French and Hindi with and without interests. Cold native statements fall
  from eight to five. At 35 ms injected round-trip latency, an English case
  changes from a 551 ms deadline failure to a successful 387 ms response under
  the same 400 ms retrieval ceiling. Request/item/audit rollback is verified.
- Prisma already batches the six issuance items into one INSERT. Expanded traces
  and real PostgreSQL comparison disproved a per-item INSERT bottleneck; that
  hypothesis did not become a speculative rewrite.

There are no changes to API shapes, profile identity, six-card fill rules,
selected-language eligibility, viewing-history rules, rate limits or Redis/Admin
deadlines. The native worker receives only Redis configuration and HMAC-derived
admission keys, namespace and deadline. It has bounded pending work and heap, and
fails closed on genuine worker or Redis failure.

## Page performance and browser evidence

The final rebuilt control and worker candidate each served 294 page requests
in the matched 20-second local workload; both returned 19/19 successful profile
requests. Candidate catalog median/p95 was 292/342 ms, versus 292/369 ms control.
Video median/p95 was 188/253 ms versus 171/209 ms; maxima were 271 versus 390 ms.
This establishes equivalent throughput for that workload, not a universal
latency improvement. The blocked-loop Redis regression isolates the reliability
improvement that this short workload may not trigger.

The final local production-build browser journey at 01:42:55–01:43:55 passed:
six distinct cards below Browse by Category, stable browsing, selection HTTP 200,
36 seconds of real playback, evidence/playback HTTP 200 and fresh six-card
homepage return. There were no JavaScript page exceptions. A playback POST
aborted during navigation is recorded separately from completed HTTP failures.

Two cache experiments were rejected and removed: decoded-page memoization still
left admission stalls, and whole-value JSON worker serialization worsened catalog
p95 from 330 to 457 ms and video p95 from 217 to 347 ms. Neither changed production
cache policy. Rebuild controls from matching source and dependencies, and isolate
cache prefixes between local builds: an initial stale control and shared cached
HTML pointing at old JavaScript chunks invalidated early local comparisons.

## Production comparison

Use the public primary host behind Cloudflare,
`dd541ea7-e468-4159-af6c-25a59cba326c.jesusfilm.org`, and verify trace hosts as well as
version tags. APM metrics are revision-scoped. Logs carry revision in `ddtags`;
using the APM `@version` filter on logs can incorrectly suggest no failures.
Count requests with metrics aggregation, not sampled trace or log row counts.
Admin APM uses `env:production`, whereas Web APM uses `env:prod`; both services' forwarded logs use `env:prod`. An initial Admin query
using Web's tag matched no data and was discarded. Check both `web.request` and
`next.request`: missing root error metrics alone can hide an aborted upstream
request that was recovered elsewhere in the trace.

### Pre-worker baseline

Fixed window **01:07–01:43**, Web `cc252f9d`:

| Route                  | Requests | Recorded errors |
| ---------------------- | -------: | --------------: |
| Profile                |    1,198 |               7 |
| Seeded recommendations |      633 |               8 |
| Playback               |    1,128 |               3 |
| Evidence               |      632 | No error series |
| Source-free delivery   |        1 | No error series |
| Selection              |        1 | No error series |

The source-free and selection calls were probes; the homepage feature was off.
A missing error series is correlated with logs/traces rather than treated as
proof by itself. There were 18 recorded errors in this 3,593-call population.

Primary-host examples show the remaining cause:

- 01:16:23, real Chrome profile: trace `4122266214311152701`, TIME 348 ms against
  250 ms, followed by backoff failures.
- 01:37:35, iPad playback: trace `6aa8a15f000000006f5fb5b9e76669b6`, EVAL 396 ms
  against 338 ms remaining. This is admission failure, not slow Admin playback.
- Failures continued at 01:53:45 and 01:56:02 on the same old revision, with TIME
  412 ms / 250 ms and EVAL 442 ms / 372 ms. A clean six-minute 01:09–01:15 window
  had already proved insufficient: real failures returned a minute later.

### Admin deployment checks

Five fresh production contextual probes returned six distinct candidates in
666–2,591 ms, including JESUS English/Spanish/French. After #2300, six fresh
source-free English/Spanish/English probes at deployment and 01:29 returned six
distinct cards: 1,214/1,813/2,391 ms at startup and 919/1,045/1,245 ms settled,
including network transit. Admin-internal startup durations were 207/920/1,387 ms.
A verified DDSQL audit of structured logs from 01:25–02:23 found nine served
deliveries and no unavailable results: six on Admin `6e97237b` (maximum 327 ms)
and three on `5a2009df` (maximum 486 ms). These are diagnostic probes because
the Web homepage feature remains disabled. Sample positive records before
filtering: the log message is empty and outcome fields are structured attributes.
An attribute-search query returned no rows despite positive records; DDSQL using
`WHERE "@event" = 'recommendation.user_delivery'` returned the verified population.

The later full trace `6aa8a5a80000000070cd728ca94d97f9` revealed semantic issuance
at 01:55:52 taking 1,065 ms on served-item insertion, then 2,294 ms in ROLLBACK.
Web aborted that Admin call at 3.5 seconds and recovered with contextual fallback
at 4.15 seconds / HTTP 200. This prompted the failed-callback reporting fix rather
than a claim that all underlying requests were healthy.

Three further cold-start probes at 02:03 returned six distinct cards in
937–1,199 ms. Following the normal Admin autodeployment of main `5a2009df`
(Railway `f353ecd5-2080-44e3-bb48-927d8c73e0fa`, ready 02:05), three trace-tagged
probes at 02:10 returned six in 727–1,195 ms. Trace `39184293741735211` confirms
the public Admin host and that exact revision, with 489 ms inside the resolver.

After the rollback fix deployed, three fresh trace-tagged cold-start probes
at 02:34:46–02:34:58 returned six distinct cards in 639–1,045 ms. Settled French,
Hindi and English probes at 02:50:02–02:50:17 returned six distinct cards in
1,242/1,554/1,130 ms. The verified structured-log population on final Admin
`3cc4017a` contains six served deliveries, no unavailable outcomes, and a
maximum resolver duration of 1,012 ms through 03:00. The final
02:35:28–02:36:17 production browser journey returned six seeded recommendations,
played 36.02 seconds and acknowledged profile, playback and evidence with HTTP 200. No page exceptions occurred, and homepage/flag state remained unchanged.

### Final worker observation

Web deployed at 02:19:07. Its 02:19:07–02:19:56 browser smoke passed six seeded
recommendations, 36.02 seconds playback and profile/playback/evidence HTTP 200.
The homepage returned HTTP 200 with no authored row; availability was false and
direct source-free Web delivery was denied with the expected HTTP 403. No browser
exceptions were recorded. GA returned 204. RUM did not emit in that session, consistent with its configured 50% session
sample rate. A fresh 02:32:29–02:32:42 session recorded RUM HTTP 202 receipts and
no page exceptions (`production-rum-receipt.json`).

The fixed **02:19–02:49** window contains **2,863** recommendation API calls:

| Route                  | HTTP 200 | HTTP 400 | HTTP 403 | HTTP 5xx |
| ---------------------- | -------: | -------: | -------: | -------: |
| Seeded recommendations |      240 |        0 |      224 |        0 |
| Evidence               |      336 |        3 |      260 |        0 |
| Playback               |      666 |        0 |      241 |        0 |
| Profile                |      371 |        0 |      520 |        0 |
| Source-free delivery   |        0 |        0 |        2 |        0 |

That is 1,613 HTTP 200, 1,250 HTTP 4xx and zero HTTP 5xx. Admission failure
logs were also absent in this window. These metrics are explicitly grouped by
`http.status_code`, rather than interpreting a missing error series as zero.
The population includes rejected requests and is not all successful deliveries.

The first nine minutes of Web runtime metrics still show a
1,044 ms maximum event-loop stall, reinforcing that admission isolation must
work even when page processing remains busy. The population includes fast
HTTP 403 rejections and is not described as all successful requests. A retained
real Chrome profile on the primary host returned HTTP 200 in 247 ms at 02:27:31
(trace `6aa8ad13000000005a8da3b51257605a`). Both release probes and the final
playback journey passed.

### Remaining Redis investigation

Extending trace inspection past the fixed window exposed four admission HTTP 503s
at 02:55:34–02:55:35 on Web `5a2009df`, beginning with profile trace
`6aa8b3a6000000007bcb21de559779ec`. The initial request took 253 ms; the next
three failed during the existing one-second Redis backoff. Railway stdout shows
`stage=eval reason=timeout durationMs=2 budgetMs=1`: the worker's preceding
TIME work used almost all of the 250 ms command budget.

The extended **02:19–03:15** population is 5,444 calls: 2,958 HTTP 200,
2,482 HTTP 4xx and four HTTP 503. No further admission failure logs appeared
between 02:55:36 and 03:15. This is an improvement over the baseline, but does
not close the newly observed failure.

Datadog only received the caller's generic `stage=worker reason=unavailable`.
The worker does not initialize the main thread's patched console forwarding,
so the detailed core diagnostic remained in Railway stdout. Do not infer a
worker crash or queue timeout from the generic log. Redis had no restart and
its preceding background save finished at 02:55:07.960, before this request.
One-minute CPU usage was 0.73 of Web's eight CPUs and 0.11 of Redis's 24 CPUs;
those averages cannot establish the absence of brief scheduling or server stalls.
The precise cause of this TIME delay remains unconfirmed. Read-only Redis
slow-log/latency diagnostics are the next discriminating check; no timeout
increase or speculative cache change has been applied.

Broader tracing also found a download HTTP 503 and another upstream fetch error
at 02:34:46, coinciding with the Admin deployment cutover. These were outside the
recommendation request population. Do not generalize the clean recommendation
window to every Web endpoint or claim the whole service had zero errors.
Follow-up: `docs/roadmap/platform/feat-507-admin-cutover-private-network-errors.md`.

Broader Web span checks found pre-existing diagnostic command errors for missing
`ps` and `.next/cache`, reproduced on both old and new revisions. They are tracked
in `docs/roadmap/platform/feat-506-web-diagnostic-command-noise.md`; they are not
recommendation request failures and are not represented as fixed by this work.

## Durable learnings and artifacts

- `docs/solutions/performance-issues/watch-etag-hashing-starves-recommendation-admission-20260915.md`
- `docs/solutions/performance-issues/contextual-recommendations-repeat-catalog-work-20260915.md`
- `docs/solutions/performance-issues/redis-clock-sample-can-expire-admission-early-20260915.md`
- `docs/solutions/performance-issues/curated-fallback-serial-metadata-reads-exhaust-budget-20260915.md`
- `docs/solutions/performance-issues/page-rendering-blocks-redis-admission-callbacks-20260915.md`
- `docs/solutions/performance-issues/failed-issuance-waits-for-rollback-20260915.md`

Redacted local evidence is under `/home/nisal/.cache/forge-runtime-timeouts/`:
`admission-worker-production-baseline.json`, `admission-worker-final-summary.json`,
`control-matched-final-summary.json`, `journey-admission-worker-final-origin.json`,
`admin-contextual-production.json`, `admin-delivery-probe-curated-deployed.json`,
`admin-delivery-probe-curated-settled.json`, `admission-worker-production-final.json`,
`admin-delivery-probe-rollback-settled-multilingual.json`,
`recovery-final-correlated-checks.json`, `worker-0255-railway.json` and the final
deployment/probe logs.
Credentials are excluded from the report and repository.
