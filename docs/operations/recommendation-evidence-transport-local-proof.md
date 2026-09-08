# feat-464 local browser lifecycle proof

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
