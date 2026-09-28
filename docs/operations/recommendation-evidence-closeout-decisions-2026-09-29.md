# Recommendation telemetry closeout decisions — September 29, 2026

Feat-545 remains **in progress**. This record completes a bounded review of the
retained September 23 and September 28 evidence and prepares owner decisions;
**none of the proposed limitations below has been accepted**. The September 24
scope transfer and Datadog deferral did not accept these coverage gaps. Merging
this documentation does not accept a limitation or satisfy feature acceptance.

## Scope and method

Review base: `1c3a3761d0524b25d67427675228214814b84185`. Historical production
release: `37e10b622bd66e55647cf561c3896b2d4fbb4dce`; historical environment:
production, as pinned by the [September 23 collection](../validation/evidence-acceptance-20260923/README.md).
The fixed window is `2026-09-23T04:30:00Z` inclusive through
`2026-09-23T06:30:00Z` exclusive. This is a repository-artifact review on
September 29, not a fresh production observation or deployment verification.

All unresolved items were enumerated before considering additional reads. The
review inspected the [September 23 acceptance record](recommendation-evidence-acceptance-2026-09-23.md),
its sanitized source artifacts, the [September 28 follow-up](recommendation-evidence-telemetry-followup-2026-09-28.md)
and [query aggregate](../validation/evidence-acceptance-20260928/feat-545-bounded-recheck.json),
and the [batch review](recommendation-batch-review-2026-09-28.md). No production
queries or writes were performed in this continuation. The follow-up already
repeated the historical aggregate queries; repeating those counts cannot supply
the missing membership or joins.

`http-final.json` retains a digest of the whole sorted request-ID set, counts
and slice coverage, rather than request members. Railway `evidence` arrays and
Datadog `web`/`admin` arrays retain outcome groups and counts. The digest cannot
be inverted into missing request identities. None of these exported artifacts
contains a cross-source attempt/episode join. This establishes non-recoverability
**from the reviewed artifacts**, not expiry or absence of every upstream record.
No provider retention claim is made.

## Recoverable accounting and its limits

| Retained comparison                        | Arithmetic                                                                                                                      | What it establishes                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web accepted fact-batch observations       | Railway 3,521 − indexed 3,513 = 8                                                                                               | Net count deficit; unmatched membership/cardinality and indexing cause remain unknown                                                                      |
| Admin accepted fact-batch observations     | Railway 3,521 − indexed 3,516 = 5                                                                                               | Separate net count deficit; unmatched membership/cardinality and overlap with Web are unknown                                                              |
| Web recognized-crawler playback rejections | Railway 351 − indexed 350 = 1                                                                                                   | Net rejection-observation deficit; unmatched membership/cardinality and cause remain unknown                                                               |
| Initial evidence                           | Primary 1,436 HTTP 200 + 37 HTTP 499 = 1,473; Web accepted 1,472; committed render 1,254 + impression 218 = 1,472               | Net difference of one in the primary success/closure comparison; exact unmatched membership/cardinality and application/durable disposition remain unknown |
| Playback success envelopes                 | 3,521 accepted batches + 8 all-replay batches + 256 claims + 279 contexts = 4,064; primary 4,054 HTTP 200 + 10 HTTP 499 = 4,064 | Numerical aggregate agreement, without identifying which clients received acknowledgements                                                                 |
| Retained browser resource partition        | 1,871 status 200 + 30 status 403 + 28 status zero + 2 status 204 + 1 status 400 + 1 status 503 = 1,933                          | Complete partition of this sampled browser population; no complete origin denominator                                                                      |

Sources: [Web outcome groups](../validation/evidence-acceptance-20260923/logs-web-final.json),
[Admin outcome groups](../validation/evidence-acceptance-20260923/logs-admin-final.json),
[indexed outcome groups](../validation/evidence-acceptance-20260923/datadog-final.json),
[primary HTTP groups](../validation/evidence-acceptance-20260923/http-final.json),
[committed audits](../validation/evidence-acceptance-20260923/delivery-durable-final.json),
and [browser resources](../validation/evidence-acceptance-20260923/rum-final.json).
The original browser artifact labels its grouped values `requests`; they are
RUM resource observations here. The September 28 indexed recheck lacks explicit
environment, revision and primary-host filters. Its numerically equal counts
do not re-establish the September 23 primary-host population.

For D1–D4, aggregate subtraction proves only a **net count discrepancy**.
Unmatched membership and cardinality are unknown; compensating discrepancies
cannot be ruled out without a trusted membership comparison. Equal counts also
do not prove membership equality.

