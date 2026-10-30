# Watch production latency incident — 2026-10-19

Tracking: feat-745. Plan: `docs/plans/2026-10-19-watch-production-latency-investigation.md`.
Evidence index, exact queries and sanitized raw data:
`docs/reports/2026-10-19-watch-production-latency-evidence/README.md`.

Status at last update (18:45 UTC): **incident ongoing. No production change made.
Recovery not observed.**

Revision 2 (18:45 UTC) replaces the 16:40 draft. An independent review found
that draft's exclusions were stronger than its evidence. Each correction is
listed in "Review findings and responses" at the end.

## Summary

- **Measured:** the single production Web process (`next-server`, Railway
  replica `7116eeca…`, deployment `772be46d…`, commit `3003c520`) runs every
  request on one Node main thread. That thread is runnable ~99% of the time:
  82.5% on CPU / 16.8% in the run queue at 16:31, and 66.8% / 32.7% at 18:41.
- **Measured:** requests of every kind queue. That includes static files that
  do no rendering (p50 7.7 s). 140–330 requests are in flight at once, against
  0–29 before onset. 39% of requests end as HTTP 499 because the client gave up.
- **Measured:** the origin finishes fewer requests than before onset: ~13/s
  including 499s, against 25–30/s at root p95 1.1 s. **Arrival load is not
  known.** Both Railway logs and Datadog record only finished requests, so a
  surge before or at onset, or a growing backlog, is not ruled out.
- **Measured:** a slow and a fast cache HIT on the same route, replica and
  edge, 82 s apart, had TTFB 37.5 s and 1.45 s. Railway's upstream duration
  equals the total, so the time is spent at the origin. **Where inside the Web
  process is not measured.** No span covers the cache read or decode. This PR
  adds spans for cache reads and writes. The response write is still not
  covered.
- **Leading hypothesis, not confirmed:** the host's CPU contention, landing on
  a service whose main thread already ran near its limit (event-loop
  utilization average 0.88 before onset). It is not confirmed that the
  predecessor's host was less contended; its scheduler stats are gone.
- **Not excluded:** more work per request. Process CPU per completed request
  rose ~39% (23 → 32 ms). That fits slower execution under contention, and
  equally fits a different request mix (more MISS renders or regenerations).
  No specific code regression has been identified. A code or workload change
  is not ruled out.

Confidence: **high** that main-thread saturation and queueing produce the
stalls (measured). **Low-medium** on why this process saturates and its
predecessor did not.

## Timeline (UTC)

| Time        | Event                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10-18 19:31 | Deployment `a6661a84…` (`156666c2`) created; process starts ~19:59.                                                                                 |
| 10-19 14:07 | Old process baseline (Railway HTTP logs): 1,500–1,800 requests/min, root p95 1.08 s, 0–29 in flight, 0.8% 499.                                      |
| 14:51       | Deployment `772be46d-0d78-4faa-aa5e-43b8d5e010d2` (`3003c520`) created.                                                                             |
| ~15:14      | New process starts. Event-loop delay average rises from ~1 ms to 60–130 ms within its first minutes.                                                |
| ~15:22      | Old process stops reporting. Deployment `8824a12a…` (`7dae8b62`) SKIPPED, not serving.                                                              |
| 15:22–16:32 | Checkly keyword check fails in us-east-1 and ap-southeast-1 (~32 s per run). Only the 16:07 pair passed.                                            |
| 16:22–16:39 | First curl samples: `/watch` HIT TTFB 6.1 s and 9.8 s; MISS 33.1 s.                                                                                 |
| 17:31       | Deployment `e288c696…` (`0527226c`) SKIPPED, not serving.                                                                                           |
| 18:33–18:36 | Matched probe pair (below): HIT TTFB 37.5 s and 1.45 s.                                                                                             |
| 18:41       | Scheduler sample: main thread 66.8% on CPU, 32.7% waiting. Host: 133–176 runnable tasks on 48 visible CPUs.                                         |
| 18:45       | Still serving `772be46d…`, runtime `c79e912b…`. p95 of `trace.web.request` 15–18 s in every 30-min bucket since 15:30 (0.9–1.5 s from 12:00–15:00). |

## Measurements

