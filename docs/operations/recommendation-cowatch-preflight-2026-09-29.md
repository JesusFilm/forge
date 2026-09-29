# Co-watch preflight and exact retry receipts — September 29, 2026

Production preflight **refused the existing source bound**. A read-only query
returned the 50,001-episode sentinel against the 50,000-row maximum, before
graph eligibility filtering. No generation or shadow evaluation was dispatched.
Feat-387 remains **in progress**. This is an observed preflight refusal, not an
application-operator terminal evaluation decision or an Admin acceptance result.

## Production observation

The [sanitized receipt](../validation/cowatch-preflight-20260929/receipt.json)
and [exact bounded query](../validation/cowatch-preflight-20260929/source-bound.sql)
pin source revision `1c3a3761d0524b25d67427675228214814b84185` and the classifier
window ending `2026-09-28T20:27:08.256Z`. The parent captured the SQL from
`loadCowatchSourceRows` using a capture-only `$queryRaw` implementation; no local
production client or source identity export was used. The count query preserves
the loader's outcome/episode join, classifier and time predicates and counts
distinct episodes with a 50,001 sentinel. The loader's later joins are left joins
and do not remove base episodes, so this lower bound suffices to refuse the run.
It is not an exact corpus size or an eligible-outcome count.

At `2026-09-28T20:27:57Z`, migration `0104_recommendation_cowatch_shadow` was
applied with no unfinished migrations. There were zero retained generations,
co-watch evaluations, active shadow evaluations, active co-watch/shadow queries,
lock waiters, or transactions older than 30 seconds. These observations precede
the count query and are separate snapshots. The enabled hybrid shadow manifest
was observed without changing it; that setting is not evidence of live co-watch
influence.

The full loader was inspected with `EXPLAIN (FORMAT JSON)` **without ANALYZE**.
It estimated 141,985 latest episodes and showed the materialized latest-outcome
snapshot and joins before the final limit. Planner estimates and cost units are
not measured counts or latency. The smaller source-bound probe completed between
20:28:47.690 and 20:28:52.736 UTC under a five-second statement timeout and
one-second lock timeout. That elapsed interval includes SSH transport; it is not
SQL or generator latency. All database probes used read-only PostgreSQL sessions.

Storage ownership stayed with “Investigate production DB growth.” Its latest
receipt verified Admin HTTP and worker at the same source revision, healthy and
using compact traces at 20:11:10 UTC, with 10,583,908,352 free bytes and a protected
5 GB reserve. That earlier capacity snapshot is not clearance for a later write.
The storage owner acknowledged the refusal and issued no capacity clearance.
Retention monitoring and the conversion pilot remain unchanged.

## Evidence not established

Production graph-eligible population, directional edges, support, confidence,
lift, contamination, chosen anchors, candidate overlap, generator latency,
sparse/stale fallback behavior and an actual terminal evaluation decision were
not measured. No graph was published, thresholds were not relaxed, and the
source window was not narrowed to obtain a successful result. No production
privacy deletion, revision change, repair or fault was manufactured.

The authorized Admin inspection subsequently reconciled the **absence** of a
generation and evaluation; see the dated addendum below. It cannot satisfy the
graph/evaluation evidence gate or remove the source-cap refusal. A later runnable attempt requires a
separately reviewed finite workload preserving source/denominator and privacy
semantics, fresh storage timing/capacity clearance, and the normal operators.
Feat-505 still governs any later causal usefulness or promotion decision.

## Authorized Admin addendum

On September 28 UTC, between 20:54 and 20:57, the parent opened the production
`/dashboard/recommendations/cowatch` page using the authorized Admin session.
The [sanitized UI receipt](../validation/cowatch-preflight-20260929/admin-inspection.json)
records generation unavailable, latest evaluation not run,
`generation_unavailable`, zero displayed generation contribution/edge/support
counts, no chosen anchors and no supported shadow candidates. The page explicitly
showed shadow-only, no promotion and live baseline fallback. Those zero generation
counts do not measure eligible source coverage. No inspection form, generation
or evaluation operator was submitted; ordinary access auditing may occur.

