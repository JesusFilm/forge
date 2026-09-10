# Recommendation release: production observation, 10 September 2026

All timestamps in this report are UTC. PR #2249 merged as
`b89957a5b5b227aa1b7bcb9085f5511f4fa8203c` at 22:39:24 after 39 passing PR checks.
The primary Admin deployment completed at 22:46:41, its worker at 22:47:43,
and Web at 22:59:58. Main CI and CodeQL also passed.

## Observed behavior

The first production browser pass at 23:01 verified the homepage, category
section, actual Chosen Witness playback, existing seeded recommendations and
accepted playback-evidence responses. The new source-free endpoint returned
`environment_disabled`, and the homepage contained no new recommendation block.
No production pool promotion, authored homepage change or flag activation occurred.

A second fresh browser pass at 23:08 reproduced three profile API 503 responses
before successful retries. Playback still advanced and seeded recommendations
were served, but the explicit source-free probe returned `admission_unavailable`.
This pass failed the release check despite successful page rendering.

Web APM showed a sustained increase in HTTP 503 responses after deployment. The
fixed pre-release window (22:22:22–22:37:22) contained 21 HTTP 503s in 19,764
requests (0.106%). Failures already existed on the same recommendation routes;
the increased frequency after rollout was not treated as healthy baseline noise.
The preceding release's first fifteen minutes contained nine 503s and no 500s.

| Web APM window                    | Requests | HTTP 503 | HTTP 500 | Combined 5xx rate |
| --------------------------------- | -------: | -------: | -------: | ----------------: |
| Before release, 22:22:22–22:37:22 |   19,764 |       21 |        0 |            0.106% |
| New release, 22:59:58–23:14:58    |   17,181 |      331 |       47 |            2.200% |

The post-release window was retrieved at 23:16 after the full interval elapsed.
Counts are request metrics, not raw retained span counts, which can contain
multiple spans or duplicate retention records per request.

## Investigation

- Web logs identify connection, Redis TIME/EVAL deadline and subsequent backoff
  failures. The same failure stages existed before this release. Do not count
  multiple diagnostic log lines as separate failed requests.
- Image optimizer 500s trace to outbound TCP connection timeouts. An inspected
  Mux trace contains `ETIMEDOUT` in `internalConnectMultiple`; its Error Tracking
  issue predates this release. This establishes the mechanism, not the cause of
  the increased frequency on the newly deployed container.
- Event-loop delay increased while the new Web container served traffic.
  Container CPU quota/throttling metrics were unavailable through the current
  Datadog integration. Memory was below its reported 16 GB limit.
- The new recommendation feature was disabled. The new source-free endpoint
  received only the explicit release probes; existing recommendation admission,
  image optimizer configuration and dependency versions were unchanged.
- Primary Admin continued accepting playback evidence. Reconciliation completion
  heartbeats occurred at 22:48:22, 22:53:26, 22:58:30, 23:03:33 and 23:08:37 across
  the Admin and worker hosts. Query both hosts: execution moves between them.
- The secondary `mastra-update-stage` worker failed its workflow startup query.
  The identical error was verified on the preceding release at 21:30:19. The
  primary worker started successfully; these environments must not be conflated.

## Recovery scope

Restore the previous Web source tree and shared Watch experience selection via
a normal PR-to-main deployment. Retain the additive Admin schema/migrations,
consumer APIs, curation artifacts, and original feature work. This is a release
mitigation and comparison point, not a claim that a specific frontend defect has
been identified or fixed. Do not increase Redis deadlines speculatively or publish
the feature while the production observation is unresolved.

The recovery branch's Web source is byte-for-byte `ab801776` before documentation
changes; the shared Watch experience fragment also matches that revision. The
new Admin block fragment and source-free operations remain exported for other
consumers. The unapplied Web homepage block and route can be restored from #2249
after the runtime issue is understood and production checks pass.

## Evidence

- [Feature PR #2249](https://github.com/JesusFilm/forge/pull/2249).
- [Profile failure trace](https://app.datadoghq.com/apm/trace/6aa3372f00000000657a51c8d248c4fd).
- [Image connection timeout trace](https://app.datadoghq.com/apm/trace/6aa33786000000003a0397c82e6db9f5).
- Redacted local browser reports and telemetry snapshots are in
  `/home/nisal/.cache/forge-477-preview/`: `release-production-post.json`,
  `release-production-post-repeat.json`, `release-prod-baseline-telemetry.json`,
  and `release-incident-evidence.json`.

Web APM metrics use `service:forge-web,env:prod,version:<sha>`. Both Railway
environments emit that environment label, so the metric denominator is not a
proven primary-only population. Investigated traces identify the primary Web
host; primary logs are independently filtered to container `6452750698e5`.
Raw log/span searches require `@env`/`@version` where those values are stored as
custom attributes. SQL message matching avoids false absence from token searches
for embedded event names such as reconciliation heartbeats.
