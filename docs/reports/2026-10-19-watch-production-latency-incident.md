# Watch production latency incident — 2026-10-19

Tracking: feat-745. Plan: `docs/plans/2026-10-19-watch-production-latency-investigation.md`.
Status at writing (16:40 UTC): **incident ongoing; no production change made.**

## Summary

The single production Web process (`next-server`, one Railway instance) runs
every request on one Node main thread. Since that process started at about
15:14 UTC, the thread has been runnable ~99% of the time: about 82% on CPU and
about 17% waiting in the kernel run queue for a CPU. Requests queue behind it.
Cache HITs, 404s, DNS lookups and TCP connects all wait. Admin answers its
calls in milliseconds.

The evidence points to **host CPU contention on the new container's host,
landing on a service that already ran with almost no main-thread headroom.**
It does not point to a code regression in `3003c520`.

Confidence: **medium-high** for "main-thread saturation causes the stalls"
(directly measured). **Medium** for "host contention, not code, is why this
process saturates and its predecessor did not". The old container cannot be
measured any more (see evidence gaps).

## Timeline (UTC)

| Time        | Event                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10-18 19:59 | Previous process (`156666c2`) starts. Event-loop utilization (ELU) stays ~0.90, as on every prior version. No cold-start saturation.                 |
| 10-19 14:51 | Deployment `772be46d-0d78-4faa-aa5e-43b8d5e010d2` (`3003c520`) created.                                                                              |
| ~15:14      | New process starts (uptime 12 s at 15:14). From its first minute: ELU 0.99–1.00, loop-delay avg 1–2 ms → 90–130 ms.                                  |
| ~15:22      | Old process stops reporting.                                                                                                                         |
| 15:22       | Deployment `8824a12a-c140-4702-a8b5-179eeac10c2f` (`7dae8b62`) is SKIPPED, not serving.                                                              |
| 15:22–16:32 | Checkly keyword check fails in us-east-1 and ap-southeast-1 (~32 s response). Only the 16:07 pair passed.                                            |
| 16:22–16:39 | Curl samples: `/watch` HIT TTFB 6.1 s and 9.8 s; later MISS 33.1 s. `/watch/jesus.html/english.html` MISS 10.0 s. Bodies 0.91–0.93 MB. All HTTP 200. |

## Measurements

### Request trace (concrete)

Trace `6ad641ff000000006cea3e3df01e2e3a`, catch-all route, 25.1 s total:

- 16:14:55 request starts. **No span for ~15 s.**
- 16:15:10 first Admin call. Admin server span 135.6 ms; Web client span 442 ms.
- TCP connect to Admin 631 ms (private network, normally ~1 ms).
- Second Admin call: Admin 26.5 ms; Web client span 1,897 ms.
- Request ends 16:15:20, about 8 s after the last Admin call.

The unexplained wall time sits between spans, on the Web side.

### Main thread: kernel view (read-only, inside the container)

`/proc/<pid>/task/<pid>/schedstat`, sampled 10.01 s apart at 16:31 UTC:

| Measure                                       | Value                 |
| --------------------------------------------- | --------------------- |
| On CPU                                        | 8.26 s (82.5%)        |
| Waiting in run queue                          | 1.68 s (16.8%)        |
| Runnable total                                | ~99%                  |
| Since start (~77 min): on CPU / waiting       | ~84.5% / ~15%         |
| Context switches, voluntary / involuntary     | 183,880 / 6,526,538   |
| GC helper threads (V8Worker), CPU / wait each | ~330 s / ~140 s       |
| libuv workers, CPU / wait each                | ~64 s / ~65 s         |
| cgroup `cpu.max` / `nr_throttled`             | 8 CPUs / 0            |
| cgroup `cpu.pressure` some / full avg10       | 14.4% / 13.5%         |
| Host CPUs / load average (1, 5, 15 min)       | 48 / 66.5, 59.1, 56.3 |
| Container I/O pressure                        | 0%                    |

There is no quota throttling. The threads are runnable but wait for a CPU on
an oversubscribed host (load 66 on 48 CPUs).

### Same work runs slower (old vs new, same day)

