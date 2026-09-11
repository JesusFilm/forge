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

PR #2250 restored the previous Web source tree and shared Watch experience
selection through the normal PR-to-main deployment. It retained the additive Admin schema/migrations,
consumer APIs, curation artifacts, and original feature work. This is a release
mitigation and comparison point, not a claim that a specific frontend defect has
been identified or fixed. Do not increase Redis deadlines speculatively or publish
the feature while the production observation is unresolved.

The recovery branch's Web source is byte-for-byte `ab801776` before documentation
changes; the shared Watch experience fragment also matches that revision. The
new Admin block fragment and source-free operations remain exported for other
consumers. The unapplied Web homepage block and route can be restored from #2249
after the runtime issue is understood and production checks pass.

## Recovery outcome

PR #2250 merged as `fede11da3a8d9534139984b9bd35a264fd346484` at
23:28:32 after 35 passing PR checks. Main CI and CodeQL passed. The primary Web
deployment completed at 23:45:53 on container `df92a1d0f515`. Admin and its worker
did not require redeployment and continued running `b89957a5`.

| Web APM window              | Requests | HTTP 503 | HTTP 500 | Combined 5xx rate |
| --------------------------- | -------: | -------: | -------: | ----------------: |
| Recovery, 23:45:53–00:00:53 |   19,489 |       48 |        5 |            0.272% |

The recovery window ends on 11 September UTC and was retrieved at 00:01:48,
allowing for metric ingestion. Error frequency fell substantially but remained
above the 0.106% pre-release comparison. Among the four existing recommendation
POST routes, recovery had 42 HTTP 503s and 987 HTTP 200s; the baseline had 21 and
963 respectively. Those ratios exclude rejected requests and are descriptive,
not matched viewer cohorts. Overall page traffic alone must not establish API
recovery. Runtime event-loop p95 samples averaged 5.70 ms over the recovery window;
this is the mean of reported p95 samples, not a pooled request percentile.

An additional control interval, 22:47–22:59, covered the old Web with the new Admin
already deployed: 14,072 requests, eight HTTP 503s, no HTTP 500s, and mean event-loop
p95 of 2.10 ms. This supports retaining the backend during the Web mitigation; it
does not identify a frontend code defect or exclude deployment/runtime effects.

Fresh production browser checks at 23:52 and 00:00 passed the homepage, category
section, Chosen Witness playback, profile updates, six existing seeded
recommendations and accepted evidence requests, with no page errors or API 5xxs.
The final check observed 9.37 seconds of actual playback, GA `page_view` receipt
HTTP 204 and Datadog RUM receipt HTTP 202. The initial recovery check at 23:46 used
a seeded-delivery timeout fallback, so the later successful checks do not erase
that cold-start observation. These checks exercise the existing recommendation
flow, not the disabled source-free homepage feature.

Primary reconciliation completion heartbeats continued at 23:49:06, 23:54:09 and
23:59:14. Residual Web admission failures and five fetch errors mean this is a
mitigated rollout, not a clean production sign-off. The release-associated runtime
delay remains unexplained and is tracked in `feat-486`; `feat-488` stays in progress.
The homepage block and Web source-free route remain backed out. The new Admin API,
additive migrations, generated contracts and curated artifacts remain merged;
production pool promotion, homepage authoring and flag activation have not occurred.

Recovery validation included 137 focused Web tests, a production Web build,
Web/shared-client type checks, Web lint, repository formatting and a local browser
check. The original feature worktree and forwarded preview remain intact. The
recovery did not increase admission deadlines or bypass normal deployment controls.

## Evidence

- [Feature PR #2249](https://github.com/JesusFilm/forge/pull/2249).
- [Web recovery PR #2250](https://github.com/JesusFilm/forge/pull/2250).
- [Profile failure trace](https://app.datadoghq.com/apm/trace/6aa3372f00000000657a51c8d248c4fd).
- [Image connection timeout trace](https://app.datadoghq.com/apm/trace/6aa33786000000003a0397c82e6db9f5).
- Redacted local browser reports and telemetry snapshots are in
  `/home/nisal/.cache/forge-477-preview/`: `release-production-post.json`,
  `release-production-post-repeat.json`, `release-prod-baseline-telemetry.json`,
  and `release-incident-evidence.json`.
- Recovery browser results: `release-production-recovery.json`,
  `release-production-recovery-repeat.json` and
  `release-production-recovery-final.json` in the same local evidence directory.

Web APM metrics use `service:forge-web,env:prod,version:<sha>`. Both Railway
environments emit that environment label, so the metric denominator is not a
proven primary-only population. Investigated traces identify the primary Web
host; primary logs are independently filtered to container `6452750698e5`.
Raw log/span searches require `@env`/`@version` where those values are stored as
custom attributes. SQL message matching avoids false absence from token searches
for embedded event names such as reconciliation heartbeats.
