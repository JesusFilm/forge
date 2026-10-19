# Watch investigation takeover — October 20, 2026

## Decision

Tatai owns the ongoing investigation (`feat-750`, formerly `feat-745`). The evidence supports
main-thread saturation and request queueing. Host contention, increased work
per request, and request/regeneration mix remain possible contributors. Neither
investigation proves a triggering code regression or progressive degradation
after every deployment. PR #2815 is useful attribution instrumentation.

The archived Codex chat **Diagnose Watch performance reports** independently
captured substantial React Flight serialization work and applied an authorized
second Web replica. PR #2816 records that setting. Its report and follow-up
`feat-747` are also included in that PR; they must not be replaced with another
speculative repair. The October 19 report's “none applied” statements describe
its observation cutoff, rather than current production state.

## Fresh production observations

Read-only checks at **10:44–10:45 NZDT on October 20** (21:44–21:45 UTC on
October 19):

- Production Web configuration has two replicas in `us-west2`, no staged
  changes, and the same successful deployment
  `772be46d-0d78-4faa-aa5e-43b8d5e010d2`, commit
  `3003c52046544d83b59f4acbea287ac04504dcf6`. Subsequent skipped deployments
  are not serving releases. This checks configured count, not a fresh census
  of online instances.
- Four sequential public document GETs all returned HTTP 200:

| Route                 |    TTFB |   Total |     Bytes | Next cache  |
| --------------------- | ------: | ------: | --------: | ----------- |
| `/watch`              | 0.545 s | 0.582 s |   906,634 | HIT         |
| `/watch/jesus.html`   | 0.407 s | 0.853 s |   931,274 | HIT         |
| `/watch/languages`    | 0.306 s | 0.386 s | 2,841,887 | HIT         |
| `/watch/spanish.html` | 0.236 s | 0.242 s |    36,184 | Not present |

The first three responses had `cf-cache-status: DYNAMIC`. Home and Jesus
retained `s-maxage=60`; language index retained `s-maxage=3600`. Spanish had
private/no-store headers. These checks do not verify playback, recommendation
delivery, or receipt of browser analytics.

A 501-row recent Railway HTTP sample spanned approximately 17 seconds:

| Class               | Successful HTTP 200 count |    p50 |      p95 |      Max |
| ------------------- | ------------------------: | -----: | -------: | -------: |
| Home `/watch`       |                         4 | 598 ms |   744 ms |   744 ms |
| Other Watch content |                       331 | 256 ms | 1,771 ms | 2,854 ms |
| Assets (`/_next/`)  |                        40 | 225 ms |   866 ms | 1,140 ms |
| API                 |                        53 |  72 ms |   408 ms |   874 ms |

Quantiles select the sorted element at `floor(n * q)`. The sample includes one
API 499, no 5xx, and no successful response over 20 seconds. Its content class
includes Watch redirects and non-200 responses in the population, but those
are excluded from timing quantiles. It is a completion-selected short sample,
not an unbiased hour or a per-replica recovery measurement. The connector does
not expose replica identity or upstream-only duration in these rows.

The trailing-hour HTTP summary included 121,795 total requests and 12 5xx
responses across all paths. Homepage HTTP 200 five-minute bucket p95s after
21:15 UTC ranged from 647 to 2,854 ms (partial final bucket included). Some
exceed the incident report's provisional 1.5-second threshold. The historical
investigation also found inconsistencies in overlapping metric summaries;
these bucket values are supporting evidence, not acceptance proof.

**Current conclusion:** scaling is associated with a substantial improvement
under unmatched traffic. Sustained recovery is still unverified. No production
setting, deployment, cache, flag, or replica count was changed by this takeover.

## PR review and repair

Pinned review: PR #2815 at `40b7ec1b9b6172acde7d13a103cf30f5eacea5cb`.
Separate Standards and Spec reviews found:

- Standards: no actionable findings.
- Spec: one P2. Scheduler metric emission and saturation logging were unguarded
  inside the interval callback. A hook exception escaped the timer and could
  terminate Web, violating the observational-telemetry guarantee.

