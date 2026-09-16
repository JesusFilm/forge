# Watch runtime follow-up — 16 September 2026

Status: Redis cleanup and selection receipt-ordering fixes verified in
production; separate selection timeouts remain under investigation.
All timestamps below are UTC. feat-496 remains in progress because the unmatched
admission incidents and separate selection timeouts are not proven resolved.

## Confirmed Redis contention mechanism

Account-authenticated Railway SSH exposed Redis slow-log entries that were not
available through the project API alone. Web's cache handler sent HDEL commands
with 430,486–542,713 fields, taking 210–368 ms. Cache and recommendation admission
share this Redis server; ordinary admission commands have a 250 ms budget.

[PR #2311](https://github.com/JesusFilm/forge/pull/2311) merged at 23:02:31 on
September 15 as `73e4263c62ac4d7b8947d5b876ca2fa9f9f3caa2`. Both exports of the
pinned cache-handler dependency now delete 500 entries per awaited batch under
the existing deletion deadline. Normal cache reads, writes and serialization
remain unchanged.

| Isolated Redis, 550,000 expired metadata entries |     Before |    After |
| ------------------------------------------------ | ---------: | -------: |
| Maximum independent worker's TIME latency        | 434.979 ms | 9.777 ms |
| TIME samples exceeding 250 ms                    |          2 |        0 |
| Total cleanup duration                           |   3,750 ms | 3,993 ms |
| Expired metadata entries remaining               |          0 |        0 |

Cleanup takes slightly longer in exchange for smaller pauses for other clients.
Eight regressions failed on the original library and pass on both patched
exports. Ten real-Redis cases, 4,381 Web tests, types, lint, build, frozen install
and formatting passed. The reproduction and maintenance guidance are in
`docs/solutions/performance-issues/shared-redis-cache-cleanup-blocks-admission-20260916.md`.

## CI repair and release identity

The first PR passed 95 checks but exposed existing Expo patch drift. The same
failure reproduced in untouched earlier main commit `d9dce17`. GitHub allowed a
normal merge, but Web's Railway trigger has `checkSuites: true`; deployment
`e62aeb28-d7a8-4e75-b4ee-716be504c829` was skipped after main CI failed. The fix was
merged at that point, not live on Web.

[PR #2312](https://github.com/JesusFilm/forge/pull/2312) separately aligned
`expo` 57.0.23 and `expo-build-properties` 57.0.19, with three required Expo
toolchain patches and generated peer/optional lockfile metadata. React and React
Native versions are unchanged. All 98 PR checks passed, including Expo Doctor and
the aggregate CI gate. It merged at 23:25:41 on September 15 as
`0a1c585998a6dbb4bf1399fe4c5eed25310a5512`.

Local validation also passed frozen install, the standalone version check,
19/19 isolated Doctor checks, Mobile types/lint, 3,639 tests in 227 suites with
the worker runner, and disposable iOS/Android exports. Serial Jest exposed late
`act` warnings in unchanged `useAutostartPlayback` tests; the same warnings
reproduced against earlier main. No EAS update or native binary was published.

The normal Web deployment for the combined revision is
`43a75813-bcca-4381-8454-d43099079b51`. Main's `forge-ci` run 35035612428 and
CodeQL run 35035610644 both passed. Railway waited for both check suites, then
started building at 23:36:58 and reached SUCCESS at 23:43:15. SSH inspection at
23:43:18 confirmed the exact revision and the 500-entry deletion helper in both
installed CJS and ESM exports.

The production browser playback smoke passed at 23:44:08: the homepage loaded,
the optional row remained disabled, and normal Watch playback produced profile,
playback and evidence responses plus six recommendations without JavaScript
errors.

The separate three-click smoke stopped on its second click because Playwright
did not observe a selection response within ten seconds. The first click
returned 200. The missing-response attempt's server trace
`15150696214934617809` returned 200 in 131 ms at Web and 62 ms at Admin; it is not
an observed 700 ms upstream timeout. This smoke did not pass.

A fresh six-click diagnostic at 23:46–23:47 removed request interception and
recorded actual network outcomes. All six clicks opened the expected video and
there were no JavaScript errors. Five selection requests returned 200 in
434–637 ms; one was aborted by the browser at 802 ms. Its server trace
`2618642203686195195` confirms a 710 ms Web 503 after the 700 ms upstream
deadline. Admin's selection mutation took 728 ms: the emergency-revocation
control read took 343 ms despite approximately 6 ms inside its query engine,
and the served-item read took 184 ms. The application delay remains unexplained.
This directly proves the separate selection timeout persists after the Redis
cleanup fix. Navigation success must not be reported as complete evidence
delivery or timeout recovery.

Revision-scoped Datadog request metrics for 23:43:15–23:50 contain 1,110 calls,
including 396 HTTP 4xx responses and one 503. The server-error population is:

| Endpoint        | HTTP 200 | HTTP 5xx |
| --------------- | -------: | -------: |
| recommendations |       59 |        0 |
| profile         |      116 |        0 |
| playback        |      303 |        0 |
| evidence        |      228 |        0 |
| select          |        7 |        1 |

This short window includes the synthetic browser checks. The select sample is
too small and test-heavy to estimate an ordinary-traffic error rate; it does
establish a post-deployment failure. Counts use APM HTTP metrics scoped to
`version:0a1c585998a6dbb4bf1399fe4c5eed25310a5512`, not retained trace counts.

## Selection receipt race

A second bounded browser run at 23:50–23:52 overlapped a 90-second Admin CPU
capture. All eight links opened correctly; five selection acknowledgments
arrived and three were aborted around 800 ms. Two server traces were upstream
timeouts. The third, `2089744889511763809`, was a PostgreSQL P0001 rejecting an
attribution marker older than its required impression receipt.

The timing race reproduces against the real database: pause selection after it
captures its receipt time, commit an impression 100 ms later, then continue.
The original service raises the exact production error. The fix derives the
marker from the later server receipt and carries it into profile feedback,
including both selection and impression replay reconciliation. The 29 focused
unit tests and eight real-Postgres cases pass. The full Admin suite passed 7,204
tests, with types, lint, production build and repository formatting also passing.
An initial heavily concurrent test run exposed three unrelated timing failures;
their targeted rerun and the full two-worker rerun passed without changing those
tests. Sequential Compound Engineering review found no remaining code findings.

[PR #2315](https://github.com/JesusFilm/forge/pull/2315) passed all applicable PR
checks and merged normally at 00:17:25 on September 16 as
`b96f5f738d3357e228da1d05bb79ec9ea2d02d68`. Main's `forge-ci` run also passed. Automatic Admin
deployment `039ade97-db71-4c2c-bbdd-b2c1c61ffd3b` reached SUCCESS at 00:24 UTC.
SSH verified the exact deployed revision and both compiled timestamp fixes at
00:24:29. See
`docs/solutions/database-issues/selection-attribution-receipt-ordering-race-20260916.md`.

The first post-release browser playback check at 00:25:01–00:25:48 passed 36
seconds of playback, profile and playback HTTP 200s, six visible recommendations,
analytics delivery, and no JavaScript errors. The recommendation response was
HTTP 200 with `result: fallback` and `reason: delivery_timeout`; this is graceful
degradation, not evidence that upstream deadlines are resolved. The homepage
still had no authored row; availability returned `enabled: false` and the
source-free endpoint returned `feature_disabled` with private/no-store headers.

The initial six-click check at 00:25:02–00:26:03 navigated correctly six times,
but recorded only four selection requests, all HTTP 200 in 438–550 ms. Its
`allSelectionsAcknowledged` assertion therefore did not pass. Unattributed
fallback cards intentionally navigate without a selection request; navigation
alone must not count toward the selection-acknowledgment denominator.

A fresh check with delivery outcomes recorded at 00:26:49–00:27:43 passed all six
selection acknowledgments, HTTP 200 in 438–508 ms, with correct destinations and
no JavaScript errors. Its 12 recommendation responses (source and destination
pages) all returned `result: served`, six cards and no fallback reason. The
initial timeout fallback remains in this report; this short successful repeat
does not close the independent latency investigation.

The CPU capture found workflow execution, database result processing, garbage
collection and synchronous error/source-map formatting during the failure
windows. Error formatting can follow a timeout, so it is not sufficient proof
of the timeout's initiating cause. The temporary monitor was removed and the
inspector was closed and verified unreachable after the capture.

For timeout trace `3895688673582395761`, the selection transaction took 801 ms.
The item advisory-lock query took 8 ms, while audit creation took 98 ms around a
4 ms engine query and commit took 222 ms around a 104 ms adapter operation.
The capture during the client's first 700 ms includes database result parsing,
promise processing and garbage collection. These observations narrow the next
investigation toward application processing and scheduling, but do not prove a
specific background workload is responsible. This remains separate from the
receipt-ordering race.

## Remaining evidence and limits

- The Redis slow-log timestamps do not match the 02:55 and 05:51 admission
  incidents from September 15. The cleanup patch fixes a reproduced contention
  mechanism without proving those incidents resolved.
- Redis latency monitoring was initially disabled. An empty `LATENCY LATEST`
  result was not evidence of no stalls. At 23:30:08, the threshold was temporarily
  changed from 0 to 10 ms to inspect command, expiration and snapshot pauses
  during rollout. The capture through 23:44:02 found fork pauses of 14–42 ms
  and two command events of 12 ms, with no event reaching 250 ms. The threshold
  was restored to 0 and read back successfully at 23:44:02. These samples span
  the old and new Web containers and do not establish historical causality. See the
  [Redis latency-monitoring documentation](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency-monitor/).
- Selection does not use Redis admission. Its Web-to-Admin deadline is 700 ms.
  Retained 18:31/20:22 traces show application delays around small SQL operations.
  A 21:54:18 selection log reports `upstream_unavailable`; its trace was not
  retained. The 21:45–22:54 HTTP metrics contain one select 200 and one select 503;
  a high aggregate success rate would obscure that low-volume path.
- A bounded 45-second Admin CPU capture found repeated 50–117 ms event-loop
  delays alongside garbage collection and Prisma processing. This does not
  isolate one workload as the cause. The temporary monitor was removed and the
  inspector was closed and verified unreachable after capture.
- A contemporaneous Postgres snapshot had no other active query or lock wait.
  That snapshot cannot rule out earlier stalls; `pg_stat_statements` is absent.
- A separate Redis client in the Web container made 600 TIME calls over
  23:30:56–23:31:56. Maximum latency was 31.580 ms and p99 was 6.413 ms, with no
  calls reaching 250 ms. This healthy sample precedes the cleanup release and
  cannot explain historical failures.
- At 23:32, the current Web and Admin cgroups reported no CPU quota throttling
  or memory-limit/OOM events. Their configured limits were 8 CPUs/16 GB and
  24 CPUs/24 GB respectively. This does not rule out problems in earlier
  containers or unrelated application processing delays.
- Three normal production recommendation-card clicks at 23:14 all returned 200
  and navigated without JavaScript errors. One deliberately sampled trace shows
  145 ms Web / 127 ms Admin selection. Its 875 ms feedback transaction runs after
  the response and must not be counted as selection's critical-path latency.
- The 22:54–23:20 pre-deployment window has 3,194 recommendation HTTP calls,
  including five successful selections and no 5xx responses. This is baseline
  evidence before the new Web revision, not an improvement caused by the patch.

## Preserved launch state

The authored English Homepage Recommendations Block stays removed and
`forge.watch.homepageRecommendations` stays default off. No Mobile/TV
recommendation surface, account linking or curation republishing was added.
All releases used normal PR-to-main automation; no local code was published or
manually redeployed to production.

## Continuation: Admin catalog scheduling

The subsequent investigation reproduced Prisma duration overfetch and shipped
#2319 to verified Admin/worker revision `8070374f6`. Its 30-minute observation
still reproduced a selection HTTP 503 and an HTTP 200 `delivery_timeout`
fallback. A second catalog workload materializes unused subtitle/language
scalars; a narrow projection reduces the independently reproduced scheduling
cost. Read `docs/operations/watch-admin-duration-recovery-2026-09-16.md` for exact
revisions, separate HTTP/semantic/browser populations and residual limitations.
PR #2322 subsequently deployed with the duration correction in Admin/worker
`9533506f967496dea60c9a4b846bf7a70463772b`. The 03:29–04:29 browser observation
recorded 66 selection HTTP 200s without aborts and 132 served deliveries with no
HTTP failures or semantic timeout fallbacks. The broader fixed HTTP population
also had no recommendation 5xx; terminal 400/403 rejections remain separate.
One pre-existing React hydration-error class was observed and remains a follow-up,
so the aggregate no-JavaScript-errors browser assertion did not pass. The report
above records the causal fixes, limitations and remaining hypotheses. feat-496
is complete for the demonstrated Admin scheduling recovery; feat-513, feat-516
and feat-517 preserve the separate unresolved work.
