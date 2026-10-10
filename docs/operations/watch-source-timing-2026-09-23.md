# Watch source timing — September 23, 2026

## Why another measurement is needed

PR #2393 supplies independent PostgreSQL state samples and generated request
correlation. Its production capture proves a successful 122-row INSERT has
time outside server execution, but does not establish the historical timeout's
cause. See `docs/operations/watch-database-wait-correlation-2026-09-23.md`.

Three subsequent successful seeded requests at 01:53:18, 01:54:27 and 01:57:09
UTC take 874, 1,054 and 798 ms. Their evidence writes take only 8, 27 and 19 ms.
The stage aggregates show delays in transaction acquisition, serving-state
reads and other work too. Indexed APM lookup by their span IDs returns no
matches. The runtime records omit source start times, so Railway ingestion
timestamps cannot reconstruct the actual operations' positions.

The uncapped 01:48–02:03 primary-log slices also contain 13,359 slow main-pool
acquisition events: maximum 375.22 ms, maximum pending count 304. All report
`requestCorrelated: false`. A five-minute query hit the 5,000-log response cap;
all five one-minute replacement slices pass below the cap. These are pool
events, not API requests, and acquisition includes connection establishment.
Temporal proximity is a workload hypothesis, not causal attribution of a
particular recommendation or the historical 1.19-second evidence write.

Sanitized evidence:
`docs/validation/watch-source-timing-20260923/slow-baseline.json`.

## Metadata contract

The existing `recommendation.runtime` event gains additive fields:

- `startedAt`: observation start on Admin's UTC clock, preserved on complete
  and late-operation records. It is not the transport's ingestion timestamp.
- `timings[label].firstStartedOffsetMs`: first call's monotonic start offset
  from that observation, rounded to microsecond precision.
- `timings[label].maxStartedOffsetMs`: start offset of the **longest completed
  call**, paired with existing `maxMs`. Missing means no completed call.
- Late-operation `startedOffsetMs`: that specific call's start offset, paired
  with its existing elapsed duration and original observation ID/start time.

For a single-call evidence INSERT, the source interval is
`startedAt + maxStartedOffsetMs` through that value plus `maxMs`. An unfinished
operation remains `inFlight > 0`; zero elapsed is not a successful zero-time
write. Repeated or concurrent labels retain aggregate counts and one longest
completed interval, not a full trace of every call. Their first call need not
be their longest or a still-pending call. Preserve this distinction in analysis.

UTC source timestamps permit alignment but do not synchronize different
machines. Compare server execution durations on PostgreSQL's own clock;
measure/bound clock offsets before interpreting cross-host timestamp gaps.
The separate selection budget is still outside the tagged delivery transaction
helper. This patch does not add a continuous database observer.

## Validation and scope

Two deterministic regressions fail on the original code and pass with the
metadata extension: repeated calls preserve the longest call's actual start,
even across wall-clock correction; a timed-out operation retains its source
start and later rejection. Existing concurrent correlation, error identity,
privacy, metadata limits and forwarding-envelope tests pass. All 7,339 Admin
tests, typechecking, lint and production build pass locally.

The ABBA microbenchmark runs 3,000 observations per phase, concurrency 10,
200 warmups per phase, 16 labels and 32 calls per observation. With no other
task-owned JS check running, original p95 is 0.976/0.894 ms and extended p95
1.117/1.159 ms; p99 is 1.311/1.112 versus 1.540/1.466 ms. Maximum extended
forwarding payload is 3,847 bytes versus 2,847 baseline. This measures diagnostic
timing/serialization cost only, without database or log-transport latency; it
is not an API latency improvement. A prior trial concurrent with checks is
excluded from these measurements. The separate worst-case bounds regression
remains below the 14 KiB payload reserve for the 16 KiB syslog envelope.

Artifact: `docs/validation/watch-source-timing-20260923/overhead.json`.

Sequential Compound Engineering review covers timing semantics, failure/late
settlement, concurrent observations, privacy, additive log compatibility,
payload size and measured overhead. No SQL, schema, pool size, deadline,
retry, authorization, attribution or homepage change. This fixes an evidence
gap; feat-496's natural timeout cause and recovery gates remain open.

## Release gate

Incorporate fresh main, pass PR CI, merge normally and verify the exact automatic
Admin/worker revision. Verify the new source timing fields on natural requests
in primary logs. Then run a bounded independent database capture with workload
context, retain actual coverage and stop reasons, and verify cleanup. Report
HTTP failures separately from delivery HTTP 200 timeout fallbacks. Do not close
feat-496 on this instrumentation release or on a short quiet window.

## Verified automatic release and bounded capture

PR #2399 merged normally to `5a30f5ddceeb4dc29d7ceb87718600a30af91401`.
Admin deployment `5dafa696-0b3c-4e87-a319-ef8bfa204330` was verified at
02:52:33 UTC with health HTTP 200 and the workflow runner disabled. Worker
`ddc50a6d-2cc0-4f1a-93fc-f838df6f731f` was verified at 03:01:29 with the
same SHA, health HTTP 200 and runner enabled. Web remained at
`1cccac03cec7ad4427d0c6f80443dd4d71b942e0`.

The first observer attempt ended with the old worker rollout after about
22 seconds and has no final summary. Its intended five minutes must not be
reported as captured. On the new worker, the tagged wait observer covered
03:01:57.581–03:03:49.521 UTC: 441 polls, four samples, 1,528 ms cumulative
query time and 8.29 ms maximum query time. The separate 1 Hz workload observer
made 112 polls, with 408 ms cumulative query time and 8.34 ms maximum. Both
were explicitly stopped during a user task pause; both summaries say
`aborted`, not duration-complete. The following 03:03:52 preflight found no
remaining observer connections. No persistent database setting or profiler
was enabled.

All 18 completed Admin observations in the uncapped 03:01–03:04 window have
source start times and required operation offsets. A natural 180-row evidence
write demonstrates the intended join:

- Observation `b86e44aa-37c2-44e8-a574-ed2f075ff120`, transaction 4, PID
  1462541; served request, 189.87 ms total.
- Admin source start 03:02:07.115 UTC; INSERT starts 144.055 ms later and
  completes in 23.879 ms. Raw driver duration is 22.891 ms.
- The independent PostgreSQL sample at 03:02:07.275 observes that same
  transaction's INSERT active, started at .270, query age 4.466 ms, no wait
  and no blockers.
- Point-in-time calibration around 03:02 bounds PostgreSQL minus either
  application host to −2…+2 ms including timestamp rounding. This is not
  continuous synchronization. One active sample does not give the entire
  SQL execution duration.

This establishes source-time correlation without relying on a retained APM
trace. The other three samples are idle-in-transaction/ClientRead, with no
blockers. None is a reproduction of the historical timeout.

For the same fixed window, HTTP metrics report one selection HTTP 200, 17
seeded delivery HTTP 200s and 12 delivery HTTP 403s; no recommendation-route
HTTP 5xx is present. Primary Web logs account for all 17 accepted delivery
responses: 16 served, one ordinary `no_candidates` fallback, zero
`delivery_timeout` fallbacks. The 12 delivery 403s are origin/fetch-metadata
rejections. Evidence/playback 400/403 terminal rejections are separately
retained in the artifact and are not classified as delivery timeouts. There
is no for-you sample. This small window validates instrumentation and
classifications, not API recovery or consistent sub-200 ms latency.

Sanitized release evidence:
`docs/validation/watch-source-timing-20260923/release.json`.