### Matched slow and fast cache HIT

Six sequential GETs to `https://www.jesusfilm.org/watch`, 10 s apart,
user agent `forge-feat745-probe/1.0`. All went through Cloudflare (`DYNAMIC`)
and Railway edge `jfk1` to edge region `us-west2`. All were served by replica
`7116eeca…`. Railway's `upstreamRqDuration` equals `totalDuration` for every
row, so the time is spent at the origin, not in Cloudflare or the Railway edge.

| Start (UTC)  | `x-nextjs-cache` | TTFB (s) | Total (s) | Railway upstream (ms) | Railway request id       |
| ------------ | ---------------- | -------- | --------- | --------------------- | ------------------------ |
| 18:33:06.469 | HIT              | 37.47    | 38.37     | 38,186                | `FPFAy9YURjq0zfQN-_9nXA` |
| 18:33:54.860 | HIT              | 22.86    | 23.93     | 23,768                | `H6G35JnWQhmTUd6D6WHkDg` |
| 18:34:28.804 | HIT              | 1.45     | 3.80      | 3,630                 | `oBkVGcucQPqnOIBu0_TJvA` |
| 18:34:42.627 | MISS             | 39.82    | 40.71     | 40,498                | `JyBZOEjOTyu9atbJpHNmDw` |
| 18:35:33.353 | MISS             | 26.57    | 30.01     | 29,844                | `F9Za0m5pTOCumIskjq4OvQ` |
| 18:36:13.379 | HIT              | 10.05    | 11.20     | 11,043                | `lRQEDKS6Qa6BVjU90_TJvA` |

What the pair shows, and what it does not:

- The slow HIT spent ~36 s more than the fast one **before its first byte**.
  The fast HIT then took 2.35 s to stream its 125 KB compressed body. So even
  writing a cached response waits on the busy thread.
- Queue depth alone does not explain the difference. About 160–170 requests
  were in flight at both 18:33:59 and 18:34:29.
- None of these requests was kept as a Datadog trace. Retention is sampled.
  So the 36 s cannot yet be split into time before Next starts the request,
  cache read (three Redis round trips plus JSON and base64 decoding), tag
  validation, and response write. **This is the exact evidence gap.** This
  PR's `next.cache.get` spans narrow it for any request whose trace is kept:
  they bound the time inside cache reads and JSON parsing. They do not split
  the rest of a read's time into Redis waiting versus other work.

### Completed requests (Railway HTTP logs, unsampled)

Railway logs one line per finished request, including requests the client
abandoned (499). Datadog's `trace.web.request.hits` counts only requests the
tracer finished. Both measure completions, not arrivals. Arrival times below
are reconstructed as completion minus duration, so they miss every request
still running when a window was cut.

| Window (UTC)      | Process       | Requests/min | 499 share | In flight (10 s samples) | Root `/watch` p50 / p95 / max | Content pages p50 / p95 | Static p50 / p95 |
| ----------------- | ------------- | ------------ | --------- | ------------------------ | ----------------------------- | ----------------------- | ---------------- |
| 14:06:44–14:09:59 | old `5140c3…` | 1,529–1,818  | 0.8%      | 0–29                     | 0.10 / 1.08 / 1.47 s          | 0.38 / 2.1 s            | 0.13 / 0.67 s    |
| 18:32:49–18:39:04 | new `7116ee…` | 742–1,002    | 39%       | 138–329                  | 20.0 / 52.4 / 61.3 s          | 15.0 / 54.8 s           | 7.7 / 48.5 s     |

Each window is the last 5,000 completed requests the Railway CLI returned for
it, so each covers 3–6 minutes. Late in-flight samples undercount, because
requests still running at the window's end are absent. The windows are at
different times of day. The traffic comparison is indicative, not matched.

### Request traces (examples, not a population)

- `6ad641ff000000006cea3e3df01e2e3a` (16:14:55, catch-all, 25.1 s): ~15 s
  before the first span, then Admin calls. Admin server spans were 135.6 ms and
  26.5 ms, inside Web client spans of 442 ms and 1,897 ms. The 15 s is
  **unattributed wall time.** It was not measured as CPU execution.