Durable fact events, replay receipts, fact batches, application envelopes,
primary requests and sampled browser resources remain distinct units. The
separately scoped durable receipt-time and episode-cohort populations, and the
clean final pointer audit, retain their original credit. These do not reconstruct
missing source observations or browser receipts.
HTTP 499 does not prove acknowledgement, rollback or lack of a committed write.

## Owner decisions, one per gap

Decision owner for every row: **nisal**. Decision state for every row:
**pending; no limitation accepted**. The proposed limitations apply only to
the named historical population or retained later sample. They do not authorize
activation or excuse a subsequently demonstrated runtime defect.

| ID / missing evidence                                                                                    | Operational consequence                                                                                                                                 | Proposed bounded limitation for owner consideration                                                                                                                                                            | Evidence that would resolve the gap                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — Net Web accepted fact-batch count deficit of eight, without retained membership                     | Indexed and Railway counts differ; exact unmatched membership/cardinality and compensating discrepancies are unknown; durable loss is unproven          | Accept an unexplained net count deficit of eight for this fixed window, with unmatched membership/cardinality and cause unknown; retain separate durable credit without claiming exactly eight omitted records | Trusted exact-primary-host Railway/indexed membership reconciliation explaining the net deficit, including any compensating discrepancies and their dispositions                                                                  |
| D2 — Net Admin accepted fact-batch count deficit of five, without retained membership                    | Exact unmatched membership/cardinality, compensating discrepancies, overlap with D1 and cause are unknown                                               | Accept an unexplained net count deficit of five independently of D1, with unmatched membership/cardinality unknown; do not sum differences into lost batches or facts                                          | Trusted exact-primary-host Admin/indexed membership reconciliation explaining the net deficit, including any compensating discrepancies and their dispositions                                                                    |
| D3 — Net indexed crawler playback rejection count deficit of one                                         | Exact unmatched rejection membership/cardinality and compensating discrepancies are unknown; no inference of accepted crawler evidence follows          | Accept an unexplained net rejection count deficit of one, with unmatched membership/cardinality unknown; preserve only the bounded zero logged recognized-crawler successes claim                              | Trusted Railway/indexed rejection membership reconciliation explaining the net deficit and any compensating discrepancies                                                                                                         |
| D4 — Net initial-evidence primary/application count difference of one in the 200/499 comparison          | Exact unmatched membership/cardinality and compensating discrepancies are unknown; no individual request commit, abort or acknowledgement is identified | Accept the unexplained net difference of one with unmatched membership/cardinality and disposition unknown; retain the 1,472 Web-success/committed-audit agreement without classifying an exact excess request | Trusted primary/application/committed-audit membership reconciliation explaining the net difference, all unmatched dispositions and any compensating discrepancies                                                                |
| D5 — One browser 503 lacks trusted primary request and durable/recovery joins                            | Origin zero-5xx evidence cannot explain this browser failure or prove its recovery                                                                      | Accept an unexplained browser resource failure at 04:54:50.312 UTC, duration 3,160.7 ms, browser release `37e10b622`; retain it beside the primary 0/4,716 POST gate without assigning edge/Redis cause        | Exact browser attempt joined to primary request/response, application/durable disposition and trusted subsequent activity                                                                                                         |
| D6 — Two browser 204 resources lack a matching primary POST status group and trusted request joins       | Cannot explain these statuses, their methods/attempts or evidence disposition from aggregate counts                                                     | Accept two unexplained browser 204 observations in this sample; do not classify them as origin POST successes, crawler rejections or lost facts                                                                | Both retained browser attempts joined to trusted primary path/method/status and application/durable disposition                                                                                                                   |
| D7 — Twenty-eight status-zero browser resources lack per-attempt transport/durable disposition           | Client transport outcomes cannot be reconciled to origin responses or interpreted as HTTP failures, recovery or no-write outcomes                       | Retain all 28 as unresolved transport observations outside the primary HTTP denominator; accept that this sample cannot establish each attempt's delivery/retry disposition                                    | Trusted browser transport attempt linkage to origin presence/absence, durable disposition and retry/activity observations                                                                                                         |
| D8 — Two historical primary 409 responses lack retained browser resources and exact client disposition   | Matching server counts/policy cannot establish either browser continued playback or stopped rejected-episode retries                                    | Accept residual terminal browser coverage for these two September 23 responses only; preserve earlier/local credit without extrapolation                                                                       | The two historical attempts joined to definitive response bodies/actions, rejected episodes, trusted continued viewer activity and sufficiently complete bounded retry attempts                                                   |
| D9 — Ten later 409 resources lack exact attempts/episodes and trusted continued-activity/non-retry proof | Same-view later 200s cannot distinguish new activity, permitted claim fallback, or unretained replay amplification                                      | Accept residual terminal browser coverage for the retained September 24–27 sample only; do not use it to repair D8 or assert current complete coverage                                                         | Retained natural definitive responses, exact actions/attempts and rejected episodes, trusted continued viewer activity, and sufficiently complete bounded attempts distinguishing fallback/new activity from replay amplification |