PR #2448 passed all 25 CI checks (17 success, eight skipped), including the full
Admin suite, and squash-merged at `2026-09-28T20:56:28Z` as
`e0f864dd5436c0c1c0307de3b4c3dd4bb38906df`. The reviewed head was
`bfbbaea09598cb36869bb7c0fd3345e55057f65e`, with no unresolved review threads.
The [ordinary deployment receipt](../validation/cowatch-preflight-20260929/deployment.json)
at `2026-09-28T21:06:30Z` verifies that merged revision in both running Admin HTTP
and worker processes, HTTP health 200, expected workflow-runner roles and compact
traces. Each service had one successful active deployment and no old active
instance. This deploys the retry repair; it does not override the source refusal
or dispatch a generation/evaluation.

## Operator repair

Previously, each CLI invocation generated a new evaluation UUID and moving
24-hour window. A retry after an uncertain response could create a different
evaluation despite the service's existing exact-retry support. The CLI now
requires a pinned evaluation ID, time window, sample size and minimum-run
threshold, validates them before importing the runtime, and prints that tuple
before dispatch. An operator retains and reuses the same tuple after an uncertain
response. Successful and fenced workflow receipts preserve `minimumRuns`, so
the existing operator can continue checking threshold conflicts after completion.

This fixes tuple drift, not exactly-once dispatch. Keep operator invocations
serialized. Independent review identified existing concurrent same-ID and
queued-ledger-without-runtime crash windows in `shadow-evaluation/operator.ts`
and `job.ts`. A retry may report an existing queued ledger without proving a
worker started; inspect the ledger and runtime evidence before further action.
Do not mint another ID to bypass that uncertainty. These are code-level limits,
not observed production failures in this preflight. Historical terminal receipts
already missing `minimumRuns` are not repaired by this change. Unexpected CLI
errors now produce a generic diagnostic instead of copying private runtime error
details into an operational receipt.

After all preflight gates pass, the existing application invocation is:

```sh
pnpm --filter @forge/admin cowatch:shadow:evaluate --execute \
  --evaluation-id "$COWATCH_EVALUATION_ID" \
  --window-start "$COWATCH_WINDOW_START" \
  --window-end "$COWATCH_WINDOW_END" \
  --sample-size "$COWATCH_SAMPLE_SIZE" \
  --minimum-runs "$COWATCH_MINIMUM_RUNS"
```

Values must be explicit and recorded before execution. Do not regenerate the ID
or recompute dates for a retry. The CLI rejects missing/duplicate/unknown options,
invalid UUIDs or timestamps, submillisecond times, noninteger bounds, expired or
unordered windows, samples above 10,000 and minimum runs above the sample. It
preserves the service's existing one-minute clock-skew allowance. This example
is documentation only; no production invocation occurred in this continuation.

## Local verification

- CLI argument/dispatch tests: 24 passed. A real no-argument `tsx` invocation
  exited 1 with the required-arguments message before loading the runtime.
- Workflow and exact operator tests: 20 passed, including preserved threshold
  receipts for successful, sampling-fenced and completion-fenced jobs, plus
  identical terminal co-watch retries and rejection of conflicting thresholds.
- Co-watch graph, candidate, projection and shadow service tests: 18 passed.
  Two projection tests ran against disposable PostgreSQL 18 after all 105
  migrations, with `RECOMMENDATION_DB_TEST=1`. They verify exact source lineage,
  revision replacement, privacy suppression, stale fencing, full edge-metric
  rebuild equivalence and watchability. The CI database suite list does not
  select this projection file, so ordinary green CI is not its receipt.
- Full Admin ESLint and TypeScript checks passed; focused lint/typecheck also
  passed after the final error-redaction/test delta.
- The initial full Admin suite had 7,465 passing tests, 365 skipped and one todo,
  with one 20-second timeout in the unchanged experience editor test “uses the
  selected Dub identity for the append selector limit.” Its isolated rerun and
  a main-baseline run reproduced that timeout on the shared development host.
  No timeout was increased or editor code changed. This local result is not
  described as a passing full suite; PR CI remains a separate release gate.

These fixtures establish local contracts. They do not establish production
coverage, production latency, authenticated Admin visibility or causal benefit.

## Durable rule

Keep an operator's explicit retry tuple recoverable before dispatch and in every
terminal receipt that later retry checks consult. Preserve the distinction
between a source-count limit and work performed before that limit: test the
bound before expensive eligibility/graph work, and retain a refusal without
inventing a successful evaluation. Existing lineage and capacity learnings in
`docs/solutions/logic-errors/cowatch-generation-denominator-lineage-20260928.md`
and `docs/solutions/best-practices/recommendation-trace-capacity-and-retention-proof-20260928.md`
continue to apply.
