# Skip unused Next cache-size serialization

Tracking: current `docs/roadmap/platform/feat-750-watch-recurring-production-latency.md`
(in progress). The older serialization ticket called feat-747 is on PR #2816;
main already assigns that ID to a TV ticket. Do not introduce another duplicate.

## Scope and evidence

The October 20 17:15:10.754–17:15:12.733 UTC process profile attributes about
379 ms to Next 16.3.8's cache-size serialization, including Buffer.toJSON. Next
calculates JSON size even for APP_PAGE values and custom handlers, where its
built-in FETCH size limit does not apply. This is measured avoidable work;
it does not prove the entire production slow-HIT delay or incident root cause.

Build a bounded local regression against the installed Next code, then extend
the existing versioned dependency patch to avoid that unused calculation only
for custom handlers. Preserve the default-handler path exactly for other apps. Keep
Redis storage, invalidation, cache lifetimes, analytics and replica configuration
unchanged. No production load or deployment.

## Feedback loop and ranked predictions

Use real IncrementalCache instances, including the bundled App Router production
runtime. A synthetic APP_PAGE with an instrumented binary buffer must reach the
custom handler without the framework first expanding it into a JSON number array.
The baseline should fail this assertion. A separate default-handler page must
still expand its buffer once, matching the original framework behavior. Test that ordinary FETCH entries still
obey the existing 2 MiB serialized-length threshold, including its dev error and
production warning behavior, while custom and implicit-build caches remain exempt.

1. Unused framework size serialization delays a pending cache callback: removing
   only that pass reduces a pending HIT's elapsed time during synthetic writes.
2. Necessary storage encoding contributes independent cost: removing the size
   pass cannot eliminate the cost of the handler's own serialization.
3. Real Redis/transport delay also contributes: a no-network fixture cannot
   settle that production hypothesis; retain the need for command-level timing.

The mechanism fixture deliberately substitutes data/storage. It cannot establish
Watch route p95, production Redis performance or incident recovery.

## Verification and boundaries

Record red/green behavior and repeated alternating timings against the same
installed framework code, with exact entry size, iterations and Node version.
Ensure the pinned patch applies cleanly and preserve the startup preload patch.
Cover the compiled runtime actually profiled; modifying the standalone source
alone would miss it. Document runtime variants covered by any candidate.

Follow the portable resource checks in the investigation plan before heavy
operations: verify free space and inodes for the checkout and temporary
filesystems, use `agent-io-guard` from `PATH` when available, and otherwise proceed
with native checks and normal validation. The owner requested this portable rule
on October 21; it supersedes the original machine-specific guard requirement.
Missing optional host tooling alone does not block builds or release checks.

Keep feat-750 in progress. Follow the normal PR-to-main release process only
after required validation, then apply the incident's sustained acceptance gates.

## Compatibility refinement — owner requirement

Only Web currently configures a custom Next cache handler among the eight locked
Next applications. Scope the optimization to that existing framework condition.
The broader first candidate failed the new default-handler behavior check in all
five executable entry points; the narrower candidate passes it. Admin's seven
existing readiness tests pass in a focused run using Web's installed Vitest.
Record the exact inventory, test setup and remaining full-build requirements in
the report. Do not describe these focused checks as proof of all-app recovery.
