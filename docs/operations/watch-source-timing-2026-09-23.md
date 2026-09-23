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
