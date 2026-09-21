---
title: "Keep recommendation evidence aligned with the behavior it measures"
date: "2026-09-21"
last_updated: "2026-09-21"
category: logic-errors
module: "Watch recommendation operational evidence"
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "HTTP 200 delivery counts cannot distinguish timeout recovery from ordinary recommendations"
  - "Admin reports zero clean hybrid requests despite persisted hybrid execution"
  - "Terminal invalid playback capabilities appear as retryable unknown failures"
root_cause: logic_error
resolution_type: code_fix
tags:
  [
    recommendations,
    observability,
    postgres,
    outcomes,
    token-validation,
    privacy,
  ]
---

# Keep recommendation evidence aligned with the behavior it measures

## Problem

Three accounting defects obscured the remaining Watch reliability work. HTTP
status omitted delivery-envelope semantics, an Admin aggregate queried an invalid
lane instead of actual execution, and playback logs disagreed with the typed
error returned to the caller. Correcting these measurements does not establish
that the remaining Admin selection delay is fixed.

## Symptoms

- A Web response could contain six cards and HTTP 200 while preserving
  `reason=delivery_timeout`. Failed Admin issuance might leave no request row.
- `cleanHybridRequests` returned zero. The audited production window instead
  contained 3,508 unexpired, clean `hybrid_personalized` decisions.
- Two retained facts traces returned `BAD_USER_INPUT` in about nine milliseconds
  while their events reported `failed / unknown / retryable`. This sample did
  not establish why the capabilities were invalid or classify every unknown.

## What did not establish recovery

HTTP successes and persisted request rows describe different populations. A
query over successful issuance cannot count requests that failed before that
write. A short healthy browser window, successful navigation after an aborted
acknowledgment, or empty sampled error results cannot supply the missing evidence.

Likewise, a lane is an assignment dimension. It is insufficient to prove hybrid
execution: legacy challenger decisions have null execution mode, and viewing-mode
personalization shares the current challenger lane. Mocked count results had not
tested whether the SQL predicate could match real constrained rows.

Do not turn the playback observation fix into a broad error catch. A revocation
store outage must still fail access as an infrastructure error, as established
by the [earlier token-boundary regression](../database-issues/prisma-raw-serialization-retry-and-token-error-boundaries-20260916.md).

## Solution

### Observe the final delivery response

`apps/web/src/lib/recommendation-delivery-observability.ts` observes both
`apps/web/src/app/api/recommendations/route.ts` and
`apps/web/src/app/api/recommendations/for-you/route.ts` after final response and
cookie construction. It emits one bounded event, including HTTP errors:

```text
event=recommendation.delivery endpoint=seeded httpStatus=200 result=fallback reason=delivery_timeout itemCount=6 upstreamResult=unavailable
```

Record the actual HTTP status, final result/reason/card count, and upstream result
before contextual recovery. Normalize every string through a closed vocabulary.
Never serialize cards, identifiers, capabilities or request bodies. Use the
existing console path without an awaited network request or database write;
logger exceptions cannot change the response. An oversized final response must
produce a 502 observation, not an earlier successful-envelope observation.

The existing UDP forwarding is not durable. Reconcile indexed events with
primary HTTP metrics for the same route, revision, status and fixed UTC window.
Report any missing coverage before interpreting zero timeout events. Handler
completion still does not prove that the browser received an acknowledgment.

Validate release filters against a known positive event. This production syslog
pipeline exposed environment/version inside `@ddtags`; bare `env:prod` filtering
returned a false zero. The event contract documents a tested exact-release DDSQL
filter. A tool's normalized display of `env` is not proof of an indexed tag.

### Count actual hybrid execution

In `apps/admin/src/services/recommendations/admin-ops/profile-reconciliation.service.ts`:

```sql
-- Previous predicate: the database does not permit this lane.
WHERE decision.lane = 'hybrid'

-- Correct predicate: retain the indexed valid lane and require execution.
WHERE decision.lane = 'profile_challenger'
  AND decision.execution_mode = 'hybrid_personalized'
```

Preserve the existing reason, expiry, inclusive-start/exclusive-end window and
privacy-suppression conditions. A real PostgreSQL fixture in the existing
`admin-ops/detail.db.test.ts` CI entry uses the production PrismaPg adapter and
migration constraints. The assertion returns zero before the correction and
three afterward; legacy, viewing-mode, expired and out-of-window controls remain
excluded. A single bounded production query completed in 2.095 ms. That sample
does not establish a speedup or selection-latency improvement.

### Classify only the proven typed terminal error