| Measure (Datadog runtime metrics) | `156666c2` 12:00–15:10 | `3003c520` 15:14–16:34 |
| --------------------------------- | ---------------------- | ---------------------- |
| ELU (max)                         | ~0.89–0.91             | 0.99–1.00              |
| Event-loop delay avg              | ~1–2 ms                | ~90–130 ms             |
| Young-gen scavenge pause, median  | ~13.5–14.8 ms          | ~20.5–23.9 ms          |
| Mark-sweep-compact pause, avg     | ~46–55 ms              | ~81–95 ms              |
| Heap used                         | ~0.60 GB               | ~0.60 GB               |
| Process CPU user / system         | ~55% / ~10%            | ~50% / ~9%             |
| Requests served per 15 min        | ~22–26 k (14:30–15:15) | ~16–19 k (after 15:15) |

A scavenge does roughly fixed work per collection. Its median took 50–60%
longer, and full GCs took ~70% longer, on the same heap size. This points to
slower execution of the same work. It does not point to more work per request.

### Async operations inflate because callbacks wait for the main thread

Datadog profiler timeline, matched ~2.2 min windows:

| Async activity       | Old (runtime `7a623397…`) | New (runtime `c79e912b…`) |
| -------------------- | ------------------------- | ------------------------- |
| Pooled DNS lookups   | 2,990, avg 23 ms          | 2,777, avg 160 ms         |
| fs operations        | 745, avg 47 ms            | 729, avg 219 ms           |
| c-ares DNS           | 160, avg 29 ms            | 346, avg 170 ms           |
| TCP (`net`)          | 135, avg 43 ms            | 225, avg 450 ms           |
| Main-loop "CPU" lane | 76%                       | 79%                       |

DNS resolution itself is fast. From a fresh Node process in the same
container, `dns.lookup` of three private hosts took 0.6–25 ms (first call) and
then ~1 ms; `resolve6` ~0.5 ms. The "libuv pool overloaded" insight and the
dns.lookup span growth (p50 ~10 ms → 70–110 ms) are symptoms of late
callbacks. They are not a resolver fault.

### Cache and Redis (read-only INFO / SLOWLOG, 10 s sample at ~16:33)

- GET 24, SET 33, HSET 67. Keyspace hits +9, misses +16.
- Input ~2.2–2.8 MB/s. Cache entries are mostly 256 KB–1 MB.
- Lifetime: 25.5 M hits / 23.3 M misses. `noeviction`, no evictions, 0 blocked clients.
- 6.4–6.6 k keys. SLOWLOG: HSCAN 10–35 ms (handler tag/expiry scans), nothing larger.
- Pages carry `s-maxage=60`. The routes declare `revalidate = 3600`, but
  60-second `unstable_cache` TTLs used during render lower the page lifetime to
  60 s. So pages re-render roughly every minute they are visited. This is
  long-standing steady-state load, not new.

Redis is not the bottleneck. A large share of requests are full renders that
write ~1 MB entries. This is the baseline cost that leaves the main thread at
~0.9 utilization on a good host.

### Traffic

Traffic was ~18–26 k requests per 15 min before onset. Served throughput after
onset is ~16–19 k (capped by saturation). Bot share in sampled spans did not
change materially.

## Hypotheses tested

| Hypothesis                                               | Verdict                     | Evidence                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code regression in `3003c520` (audience flag)            | Not supported               | The diff adds one in-memory LaunchDarkly evaluation per render and flag-off UI (audience markup absent from production HTML). No new hotspot in the CPU profile. GC unit cost rose while heap was unchanged, which code would not explain. |
| Cold cache / deploy warm-up                              | Not supported as main cause | The previous deploy did not saturate. This process saturated in minute one and stayed saturated 80+ min with no convergence. Redis keys are path-based and survive deploys.                                                                |
| Redis latency / blocking                                 | Rejected                    | Commands are µs; no evictions or blocked clients; SLOWLOG max ~35 ms.                                                                                                                                                                      |
| Admin latency                                            | Rejected                    | Admin server spans are 26–136 ms inside 0.4–1.9 s client spans.                                                                                                                                                                            |
| DNS resolver latency                                     | Rejected                    | Fresh-process lookups ~1 ms in the same container.                                                                                                                                                                                         |
| Container CPU quota throttling / RAM                     | Rejected                    | `nr_throttled 0`. Container uses ~0.7–1.9 of 8 vCPU. RSS ~2 GB.                                                                                                                                                                            |
| Main thread saturated, made worse by host CPU contention | **Supported**               | 99% runnable with 15–17% run-queue wait. Host load 66 on 48 CPUs. GC unit cost +50–70%. 6.5 M involuntary context switches. Helper threads wait as long as they run.                                                                       |