**Affected gates for each D1–D9:** feat-545's complete operational/client/durable
reconciliation; D8 and D9 also directly affect the natural terminal-response browser
gate. All unresolved rows preserve feat-545's downstream readiness blocks on
**feat-372, feat-381 and feat-447**. Accepting one row does not close the others.
No new dependency on feat-373 is introduced for feat-505.

For D5, [the retained individual observation](../validation/evidence-acceptance-20260923/rum-interim-discrepancy.json)
supplies a timestamp, host and release, but no trusted join. The inspected view
had no further retained playback resource in 04:53–05:00. That absence cannot
prove recovery or a stopped retry. D6 and D7 retain only grouped observations.

## Natural terminal evidence assessment

Historical Web claim/facts binding rejections, Admin binding rejections and the
primary two HTTP 409 responses agree in count. Both historical responses lack
retained RUM resources. Matching counts and server `retryDisposition=terminal`
express observed outcomes/policy; they do not observe actual client retry attempts.

The later query returned ten 409 resources from September 24 through query
execution before September 27 21:25:12 UTC. Its requested end was in the future;
exact execution time and deployed revisions are absent. Returned resources
reported `www.jesusfilm.org` and POST, but the query had no explicit host,
method, environment or revision filters. Two selected views had 16 and 19 later
HTTP-200 resources within roughly two minutes of September 25 19:50 UTC and
September 26 16:42 UTC respectively. They had no second retained 409 resource.
These are same-view browser activity observations. They do not identify the
rejected episode, prove trusted continued viewer playback, or prove zero retry
amplification; unretained retries and new activity remain possible.

The recorder distinguishes claim and fact disposition. A definitive claim
rejection can permit one standalone context fallback. A fact 409 is definitive
only with the recognized `playback_binding_invalid` body; a malformed or unknown
body retains bounded transport retries. A bare RUM status cannot distinguish
these paths. The [response policy](recommendation-evidence-transport.md) and
`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`
were inspected as context, not as historical browser evidence. No consequential
runtime defect is established by the retained gaps; no instrumentation or runtime
change is proposed.

## Future terminal observability is a separate gate

A future natural sample can establish current terminal handling only for its own
recorded release/window, exact response body/action, complete bounded attempt
coverage, episode correlation and trusted continued viewer activity. It cannot
resolve D8 or D9 retroactively. The retained gaps do not themselves demonstrate
a runtime defect or authorize adding identity-bearing telemetry. Route any
subsequently demonstrated consequential runtime defect through the parent before
changing instrumentation; preserve privacy and bounded transport.

## Bounded next action and durable review rule

For any additional source read, first identify an actually retained join field
or record source unavailable in the sanitized exports. Pin the row's historical
window, environment/revision, exact host/path/method and unit; set a finite query
scope and export only privacy-safe aggregate disposition. A timestamp-only
coincidence or matching count is insufficient. If no such source is identified,
the next action is the owner decision for that row, rather than another broad
audit. A new healthy window may validate current behavior separately; it cannot
repair a missing historical join.

An accepted decision must name D1–D9 individually as applicable, the owner,
decision date, exact scope, residual operational risk and affected readiness
gates. Record the actual decision separately from these proposals. Until all
required rows are resolved by evidence or explicitly accepted, keep feat-545
open and its dependencies unchanged. No decision is inferred from authorization
to investigate or from approval to merge this evidence PR.

The existing accounting learning in
`docs/solutions/logic-errors/recommendation-outcome-accounting-boundaries-20260921.md`
already explains missing-data, population and point-in-time boundaries. This
review applies that rule: preserve the source/unit and ask whether the retained
artifact can discriminate the desired claim before performing another read.

Datadog definitions/runbook remain prepared and deferred. No monitors,
dashboards, credentials or Slack destination were installed or requested.
Storage capacity, retention purge and conversion-pilot monitoring remain with
the independent storage workstream. No flags, live delivery, experiment,
co-watch promotion or staging Auth setting changed.
