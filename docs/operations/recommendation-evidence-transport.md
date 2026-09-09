# Recommendation evidence transport operations

Scope: feat-464. This release repairs evidence transport and recognized-machine
admission. It does not authorize profile ranking, experiments, learning, or proxy
promotion. Keep `active-watch-proxy-v1` fail-closed.

## Acknowledgement contract

| Boundary                        | Budget                    | Meaning                                          |
| ------------------------------- | ------------------------- | ------------------------------------------------ |
| Evidence Web → Admin            | 3 seconds                 | Claim, context and initial/fact evidence request |
| Evidence browser → Web          | 5 seconds                 | Includes consuming the acknowledgement body      |
| Episode lock contention         | 1.5 seconds / 64 attempts | Retry admission outside the transaction          |
| Serializable conflicts          | 3 attempts                | Separate from busy-lock retries                  |
| Recommendation complete service | Existing 1.5 seconds      | Unchanged delivery contract                      |

The 3/5-second evidence budgets add headroom around the ticket's measured 1.91-second
successful p95. They do not guarantee every transaction completes within that time.
An upstream timeout does not undo an Admin commit. Replay uses the original
capability, claim nonce, event identifiers, timestamps and payload. Context
issuance has no client idempotency key and is not automatically retried.

A proven `invalid_binding` from a returned or rejected Apollo result becomes Web
HTTP 409 and terminates that capability's fact retries. A stale linked claim can
fall back once to standalone context. Authentication and recognized-machine 403
responses stop without that fallback. Recognized crawlers and prefetch/prerender
requests are refused before human evidence mutations. Missing or unrecognized
user agents are not proof of humanity.

The database retains Serializable isolation and uses the same episode advisory
lock namespace. Busy lock acquisition rolls back immediately; retry starts with
a new snapshot. Canonical duplicate claims return the already committed capability
and original signing key. Immutable receipts and payload conflicts remain authoritative.

## Operational observations and durable evidence

Web, Admin and the Admin worker emit transport observations to the existing
Railway/Datadog log pipeline. Datadog supplies the operational dashboard and
monitors. PostgreSQL remains the authority for claims, facts, receipts, outcomes
and profile decisions, viewed through the authorized Admin Recommendations area.

The optional Redis evidence collector and its extra Admin panel have been removed.
They duplicated these operational logs and did not contribute to recommendation
decisions or durable analytics. `RECOMMENDATION_EVIDENCE_REDIS_URL` is no longer
read; remove that obsolete variable from service configuration during normal
maintenance. Previously written counter keys expire naturally within 48 hours.
The general Redis configuration still serves cache and admission functions.

Logs are best-effort observations, not a durable evidence ledger, complete HTTP
denominator, or recovery queue. A missing log is unknown, never a healthy zero.
Use the existing authorized receipt, playback and profile audits for correctness.

Fields are allowlisted at runtime: action, outcome, normalized reason, timeout
stage, retry disposition, recognized-machine disposition, HTTP status and bounded
transaction retry attempt. Browser retry attempt is unknown unless independently
observed; server retry disposition is a policy classification. No raw request,
error, user agent, capability, profile/session/episode/event identifier, history or
vector is admitted. The underlying immutable receipt and authorized profile audit
remain the source for correctness.

## Logs, dashboard and monitors

Plain `key=value` logs follow the repository's Railway-compatible format:

```text
event=recommendation.evidence source=web action=claim outcome=rejected reason=invalid_binding timeoutStage=none retryDisposition=terminal crawler=not_recognized httpStatus=409
event=recommendation.reconciliation.heartbeat outcome=completed
```

The scheduler heartbeat is emitted only after its durable ledger update succeeds.
`outcome=unavailable` is a substantive batch failure; expected workflow step/wait
suspension is not.
Query both verified primary Admin and worker hosts: either service can execute
the scheduled work, so a worker-only query can create apparent cadence gaps.
Compare actual completion intervals: the scheduler waits five minutes after
batch work, so a heartbeat can cross a fixed five-minute query boundary. A
completed heartbeat does not expose internal `classificationsFailed`,
`dispatchFailures` or `attemptsExhausted` counts; inspect the authorized durable
batch result before asserting they are zero.

Definitions live in `infra/datadog-monitors/recommendation-evidence/`:
six monitor payloads and `dashboard.json`. The nested definitions are deliberately
not installed by the older fleet-ceiling `create.sh`. Before installing through the
Datadog Monitor/Dashboard APIs, validate payloads against the API, set an approved
notification destination, and check for existing matching names to avoid duplicates.
Installation/activation is a separate operational step; committed JSON is not an
installed monitor. If the retired collector-unavailable monitor or dashboard
widget was installed, remove that obsolete alert/widget; retain the transport,
crawler and reconciliation monitors.

Queries use quoted fixed substrings, matching the existing repo log monitor
convention. They do not assume JSON parsing or custom facets. Verify a known local
or staging event reaches the expected production log pipeline before relying on
alerts. The sustained-5xx count alert catches bursts; it does not substitute for
the canary's under-1% error-rate criterion. Binding amplification monitors detect
a binding rejection incorrectly classified retryable; browser retry prevention is
also verified by tests and actual request/receipt reconciliation.

## Admission failure diagnosis

`admission_unavailable` is a public fail-closed response, not a root-cause label.
Failure-only `event=recommendation.admission` logs distinguish configuration,
connection, retry backoff, loading, Redis TIME and Lua EVAL. `reason=timeout`
means the local timer rejected; `budget_exhausted` means the clock read consumed
the command budget; `redis_deadline` means Lua refused the Redis-clock deadline.
`client_error`, `invalid_clock` and `invalid_result` remain distinct. Correlate
the diagnostic with the existing request trace and evidence outcome.