- `6ad65f3b000000005b2c16d80a6ee879` (18:19:39, `GET /watch`, 26.7 s): one
  Admin call (`GetWatchHomeVideos`) started at +14.5 s. Client span 1.35 s,
  Admin server 0.72 s. Then 10.7 s more before the response ended. No cache
  status on the span.
- `6ad65355000000001a847091a66b24c9` (17:28:53, `GET /watch`): `web.request`
  31.8 ms, but its child `next.request` lasted **22.0 s**. The response
  finished in 32 ms while Next kept working on that request for 22 s more. The
  work is probably background regeneration or after-response work; it has no
  child spans, so it is unattributed. A fast response does not mean little
  main-thread work.
- No trace examined contains a Redis span. Cache reads are invisible in APM
  today.

### Main thread: kernel view (read-only, inside the container)

| Measure (10 s window)                                 | 16:31 sample  | 18:41 sample                 |
| ----------------------------------------------------- | ------------- | ---------------------------- |
| Main thread on CPU / waiting in run queue             | 82.5% / 16.8% | 66.8% / 32.7%                |
| Main thread involuntary context switches              | not split     | 4,941/s (main thread only)   |
| Container CPU used (cgroup `usage_usec`)              | —             | 0.99 CPU of 8                |
| cgroup `nr_throttled` / `cpu.max`                     | 0 / 8 CPUs    | 0 / 8 CPUs                   |
| cgroup `cpu.pressure` some / full avg10               | 14.4% / 13.5% | 12.9–17.8% / 12.8–17.8%      |
| Host `procs_running` (R state only) / `procs_blocked` | not sampled   | 176 → 133 / 5 → 1            |
| Host load average (1 min) / visible CPUs              | 66.5 / 48     | 87.7–93.9 / 48               |
| Host `/proc/pressure/cpu` some avg10                  | not sampled   | 87.1–87.2%                   |
| Host `/proc/stat` over the window                     | not sampled   | idle 22%, steal 6.6%         |
| Affinity / `cpuset.cpus.effective` / `cpu.weight`     | not sampled   | 0–47 / 0–47 / 100 (default)  |
| Main thread policy / priority                         | not sampled   | `SCHED_OTHER` / 120 (nice 0) |

The 16:31 row is from the earlier read. Its raw output was not retained. The
18:41 raw output is in the evidence directory.

What this supports:

- The schedstat arithmetic directly shows the main thread waiting for a CPU
  for 17–33% of wall time. That is not a quota throttle: `nr_throttled` is 0.
- Load average counts uninterruptible tasks, so by itself it cannot show CPU
  oversubscription. `procs_running` counts only runnable tasks: 133–176 on 48
  visible CPUs, with 1–5 blocked. Host CPU pressure was 87%. So the visible
  CPUs were oversubscribed during the 18:41 sample.

What it does not establish:

- `/proc/stat` showed 22% of the visible CPUs idle in the same window while
  tasks waited. That is unexplained: per-CPU imbalance, or VM-level accounting.
  The host-side mechanism is therefore not established.
- The container sees its own cgroup as the root (`0::/`). Ancestor limits and
  weights are invisible, so zero local throttling does not exclude throttling
  further up.
- No equivalent sample exists for the predecessor's host. Host contention is
  the leading hypothesis for this process; that it changed from the
  predecessor is unconfirmed.

### Same-day runtime comparison (Datadog runtime metrics)

Windows: 12:00–15:10 (old process) and 15:20–18:30 (new process), both
3 h 10 min. Exact queries are in the evidence README.

| Measure                                    | Before (12:00–15:10) | After (15:20–18:30) |
| ------------------------------------------ | -------------------- | ------------------- |
| Event-loop utilization, average            | 0.88                 | 0.95                |
| Event-loop utilization, maximum point      | 1.00                 | 1.00                |
| Event-loop delay, average                  | 1.1 ms               | 60.5 ms             |
| Scavenge pause, median                     | 13.9 ms              | 22.0 ms             |
| Mark-sweep-compact pause, average          | 50.2 ms              | 95.5 ms             |
| Scavenges / mark-sweep-compacts per 1k req | 76 / 13.7            | 66 / 14.3           |
| Heap used, average                         | 601 MB               | 605 MB              |
| Process CPU user + system                  | 55.2%                | 61.4%               |
| Completed requests (`web.request` hits)    | 273,197 (24.0/s)     | 218,930 (19.2/s)    |
| Process CPU per completed request          | ~23 ms               | ~32 ms              |