## Evidence gaps

- The old container's scheduler stats and host load are gone, so it cannot be
  confirmed that its run-queue wait was low. The GC-cost comparison is the best
  available proxy.
- Datadog runtime metrics have no run-queue or PSI signal. This incident needed
  SSH to see the split. The accompanying instrumentation closes this gap.
- No same-commit redeploy has been observed. A redeploy of `3003c520` that is
  fast would confirm placement. A slow one would reopen the code hypothesis.

## Code change in this PR (instrumentation only)

`apps/web/src/observability/scheduler-pressure.ts` samples the main thread's
schedstat, involuntary context switches, cgroup throttling and cgroup CPU PSI
every 15 s in production. It emits these as DogStatsD gauges:

- `forge.web.main_thread.on_cpu_ratio`
- `forge.web.main_thread.runqueue_wait_ratio`
- `forge.web.process.involuntary_context_switches_per_second`
- `forge.web.cgroup.cpu_throttled_ratio`
- `forge.web.cgroup.cpu_pressure.some_avg10_pct` / `full_avg10_pct`

When the main thread is ≥95% runnable, it also logs one plain-string
`[scheduler-pressure] event=main_thread_saturated …` line, at most every
5 minutes. Kill switch: `FORGE_SCHEDULER_PRESSURE_METRICS=false`. Cost:
~19 µs per sample. It changes no request, cache, analytics or recommendation
behaviour.

Local discrimination: a busy loop alone reads on_cpu 0.99 / wait 0.00. The same
loop pinned to a core shared with another busy process reads on_cpu 0.58 /
wait 0.42.

This does **not** repair the incident.

## Proposed mitigations (owner decision; none applied)

1. **Immediate, lowest risk:** redeploy the current commit (`3003c520`) through
   the normal Railway path so the container is rescheduled. This also tests the
   placement hypothesis. Watch ELU, loop delay and the new gauges.
2. **Durable capacity:** run ≥2 Web replicas. The shared Redis ISR cache already
   supports this. Process-local manifests have 60 s TTLs (see
   `apps/web/CLAUDE.md`). A single main thread at ~0.9 utilization on a good
   host has no margin for a slower host, a crawl burst or a heavier page.
3. **Reduce per-request main-thread work (separate, reviewed change):** the
   effective 60 s page lifetime comes from 60 s `unstable_cache` TTLs. Raising
   the data TTLs, or decoupling page `revalidate` from them, would cut
   re-renders and ~1 MB Redis writes sharply. Webhook revalidation already
   handles freshness. This changes content-freshness semantics and needs
   product review.
4. **Alerting:** add a Datadog monitor on `runtime.node.event_loop.delay.avg`
   (for example > 50 ms for 5 min) and on
   `forge.web.main_thread.runqueue_wait_ratio` once it reports.

## Production acceptance (pending)

Derived from the previous process's same-day baseline:

- ELU < 0.95 and loop-delay avg < 10 ms sustained for 60 min.
- Same-route warm HIT TTFB for `/watch` at or below ~1.5 s p95 (prior p95 1.38–1.50 s).
- No request > 20 s in a 60 min window.
- Checkly keyword, playback and redirect checks passing in both regions.
- `x-nextjs-cache`/`s-maxage` headers, GA, Datadog RUM and recommendation
  behaviour unchanged.
- After this PR deploys: `forge.web.main_thread.*` gauges reporting, with
  run-queue wait < 5% on a healthy host.
