# Admin catalog scheduling recovery — 16 September 2026

Status: demonstrated Admin catalog stalls corrected and release observation
complete. All times are UTC. The first release did not establish recovery; the
second release has the bounded outcome evidence below, including its browser
hydration caveat.

## Cause and correction

Production Admin returned 142,956 dub rows for one 216-video duration batch.
Prisma 6.19.3 trimmed nested `take: 5` relations in application memory, causing
result parsing and garbage-collection work on the same event loop that handles
Watch selection acknowledgments. A representative local workload reproduces
unrelated small transactions exceeding the unchanged 700 ms deadline.

[PR #2319](https://github.com/JesusFilm/forge/pull/2319) moves the existing
primary-within-five duration policy into a parameterized PostgreSQL LATERAL
query, returning one duration per video. Production already has a valid partial
index supporting that lookup; no migration, deadline increase or retry was
introduced. Identity, authorization, attribution and rate limits are unchanged.

The causal reproduction, independent pool/lock observations, diagnostic cleanup
and limitations are documented in
`docs/solutions/performance-issues/prisma-nested-take-duration-stalls-admin-20260916.md`.
Selection does not use Redis admission. This release does not prove the earlier
unmatched Redis incidents resolved.

## Matched local evidence

The isolated fixture contains 216 videos × 662 dubs and production's existing
partial duration index. An independent worker issues two catalog requests every
2.5 seconds and small eight-query transaction probes, sequentially with 100 ms
between completions. Each control/treatment run lasts 30 seconds. This is a
transaction probe, not an estimate of production selection failure rate.

| Measurement                 | Historical loader |   Fixed loader |
| --------------------------- | ----------------: | -------------: |
| Catalog calls               |                24 |             24 |
| Catalog p95 / maximum       |  1,800 / 1,811 ms | 52.4 / 54.7 ms |
| Transaction probes          |               197 |            271 |
| Probe p95 / maximum         |      633 / 738 ms | 11.9 / 89.2 ms |
| Probes over 700 ms          |                 3 |              0 |
| Maximum event-loop delay    |          418.9 ms |        15.3 ms |
| HTTP failures               |                 0 |              0 |
| Separate SQL-only execution |          103.0 ms |         3.6 ms |

The real PostgreSQL wire-cardinality regression fails before the change
(143,208 rows against a 1,296-row bound) and passes after it (216 rows). It also
checks primary-language fallback, visibility, HLS, empty and null semantics.

## Validation and merge

Work started in a dedicated worktree at freshly fetched main `ed6d978f8`.
After incorporating `3028f3305`, the full Admin suite passed 7,252 tests; types,
lint, production build and repository formatting passed. The branch then
incorporated Web compatibility fix `ea07cad7d`; 25 focused database/loader tests,
50 affected Web tests and Admin types passed again. Sequential Compound
Engineering review found no unresolved code findings.

The GitHub credential could not modify workflow files. The new database cases
therefore live in the existing Watch PostgreSQL entry point
`apps/admin/src/services/recommendations/playback-episode.db.test.ts`. CI logs
confirm all ten cases in that file actually ran, including the two new duration
cases; they were not counted from skipped ordinary-unit invocations. PR CI
`35046317142` passed, including the 65-case recommendation PostgreSQL step,
schema drift, Admin tests/lint/build, formatting and the aggregate gate.
CodeQL passed separately.

The PR merged normally at 02:06:01 as
`8070374f6a6e3e892926112d5a6ca8f5f7480fa1`. No direct deployment or manual
redeploy was requested.

## Production baseline: separate outcome populations

At investigation start, Admin and worker ran `b96f5f738` and Web ran `0a1c58599`.
The 01:28:42–01:29:38 browser baseline recorded 12 HTTP 200 served deliveries,
six cards each, with no semantic fallback. Five of six selection attempts
acknowledged. The remaining abort corresponds to Web HTTP 503 trace
`6aa9f0f5000000002968452ed5de64cd`, with a 704 ms Web span and 814 ms Admin selection.

A second baseline at 02:01:49–02:02:43, with Admin and Web on `3028f3305`,
recorded ten served deliveries of six cards and no semantic fallback. Three of
six selections acknowledged (483–578 ms); three aborted at 800–801 ms and all
three have confirmed Web 503 traces:

| Trace                              | Web duration | Admin selection duration |
| ---------------------------------- | -----------: | -----------------------: |
| `6aa9f8a40000000000a70dfb8732d90d` |       706 ms |                   905 ms |
| `6aa9f8ad000000002a595621d87c7427` |       716 ms |                 1,101 ms |
| `6aa9f8b5000000002347340b1e2c8492` |       703 ms |                 1,263 ms |

All links navigated correctly. That did not establish selection acknowledgment.
These synthetic checks are small, deliberately observed populations, not
ordinary-traffic error-rate estimates. The earlier HTTP 200 `delivery_timeout`
fallback at 00:25 remains recorded in
`docs/operations/watch-runtime-followup-2026-09-16.md`.

## Release observation

Railway automatically deployed Admin `adcb7f07-030d-41e9-8080-d288af5ff723`
and worker `debe240b-08c7-42b6-bea7-e98c30f510e2`; both were SUCCESS at
02:13:54. SSH verified Admin revision
`8070374f6a6e3e892926112d5a6ca8f5f7480fa1` and its compiled scalar query at
02:14:42. A 45-second capture returned at most 216 duration rows per query,
with a 29.8 ms maximum client query duration. The earlier overfetch is removed.

The 02:15–02:45 window failed the broader recovery check:

- Six browser batches, 36 navigations, 35 selection requests: 31 browser HTTP
  200 acknowledgments (437–741 ms) and four browser aborts at 801–804 ms.
  The fallback card navigation did not issue a selection mutation.
- 72 delivery responses: 71 HTTP 200 `served`, and one HTTP 200 `fallback` /
  `delivery_timeout` at 02:44:26.441. All contained six cards. No delivery HTTP
  failure or body-read failure was observed. No JavaScript error was observed.
- The retained 02:27:33 selection trace `11125940432511389720` has Web HTTP 503
  at 732 ms, upstream HTTP 728 ms and Admin selection 663 ms. The 700 ms
  Web-to-Admin deadline includes time outside the Admin resolver.
- Two other browser aborts were server HTTP 200: trace `1580210176704057537`
  at 02:21:33 (Web 545 ms, Admin selection 472 ms) and trace
  `16999250323956071879` at 02:39:36 (Web 636 ms, Admin selection 611 ms).
  Their browser acknowledgment deadlines are distinct from the upstream 503.
  The first batch's individual aborted request was not retained for correlation.

Datadog request metrics, grouped by actual Web revision, independently report:

| API       | HTTP 200 | HTTP 400 | HTTP 403 | HTTP 503 |
| --------- | -------: | -------: | -------: | -------: |
| delivery  |      380 |        0 |      237 |        0 |
| selection |       59 |        0 |        0 |        1 |
| evidence  |    1,725 |        6 |      224 |        0 |
| playback  |    1,995 |        0 |      236 |        0 |
| profile   |      613 |        0 |      525 |        0 |

These populations include ordinary traffic and separate diagnostic journeys;
they are not the browser-batch denominators. The two Web revisions are
`ea07cad7da833dc5c2ddf69331715ed39d481c34` and
`469edc6f996db1c6bd729b9a1b9f0e2732a0cd58` (automatic Web deployment at
02:30:18). Admission 403s and terminal 400s are not successes. Request metrics
do not expose delivery result/reason, so they cannot establish a population-wide
semantic fallback rate.

The main CI run for the duration merge was canceled by the subsequent Web-only
merge; its aggregate failure was cancellation, not a failed duration test.
The PR checks had passed before the normal merge.

## Residual scheduling investigation

The 02:39 capture overlaps the retained browser abort and independently samples
PostgreSQL every 50 ms. Selection's `findUnique` completed at the pg client in
2.6 ms, while PostgreSQL then spent over 250 ms in `idle in transaction` /
`ClientRead` waiting for the next application statement. No blocker was observed
on that trace. This sampling cannot rule out waits shorter than its interval.
The main loop's overlapping maximum pause was 139 ms. Pool acquisition reached
94.8 ms over the full capture, but that callback duration also includes scheduling
and is not a pure database wait measurement.

Bounded JSON instrumentation then identified recurring 100-dub hydration results
with 3,660 subtitle rows and approximately 5.5 million characters of Prisma JSON.
Pothos default
include mode materializes unused subtitle scalar fields and repeated language
metadata. This is a second catalog scheduling workload, separate from duration
overfetch and the unproven workflow-listener hypothesis. A narrow projection
experiment preserves the requested fields and removes much of this processing.
Its isolated local run reproduces the event-loop pause, not the entire production
failure rate; no isolated subtitle probe exceeded 700 ms.

The final schema-generated projection experiment reduced maximum loop delay
from 153 ms to 31 ms and catalog p95 from 379 ms to 166 ms, preserving the
requested subtitle/language response on every call. The new regression fails
on the historical implementation and passes with narrow selection. The full
Admin suite passes 7,255 tests. Schema and consumer introspection regeneration
produce no contract diff; types and scoped lint pass. The branch incorporates
newer main `421a4b273` before release checks. See the durable learning
`docs/solutions/performance-issues/pothos-subtitle-scalar-projection-stalls-admin-20260916.md`.

A separate pre-projection browser check at 02:59:19–03:00:12 recorded 12 served
deliveries and five of six acknowledged selections. The remaining browser abort
maps to Web HTTP 503 (706 ms), trace `11494686238428199507`. Do not combine this
additional diagnostic with the six scheduled batches above.

Parts of the first 30-minute window overlapped bounded diagnostic captures and
other release verification traffic. The 02:27 and 02:59 selection HTTP 503s also
occurred outside the owned inspector captures. Preserve this distinction when
comparing the window with ordinary traffic; diagnostics can add overhead.

All temporary pg/JSON wrappers, event-loop monitors and CPU profiles were restored.
Each owned inspector session was closed and verified unreachable afterward.
An already-owned heap sampler was left running; only its existing profile was
read. No production service configuration, queue or database setting was changed.

## Subtitle projection release

[PR #2322](https://github.com/JesusFilm/forge/pull/2322) merged normally at
03:12:52 as `d51e4d41c6dd0cb4091b5c5a98ec41888da66f76`. All 18 applicable PR
checks passed, including the aggregate gate, Admin build/tests/lint, schema drift,
formatting and CodeQL. Local validation additionally ran 28 focused tests with
ten real PostgreSQL cases. Main had not advanced at the final pre-merge fetch.

An independently owned Mobile PR merged immediately afterward as
`9533506f967496dea60c9a4b846bf7a70463772b`. It includes the Admin fix and changes
the shared lockfile, triggering a newer automatic rollout. This task did not
modify the Mobile UI. The earlier main CI run was canceled by that push; its PR
checks had passed. Both Admin and worker were observed SUCCESS on `9533506f`
at 03:27:55; SSH verified Admin’s exact SHA and both compiled projections at
03:29. Web's corresponding deployment was SKIPPED; it continues running
`469edc6f996db1c6bd729b9a1b9f0e2732a0cd58`.

Admin deployment: `24804257-f7dc-4756-90a9-955500cd71b0`. Worker deployment:
`9a18f94b-0015-4a91-83d5-5fb95331074c`. The first projection deployment on
`d51e4d41` also reached SUCCESS before that newer rollout.

A bounded 20-second capture on `d51e4d41` measured the same 100 dubs and 3,660
subtitles at 1.10–1.11 million characters of Prisma JSON, down from approximately
5.5 million characters. Parsing
these results took 2.08–3.43 ms. This confirms the materialization change in the
actual deployed workload; it does not itself prove timeout recovery. Size here
means JavaScript string length in UTF-16 code units, correcting the earlier
approximate MB wording; it is not a measured UTF-8 wire-byte count.

The later main CI run `35050960956` failed an unrelated Web assertion in
`WatchHomePage.test.tsx`: the resume-state write count was five instead of four.
Do not describe that main run as green or as a failure in the Admin regression.
The Admin fix's own PR checks passed before merging. On the incorporated main
revision, a fresh frozen-lockfile install and all 7,255 Admin tests passed; the
28 focused tests, including ten real PostgreSQL cases, passed against the owned
local database. The unrelated Web test file also passed all 70 cases locally;
that does not retroactively make the failed CI run green. Admin type checking
and a fresh production build also passed on the incorporated revision.

## Additional profiler observation

The 03:20:51–03:21:12 capture also recorded a 598 ms loop pause during Datadog
profile serialization, lazy source-map parsing and garbage collection. It was
near deployment startup and overlapped an owned CPU diagnostic. There is no
matched Watch timeout proving that this workload caused a request failure.

A subsequent 90-second timing-only observation on `9533506f`, with no additional
CPU sampler, measured two ordinary profile collections. Heap and wall collection
took 43 + 49 ms and 32 + 45 ms, with overlapping loop maxima of 132 and 99 ms.
The whole observation's loop maximum was 135 ms. All wrappers and the inspector
were restored. This 03:30:55–03:32:25 diagnostic falls between scheduled browser
batches and must remain identified in the broader APM observation population.

A local replay did not reproduce the 598 ms pause. Its 5,549 captured CPU nodes
also lacked 31 matching production bundle paths, so it is not a sufficiently
representative control for changing profiler configuration. Profiling, source
maps and production diagnostic settings remain unchanged. Recurring versus
cold-start profiler cost remains an uncertainty, separate from the two causally
validated catalog fixes. Follow-up feat-516 owns that investigation.

## Extended recommendation outcome window

Eleven scheduled browser batches ran from 03:29:13.105 to
04:29:01.714 UTC, spanning approximately one hour. All ran
against Admin/worker `9533506f` and Web `469edc6f`; repeated Railway observations
and final runtime verification identify the actual releases, not just main HEAD.

- 66 selection requests returned HTTP 200 with no browser aborts; response times
  were 414–671 ms. The final 48 additionally validated the returned claim
  nonce, nonempty target and canonical destination. The first 18 recorded HTTP
  status and completion without that additional body assertion.
- 132 delivery responses all returned `served`, six cards and six capabilities.
  There were **zero HTTP failures** and **zero semantic timeout fallbacks** in
  this browser delivery population, with no request or body-read failures.
- All 66 navigation destinations matched. One React hydration error means the
  aggregate no-JavaScript-errors browser gate **did not pass**; see its separate
  investigation below. Do not describe this as a completely clean browser run.

Datadog HTTP request metrics for 03:29–04:30, retrieved after the window, report
these separate populations on Web `469edc6f`:

| API       | HTTP 200 | HTTP 400 | HTTP 403 | HTTP 5xx |
| --------- | -------: | -------: | -------: | -------: |
| delivery  |      529 |        0 |      652 |        0 |
| selection |       70 |        0 |        0 |        0 |
| evidence  |    2,211 |       15 |      403 |        0 |
| playback  |    3,214 |        1 |      627 |        0 |
| profile   |      832 |        0 |    1,579 |        0 |

The availability and source-free endpoints are reported separately in the raw
metric population; the above table focuses on the five main recommendation APIs.
The 400 examples inspected through 04:15 log `invalid_request`,
`retryDisposition=terminal`, `timeoutStage=none`. Inspected 403 examples log
`forbidden` or `crawler_rejected`. These are rejections, not successes or hidden
server timeouts. No recommendation HTTP 5xx was observed in the fixed window.

Datadog also counted 36,825 `forge-admin` GraphQL request hits on `9533506f`
during this window, confirming ongoing application traffic.

These metrics include ordinary and diagnostic traffic and cannot establish the
semantic fallback rate of all HTTP 200 deliveries. Only the 132 inspected browser
bodies support the zero-fallback result. The separate hydration revisit and the
03:30:55–03:32:25 timing-only profiler observation are included in the broader
traffic window; the latter falls between browser batches.

The two causal local reproductions, live cardinality/string-length confirmation,
regressions and this longer window support completing the demonstrated Admin
scheduling recovery in feat-496. This is bounded evidence, not a guarantee that
rare deadlines can never recur. Workflow ownership, profiler cost and the
existing hydration-error class remain explicitly scoped follow-ups.

## Browser hydration finding during observation

The 04:05:13–04:06:03 batch reported one React #418 with `args[]=HTML`.
Its six selection responses had valid acknowledgment bodies, all twelve
recommendation deliveries served six cards, and all six navigation destinations
matched. The aggregate browser assertion nevertheless failed because it includes
a no-JavaScript-errors requirement. Do not omit that failure or relabel it as a
recommendation timeout.

A separate 04:07:14–04:07:40 revisit of all seven involved pages did not repeat
the error. Datadog RUM matched it to `/watch/sermon-on-the-mount-2.html` at 04:05:52,
issue `8513bab6-8960-11f1-a33c-da7ad0900002`. The same HTML variant appears
before both Admin fixes, including 01:34:24 and 00:53:42 on other Watch pages.
This establishes an existing error class, not one shared initiating cause.
Follow-up feat-517 owns reproduction; feat-515 separately owns cold-paint
variability.

## Preserved state and remaining limits

Read-only queries at 01:58:46 and 02:15:11 confirmed the published English `watch-home`
experience had no authored `homepageRecommendations` block. Final checks at
04:29:47–04:29:50 reconfirmed the exact Admin SHA, both compiled corrections,
closed inspector and absent authored block. Browser availability returned
`enabled: false`; the source-free route returned HTTP 403 `feature_disabled`,
with private/no-store headers. The flag's default remains off. No Mobile/TV UI,
account linking or curation was changed.

feat-513 records the independently observed workflow enqueue/listener ownership
issue. Its contribution to the observed stalls has not been causally isolated.
Do not claim every scheduling or Redis delay has the duration-loader cause.
