---
title: "Preserve source timing for slow Watch operations without retained traces"
status: active
type: fix
---

# Watch runtime source timing

Continue in-progress feat-496 from freshly fetched main `77eb63fbb` in the
dedicated `codex/watch-causal-capture-20260923-q7n` worktree. Prior diagnostic
release PR #2393 captures PostgreSQL state independently, but runtime events
only contain aggregate stage durations. Railway ingestion timestamps cannot
stand in for operation start time, and three newly slow successful deliveries
(798–1,054 ms) have no retained APM spans. Their evidence writes take 8–27 ms;
do not assume the evidence INSERT explains all slow deliveries.

## Scope and prediction

Preserve the observation's own UTC start time and monotonic offsets for each
timing label's first start and longest completed call. Late-operation records
must carry their actual start offset and the same observation start time.
The existing call count and pending count remain authoritative: a longest
completed call is not an unfinished call or an entire repeated stage timeline.
No SQL, query payload, identity, additional database round trip, deadline,
retry, pool limit or homepage change.

This fixes a demonstrated evidence gap, not the natural timeout. Prediction:
even without a retained APM trace, a single-call evidence-write log can be
aligned with its independent tagged database samples using source timestamps;
late settlement can be aligned after the response too. Different host clock
offsets remain a limitation, so compare durations on the same clock and do not
treat raw cross-host timestamp subtraction as exact execution time.

## Validation and release

1. Fail deterministic tests for repeated labels, longest-call start selection,
   pending and late operations, monotonic timing despite wall-clock changes,
   and existing privacy/payload bounds.
2. Implement the smallest metadata extension; verify original results/errors
   and all existing concurrency/correlation behavior. Measure serialization
   overhead in an ABBA comparison using realistic bounded observation sizes.
3. Sequential Compound Engineering review, focused and required Admin checks,
   fresh main incorporation, normal PR/CI merge and automatic release only.
4. Verify exact running revisions and source timing fields in primary logs.
   Coordinate the next independent bounded capture with the deployed revision;
   stop on observer limits and verify cleanup. Report HTTP and semantic
   timeouts separately. Keep feat-496 open without proven causal recovery.
5. Compound the source-time/ingestion-time and missing-trace lesson into the
   existing runtime observation learning.