In `apps/admin/src/services/recommendations/playback.service.ts`, include
`RecommendationTokenInvalidError` alongside `RecommendationInputError` when
emitting `rejected / invalid_request / terminal`. Keep binding errors distinct
and unknown infrastructure errors retryable. Rethrow the identical error object.
Token validation, actual response mapping, attempt charging and retries stay
unchanged.

Tests assert both the terminal typed error and the unexpected-error control,
including absence of a budget charge or fact transaction after token rejection.

## Why this works

Each signal now describes its own boundary: the constructed HTTP envelope,
executed personalization mode, or existing typed error contract. The corrections
add no new serving policy and do not conceal failures with recovery counts.
Test-first regressions cover the missing distinctions instead of checking only
that a log or aggregate exists.

## Prevention

- Report HTTP failures, semantic timeout envelopes, ordinary coverage fallbacks,
  browser aborts and persisted evidence separately. State the denominator and
  observation coverage for each.
- Distinguish failed retry attempts from exhausted requests by correlating their
  final outcomes. Four release-window `transaction_busy` attempts all recovered
  to HTTP 200. A separate 46.6 ms playback 503 was a fast upstream fetch failure,
  not the selection deadline; deployment overlap alone did not establish cause.
- Test operational SQL with actual migration constraints and both positive and
  plausible-but-wrong rows. Keep privacy suppression tests alongside it.
- Test error observation and transport behavior together. Never infer retries
  actually occurred from a `retryDisposition` label.
- For a complete integrity audit that exceeds a statement guard, use a bounded
  read-only cursor through the unchanged canonical predicate in one snapshot.
  Consume it to exhaustion; partial results are not a passing invariant. The
  [September 21 audit](../../operations/watch-profile-audit-2026-09-21.md) checked
  all 167,029 live pointers with zero ineligible, local settings and explicit
  rollback. Changing cursor execution and JIT together did not prove why the
  earlier aggregate was slow.
- An observed `WalSync` wait is a hypothesis input. Query age at a sample is not
  wait duration; it does not separate pool, lock and application scheduling time.
  Keep the capability budget independently committed and atomically bounded
  while investigating the remaining selection delay.
- Keep a failed reconciliation heartbeat even if the next run succeeds. Release
  monitoring caught real five-second transaction expiry. `LIMIT 100` did not
  bound canonical lineage checks over roughly 167,000 current pointers. Separate
  `EXPLAIN ANALYZE` overhead from direct execution controls, and reject JIT or
  query-shape tweaks that do not reliably clear the existing budget. The
  [execution record](../../operations/watch-ticket-execution-2026-09-21.md)
  retains the unsuccessful controls; that earlier checkpoint did not establish
  a scan correction. The subsequent proven correction is linked below.

## Production closeout refinements

The [September 21 release observation](../../operations/watch-closeout-release-2026-09-21.md)
found an actual collection gap: 927 unique Railway edge requests and matching
application outcome aggregates, but only 924 indexed Datadog events. The three
additional Railway outcomes were served responses, not timeout fallbacks. Never
sum grouped outcomes mentally: derive totals by status and result in a script,
then compare both independent populations. Railway returned exact repeated rows;
retain duplicate/conflict counts and boundary coverage when deduplicating.
Application collectors can timestamp the same event differently, so minute-level
misalignment is not automatically log loss. No identifier is added to the
privacy-bounded event merely to make this audit easier.

Do not designate one collector as universally complete. In the later two-hour
window, all 1,536 delivery outcomes match exactly across Railway, Datadog and
primary HTTP counts, but Railway has six extra initial-evidence success records
and 135 fewer Admin accepted-facts records than Datadog. Datadog's Web/Admin
accepted-facts totals do agree. Validate coverage independently for every stream
and fixed window, and retain unexplained collector differences instead of
selecting the most favorable total.

For browser-to-database lineage, outcome revisions are scoped by
`(episode_id, classifier_version)`. Ordering revisions across classifiers selected
a legacy comparator with null active-playback fields in an early diagnostic.
Select the intended classifier before its latest revision:

```sql
WHERE episode_id = $1
  AND classifier_version = 'active-watch-proxy-v1'
ORDER BY revision DESC
LIMIT 1
```

Correlate the exact episode item and claimed, attribution-eligible selection;
an arbitrary impression or selection with the same request ID is weaker evidence.
Retain private correlation keys only in the canary process and pass them to
read-only SQL as parameters. Report aggregate booleans and counts, not cookies,
capabilities, profiles or vectors. Independently verify later hybrid influence,
withdrawal, reset and completed erasure. A response saying erasure is pending is
not the completed database invariant, and an authorized SQL read does not replace
the permission-checked Admin UI gate.

