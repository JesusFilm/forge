# feat-464 local browser lifecycle proof

> Historical proof from PR #2211. The Redis transport counter panel described
> below was subsequently removed at the owner's request. Current operational
> inspection uses Datadog logs; the PostgreSQL Watch-to-Admin lifecycle remains.

## Measured admission budget regression (2026-09-09)

The selection follow-up reproduced thrown/returned `BAD_USER_INPUT` becoming
503 before applying the same structured error wrapper. Full Web tests passed
3,938 cases; the final focused route/browser-helper/component run passed 26,
including the subsequently added specific-binding precedence case. Web lint and
typecheck passed. The component test proves exactly one trusted-href navigation
and one selection attempt after terminal 400; lost-ack retry coverage still passes.

Against the real local Web/Admin services, a disposable served-item fixture with
an invalid capability produced private HTTP 400 `evidence_request_invalid`.
Video remained unpaused, advanced 39.765 seconds and decoded another 2,384 frames.
A missing-item binding fixture separately returned definitive 409. Subsequent
browser navigation to the trailer measured 473 ms TTFB, 624 ms DOMContentLoaded
and 897 ms load on the warm local development server. This was a route integration
and playback/navigation smoke; the recommendation-card fallback itself was
verified by the component test. No browser runtime or initial loading work changed.

A real Redis delayed-TIME test failed at the original 250 ms budget and passed
at 500 ms for playback-context commands. Connection and other namespaces retain
250 ms; the final narrowed admission/Redis/routes/browser-helper run passed 59
tests. A separately held EVAL ran only after the caller timed out and left
both admission buckets absent. Client/aggregate limits and privacy-control
isolation still pass against real Redis. Focused admission/Redis/route/recorder
checks passed 68 tests; after extending terminal mapping to render/impression
evidence, the final full Web suite passed 3,934 tests (three Redis cases
are opt-in and ran separately). Web lint and typecheck passed.

The real browser sent nine successful fact batches, paused at 13.496763 seconds,
held that position, resumed, and reached a native ended event after seeking near
the end. The normal workflow finalized the episode with ten immutable facts;
the authorized local Admin detail displayed the immutable fact timeline and
revisioned outcomes. This supplements the five earlier failure perspectives;
the follow-up changes server admission and error mapping, with no new browser
loading work. Render/impression route tests reproduce thrown/returned input
errors before the mapping fix, then verify HTTP 400. The existing browser JSON
retry test proves one attempt for 400; arbitrary error messages still yield 503.

## Terminal invalid-input regression (2026-09-09)

Two retained primary production traces (`4899517045392701787` and
`4310965155225796154`) showed fast Admin `BAD_USER_INPUT` responses becoming Web
503s. New regressions reproduced both the wrong HTTP status and browser retry
amplification before the fix. Structured playback input rejection now returns
HTTP 400 `playback_request_invalid`; the recorder drops the rejected episode.
Specific invalid binding retains HTTP 409. Unrecognized 400/409 bodies, 429 and
503 preserve bounded identical-payload retry behavior.

The normal-environment full Web suite passed 3,927 tests. The final focused
route/recorder/claim/observation run passed 66 tests, including three subsequently
added ambiguous-response cases. Web lint/typecheck passed. The first full run
inherited local server fixture secrets/origin and failed 20 unrelated assertions;
the clean-environment rerun passed. No Admin, schema or durable-write code changed;
the preceding full Admin, PostgreSQL and Redis results remain applicable.

A real browser on the same isolated fixture changed one local episode capability
signature before sending facts through real Web/Admin HTTP. It observed exactly
one fact HTTP 400 and one `request_invalid` dropped notification. Over the next
28.027 seconds it made no additional fact request, remained unpaused and decoded
1,679 more frames. A screenshot confirmed visible playback. Navigation to the
trailer succeeded (574 ms TTFB, 701 ms DOMContentLoaded, 939 ms load on the warm
local development server). The change adds no initial rendering work, resources
or network requests; these timings are local smoke evidence, not a production
performance comparison. All fault injection was local.

Older already-loaded clients retain their bounded retry behavior until refreshed.
This fix does not identify or relax the underlying failed token validity check,
and does not resolve the separately instrumented admission failure.

## Admission diagnostics regression (2026-09-09)

The follow-up diagnostic branch preserves admission behavior while exposing its
failure stage and timing. Full suites passed: 3,924 Web tests and 6,233 Admin
tests. Web/Admin lint and typechecks, repository formatting, the real Redis
admission test, and six real PostgreSQL lifecycle/concurrency tests passed.
The focused admission/route/recorder run passed 58 tests. Sequential review in
the main task covered correctness, testing, standards, privacy, reliability,
TypeScript, and the existing recommendation-boundary learning; no blocking
finding remained. No parallel-agent result is claimed.

