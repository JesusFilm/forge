# Watch runtime investigation — 14 September 2026

Owner: `feat-496`. Feature restoration: `feat-488`.

## Current production evidence

Fixed window: **13 September 2026, 20:00–20:55 UTC**. Web version
`8d2a72cbc624e2254089d97d907e4e4ea4f07cbe`, primary Web host `cb795c475081`,
primary Admin host `9d8dcdb4fa70`.

Web APM counted 104 responses with status 503: playback 70, profile 15,
recommendation delivery 13, evidence 6; zero responses with status 500. The
mean of Web event-loop p95 samples was 0.619 ms. These version-filtered metrics
are request populations, not primary-only denominators: Railway environments
can share `env:prod`. Failure logs and traces below identify the primary hosts.

Primary-host admission logs include TIME/EVAL timeouts and retries during the
shared client's one-second backoff. Primary playback transport logs also report
the separate `upstream_unavailable` / `timeoutStage=upstream` outcome.

## Reproduced Redis cancellation

All recommendation admission namespaces share one connection. A profile request
has a 250 ms command budget; playback context has 500 ms. Previously, expiration
of either request immediately destroyed the socket, rejecting other commands
even when their callers still had time to finish.

The new regression makes profile TIME stall while a concurrent playback EVAL
would finish at 300 ms. Before the fix, both requests fail at 250 ms. With the
fix, profile fails as expected and playback succeeds at 300 ms. A retired client
stops accepting admissions immediately, but closes only when its active callers
finish. Every caller keeps its original deadline. A second test proves stalled
callers finish by their own budgets and a new connection can open after backoff.

This establishes an error-amplification defect; it does not establish why the
first Redis command was slow or explain the entire September 10 incident.
The removed Redis evidence collector is unrelated. General Redis cache and
admission responsibilities remained after that removal.

## Separate Admin timeout path

- Trace `3689471418930194538`: Web aborts at 2999.9 ms. Admin finishes
  `RecordSemanticRecommendationPlayback` at 3142.8 ms, with one successful
  transaction lasting 2134.7 ms. Its `ResponseAborted` follows caller cancellation.
- Trace `1502125874037635409`: Admin finishes at 3319.3 ms, with a successful
  transaction lasting 2131.8 ms.
- Successful comparison `6aa70ce200000000512af6dc5d02d76f`: Web 82.9 ms,
  Admin 58.6 ms, transaction 41.7 ms on the same deployed versions.
- Simultaneous homepage trace `6aa70d4100000000024b4d905ac3bb34`: 1972 ms on
  the same Admin HTTP runtime, with at least 260 `VideoDub.findFirst` and
  105 `Video.findFirst` calls. The trace result was truncated; these are lower
  bounds. `preferredPlayableDub` currently resolves each item separately.

Admin runtime metrics use **`env:production`**, while application logs use
`env:prod`. High event-loop utilization and short bursts of delay are visible,
but available spans do not separate PostgreSQL pool queueing, database execution,
and event-loop scheduling. With adapter-pg, a short Prisma `connection` span
does not rule out pool waiting inside `Pool.query` or `Pool.connect`.

Playback transaction/retry logic predates the homepage feature. Legacy identity
resolution adds no database read; new user-history retrieval runs only for the
enabled source-free path. No timeout increase is justified by this evidence.

## Verification and release boundary

- Reproduction failed before the Redis lifecycle change and passed afterward.
- 17 admission unit tests and three real-Redis tests pass. Atomic limits, the
  separate privacy-control budget, and rejection of late Lua writes remain intact.
- Web suite, lint, typecheck, production build and post-deployment observation
  are required before calling the recovery complete.
- A preferred-dub batching repair needs exact language/primary/fallback parity,
  Pothos nested selection preservation and concurrent homepage/playback load proof.
- Restore the homepage separately after runtime validation. Production pool
  promotion and serving activation remain separate requirements; API contract
  availability does not imply a live personalized homepage.

## Preferred-dub batching: reproduced contention and bounded repair