The 16:40 draft's "ELU max ~0.9" was not the maximum of raw points. Raw
points reached 1.0 before onset too, so a past maximum near 0.9 cannot show
sustained headroom. Event-loop utilization
is the share of time the loop was not idle. It is not CPU utilization: a loop
waiting in the run queue still counts as busy.

GC: pauses grew 58–90% at similar heap occupancy. Similar occupancy does not
mean the same collection work: survivors, promotion, roots and allocation all
vary with workload. Collection counts per request moved in opposite directions
(fewer scavenges, slightly more full GCs). Longer pauses fit slower execution
under contention. **They do not discriminate between contention and more
work.**

### CPU profile (Datadog profiler, runtime `c79e912b…`)

- 18:33:00–18:34:00 timeline: main-loop CPU lane 42.0 s of 59.6 s (70.5%), plus
  4.1 s of GC. Event loop blocked 190–352 ms at a time, at least eight times.
  The libuv pool (size 4) had 5–33 queued operations for 0.5–1.7 s at a time.
- 18:30–18:40 CPU flame graph: non-JS threads 33% (largely GC helpers),
  microtask processing 18% (Next, the cache handler's `set`, `content.ts`),
  React server rendering ~7%, Next `handleRevalidate → set` JSON
  serialization 6.5%, Redis client socket writes 5%. The catch-all page route
  accounts for ~30 of ~65 CPU-seconds per minute.

Relative shares cannot exclude an increase in absolute work. The old runtime's
equivalent profile was not exported, so there is no like-for-like
comparison here. The 16:40 draft's async-latency table (old runtime
`7a623397…` vs new `c79e912b…`) remains valid as a symptom: callbacks completed
3–10× later. It does not distinguish late callbacks from slower I/O.

### Redis and the cache read path

What the 16:33 Redis read (`scripts/redisinfo.js`) actually measured:

- Command **call counts** over 10 s (GET 24, SET 33, HSET 67).
- `usec_per_call` from `INFO commandstats`: **lifetime averages** since Redis
  started 27 days earlier, not incident-window values.
- The last 10 `SLOWLOG` entries (HSCAN 10–35 ms). The slowlog measures command
  execution inside Redis only. It excludes client-side queueing, transport and
  the client's reply decoding.
- `noeviction`, no evictions, 0 blocked clients, 109–110 connected clients
  (not investigated).

So Redis server execution was not slow in what was sampled. **End-to-end
cache latency as Web experiences it was never measured.** The installed
handler (`@fortedigital/nextjs-cache-handler` 3.2.1, `redis-strings`) does
this for each HIT, all on the Web main thread:

1. `GET` the entry (256 KB–1 MB strings for pages), then `JSON.parse` it.
2. Convert `rscData`/segment data from base64 to `Buffer`.
3. `HEXISTS` the shared-tags hash, then `HMGET` the revalidated-tags hash.

That is three sequential round trips, each of whose callbacks waits for the
busy thread. Each command has a 5 s abort. On abort, or on "client not ready",
the base `CacheHandler` swallows the error and returns `null`, so Next renders
a MISS. Its log line exists only in debug mode, so a cache read that times out
is indistinguishable from a real miss today. The new telemetry records it as
`outcome:error`. This matches the 2026-09-15 learning
(`docs/solutions/performance-issues/page-rendering-blocks-redis-admission-callbacks-20260915.md`):
page work on the same loop delays Redis callbacks.

### DNS

`scripts/dnsprobe.js` ignored each callback's error and address. A fast
callback could have been a fast failure. It also ran in a fresh process with
an empty queue. It shows that the resolver answered a fresh process quickly.
It does not show that production lookups succeed quickly inside the saturated
process. The profiler's inflated `dns.lookup` times fit late callbacks; they
are not proof of it.

### Admin

The sampled Admin server spans were fast (26–724 ms) inside slower Web client
spans. That clears only those sampled server operations. It does not cover
connection acquisition, transport, unsampled calls, or calls whose spans were
not kept.

