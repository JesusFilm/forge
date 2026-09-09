# Recommendation evidence production gates — 2026-09-09

This is an acceptance record for content-discovery feat-464, not the unrelated
ai-chat ticket. All times below are UTC. Production acceptance remains open.

## Releases and scope

- PR #2217 (`dafa3ab003080aada92d6094f04ec1342762c8b6`) added failure-only
  admission stage/timing diagnostics. It preserved Redis behavior and deadlines.
  Primary Web deployment `6388e36b-cc9b-48fc-8104-8e1f284bace3` succeeded at
  04:42:04; new primary host `b049e8780ceb` served accepted context, claim and
  evidence requests. Secondary host `f516e83f7fc5` also reports this revision.
- PR #2218 (`fb3eb50ad273b5b8efd84dd016e764aff7e139db`) merged at 04:42:49
  after local tests, real browser proof, sequential review and green CI. It
  makes structured playback `BAD_USER_INPUT` terminal. Primary deployment
  `b3916a63-63a1-4846-83c2-25f480085909` succeeded at 05:00:46, serving on
  `ad09faa4f37e`; secondary host is `182e151a5b81`.
- PR #2219 (`7ee7147b31a8b2d06e28cc6bbaaacc9148a944f5`) merged at 05:12:54
  after all CI checks passed. It gives playback-context commands 500 ms, retains
  250 ms connection/other namespaces, and makes render/impression input errors
  terminal. Primary deployment `3d7d9073-79d4-4d2d-a960-dd63cffe606e` succeeded
  at 05:30:52, serving on `08f0af1aa08a`; secondary host is `31ef3f559cb8`.
  Observation began at 05:32 with a planned end of 07:32. It found another
  selection input-classification failure, so it is diagnostic evidence; a fresh
  two-hour window is required after the selection follow-up deploys.
- Normal PR/main deployment only. No direct Railway publish or redeploy was used.
  All injected failures and signed Admin fixtures were local.

Primary Railway environment: `5f41e037-90e4-4674-a3ea-66bbd05fb3b4` in project
`98952497-a4d9-4714-8fe8-0cdbff3147c9`. Do not mix secondary environment
`9e37cf71-dea0-49f7-9f98-be015f7521a8`, which also emits `env:prod`.

Current Admin and worker remain on `c2af7e75cb8b0a0dc57a2ad2d5e7fd8be04331c4`:
primary Admin deployment succeeded 03:11:12 and worker 03:14:13. Primary logs use
Admin host `ffb858261e9b` and worker `04d5aebe150f`. The latest Admin commit status
alone refers to the secondary environment; deployment status history is required
to distinguish them. Primary Web traces link directly to the Admin service.

## Baseline findings

The fixed 02:34–04:15 window on earlier Web revision `d7cefafc` had 26 primary
context `admission_unavailable` logs. Two retained examples lasted approximately
250 ms and 4 ms respectively, consistent with timeout/backoff but insufficient
to identify the failing stage. Node event-loop delay metrics also showed stalls
above the 250 ms admission budget, but their runtime client IDs were not yet
mapped to primary/secondary hosts. These are hypotheses, not a causal diagnosis.

For playback POST requests, the APM `trace.web.request.hits` metric returned:

| HTTP status | Requests |
| ----------- | -------: |
| 200         |    3,780 |
| 401         |        5 |
| 403         |      584 |
| 409         |        1 |
| 503         |       73 |
| Total       |    4,443 |

That is 1.643% 5xx, above the <1% target. There was no production fault injection
by this task. The 73 primary playback failure logs comprise 26 context admission
failures, 33 ambiguous fact timeouts, 13 other fact failures and one ambiguous
claim timeout. Matching these numerators does not prove a primary-only request
denominator: the metric has service/env/version/resource/status and the shared
Datadog-agent host, but no Railway environment or application container dimension.
Both environments served the same Web revision. Do not treat this metric as a
fully scoped primary acceptance result.

Two retained traces, `4899517045392701787` and `4310965155225796154`, show fast
Admin `BAD_USER_INPUT` from `RecordSemanticRecommendationPlayback` becoming Web 503. PR #2218 fixes this misclassification and the browser retry behavior. The
public error does not establish which capability validity condition failed.

Trace `25873891277619499` shows a different failure: Web timed out after about
3.02 seconds, while Admin spent most of that time before starting its playback
resolver. The resolver then took approximately 342 ms and wrote replay metadata.
This confirms an ambiguous acknowledgement; retaining identical-payload retries
is necessary. Auth introspection is a code-level hypothesis for pre-resolver
latency, but the available trace does not contain an Auth span establishing it.

A further trace, `370367448730537963` at 04:46:05, shows the render/impression
operation returning `BAD_USER_INPUT` for an invalid timestamp, again becoming
Web 503. The follow-up repair extends the structured HTTP 400 mapping to that
operation. Its existing browser retry helper already treats 400 as terminal.
The 04:43–04:53 diagnostic-revision playback metric counted 313 HTTP 200, 74 HTTP
403 and 57 HTTP 503 (444 total); 54 of those 503s were non-timeout fact errors and
three were context admission failures. These observations show why both repairs
are needed. The metric environment-scoping limitation still applies.