The actual `GetWatchHomeVideos` query expands 26 roots into 242 videos. On a
local PostgreSQL clone with the existing ten-connection pool, the scalar resolver
issues **1,337 SQL statements per request**. The final request-local loader
issues **40**. It groups the language and Pothos selection, caps each batch at
100 keys, selects one winning dub per video using parameterized LATERAL queries,
and hydrates only those IDs. Hydration rechecks publication, HLS and deletion.

Independent read-only measurements against the final implementation, with no
concurrent local builds or test suites:

| Workload                                         | Scalar resolver | Bounded loader |
| ------------------------------------------------ | --------------- | -------------- |
| Two home requests, SQL including 20 probe reads  | 2,694           | 100            |
| Two home requests, maximum waiting connections   | 495             | 4              |
| Two home requests, completion range              | 2,238–2,460 ms  | 1,772–1,944 ms |
| Four home requests, SQL including 20 probe reads | 5,368           | 180            |
| Four home requests, maximum waiting connections  | 1,003           | 19             |
| Four home requests, p95 connection acquisition   | 2,358 ms        | 77.8 ms        |
| Four home requests, completion range             | 4,996–5,620 ms  | 2,986–3,734 ms |
| Four home requests, slowest independent probe    | 2,348 ms        | 950 ms         |

The probes are `SELECT 1` reads, **not playback mutations**. They isolate shared
database/runtime contention without modifying production or user history. These
local samples demonstrate less fanout and queueing; they are not production
latency forecasts. Residual multi-second homepage tails remain.

All 242 selected IDs and nested scalar payloads match for English, Russian, the
`en` alias and null-language fallback. Fresh full GraphQL comparisons also match
with array ordering preserved. A PostgreSQL fixture covers exact/primary/longest
selection, tied and null durations, empty HLS, publication/deletion, and nested
hydration. The full Admin suite passes **6,498 tests**; lint, typecheck, production
build and workflow build verifiers pass. Regenerating SDL and shared client
introspection produces no contract change. The old scalar service remains for
its existing direct callers.

## Release observation

Redis drain fix **#2276** merged at **13 September 2026, 21:28:31 UTC** as
`a984a52ec9e9918481a0d7163c8e5760c481aa1c`. All PR CI checks passed. Primary Web
Railway deployment `42d69ab4-53ee-4fdc-bb34-07da408f5b73` entered pending at
21:42 UTC and succeeded at **21:48:07 UTC**. Live APM subsequently observed
the new Web revision serving requests.

The settled version-filtered window **21:50–22:05 UTC** contains 13,177 requests,
53 HTTP 503s and four HTTP 500s (0.433% 5xx). The preceding **21:00–21:20 UTC**
control contains 17,298 requests, 66 HTTP 503s and zero HTTP 500s (0.382%). These
are descriptive traffic populations across the shared environment tags, not
matched cohorts or proof that recovery is complete. The four 500s are three
image-optimizer requests at 21:58 and one video-page fetch failure at 22:02:27:
trace `6aa71d7300000000028086650dc48b78`. They remain part of the investigation.

The 21:50–22:00 runtime gauges show a 1.874 ms mean of event-loop p95 samples,
a 757.9 ms maximum delay and 0.945 maximum utilization. The metric host identifies
the Datadog agent, not one Web container. Request-specific attribution still
requires correlated traces; short average delay does not rule out bursts longer
than an admission budget.

Browser smoke at **21:50:35–21:51:06 UTC** passes homepage/category rendering,
actual Chosen Witness playback, profile/evidence requests and six existing seeded
recommendations, with no page errors. GA page-view receipts return 204. This
exercises existing production behavior, not the disabled source-free row.

Admin batching **#2278** merged at **22:06:59 UTC** as
`38db245322d3309f575aec3238307e1e681a66cd`. All CI checks passed, including the
PostgreSQL regression integrated into the existing Watch database suite. Primary
Admin deployment `e6894604-189a-4d6e-aea0-8ad5c7ebd10d` succeeded at **22:13:56 UTC**;
subsequent Admin logs identify container `41d21fa4a4b1`. The production browser
journey passed again at **22:15 UTC**. Longer request/error comparison remains
open; a healthy browser session does not close the residual runtime investigation.
