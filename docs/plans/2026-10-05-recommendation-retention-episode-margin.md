# Recommendation retention: episode-page margin

## Scope

Reduce the number of request-free playback episodes processed before request roots in one five-second retention attempt from ten to five. Keep each episode's existing transaction and dependency checks, the root batch of 100, deletion order, expiry, lock, deadline and failure accounting unchanged. Feat-554 remains open until two ordinary failure-free loaded production cycles pass.

## Evidence and limits

The October 4 ordinary cycle had six failed attempts amid successful catch-up. Some failures occurred after episode work; the exact production slow statement is not established. In a paired owned PostgreSQL fixture with equal mixed work, the first attempt took 4,467 ms at ten episodes and 2,767 ms at five. All work completed in 8,366 ms over three attempts at ten versus 8,871 ms over five, 505 ms (about 6.0%) more total fixture time. A separately slowed projection tail still timed out with five episodes, so this is deadline-margin mitigation, not a complete timeout cure.

A bounded October 4 20:11 UTC read found 26,071 surviving request-free episodes expiring by October 6 10:30 UTC across 47 hourly buckets; its 50,001-row cap was not reached. Using the full October 4 10:30–12:12 elapsed window, including failures/backoff, the observed deletion cadence was 42.61 episodes/minute. Half of that, 21.31/minute, is a conservative _conditional_ page-five capacity, not a production observation. A cumulative prefix check against each hour's earliest possible 24-hour propagation deadline found a minimum conditional margin of 1,377 rows for the cohort already expired by the next 10:30 start. This does not prove future latency, scheduler continuity, new writes or full-cycle acceptance. The 5,059 episodes created in the prior 24 hours are **not** expiry inflow and are excluded from this calculation.

Aggregate-only read receipts and the paired native measurements are under `outputs/heartbeats/20261004T1938-daily/` in the recommendation-traffic-isolation evidence workspace.

## Verification

1. Keep the native mixed-work fixture's request-root, descendant, graph, episode-continuation and live-lineage assertions; add exact projection-tail deletion and successful-ledger/health-watermark assertions.
2. Add a negative native PostgreSQL fixture where a slow projection phase exceeds the unchanged deadline. Assert one earlier root committed, projection deletion rolled back, the durable attempt failed and no success watermark advanced.
3. Run the focused native file, relevant unit tests, typecheck, lint and formatting, then review the exact diff. Release only by reviewed PR-to-main.
4. After actual Admin HTTP and worker convergence, verify natural loaded retention, all 21 health types, filesystem/WAL headroom and two later ordinary failure-free loaded cycles before completing feat-554.