The 05:01–05:06 primary Web/Admin logged acceptance counts match at 140 fact
batches and six exact replays. There were 19 terminal Web crawler playback
rejections and no logged playback 5xx. Admin recorded six first-attempt and one
second-attempt recoverable transaction-busy observations. The 05:01–05:09
revision-wide request metric contains 268 HTTP 200 and 42 HTTP 403, zero 5xx;
this is an interim eight-minute sample, not the final canary or durable audit.

## Admission mechanism and deployed repair

The diagnostic 04:42:04–04:48 window on primary host `b049e8780ceb` recorded six
Redis-clock deadline rejections, seven EVAL timeouts, two TIME timeouts, two
connection timeouts, one client error and eight backoff rejections. Load events
can duplicate the same failed request and are excluded from this stage summary.
Example trace `7349929889109661150` logged EVAL deadline rejection with 47 ms
EVAL duration and 111 ms remaining budget; TIME had already consumed roughly
139 ms. Other timers fired late (TIME 402 ms for a 250 ms budget), showing
scheduler delay. Shared-client retirement after timeout explains the subsequent
backoff failures; not every client error has been individually attributed.

The conservative Redis-clock fence must remain. A real Redis regression delays
a TIME reply by 160 ms and reproduces the original rejection. Raising playback-context
combined TIME/EVAL to 500 ms passes it; a second test releases
EVAL after caller timeout and proves no admission writes occur. The deployed
context admission budget is 750 ms, leaving 1.25 seconds of browser margin
after three seconds upstream. Admin's complete service remains 1.5 seconds.
Connection and other namespaces retain 250 ms because some browser paths have
tighter deadlines. The three observed context failures correlate to two EVAL
Redis-deadline rejections and one EVAL timeout.
This is a measured budget repair awaiting production acceptance, not a claim
that event-loop stalls or all upstream timeouts have disappeared.

The observation has a residual context failure at 06:08:48.568,
trace `5571421142438653530`: EVAL `redis_deadline`, duration 120 ms, remaining
budget 218 ms (TIME consumed approximately 282 ms of the 500 ms budget).
The request returned 503 after 406 ms, with no upstream mutation in the trace.
This is a retained fail-closed clock rejection under higher latency, not fault
injection, and remains in the production error numerator. Nearby diagnostics
using the unchanged 250 ms budget belong to other admission paths and must not
be counted as playback failures without a matching playback outcome.

At 06:15:33, selection traces `3968472780564022866` and `4286251054126801484`
show structured Admin `BAD_USER_INPUT` in approximately 13 ms becoming Web 503
after 39 and 29 ms. The selection operation had not used the error wrapper.
The follow-up applies terminal HTTP 400 `evidence_request_invalid` to selection,
retaining specific binding HTTP 409, the existing short deadline and trusted-href
fallback. These two selection failures are outside the playback metric resource
and remain included in broader evidence-failure reporting.

A natural claim rejection at 06:15:41, trace `7735611335039890176`, was
classified `invalid_binding`, terminal HTTP 409, by primary Web and Admin.
No retryable-binding signal occurred in its five-minute sample. Server policy
classification alone does not prove the originating browser made no retries;
the local browser/component regressions provide that separate bounded proof.

## Reconciliation and access-dependent evidence

An initial worker-only query appeared to have heartbeat gaps. Re-querying both
verified primary Admin and worker hosts resolves them: 28 consecutive completed
heartbeats from 03:18:16.762 through 05:34:25.192, approximately 302–304 seconds
apart, with no unavailable heartbeat in that window. Both services execute
reconciliation work; a worker-only filter is incomplete. The completion log is
emitted after its durable ledger update succeeds, but does not expose lineage or
replace the authorized current-pointer audit. Recoverable write conflicts and
`transaction_busy retryAttempt=1` were observed; these are not themselves proof
of exhausted P2034 retries.

The owner explicitly restricted Datadog work to available read access and declined
to provide a token. Read access supports observation and monitor searches; it
does not install alert definitions. Searches found no applicable recommendation
monitor. Installation is an unmet gate, not an implied authorization to write.
No authenticated production Admin session or authorized database access is
available for historical/clean durable reconciliation or the fresh current-pointer
audit. Local fixtures do not substitute for those production invariants.

## Acceptance state

- Diagnostic deployment: verified on primary; failure mechanism observed; budget repair locally verified.
- Terminal playback input repair: deployed and locally verified; natural terminal
  input rejection has not yet been observed in the early primary window.
- Targeted admission and render/impression repair: deployed to primary at 05:30:52.
- Selection input follow-up: locally verified; review/CI/deployment pending.
- Two-hour post-fix canary: not yet complete.
- Primary-only complete evidence numerator/denominator: not yet established.
- Installed monitors: unmet under read-only access.
- Historical/clean PostgreSQL and authorized Admin reconciliation: unverified.
- Five-minute reconciliation cadence: observed across both primary execution
  services before the final canary; full canary observation pending.
- Zero ineligible current pointers: unverified.

Keep feat-464, feat-459 and feat-447 in progress. Keep `active-watch-proxy-v1`
comparison-only and fail closed for live ranking. No personalization, experiment,
promotion or learning activation is authorized by this repair.
