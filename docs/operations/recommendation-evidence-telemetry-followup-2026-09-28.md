# Recommendation evidence telemetry follow-up — September 28, 2026

This bounded, read-only continuation of [feat-545](../roadmap/content-discovery/feat-545-recommendation-monitoring-and-telemetry-closeout.md) rechecks specific gaps in the [September 23 acceptance record](recommendation-evidence-acceptance-2026-09-23.md). Queries completed before September 27 21:25:12 UTC (September 28 in New Zealand); exact completion times were not captured. No production setting, request, database row, monitor or dashboard was changed. The September 23 release was `37e10b622bd66e55647cf561c3896b2d4fbb4dce` in production; later RUM observations below are a separate population and were not used to repair its accounting.

The [sanitized query aggregate](../validation/evidence-acceptance-20260928/feat-545-bounded-recheck.json) records the exact requested windows, filters, units, counts and query limitations without private event, view or session identifiers.

## September 23 fixed window

Window: `2026-09-23T04:30:00Z` inclusive to `06:30:00Z` exclusive. The source identities, exact primary host guards and complete Railway slices are retained in the [sanitized collection](../validation/evidence-acceptance-20260923/README.md). I repeated three Datadog indexed-log `COUNT(*)` queries with concrete event text, service filters and this fixed interval. This recheck had no explicit environment, version or primary-host filter:

| Indexed event                                                             | Railway structured outcomes | Indexed Datadog recheck | Difference |
| ------------------------------------------------------------------------- | --------------------------: | ----------------------: | ---------: |
| Web `source=web action=facts outcome=accepted`                            |               3,521 batches |            3,513 events |          8 |
| Admin `source=admin action=facts outcome=accepted`                        |               3,521 batches |            3,516 events |          5 |
| Web `source=web action=playback outcome=rejected reason=crawler_rejected` |              351 rejections |              350 events |          1 |

The counts agree numerically with the stronger primary-host capture, but this recheck alone does not re-establish population identity. Neither query proves which individual events are absent or why. A fact batch is not a fact event or an HTTP request. The [durable snapshot](../validation/evidence-acceptance-20260923/durable-final.json) and the separately bounded primary HTTP denominator retain their original credit; these missing indexed records are not evidence of lost durable writes.

Bounded RUM resource count queries scoped to `service:forge-web`, playback API resource URL and the same fixed interval still return **one HTTP 503**, **two HTTP 204** and **28 status-zero** observations. The first three still have no trusted join to a primary origin request; the primary playback POST population had zero 5xx and no 204 group. The 28 status-zero browser transport observations remain their own population, not HTTP zero responses. The [initial-evidence one-envelope discrepancy](recommendation-evidence-acceptance-2026-09-23.md#http-application-outcomes-and-durable-units) also remains unexplained: 1,472 Web successes versus 1,436 primary 200s plus 37 primary 499s. A new aggregate count cannot identify that one request.

## Later natural terminal observations

A separate service-scoped Datadog RUM resource query for playback HTTP 409 from September 24 00:00 UTC through the September 27 query time returned **ten retained resources**; all returned records reported `www.jesusfilm.org` and POST. The query had no explicit environment, revision, host or method filter. A within-view playback-resource read for each found two views with later HTTP-200 playback resources within roughly two minutes: September 25 19:50 UTC (16 later 200 resources) and September 26 16:42 UTC (19 later 200 resources). These are browser-reported resource events, not unique episodes or complete request attempts. Neither selected view has a second retained 409 resource. The search did not establish the exact server revision of each later resource or an exact primary-request/episode join. Subsequent 200s may belong to new activity; their presence alone cannot prove that the rejected episode stopped retrying. Absence of another sampled 409 cannot prove zero amplification.

The September 23 two primary 409s still have no retained RUM resource. The September 22 bounded production non-retry observation and the local terminal browser control retain their recorded credit. The ten later resources add natural response coverage, but do not close the requirement to verify every observed terminal response with continued activity and no retry amplification.

## Disposition and next evidence

All five retained source/browser discrepancy classes remain **open**: indexed fact-batch gaps (Web and Admin), indexed crawler rejection, initial-evidence envelope, RUM 503/204 versus primary requests, and terminal browser retry coverage. No owner-accepted limitation was recorded here. Keep feat-545 `in-progress` and its blocks on feat-372, feat-381 and feat-447. Datadog installation remains separately deferred by the owner in [PR #2410](https://github.com/JesusFilm/forge/pull/2410); prepared definitions are not installed monitoring.

Closure needs retained request-level linkage for the historical cases, or an explicit owner decision accepting each bounded limitation. For terminal responses, a privacy-safe exact browser attempt and episode correlation with primary requests, plus observed subsequent activity, would distinguish a new episode from retry amplification. A new window can validate current behavior but cannot silently prove the missing September 23 joins. No instrumentation change is justified by this read-only recheck alone.
