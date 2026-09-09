# feat-464 local browser lifecycle proof

> Historical proof from PR #2211. The Redis transport counter panel described
> below was subsequently removed at the owner's request. Current operational
> inspection uses Datadog logs; the PostgreSQL Watch-to-Admin lifecycle remains.

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