### Page lifetime and regeneration

- Supported: pages send `s-maxage=60`. The routes declare `revalidate = 3600`,
  but the shortest `unstable_cache` TTL used during render (60 s) sets the
  page lifetime.
- Regeneration is demand-driven: the first request after an entry goes stale
  triggers a background re-render of that page. It is not a timer re-rendering
  every page every minute.
- Redis write and hit counts are not the share of rendered pages. How much of
  the baseline main-thread load regeneration causes, and what a longer
  lifetime would save, is unquantified.
- HITs still pay JSON and base64 decoding.
- A stable Redis key prefix does not mean stable Data Cache keys.
  `unstable_cache` keys include the callback's source and arguments, so a code
  change can cold-start data entries after a deploy. Not measured.
- Before proposing longer TTLs, verify that a revalidation webhook covers each
  data source those TTLs protect.

## Hypotheses: bounded findings

| Hypothesis                                        | Status                           | What the evidence covers                                                                                                                        | What it does not cover                                                                                |
| ------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Main-thread saturation causes the stalls          | **Supported (measured)**         | 99% runnable; all request classes queue; in-flight 140–330; static files wait seconds                                                           | Which work fills the thread                                                                           |
| Host CPU contention reduces the thread's capacity | **Leading, unconfirmed**         | Run-queue wait 17–33%; 133–176 runnable tasks on 48 CPUs; host CPU pressure 87%; steal 6.6%                                                     | Predecessor's host never measured; 22% host idle unexplained; ancestor cgroups invisible              |
| More work per request (code or request mix)       | **Open**                         | CPU per completed request +39%; diff adds one in-memory flag evaluation per render (flag off in production); no new hotspot in relative profile | Absolute work per request type; MISS/regeneration share before vs after                               |
| Cold cache / deploy warm-up                       | **Unlikely as the sole cause**   | Saturated from the first minutes and for 3.5 h with no convergence                                                                              | Data Cache key churn on deploy not measured                                                           |
| Redis server latency                              | **Not seen in what was sampled** | Redis execution in µs (lifetime) and slowlog ≤35 ms                                                                                             | End-to-end read latency, client queueing, decoding, reconnects; unmeasured until this PR's spans      |
| Admin latency                                     | **Not seen in sampled spans**    | Admin server spans 26–724 ms                                                                                                                    | Connection acquisition, transport, unsampled calls                                                    |
| DNS resolver latency                              | **Not shown**                    | A fresh process resolved quickly                                                                                                                | Errors were discarded; the production process's queue                                                 |
| Container CPU quota or memory                     | **Not seen locally**             | `nr_throttled 0`; ~1 of 8 CPUs used; RSS ~2 GB                                                                                                  | Ancestor cgroup limits                                                                                |
| Traffic surge                                     | **Open**                         | Completed throughput is lower now (~13 req/s) than at 14:07 (25–30 req/s)                                                                       | Arrivals are not observed; unfinished requests are missing; windows hours apart; nothing around onset |

## Instrumentation in this PR

All of it is read-only telemetry. It changes no request, cache, analytics or
recommendation behaviour.

**Instance identity.** Every DogStatsD series reaches Datadog through the
shared agent, so `host` is the agent's hostname for every Web process. dd-trace
also drops `runtime-id` from metrics by default (confirmed in the installed
5.109.0 source, and by an empty `by {runtime-id}` query in production). Two
replicas, or an old and a new process during a deploy, therefore wrote the same
series. Now:

- The scheduler and cache metrics carry `replica_id` (Railway
  `RAILWAY_REPLICA_ID`, which equals `deploymentInstanceId` in Railway HTTP
  logs) and `deployment_id`. One series per replica per deployment.
- `apps/web/railway.toml` sets `DD_RUNTIME_METRICS_RUNTIME_ID_ENABLED=true`, so
  built-in runtime metrics (ELU, GC, heap) carry the per-process `runtime-id`
  too. Verified locally that the installed dd-trace adds the tag only with this
  variable. One series per process start.
- Tests prove two replicas with identical readings land in separate series.

