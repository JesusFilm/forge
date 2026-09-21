# Watch error-formatting recovery — September 22, 2026

## Proven mechanism and scope

The [sustained production verification](watch-production-verification-2026-09-22.md)
found 206 Yoga errors after a catalog PostgreSQL 53100 failure, overlapping a
38.55-second maximum event-loop delay and 63 playback HTTP 503s. The isolated
source-map experiment was insufficient to establish the actual application effect.

An owned Admin production build now reproduces the complete interference path:
a catalog loader fails, GraphQL produces one error per field, Yoga logs each
error, and Next's custom Error inspector synchronously rebuilds source-map
consumers for each log. Unrelated real selections and playback writes wait behind
that synchronous work. This demonstrates the amplification mechanism; it does
not recreate the initiating database shared-memory exhaustion or explain the
earlier capability-budget timeout.

## Small correction

`apps/admin/src/graphql/logger.ts` keeps Yoga's logger and log levels. In
production only, native Node inspection formats Error arguments with
`customInspect: false` before they reach console. Native stacks, causes and
error fields remain visible; no error is dropped or deduplicated. Non-error
arguments and development inspection retain their existing behavior.

`apps/admin/src/app/api/graphql/route.ts` supplies that logger to Yoga. Error
masking, responses, execution, authorization, attribution, budget commits and
retries are unchanged. The existing console forwarder still attaches trace/span
identity and sends logs to Datadog. No global Error prototype, live callback,
source-map generation or profiler setting is changed.

## Full-build comparison

The disposable fixture has 207 videos and real PostgreSQL migrations. A
fixture-only view raises SQLSTATE 53100 during catalog playback lookup. Two
bounded root lists generate 206 field errors through the actual loader and
GraphQL route. Five concurrent real selections and one playback fact run behind
that failure. The existing Datadog log forwarder sends to an owned UDP receiver.

The control is the same build with native inspection's `customInspect` option
set true; the fixed bytes are restored afterward. No such switch is shipped.
The [aggregate measurements](../validation/watch-error-formatting-20260922/results.json)
retain all runs and unsuccessful controls.

| Measurement                     | Control                | Fixed, four fresh processes |
| ------------------------------- | ---------------------- | --------------------------- |
| Catalog response                | 75,757.55 ms           | 85.81–142.48 ms             |
| Five concurrent selections      | 75,844.90–75,895.67 ms | 135.30–208.25 ms            |
| Playback acknowledgment         | 75,876.76 ms           | 139.98–183.18 ms            |
| Selection durations over 700 ms | 5/5                    | 0/20                        |
| Masked catalog errors           | 206                    | 206 each                    |

Three repeated fixed runs independently receive all 206 Yoga errors over UDP.
The first pair counted 208 allocation-error rows including the two Prisma batch
logs; that mixed counter is not mislabeled as 208 Yoga errors. Every fixed
selection and playback receipt is accepted. These are full Admin measurements,
not claims about production Web/browser acknowledgment or future rare failures.

A second control returns playback HTTP 408 and resets the response before the
probe can record complete measurements. It remains an unsuccessful control;
there is no evidence of an OOM. The first diagnostic client also reached its own
30-second observation limit. Increasing that local measurement window to 180
seconds only observes the control to completion; application deadlines stay
700 ms for selection and 3,000 ms for playback.

## Validation and remaining work

The regression fails before the correction because a custom inspector executes.
Five logger cases verify native details, development behavior, severity/arguments,
real Yoga fan-out/masking, and unchanged intentional domain errors. The fan-out
case also verifies that the non-enumerable GraphQL source/literal is not logged.
The full Admin suite passes 7,293 tests; focused logger/forwarder/domain checks,
Admin lint, typecheck and production build pass. Sequential Compound Engineering
review checks correctness, error semantics, privacy, performance and standards.

A bounded read-only production EXPLAIN of a representative 206-video fallback
lookup plans a parallel hash join over the Mux catalog and estimates 35,280 output
rows before Prisma trims nested dubs. The incident parameters are unavailable;
this plan is an investigation lead, not proof of that allocation failure's cause.
Keep database execution, pool waits, WAL/lock waits and application scheduling
separate. No production database setting changed.

feat-496 stays in progress pending release verification, sustained production
outcomes and the separate capability-budget investigation. The other Watch
acceptance gates remain in the existing closure plan. The authored English
homepage recommendation block stays absent and its feature flag defaults off.
No Mobile/TV, account linking or curation changed.
