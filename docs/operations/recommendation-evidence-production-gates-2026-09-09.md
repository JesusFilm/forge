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
  makes structured playback `BAD_USER_INPUT` terminal. Deployment is pending.
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

## Admission mechanism and proposed repair

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
a TIME reply by 160 ms and reproduces the original rejection. Raising connection
and combined TIME/EVAL budgets to 500 ms each passes it; a second test releases
EVAL after caller timeout and proves no admission writes occur. The proposed
maximum admission budget is one second, leaving one second of browser margin
after three seconds upstream. Admin's complete service remains 1.5 seconds.
This is a measured budget repair awaiting production acceptance, not a claim
that event-loop stalls or all upstream timeouts have disappeared.

## Reconciliation and access-dependent evidence

Primary worker retained completed heartbeat logs at 03:18:16, 03:28:21,
03:43:29, 03:48:32, 03:53:34, 04:03:38, 04:08:41, 04:18:47 and 04:23:49.
The gaps do not establish the required five-minute cadence. Logs are best effort;
missing entries could reflect missing telemetry or delayed runs. Durable workflow
state is needed to resolve that ambiguity. Recoverable write conflicts and
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
- Terminal invalid-input repair: merged and locally verified; rollout pending.
- Two-hour post-fix canary: not yet complete.
- Primary-only complete evidence numerator/denominator: not yet established.
- Installed monitors: unmet under read-only access.
- Historical/clean PostgreSQL and authorized Admin reconciliation: unverified.
- Five-minute reconciliation cadence and zero ineligible current pointers:
  unverified.

Keep feat-464, feat-459 and feat-447 in progress. Keep `active-watch-proxy-v1`
comparison-only and fail closed for live ranking. No personalization, experiment,
promotion or learning activation is authorized by this repair.