**Scheduler pressure** (`apps/web/src/observability/scheduler-pressure.ts`,
15 s): `forge.web.main_thread.on_cpu_ratio`, `…runqueue_wait_ratio`,
`forge.web.main_thread.involuntary_context_switches_per_second` (renamed from
`forge.web.process.…`; it now reads the main thread's task status and was
never an all-process total), `forge.web.cgroup.cpu_throttled_ratio`,
`forge.web.cgroup.cpu_pressure.{some,full}_avg10_pct`, and new
`forge.web.scheduler_pressure.sample_interval_seconds`. The sampler shares the
loop it measures. A late timer shows as a window longer than 15 s, and a fully
stalled loop shows as no data. Monitors must treat missing data as a signal.
Kill switch: `FORGE_SCHEDULER_PRESSURE_METRICS=false`.

**Cache read and write spans** (`apps/web/src/observability/next-cache-telemetry.ts`,
`apps/web/cache-handler.mjs`): every Next cache call becomes a
`next.cache.get` or `next.cache.set` span under the request span. Tags:
`next_cache.kind` (`app_page`, `fetch`, …), `next_cache.outcome`
(`hit`, `miss`, `expired`, `ok`, `error`), `next_cache.error_reason`
(`aborted`, `not_ready`, `timeout`, `other`), `next_cache.codec_ms` (JSON
parse/stringify time), and `next_cache.value_length`. Distributions:
`forge.web.next_cache.{get,set}.duration_ms` by kind and outcome, and
`forge.web.next_cache.codec_ms` by direction. Cache keys and slugs never enter
tags. Kill switch: `FORGE_NEXT_CACHE_TELEMETRY=false`.

With these spans, a kept trace of a slow HIT shows: time before Next reads the
cache; each read's duration, of which `codec_ms` is JSON parse elapsed time;
a read that timed out and became a MISS; and time after the reads until the
response ends. The rest of a read's duration is **unattributed**. It holds
Redis round trips, base64 conversion, tag checks, scheduling delay and the
telemetry itself. It is not pure waiting: a test pins that synchronous
non-JSON work also lands there. Even `codec_ms` includes any time the thread
was descheduled mid-parse. The scheduler gauges and the profiler must
separate CPU work from waiting.

The telemetry is observational. A failing emitter, span, tracer or recorder
cannot change a cache result or replace a cache error, and never reruns a
cache call. Tests inject each failure.

Measured cost, on an idle development machine with real dd-trace and an
unreachable agent: ~4–4.5 µs per cache call (span plus metric; 3.9 and 4.5 µs in two runs), and ~22 µs per
scheduler sample including emit (the earlier "19 µs" covered the snapshot read
only). These numbers exclude contention. On a saturated host each costs more,
but stays small next to ~32 ms of CPU per request.

Validation limits: the busy-loop test validates the scheduler sensor only. It
is not evidence of the production cause. The cache tests prove attribution
with fake Redis delays and real handler error shapes; the production Redis
wiring is pinned by a source test, not exercised against a live Redis.

## Proposed mitigations (owner decision; none applied)

1. **Same-commit redeploy as a recovery attempt, not a test.** It may help, by
   resetting the process, caches, traffic mix or runtime state, or by landing
   on a different host. A fast result would not prove placement; a slow result
   would not disprove it (it could land on the same or another contended
   host). The old `3003c520` process has none of the new gauges. Not
   performed.
2. **More than one Web replica.** Shared Redis is a foundation only. Before
   presenting this as a repair, verify:
   - every replica runs the same build, assets and secrets;
   - rolling deploys are compatible across old and new builds;
   - invalidation reaches all instances (the route and SEO manifests are
     process-local, with 60 s TTLs);
   - fallback behaviour when Redis is down;
   - duplicate regeneration of the same page on two replicas.
     Two replicas may also share a contended host. Not proven as a repair.
3. **Reduce main-thread work per request** only after the new spans show
   regeneration and codec share. Changing page lifetime changes freshness
   semantics, needs product review, and first needs webhook-coverage
   verification.
4. **Alerting** once the gauges report: `runtime.node.event_loop.delay.avg`
   above 50 ms for 5 min; `forge.web.main_thread.runqueue_wait_ratio` (by
   `replica_id`); and no-data on `forge.web.scheduler_pressure.sample_interval_seconds`.

## Production acceptance (provisional)