`durationMs` is clamped to 0–60,000 and `budgetMs` to 0–500. Playback-context
TIME/EVAL commands share 500 ms; connection and other admission namespaces retain
250 ms. EVAL receives only the budget remaining after TIME. The conservative
Redis-clock deadline prevents admission writes after caller timeout. A duration above its budget can indicate
delayed timer processing; it does not independently prove the source of latency.
Connection failures may be followed by immediate backoff refusals. Load records
can accompany connection/configuration/backoff diagnostics; do not sum diagnostic
records as failed requests. These logs contain no Redis error text, URL, keys,
headers, identity or capability. The playback-context budget repair preserves
fail-closed admission, rate limits and retry backoff; see the
[production acceptance record](recommendation-evidence-production-gates-2026-09-09.md)
for the measured failure mechanism and remaining gates.

## Historical window audit

Preserve the original fixed window:
2026-09-07 23:20:00 through 2026-09-08 01:05:00 UTC.
Use the resource filters in the
[feat-464 ticket](../roadmap/content-discovery/feat-464-recommendation-evidence-transport-crawler-integrity.md).

The current episode schema stores discovery provenance, not trusted user-agent
classification. Browser-supplied discovery data and matching timestamps cannot
prove a historical episode came from a crawler. Aggregate APM counts cannot be
joined to arbitrary episode rows.

Record historical attribution as unknown unless retained trusted traces establish
an exact affected root. Only then use the existing superseding eligibility and
reconciliation workflow; preserve immutable original facts. Do not delete,
relabel by time range, or promote ambiguous evidence. If no trusted linkage remains,
publish that bounded uncertainty and use clean post-fix evidence for release decisions.

## Release and canary gate

Deploy only through the normal PR-to-main path. Do not run direct Railway deploys,
change live ranking pointers, or manufacture production evidence as part of local
verification. After deployment, run the ticket's minimum two-hour canary:

1. Record deployed SHA, fixed UTC start/end, complete request counts and explicit
   exclusions. Calculate playback 5xx numerator / denominator, excluding only
   documented deliberate fault injection; the result must be below 1%.
2. Reconcile valid claim/fact acknowledgements with immutable receipts and facts.
   Prove lost-ack replay does not duplicate facts or mutate original payloads.
3. Verify every observed invalid binding receives the definitive response without
   browser retry amplification. Verify zero receipt P2002 collisions and exhausted
   playback P2034 retries.
4. Verify no recognized crawler successfully creates human-eligible evidence.
   Low traffic is insufficient evidence; use only an explicitly authorized safe
   canary, preserving auth and admission.
5. Verify five-minute reconciliation cadence with no substantive batch failures.
   Run the existing authorized current-pointer audit after convergence and require
   zero current generations with ineligible lineage.
6. Reconcile Watch playback, finalization and the matching authorized Admin view.
   Prove navigation/playback availability during telemetry degradation.

Retain feat-464 and feat-459 in progress until these production gates pass.
Feat-447 remains blocked. Local fixture tests, empty databases, synthetic vectors,
and screenshots cannot satisfy the production audit or production-vector latency
requirements.

Rollback follows the normal deployment path. If evidence admission must be stopped,
use the existing approved collection control; preserve stored evidence and semantic
delivery. Do not repair a transport incident by loosening privacy, integrity,
idempotency, or live-ranking policy.

Forge's Railway log intake currently exposes the production environment in
`@env`, while some Datadog sources expose the `env` tag. Monitor queries accept
`(env:prod OR @env:prod)`. Confirm both service and environment against actual
logs before interpreting an empty monitor result; empty results are not a healthy
traffic window.

Admin observations can be emitted by both `forge-admin` and
`forge-admin-worker`. Reconciliation and background finalization normally run
in the worker; include both service tags in Admin evidence monitors.

### Definitive playback input rejection

Admin playback `BAD_USER_INPUT` is a definitive rejection, including invalid
episode capabilities. Web maps the structured code to private HTTP 400
`playback_request_invalid`; the recorder drops the rejected episode without
replaying facts. The more specific `invalid_binding` code retains HTTP 409
`playback_binding_invalid`. Never infer either from human-readable error text.
Unrecognized response bodies and transport failures retain bounded retries.
Already-loaded older browser bundles may retry until their existing limit or a
refresh. A 400 must not be counted as an upstream availability failure.

### Admission latency budget

Production stage diagnostics identified TIME reply delay, Redis deadline
rejection, command/connection timeout and subsequent backoff. Playback-context
combined TIME/EVAL has a 500 ms ceiling; connection and other namespaces retain
250 ms. Context admission reserves 750 ms total, leaving 1.25 seconds of margin
after the separate three-second evidence
upstream budget within the browser's five-second deadline. The Admin complete
recommendation service budget remains 1.5 seconds. Event-loop stalls can delay a
JavaScript timer; Lua still rejects expired work before any admission mutation.
Never replace that Redis-clock fence with application wall-clock time or extend
a queued command's deadline merely because its caller has already timed out.

Render/impression evidence uses the same structured input-error mapping, with
HTTP 400 `evidence_request_invalid`. Its existing JSON retry helper drops 400
without retry. Timestamp validation remains strict; do not repair a viewer's
invalid timestamp by accepting it as human-eligible evidence.