The subsequent sparse-invalid reconciliation fix and its real PostgreSQL
regression are documented in
[the batch-query learning](../performance-issues/profile-reconciliation-sparse-invalid-scan-20260921.md).
Historical heartbeats place the sampled selection timeouts between reconciliation
batches; do not claim that this proven worker correction resolves their separate
unproven cause.

Separate the renderer's fetch/body/validation lifecycle from the test runner's
network-object lifetime. In new agent-browser controls, Playwright could no
longer retrieve a response body after navigation while the page had already
parsed its fetch clone successfully. That is not a browser acknowledgment
timeout. Retain status, renderer timing, abort timing and exact nonce/target
validation as independent booleans. A User Timing mark at selection start and
body completion also identifies the relevant renderer process/thread; a maximum
native wait from every renderer in the trace can otherwise be attributed to
the wrong frame or interval. No capabilities or private identifiers need to be
retained to make these distinctions.

Review the assertions behind a passing canary label. The initial harness checked
the nonce and the target fields' types, but did not compare both target values
with the selected card. Corrected controls retain the issued card only in memory
and explicitly compare nonce, canonical href and media ID in the renderer.
Report those checks separately from JSON parsing or successful navigation.
Locally intercepted acknowledgment fixtures can isolate browser scheduling,
but their HTTP 200s never enter a production API success denominator.

Likewise, a claimed recommendation selection may intentionally lack an eligible
impression. Count missing or mismatched selection bindings separately from
`attribution_eligible_at IS NULL`; the latter is not automatically corruption.
Use canonical attribution and serving fences to assess whether it can influence
a consumer, rather than promoting it because navigation or claiming succeeded.

## Preserve bounded network causes without inventing retry safety

Repeated normal Admin handovers produced fast playback HTTP 503s with only
`TypeError: fetch failed` in retained traces. The 154/330 ms upstream durations
distinguish these from the 700 ms selection deadline, but the outer exception
cannot distinguish a refused connection, DNS lookup failure or closed socket.
No retained Admin span is not proof that the mutation never reached Admin.

`apps/web/src/lib/recommendation-evidence-response.ts` now reads at most four
objects along the existing error's `cause` chain and emits a finite optional
`networkErrorCode`. The Web/Admin evidence vocabularies remain identical. Keep
the allowlist small, return `unknown` for unrecognized errors and throwing
properties, and never stringify the original object. Do not add addresses,
request URLs, headers, capabilities, arbitrary codes or stack traces to this
operational dimension. Leave normal responses and existing reason/outcome fields
unchanged so deployed alert queries continue to work.

Test both the helper and its real route call path: a native local socket closure
produces `UND_ERR_SOCKET`, an owned closed listener produces `ECONNREFUSED`, and
the adapter preserves the cause while the route still returns the same 503 with
one mutation invocation. Cover cycles, excessive depth, throwing getters and
arbitrary values; verify 2xx/4xx observations omit the field. These tests establish
diagnostic fidelity, not a fix for production transport failures. Measure the
observer plus formatting overhead separately from network and database latency.

Use the eventual natural error code to select a discriminating handover or
connection-lifecycle experiment. Even `UND_ERR_SOCKET` does not establish whether
a mutation committed; do not introduce automatic mutation retries from that
label. Likewise, do not force a production fault merely to demonstrate that an
observation exists. The [startup release record](../../operations/watch-startup-readiness-2026-09-21.md)
retains the two failure traces, deployment timing, local proof and remaining
closure gates. This addition resolves a diagnostic blind spot only.

Verify a deployed diagnostic against the actual route's traced build files and
the running revision, with a pre-release control when available. A source tree
or successful health request alone does not establish which implementation is
serving. Keep that installation evidence separate from a natural error observed
by the collector, and from proving the cause or disposition of a failed mutation.

## Related evidence

- [Delivery event contract and limits](../../operations/watch-delivery-outcome-observation-2026-09-21.md)
- [Profile audit and Admin accounting regressions](../../operations/watch-profile-audit-2026-09-21.md)
- [Sustained production corpus](../../operations/watch-recommendation-corpus-review-2026-09-21.md)
- [Exact transport-diagnostic deployment and outcome reconciliation](../../operations/watch-transport-cause-release-2026-09-21.md)
- [Denominator bias from excluded failures](excluding-failed-observations-from-eval-denominator-flatters-score.md)
- [Web implementation PR #2352](https://github.com/JesusFilm/forge/pull/2352)
- [Admin implementation PR #2353](https://github.com/JesusFilm/forge/pull/2353)