Recovery is declared only when all of these hold in one 60-minute window after
a change. Thresholds are provisional, taken from the 14:06–14:09 old-process
baseline (3 minutes, 5,000 requests). Before acceptance, replace them with a
same-hour baseline from at least one unaffected day.

| Signal                   | Population and method                                                                                                                                                | Provisional threshold                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Root and content latency | Railway HTTP logs, all requests (not sampled), split into `/watch`, content pages, static files and `/watch/api/*`. p95 and max of `upstreamRqDuration`, per replica | `/watch` p95 ≤ 1.5 s; content p95 ≤ 2.5 s; static p95 ≤ 1 s                            |
| Long requests            | Same logs: count of requests over 20 s                                                                                                                               | 0 (Railway logs are complete; sampled traces cannot prove this)                        |
| Client abandonment       | Same logs: share of 499                                                                                                                                              | ≤ 2% (baseline 0.8%)                                                                   |
| Queue depth              | Same logs: in-flight count from arrival and completion times, every 10 s                                                                                             | ≤ 40                                                                                   |
| Cache-state latency      | 12 probes per hour per route (`/watch`, `/watch/jesus.html/english.html`), 45 s client timeout, via Cloudflare; record `x-nextjs-cache`, TTFB and Railway request id | HIT TTFB p95 ≤ 1.5 s; MISS and STALE reported separately, no threshold until baselined |
| Main thread              | `forge.web.main_thread.*` by `replica_id`                                                                                                                            | Run-queue wait < 5% — **provisional; no healthy-host baseline exists**                 |
| Synthetic checks         | Checkly keyword, playback and redirect, both regions                                                                                                                 | All passing                                                                            |
| Behaviour preserved      | `x-nextjs-cache` and `s-maxage` headers, GA and Datadog RUM events, recommendation delivery                                                                          | Unchanged                                                                              |

## Evidence gaps

- No kept trace for any matched probe, so a slow HIT's 36 s is not yet split
  inside the process. Narrows when this PR deploys and a slow HIT's trace is
  kept; the non-JSON remainder of each cache read stays unattributed.
- No scheduler or host sample for the predecessor `156666c2` process.
- Old runtime's CPU profile and timeline were not exported for a
  like-for-like comparison.
- The 16:31 scheduler sample, the 16:14 trace and the profiler async table were
  read live. Only their summary values survive; their raw exports were not
  retained.

## Review findings and responses (2026-10-19)

An independent read-only review of the 16:40 draft raised these points. Each
was accepted, and the response is in the sections above:

- **GC:** similar heap does not mean fixed collection work. Accepted; the GC
  paragraph now says it does not discriminate.
- **Redis, DNS, Admin and trace-gap exclusions:** were categorical. Accepted;
  replaced with bounded findings that state what each probe covers.
- **Scheduler:** load average includes uninterruptible tasks; ELU is not CPU;
  ancestor cgroups are invisible. Accepted. A new sample added runnable-only
  counts, host CPU pressure, affinity and weights. Host contention stays the
  leading hypothesis, with the change from the predecessor unconfirmed.
- **Redeploy:** neither outcome proves placement. Accepted.
- **TTL:** regeneration is demand-driven; Redis counts are not page shares;
  key stability is not prefix stability. Accepted.
- **Acceptance:** 1.38–1.50 s was a version-wide APM p95, not root warm-HIT
  TTFB. Accepted; replaced with defined populations from complete Railway
  logs, and provisional thresholds.
- **Replicas:** shared Redis is a foundation only. Accepted.
- **Instrumentation identity, metric naming, cost and sample age:** accepted
  and implemented as described above.
- **Provenance:** accepted; see the evidence README.

A second independent review (round 2, same reviewer) of revision 2's draft
raised three more points, all accepted:

- **Traffic surge (P1):** completion-selected logs cannot rule out a surge.
  The claim is withdrawn; the hypothesis is open.
- **Telemetry failures (P2):** a throwing emitter or JSON hook could change a
  cache result. Fixed: every hook is guarded, the cache call is never rerun,
  and tests inject each failure.
- **"Waiting" versus codec (P2):** the non-JSON remainder is not pure waiting.
  The wording is corrected, and a test pins the limitation.