The follow-up guards each metric and the logger independently. A failed metric
does not skip the other metrics or saturation logging, and later samples still
use the preceding snapshot. Two injected-failure regression cases failed on
the reviewed implementation, then passed with the fix. The observability suite
passes **45/45**. This repairs a telemetry failure path, not the production
latency root cause. Existing CI at the reviewed head was green; the follow-up
requires fresh CI before merge.

## Ordered next steps and falsifiable hypotheses

1. Preserve two production replicas through PR #2816. Release the guarded
   attribution patch through PR #2815 and the normal PR-to-main path. Confirm
   the deployed commit, both online replicas, `replica_id`/`deployment_id`,
   runtime identity, cache spans, and sample-interval telemetry. Do not mix
   process-wide series from two replicas or overlapping deployments.
2. Re-run the October 19 report's acceptance protocol for a complete 60-minute
   post-change window, with a same-hour unaffected-day baseline. Use complete
   HTTP logs split by replica/route, count 499 and >20-second requests, retain
   cache-state probes, and verify both regions' keyword/playback/redirect
   checks. Today's probes and short sample do not satisfy that protocol.
3. Rank and discriminate the remaining causes before tuning:
   - **Application work / regeneration mix:** if this dominates, slow periods
     should coincide with costly Flight/cache serialization or frequent cold
     renders while scheduler run-queue wait is low. Compare identical content,
     warm/cold routes, traffic rate, cache state and instrumentation between
     `156666c296966c58e089619f6423c114223fd302` and `3003c520…` locally in
     production mode; measure absolute CPU work per completed route, payload
     bytes, regeneration rate and warm-page latency under concurrent cold routes.
   - **Host contention:** if this dominates, excess delay should track per-replica
     run-queue wait and low CPU execution despite runnable demand, across cache
     and non-cache requests. A restart or fast result after scaling cannot by
     itself prove placement. Capture both replicas in the same time window.
   - **Cache/dependency delay:** if this dominates, slow kept HIT traces should
     spend the excess within cache reads or outbound calls. Split JSON codec
     elapsed time from the remainder; that remainder includes synchronous work
     and scheduling, so it cannot be labeled pure Redis/network waiting.
4. Only change effective cache lifetime after measuring regeneration's share
   and checking webhook coverage and freshness requirements. Preserve the
   process-local route/SEO manifest TTL, shared Redis behavior and fallback
   guarantees. Keep player, recommendation, GA and Datadog behavior intact.
5. Keep image-optimizer egress timeouts and missing LaunchDarkly flag definitions
   as separate issues unless evidence connects them to cached HTML stalls.
   `feat-747` in PR #2816 remains the measured serialization repair follow-up.

## Durable lesson

Telemetry introduced during an outage needs failure containment in every
asynchronous callback. Startup error handling cannot catch an exception raised
later by an interval. Inject emitter and logger failures independently, assert
remaining signals still run, and assert the next interval continues.

## Sources and reproducibility

- [Incident and evidence at reviewed commit](https://github.com/JesusFilm/forge/blob/40b7ec1b9b6172acde7d13a103cf30f5eacea5cb/docs/reports/2026-10-19-watch-production-latency-incident.md).
- [Attribution PR #2815](https://github.com/JesusFilm/forge/pull/2815).
- [Replica mitigation and independent profile PR #2816](https://github.com/JesusFilm/forge/pull/2816).
- Railway project `98952497-a4d9-4714-8fe8-0cdbff3147c9`, production environment
  `5f41e037-90e4-4674-a3ea-66bbd05fb3b4`, Web service
  `23b82451-0da1-4edc-bcde-096a9fd2a687`.
- Connector reads: `get_service_config`, `list_deployments(limit=3)`,
  `get_logs(types=[http], limit=500)`, `http_requests(hoursBack=1,
maxDataPoints=12)`, `http_response_time(hoursBack=1, maxDataPoints=12,
path=/watch, statusCode=200)` with explicit IDs above. The HTTP connector
  returned 501 rows despite the requested limit; no raw client fields retained.
- Public probes: `curl -sS --max-time 25 -o /dev/null -w '%{json}' URL`, with
  selected cache headers read separately. Retain only status, timing, byte
  count, route, cache state and request ID; discard client/network identifiers.
- Regression: `pnpm exec vitest run src/observability/` in `apps/web`.