Fresh local verification used Web development port 3050, the successful Admin
production build on 3053, isolated PostgreSQL on 55465, and Redis on 56465.
The seed catalog used the previously downloaded public Mux sample, relayed as
local HLS with unchanged segment bytes. This is a decoder/transport fixture,
not production catalog, vector or CDN evidence.

- Video decoded and sent accepted facts through real Web/Admin HTTP. Pause held
  position 19.450769 seconds unchanged, then playback resumed.
- A deliberately lost acknowledgement after a successful fact write caused an
  identical-payload replay, confirmed by the browser wrapper and Admin replay log.
- Six injected fact 503 responses left video unpaused; it advanced 21.064 seconds
  and decoded another 1,263 frames. The first browser subsequently encountered a
  local resource error during navigation; that attempt is not a navigation pass.
  A fresh browser successfully navigated between the feature and trailer routes.
- A deliberately wrong fact media binding produced exactly one real HTTP 409,
  no further fact retries, and continued decoded playback.
- An Applebot browser received HTTP 403 for context, claim and facts. Its public
  Watch page remained accessible.
- A fresh viewer reached a real media `ended` event after seeking near the end.
  The normal workflow automatically finalized the episode into two immutable
  outcomes; no outcome service was invoked manually.
- A separately authenticated local Admin fixture loaded the authorized playback
  and profile eligibility sections. Its production-build navigation measured
  46 ms TTFB, 144 ms DOMContentLoaded and 203 ms load. These are local smoke
  measurements, not a production or baseline comparison. No browser code changes
  are included in the diagnostic release.

The initial Admin fixture omitted `REDIS_HOST`/`REDIS_PORT`, causing GraphQL 500s;
pointing its existing limiter at the isolated Redis corrected the setup. The
known unrelated local search-retention workflow registration error remains;
recommendation reconciliation heartbeats and episode finalization succeeded.
Local empty profile populations cannot establish the production pointer invariant.
Production admission diagnosis, the two-hour canary, installed monitors and the
fresh authorized production audit remain separate gates.

## Collector removal regression (2026-09-09)

The removal was verified in an isolated host worktree with a fresh PostgreSQL 18
database. All 6,233 Admin tests (412 files), 3,918 Web tests (242 files), and six
real PostgreSQL source-neutral lifecycle/concurrency tests passed. The latter
include eight simultaneous claims, exact replay, late/conflicting facts and
concurrent finalization. Web/Admin lint and typechecks, repository formatting,
the normal commit hooks, and the Admin production build passed.

The production build served `/dashboard/recommendations` to a locally signed Admin
fixture session. A fresh Chromium session verified the retained playback,
reconciliation, eligibility, privacy and request-trace sections, absence of the
retired transport panel, and working navigation to `?window=7d`. It recorded zero
console messages and zero page errors. Warm HTTP 200 loads measured 102–110 ms
to first byte and 245–318 ms to load; the initial process-cold load took 3.90 s.
The change removes the extra counter read and adds no client JavaScript or database
query. These local samples are smoke evidence, not production latency estimates.

Both development bundlers exposed unrelated Node-import errors through workflow
instrumentation. The final browser check used the successful production build
without modifying instrumentation. The empty fixture correctly displayed
"Unavailable — activity unknown" for readiness; no live readiness or production
integrity result is inferred. This removal did not repeat the earlier full video
journey below: the recorder and transport paths are unchanged, and the full unit
suites plus real PostgreSQL concurrency were rerun against the simplified logger.

Screenshot retained locally as `/tmp/forge-evidence-redis-removal-admin.png`.

Environment: isolated dev-container checkout `/tmp/forge-feat-447`, disposable PostgreSQL database `forge_feat447_validation`; local Web port 3010 and Admin port 3013. No production data or services mutated.

## Fixture and limitations

The repository's `seed-web-fixtures` catalog was supplemented with five English dubs referencing the public Mux sample playback ID documented by the installed official `@mux/mux-video-react` README. The sample is synthetic relative to the catalog titles. Container egress blocked the media CDN, so original official HLS rendition and segment bytes were fetched on the host and served to the browser via Playwright media-only fulfillment. Application requests were real Web/Admin HTTP. Chromium used an explicit ordinary Chrome user agent for the viewer fixture and Applebot for rejection tests.

This proves local decoder, browser recorder, Web-to-Admin, PostgreSQL and authorized Admin UI behavior. It does not prove direct production CDN transport, production-vector ranking latency, a production snapshot, the two-hour canary, or the production current-pointer audit.

## Successful lifecycle

Browser click activated real playback: decoded media advanced, `readyState=4`, and the player stayed unpaused. The recorder sent context, claim and facts through real same-origin routes, returning HTTP 200.

