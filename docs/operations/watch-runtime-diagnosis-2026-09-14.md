# Watch runtime investigation — 14 September 2026

Owner: `feat-495`. Feature restoration: `feat-488`.

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