A completed browser session stored six ordered immutable facts: attempt, start, two progress facts, 23,090 ms of complete active-visible-playing coverage and a pagehide terminal. The real outcome service finalized the episode with `active-watch-proxy-v1` and `legacy-position-v0` revisions. Finalization was invoked through the application service for this local proof; automatic workflow recovery is a separate gate.

A cookie-isolated Admin context authenticated using the repository's local signed-session helper and a disposable ADMIN principal. The authorized episode route returned HTTP 200 and displayed Finalized/generation 1, six immutable facts and two outcomes. Identifiers and digests are masked in the retained screenshot.

The real local reconciliation read returned `currentPointerInvariant=clean` with zero affected pointers. The local fixture contains no populated profile projection population, so this is not the feat-459 production audit.

## Failure and admission checks

- Normal viewer: 604 decoded frames, 10.000 seconds playback, real context/claim/facts HTTP 200.
- Injected telemetry HTTP 503: 601 decoded frames, 9.939 seconds playback; one failed context request, no claim retry amplification. Recommendation delivery was also faulted.
- Actual invalid binding: a local claim transport deliberately supplied the wrong media binding. Admin produced HTTP 409; browser recorded exactly one context 200 and one claim 409, no claim retries, while decoding 601 frames and advancing 9.953 seconds.
- Applebot context, claim and facts requests: HTTP 403 `machine_evidence_rejected`.
- The authorized Evidence transport panel showed Web accepted facts 7 and Admin accepted facts 7, recognized-crawler terminal HTTP 403 count 3, and Web accepted context count 3. Groups below three observations remained suppressed. The unrelated overview headline remained unavailable because the fixture does not establish live recommendation readiness.

## Navigation measurements

Warm local development server, independent browser contexts:

| Scenario      |    TTFB | DOM content loaded | Resource count | Transfer bytes |
| ------------- | ------: | -----------------: | -------------: | -------------: |
| Normal        |  755 ms |            1171 ms |             89 |        2752800 |
| Telemetry 503 | 1154 ms |            1631 ms |             88 |        2746221 |

These are development-environment smoke measurements, not a baseline/main comparison or production performance acceptance. External thumbnail and Mux analytics requests were blocked by the container network.

Artifacts: `lifecycle.json`, `scenarios.json`, and redacted screenshots retained locally at `/tmp/feat464-browser-proof/`. No raw traces, capabilities, cookie values, or request bodies are included.

## Stronger regression run (2026-09-09)

This follow-up supersedes the manual-finalization limitation for the local
recommendation lifecycle. Two independent regression agents and the primary
agent covered viewer playback, navigation, transport faults, crawler admission,
and Admin evidence. Further agent launches were rejected by the platform's agent
limit. Browser interactions used agent-browser; the media fixture only relayed
original public media bytes.

The disposable setup required the documented `workflow:setup:postgres` command,
`WORKFLOW_RUNNER_ENABLED=true`, and
`WORKFLOW_LOCAL_BASE_URL=http://127.0.0.1:3013`. Prisma migrations alone do not
create Workflow's runtime schema. Generating the normal stored Watch route
manifest also repaired fixture-only implicit-language/parent-child 404s; no
catalog rows or product routing code changed.

- The ordinary viewer decoded 5,558 frames over 83.468 seconds. Pause held
  59.175281 seconds unchanged for 18 seconds; Play resumed playback.
- Four browser-created episodes finalized automatically into eight immutable
  outcomes from 41 ordered facts. Workflow runtime completion and durable
  finalization ledgers were verified; no outcome service was invoked manually.
- Navigation across two media titles produced separate finalized episodes with
  zero conflicts. The generated parent-child recommendation route loaded after
  normal manifest initialization.
- A deliberately wrong media binding returned one claim 409 and no retries while
  video decoded 1,263 frames. Injected context 503 left playback running and
  generated no claim attempts.
- An Applebot browser received terminal context 403 and made no claim/fact
  requests or playback episode. It could still view the public video.
- Reconciliation completed real scheduled batches at 00:07 and 00:12 UTC, with
  zero dispatch failures. Five stale local projection runs were recovered.
- An authorized Admin browser displayed the automatically finalized viewer episode,
  all 16 immutable facts, both outcomes, and 90,311 ms active viewing.
- Both viewer outcome classifiers remained ineligible for learning. No live
  profile ranking was enabled.

An unrelated local development manifest omitted `searchTraceRetention`, whose
scheduler failed registration. Recommendation finalization and reconciliation
were registered and completed. The minimal seed still lacks the hard-coded home
`jesus` category, so this is not a full-catalog website certification.

Artifacts are retained locally in `/tmp/feat464-regression/`; identifiers and
capabilities are omitted from public reports. These local results still do not
substitute for the production canary or authorized current-pointer audit.
