---
id: "feat-464"
title: "Recommendation evidence transport and crawler integrity"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: ""
duration: 3
depends_on:
  - "feat-369"
blocks:
  - "feat-459"
  - "feat-372"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "analytics"
  - "integrity"
  - "reliability"
  - "observability"
---

## Problem

September 16 follow-up: [feat-509](feat-509-playback-sqlstate-serialization-retry.md)
records a pre-existing raw-query SQLSTATE `40001` gap: it escapes the `P2034`-only
retry classifier and can become terminal Web HTTP 400. The recommendation
release's live verification reproduced it once and found it on older revisions;
this ticket's broader production acceptance remains open.

Latest verification: the [authorized production integrity audit](../../operations/recommendation-evidence-production-integrity-2026-09-10.md)
now proves current-pointer convergence, stored receipt consistency and zero
substantive failures across 23 reconciliation batches. The previous lack of
database access is resolved. The [Railway HTTP audit](../../operations/recommendation-evidence-primary-request-accounting-2026-09-10.md)
also verifies the complete primary-only request gate at 2 / 6,543 playback 5xx
(0.03057%). Required alerts are absent from the visible inventory; production
acceptance remains open pending installation and verification.

The recommendation evidence closeout hotfix shipped the replay-receipt collision fix and reconciliation scheduler recovery, but a fixed production audit window after deployment still showed an unhealthy Web-to-Admin evidence boundary. Between 2026-09-07 23:20 and 2026-09-08 01:05 UTC, `POST /api/recommendations/playback` returned 791 `503` responses, 101 `200` responses, and one `403`. Excluding Applebot still left 502 `503` responses, 84 `200` responses, and one `403`.

The failures are not a recurrence of the resolved replay-receipt collision. Production traces showed 300 claim mutations ending in `invalid_binding`, while Web converted the actual Admin GraphQL error shape into the generic `episode_unavailable` path and returned `503`. The browser treats `503` as retryable, so a definitive binding failure is amplified into repeated traffic. Playback writes also exhausted ten PostgreSQL `P2034` write-conflict retries. At the same time, the 900 ms Web upstream deadline is below observed successful production latency, making a committed or still-running Admin mutation indistinguishable from a retryable transport failure at the browser boundary.

Crawler admission is also contaminating the evidence population. Applebot made 306 playback endpoint requests in the audit window, including 17 successful responses. A traced success reached the real `ClaimSemanticRecommendationEpisode` mutation and wrote a `WorkflowRun`, so a recognized crawler can enter a path intended to represent human playback evidence.

This ticket is the remaining transport, admission, observability, and production-proof work required to close `feat-459`. It does not reopen the replay-receipt fix: no replay-receipt `P2002` collision was observed after that hotfix.

## Production Evidence Snapshot — 2026-09-08

Fixed audit window: 2026-09-07 23:20:00 through 2026-09-08 01:05:00 UTC, after merge commit `8b5d635d4b5dbd1beabf18ea58e65272659f21aa` was deployed.

| Signal                                   | Result                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Web playback endpoint                    | 791 `503`, 101 `200`, 1 `403`                                                                                        |
| Web playback endpoint excluding Applebot | 502 `503`, 84 `200`, 1 `403`                                                                                         |
| Admin episode claims                     | 304 errors, 53 successes; 300 errors were `invalid_binding`, 4 were conflicts                                        |
| Admin playback mutations                 | 62 errors, 227 successes; 52 errors were `invalid_binding`, 10 exhausted `P2034` retries                             |
| Initial evidence mutations               | 6 errors, 146 successes                                                                                              |
| Successful Web playback latency          | p50 858 ms, p95 1.91 s                                                                                               |
| Successful Admin claim latency           | p50 912 ms, p95 1.63 s                                                                                               |
| Successful Admin playback latency        | p50 858 ms, p95 1.91 s                                                                                               |
| Successful initial evidence latency      | p50 1.007 s, p95 1.50 s                                                                                              |
| Applebot playback endpoint traffic       | 306 requests; 17 returned `200`                                                                                      |
| Replay-receipt `P2002` collisions        | zero after the hotfix                                                                                                |
| Reconciliation scheduler                 | active every five minutes; no new substantive scheduler error or `WorkflowNotRegisteredError` in the reviewed window |

Reproduce the snapshot in production Datadog APM with the fixed time range and these resource filters:

- `service:forge-web resource_name:"POST /api/recommendations/playback" operation_name:web.request`
- `service:forge-admin resource_name:graphql.mutation.ClaimSemanticRecommendationEpisode`
- `service:forge-admin resource_name:graphql.mutation.RecordSemanticRecommendationPlayback`
- `service:forge-admin resource_name:graphql.mutation.RecordSemanticRecommendationEvidence`
- `service:forge-admin resource_name:*recommendationProfileReconciliation*`

The APM snapshot cannot prove the `feat-459` zero-current-pointer invariant. That result requires a fresh authorized Admin integrity audit.

## Entry Points — Read These First

1. `docs/roadmap/content-discovery/feat-369-recommendation-playback-episodes-active-playback.md` — playback evidence, capability, idempotency, and fail-open contracts.
2. `docs/roadmap/content-discovery/feat-459-recommendation-profile-eligibility-reconciliation.md` — the blocked production closeout and zero-current-pointer Admin gate.
3. `apps/web/src/lib/recommendations.ts` — Web-to-Admin mutation deadlines and GraphQL error normalization. `claimSemanticRecommendationEpisode` currently has no `invalid_binding` mapping; the playback mapper must be validated against the actual production Apollo result shape.
4. `apps/web/src/app/api/recommendations/playback/route.ts` and `apps/web/src/lib/recommendation-route-response.ts` — claim/fact HTTP response semantics and the current `409` mapping.
5. `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx` — the browser's one-second request deadline and claim/fact retry behavior.
6. `apps/web/src/lib/recommendation-mutation-admission.ts` — admission policy for evidence mutations.
7. `apps/admin/src/services/recommendations/episode.service.ts`, `playback.service.ts`, and `errors.ts` — binding validation, transactional writes, retry exhaustion, and typed domain errors.
8. `apps/admin/src/services/recommendations/admin-ops/` — privacy-safe production evidence and the authorized integrity audit surface.

## Grep These

- `EVIDENCE_UPSTREAM_TIMEOUT_MS|REQUEST_DEADLINE_MS`
- `hasRecommendationGraphqlCode|invalid_binding|playback_binding_invalid`
- `ClaimSemanticRecommendationEpisode|RecordSemanticRecommendationPlayback`
- `P2034|RecommendationPlaybackTransportReplayReceipt`
- `assertRecommendationMutationAdmission|user-agent|Applebot`
- `recommendationProfileReconciliation|currentGenerationId`

## What To Build

- Normalize Admin GraphQL domain errors at one tested Web boundary using every result/error shape the production Apollo client can return. Map `invalid_binding` consistently for episode claims and playback facts so Web returns a definitive `409` response rather than a retryable `503`.
- Make the browser treat definitive claim and fact binding failures as terminal for that capability and stop retry amplification. Preserve fail-open navigation and playback; telemetry failure must never prevent a viewer from watching.
- Replace the mismatched timeout stack with an explicit end-to-end acknowledgement contract based on measured production latency. A browser timeout must not make a committed or still-running mutation look safely retryable unless the retry is durably idempotent. Keep the complete-service recommendation deadline unchanged.
- Eliminate exhausted `P2034` write-conflict failures under realistic concurrent claim and playback replay. Preserve exact-event idempotency, exact-payload conflict detection, bounded attempts, and the shipped replay-receipt collision fix.
- Prevent recognized crawlers and other machine traffic from creating human-eligible recommendation episodes or playback facts. Reject known crawler traffic before the human evidence mutation when possible, and keep any intentionally supported machine disposition explicitly separate and ineligible for CTR, profiles, learning, experiments, and promotion.
- Audit evidence written during the affected production window. Supersede eligibility only where stored provenance proves contamination; do not heuristically relabel or delete ambiguous human evidence. Publish the bounded uncertainty and use clean post-fix evidence for activation decisions.
- Add privacy-safe telemetry for action, HTTP outcome, normalized domain reason, timeout stage, retry attempt/disposition, transaction exhaustion, and crawler admission. Add a dashboard and actionable monitors for sustained playback `5xx`, invalid-binding retry amplification, exhausted database retries, successful crawler evidence, and reconciliation health.

## Operational and Admin Evidence Gate

- In Datadog, show claim, fact, and initial-evidence attempts by outcome and normalized reason without exposing profile, session, episode, capability, or event identifiers.
- In Datadog, show crawler admission outcomes and prove recognized crawler requests cannot create human-eligible episodes or facts.
- In Datadog, show ambiguous-timeout, retry, idempotent replay, payload-conflict, and exhausted-transaction counts so committed evidence can be reconciled with client-visible outcomes.
- Preserve the five-minute reconciliation cadence and show no substantive scheduler error after excluding the workflow runtime's expected step/wait suspension spans.
- Run the `feat-459` authorized current-pointer audit after reconciliation converges and prove zero current generations contain currently ineligible lineage.

The ticket is not complete until operational results in Datadog reconcile with durable evidence in the authorized Admin Recommendations area and a fresh production snapshot. The owner's 2026-09-09 decision removes the duplicate Redis counter store and transport panel; it does not relax the current-pointer audit or production acceptance gates.

## Production Acceptance Gate

After deployment, run a minimum two-hour production canary that proves all of the following:

- Valid playback evidence continues to succeed and playback/navigation remain fail-open when telemetry is unavailable.
- Every observed `invalid_binding` receives the documented definitive Web response and causes no browser retry amplification.
- No replay-receipt `P2002` collision and no exhausted playback `P2034` retry occurs.
- No recognized crawler request successfully creates human-eligible playback evidence.
- Playback evidence `5xx` stays below 1% after excluding deliberate fault-injection traffic; report numerator, denominator, and exclusions.
- The reconciliation scheduler runs on cadence without substantive errors, and the fresh authorized Admin audit returns zero current pointers with ineligible lineage.

If traffic is too low to exercise a criterion, use an authorized production-safe canary and record its trace. Do not weaken authentication, use fake privileged credentials, bypass admission policy, or manufacture production evidence.

## Constraints

- Preserve immutable evidence, superseding eligibility, source attribution, retention, personalization settings, erasure, and privacy-generation contracts.
- Preserve the shipped exact replay-receipt idempotency and payload-conflict behavior; do not turn a collision fix into last-write-wins behavior.
- Do not broaden a crawler heuristic into a claim that arbitrary malicious automation can be detected. The invariant is that recognized or intentionally supported machine traffic is never silently classified as human evidence.
- Do not log raw capabilities, session digests, profile identifiers, event identifiers, histories, vectors, or small-cohort data.
- Do not increase the 1.5-second complete-service recommendation deadline. Any evidence deadline change must have a measured end-to-end budget and explicit retry/idempotency semantics.
- Do not advance mission-action collection, profile-derived ranking, experiments, promotion, or learning until this ticket and the `feat-459` Admin gate are complete.

## Verification

- Unit-test all production Apollo error shapes for claim and fact `invalid_binding`, and assert the exact Web status/body plus terminal browser disposition.
- Test lost acknowledgement after commit, client abort while Admin continues, duplicate identical replay, conflicting replay, timeout at every boundary, and retries straddling a deployment.
- Run real PostgreSQL concurrency tests for simultaneous claim/fact batches and prove no exhausted `P2034`, duplicate receipt, lost fact, or partial acknowledgement.
- Test recognized crawler, ordinary browser, missing user-agent, spoofed origin, and intentionally supported machine admission. Prove machine evidence cannot become human-eligible.
- Reconcile the fixed production window and a clean post-fix window through Web requests, Admin mutations, committed receipts/facts, eligibility, and Admin aggregate evidence.
- Run focused Web and Admin tests, lint, typechecks, real PostgreSQL tests, and a local browser Watch-to-Admin lifecycle proof.
- Run `pnpm --filter roadmap generate:readme` and `pnpm --filter roadmap lint` after updating roadmap metadata.

## Kickoff Prompt

```text
Use compound-engineering:lfg to implement Forge roadmap ticket feat-464, "Recommendation evidence transport and crawler integrity," from docs/roadmap/content-discovery/feat-464-recommendation-evidence-transport-crawler-integrity.md. Work hands-off through implementation, tests, review, commit, push, and an open PR. Preserve the ticket's production evidence snapshot and acceptance gates; do not mark feat-459 or feat-464 complete without a fresh authorized Admin audit and the required production canary.
```

## Implementation progress (2026-09-09)

The implementation branch `codex/feat-464-evidence-transport` normalizes Apollo
binding failures, makes definitive browser failures terminal, bounds PostgreSQL
contention, rejects recognized crawler evidence before mutation, and exposes
privacy-bounded transport logs. The original Redis counter panel was subsequently
removed at the owner's request because it added no recommendation or durable
analytics input; operational visibility uses Datadog, and durable evidence stays
in authorized Admin. See the
[transport runbook](../../operations/recommendation-evidence-transport.md) for
configuration, monitor installation, and post-deployment acceptance.

Local validation covers the full Web and Admin unit suites, typechecks, real
PostgreSQL concurrency and a browser Watch-to-Admin
lifecycle with decoded video and telemetry failure injection. Local fixtures and
an empty local current-pointer audit do not satisfy production acceptance.
A two-hour production observation is recorded below. Historical-window
reconciliation, monitor installation, and the fresh authorized production
current-pointer audit remain outstanding. This ticket remains in progress and feat-459 remains blocked; live profile ranking
remains fail-closed.

## Production-gate continuation (2026-09-09)

PRs #2217 and #2218 deployed admission diagnostics and terminal playback input
handling. PR #2219 deployed the measured playback-context command budget repair
and terminal render/impression input handling. Real Redis tests reproduce delayed
TIME rejection and prove a queued EVAL cannot write after caller timeout. Full
Web checks, the real browser lifecycle, and authorized local Admin finalization
proof passed; detailed results and environment scoping are in
[the production-gate record](../../operations/recommendation-evidence-production-gates-2026-09-09.md).

Production acceptance remains open. The owner restricted Datadog work to read
access, so missing installed monitors remain an unmet gate. Historical/clean
durable reconciliation and the fresh authorized production current-pointer audit
are unavailable with the current access. The observation found selection
`BAD_USER_INPUT` still becoming 503; PR #2220 deployed the same terminal mapping
to selection at 06:59:28 after local browser/component proof and green CI.

The fresh 07:01–09:01 UTC observation is complete and was re-queried after
ingestion settled: revision-wide playback 5xx is **1 / 4,319 (0.02315%)** with
zero injected production traffic or exclusions. Primary Web/Admin logs match
at 3,029 accepted fact batches and 56 all-replay batches. One facts binding
rejection is terminal HTTP 409, with no retryable-binding signal; 1,208 recognized
crawler requests were rejected across evidence actions, with no logged crawler
success, receipt collision or exhausted transaction signal. There are 23 committed
heartbeats across primary Admin and worker, 302.045–309.747 seconds apart.

This does not close the acceptance gate: the metric combines environments and
does not fully reconcile with handler logs; durable receipt/eligibility and
browser retry-amplification reconciliation, internal batch failure counts, installed
monitors and zero ineligible current pointers remain unverified. Keep dependent
feat-459/447 in progress and live profile ranking fail-closed.

## Sustained production review — September 21

The [fixed 64-hour 35-minute corpus review](../../operations/watch-recommendation-corpus-review-2026-09-21.md)
records one playback HTTP 503 among 255,450 primary requests; the denominator
includes rejected traffic and is not a human-only rate. Structured logs contain
174 retryable Admin facts failures with `reason=unknown`, no exhausted-transaction
entry in the returned failure grouping, and 749 completed reconciliation
heartbeats. Stored capability timestamp rejections remain separate from the
repaired server receipt-ordering race.

Required recommendation alerts were not found in the visible title/service-tag
inventory. The complete canonical current-pointer audit exceeded its five-second
read-only guard and was rolled back, so this review supplies no fresh passing
feat-459 audit. Keep both production gates open; do not infer them from aggregate
personalized deliveries, a low HTTP failure rate or a partial database audit.

The [later September 21 audit](../../operations/watch-profile-audit-2026-09-21.md)
completed the full canonical predicate in one read-only snapshot: 167,029 live
current pointers, zero ineligible. This supersedes only the missing fresh audit
evidence above. Required installed alerts remain unmet because available Datadog
access is read-only; transport classifications and browser lifecycle evidence
remain separate. Keep this ticket in progress.

Retained traces also prove two sampled `unknown / retryable` facts observations
were fast terminal GraphQL `BAD_USER_INPUT` responses. A local typed-error
regression reproduces the logger's missing `RecommendationTokenInvalidError`
classification. The fix records those as `rejected / invalid_request / terminal`
and rethrows the same error without changing token validation or Web responses.
The 42 playback/token/GraphQL tests pass, and the complete final Admin suite
passes 7,281 tests. PR #2353 deployed automatically to Admin and its worker as
`6e02dd855af4053d9c9a7b032fe1ece7317cfc33`; natural accepted facts are visible on
that exact revision. This does not classify all 174 historical unknown failures
or establish that the specific invalid-capability branch occurred in the short
release window. [Release evidence and outstanding gates](../../operations/watch-ticket-execution-2026-09-21.md)
remain explicit. Continue using the existing read access; installed alerts stay
unmet without a monitor-writing capability.

The release window adds a separate transport investigation: at September 20
22:48:27 UTC, playback trace `2812671347123689187` returns HTTP 503 in 46.6 ms
after a 42.7 ms upstream `fetch failed`, with `timeoutStage=none`. It overlaps
Admin deployment but does not prove the transport cause or mutation disposition.
Keep the failure in the 1/800 primary playback denominator; investigate routing,
connection and shutdown behavior before proposing a change. Do not substitute
an ambiguous mutation retry. Four separately correlated transaction-busy
attempts recovered to Web HTTP 200; a natural terminal rejection agrees with
`BAD_USER_INPUT`. None is a selection deadline or delivery semantic timeout.

The new worker also emitted an unavailable reconciliation heartbeat at 22:52:48
UTC after substantive five-second transaction expiry, followed by a completed
heartbeat at 22:58:17. Feat-459 now records the reproduced expensive discovery
scan and rejected controls. This keeps the reconciliation-health gate open;
one subsequent success does not satisfy the sustained criterion.

## Repaired worker and complete two-hour observation — September 21

PR #2356 deploys the reproduced discovery-scan correction to Admin and worker
as `de752d60980b25ee11806f2c424770fc78027188`. The fixed **00:15–02:15 UTC**
window has **0 / 9,787 playback 5xx (0%)**, with no fault-injection exclusions;
ordinary canaries and rejected traffic remain included. Independent Railway edge
counts and Datadog primary metrics match. All 24 reconciliation batches and
heartbeat steps complete; 238 classification attempts and 14 queued rebuilds
have zero classification/dispatch failures or exhausted attempts.

The final timed pointer audit finds one ineligible pointer; a later complete
02:20:44 UTC snapshot finds zero among 167,984. A separate durable episode cohort
audit finds zero fact/replay sequence or original-fact binding violations across
10,600 facts and 207 replay receipts. The exact populations, nonzero snapshots
and collector differences remain in the
[release record](../../operations/watch-closeout-release-2026-09-21.md).

Admin/Web indexed logs agree on 8,003 accepted facts batches and 23 all-replay
batches. All 126 observed transaction-busy attempts across 109 trace-correlated
requests reach final Web facts HTTP 200, without exhaustion. Four binding
rejections map to terminal HTTP 409. All 1,520 recognized-crawler evidence
actions are logged as rejected; the `human_anonymous` database label is not
independent proof of human provenance. Terminal labels alone do not establish
cross-request browser retry behavior.

Keep this ticket in progress. The completed two-hour HTTP and worker observation
does not install alerts or replace the permission-checked Admin reconciliation.
The paginated inventory of 41 visible monitors contains legacy Watch RUM monitors
but no required Forge recommendation transport/reconciliation alert coverage.
Use the existing read access for verification; no monitoring write was attempted.
The separately retained fast playback fetch failure and historical unknown-attempt
classification limits also remain explicit rather than being erased by this
healthy window.

## Short crawler user-agent repair — September 21

The continuation reproduced a narrower admission hole: short
`meta-externalagent/1.1` and `Meta-ExternalFetcher/1.1` user agents reached mocked
Admin mutations through otherwise valid evidence and selection requests. The
existing full production Meta user agent was already rejected through the
`crawler` substring in its documentation URL. No retained short-form success
has been established, and no historical evidence was relabeled or deleted.

The shared guard now recognizes both Meta product tokens independently of the
optional URL. Seven regressions failed before the fix; all 67 focused tests and
4,455 Web tests pass afterward, with lint and typecheck passing. Playback
context, claim and facts are covered before mutation, and ordinary Facebook
in-app browsers remain admitted. See the
[durable learning](../../solutions/security-issues/recognize-crawler-product-tokens-without-documentation-urls.md).

This repair does not satisfy the remaining installed-alert, authorized Admin
reconciliation or browser retry-amplification gates. Keep this ticket in
progress until those checks have their own evidence.

PR #2360 merged as `475a5f2ed102909a6c1463d3f32e8ed4bcfffbf5`; Railway and an
independent SSH read verify that exact Web deployment. Six bounded public-path
negative probes at 04:27 UTC all return 403 `machine_evidence_rejected` for the
two short Meta forms across evidence, selection and playback. No capabilities
or cookies were supplied. The [release evidence](../../operations/watch-startup-readiness-2026-09-21.md)
keeps these diagnostic rejections separate from natural HTTP and semantic
fallback populations. Installed alerts, Admin reconciliation and browser retry
evidence remain open.

## September 21 later release observation

The [runtime release record](../../operations/watch-startup-readiness-2026-09-21.md)
retains a playback HTTP 503 at 05:07:25.928 UTC during the Admin release period.
The upstream span reports `fetch failed` after 330 ms, with no retained Admin
span; deployment timing alone does not prove its network/process cause. Keep it
separate from selection deadlines and HTTP 200 delivery-timeout fallbacks. The
05:10–05:20 UTC window has 479 playback requests and no 5xx, but is only ten
minutes. The earlier completed two-hour corpus remains valid for its timestamp.
Installed alerts, authorized Admin reconciliation and actual browser terminal
retry behavior still require their own evidence. Browser inventory remains
empty and the in-app browser is unavailable; no authorization was manufactured.

A second fast playback 503 at 05:40:18 UTC takes 159 ms, during the next Admin
handover, with an upstream fetch failure and no retained Admin span. The scoped
diagnostic adds only an optional finite `networkErrorCode` to existing evidence
events; it does not change HTTP responses or retries. Real local socket/refusal
and route-boundary tests validate the diagnostic. Keep installation and sustained
natural-error attribution separate from implementing this field. See the linked
release record's current closure table for the exact outstanding gates.

PR #2364 is now verified on Web/Admin/worker as
`d0c749b981b8c3cf777c6e62bd9e5eae1abbd2bf`; the
[diagnostic release evidence](../../operations/watch-transport-cause-release-2026-09-21.md)
confirms the compiled field, unchanged homepage constraints and separate HTTP
and semantic outcome accounting. The latest 41-monitor inventory still lacks
the required alert coverage. No monitor write or Admin impersonation occurred;
the installed-alert, matching authorized Admin and actual browser retry gates
remain unmet.

## September 22 sustained production verification

The [September 22 sustained verification](../../operations/watch-production-verification-2026-09-22.md)
covers 13 hours 10 minutes on exact revision `d0c749b9…`. Playback has
65 HTTP 503s / 49,763 calls (0.130619%, no exclusions), including a separate
63-request burst around a catalog shared-memory error and 38.55-second loop
delay. One episode-lock budget exhausts; it is not P2034 exhaustion. All 16
observed binding errors map to terminal 409, and all 6,840 recognized-crawler
observations are rejected. These server facts do not prove browser retry behavior.
Installed alerts and matching authorized Admin evidence remain unmet. Keep this
ticket in progress and retain the burst despite the passing aggregate rate.

## September 22 reproduced burst corrections released

PRs #2369 and #2371 fix the reproduced GraphQL error-inspection amplification and
catalog shared-memory workload. Both are verified in Admin and worker at
`ce421561ee9bcf89991dea5a060a656e45c3434b`. The
[release verification](../../operations/watch-runtime-release-verification-2026-09-22.md)
keeps the first 17-minute logger-only population separate: 0 playback 5xx / 1,146
requests, one terminal binding 409, and all 125 recognized crawler submissions
rejected. Final-revision sustained acceptance remains pending. The fresh complete
41-monitor inventory still lacks the required recommendation alerts. Read-only
Datadog access, authenticated Admin acceptance and actual browser retry proof
remain distinct constraints; no gate was waived to close this ticket.

The 23:29–23:33 owned headed-browser canary now verifies normal Watch
navigation, two served six-card envelopes, a selection HTTP 200 with a matching
attributable database row, and 56 accepted playback fact receipts. Its incomplete
response captures remain explicit. No real terminal 409 occurred, so the browser
retry gate is still unmet; do not carry forward the obsolete claim that no
browser can be run. Installed alerts and matching authenticated Admin acceptance
also remain open. The [release record](../../operations/watch-runtime-release-verification-2026-09-22.md)
retains these limits and the separate sustained observation.

The complete 21:55–23:55 UTC primary population now has zero playback 5xx /
8,725 requests and three binding 409s. Datadog observes 984 recognized crawler
events, all terminal 403s, but lacks 13 playback/evidence outcome observations
relative to primary HTTP counts. Independent Railway evidence reads fail, so
their semantics remain unknown. Delivery is independently reconciled and has
one HTTP 200 `delivery_timeout`, including its diagnostic-overlap uncertainty.
No request is excluded. Twenty-four durable completed reconciliation batches
and heartbeats have no recorded classification/dispatch failures. These advance
production evidence without satisfying alerts, authenticated Admin, real browser
terminal non-retry or complete final-release acceptance; status stays in progress.

## September 22 authenticated acceptance and Redis update burst

Normal authenticated Admin now verifies the fresh zero-current-pointer snapshot,
one exact repaired-generation chain, and a complete fresh Watch qualified-outcome
journey through later hybrid use. Credit these Admin checks; access is no longer
the blocker. The [contextual release continuation](../../operations/watch-contextual-distance-release-2026-09-22.md)
records the evidence and its snapshot limits.

The longer 01:39–02:19 UTC release observation catches **19 playback HTTP 503s /
1,738 requests (1.093%)**, with no exclusions. They occur during an automatic
Admin Redis image update. A matching trace receives Admin HTTP 500 in 7.1 ms;
the exact Admin error is the disconnected Redis GraphQL rate-limit store.
These are fast upstream failures, not the historical selection deadline. A
separate Web Redis automatic update overlaps one delivery admission 503. All
477 seeded-delivery outcomes reconcile, with zero observed HTTP 200 timeout
fallbacks and four successful selections. Retain the burst despite the earlier
healthy fifteen minutes; neither population is the required sustained closure
proof. No rate-limit guarantee or infrastructure setting was changed.

Installed Datadog alerts/dashboard, real terminal-browser non-retry evidence and
complete sustained transport acceptance remain open. Read-only access cannot
install monitors. Redis update availability requires separate investigation;
do not mask its failures with an in-memory limiter or ambiguous mutation retry.

## September 22 bounded workload and production follow-up

The [September 22 follow-up](../../operations/watch-budget-followup-2026-09-22.md) verifies the fixed 01:39–03:39 UTC playback threshold at 19/6,463 (0.294%), with no exclusions, and a fresh authenticated zero-current-pointer audit. The running scheduler has 23 completed batches and heartbeats with no classification failures or exhausted attempts. A complete retained real browser view supplies a 409 non-retry example with further network activity 10.55 seconds later; its response body/action and matching server trace are unavailable, so do not claim those details. Installed alerts/dashboard, complete outcome reconciliation and remaining transport proof keep this ticket in progress. The artifact explicitly retains the unmatched successful HTTP counts.

The dashboard tool is discoverable, but Datadog explicitly rejects even widget
validation because MCP writes are disabled for this organization. No matching
dashboard or feat-464-tagged monitors were found. This replaces the earlier
imprecise description of a read-only tool list with a verified organization
policy blocker; Railway/database diagnosis remains available.

## September 22 internal continuation

The internal continuation reconciles every delivery, selection, playback and initial-evidence HTTP group in the fixed 02:34–04:34 UTC window using primary Railway logs. Playback is 0/7,185 5xx with no exclusions. Durable delivery, render/impression and selection counts reconcile; all 24 reconciliation batches complete without recorded errors, and the fresh authorized current-pointer audit is clean. Credit these production checks. No binding failure occurs in this window, so the earlier bounded browser proof is unchanged. Installed monitoring remains blocked by the Datadog organization write policy; this ticket is still in progress. See the [internal verification](../../operations/watch-budget-followup-2026-09-22.md#internal-continuation-workload-volume-and-reconciled-outcomes).

## September 23 isolated diagnosis

The [intermittent-evidence investigation](../../operations/watch-intermittent-evidence-investigation-2026-09-23.md)
reconciles the 00:00-02:00 UTC primary window at zero playback 5xx / 6,981
requests, with no exclusions. Railway fills fifteen missing indexed Web outcomes.
A read-only aggregate confirms eighteen delivery timestamp rejections; local
signed-token tests reproduce device-clock sensitivity but do not attribute those
production events to clock skew. A separate local characterization shows startup
health can return 200 while the production Redis rate-limit store rejects reads
and writes. This is a readiness blind spot, not proof of a new production outage
or a fix for the older Redis-update burst. No application behavior or production
configuration changed. Keep this ticket in progress; proposed implementation,
browser proof, fresh canonical integrity acceptance, and installed alerts remain
separate decisions and gates.

## September 23 controlled recovery experiment

The owner-authorized [local experiment](../../operations/watch-intermittent-evidence-investigation-2026-09-23.md#controlled-recovery-experiment)
reproduces the retained Redis failure through real Yoga HTTP, the production
limiter/ioredis client, signed episode capabilities and real playback storage.
Three restart rounds in each of two successful runs fail before resolver writes
and recover on the existing client without restarting Admin. Exact replay and
post-commit socket-loss replay preserve one fact. A silent Redis stall can instead
outlast a caller timeout and commit later; do not equate timeout with non-commit.

The real browser recorder's jsdom test identifies the recovery gap: fast 503s
exhaust the three attempts at 0/100/300 ms and drop the facts permanently, even
when the dependency recovers at one second. This is a confirmed local causal
chain consistent with the historical Redis interruption, not evidence that every
historical failed request lost facts. Minimal GraphQL/auth fixtures and independent
browser tests are not a full live-browser production reproduction.

This stage passes 169 focused cases including seven disposable-service cases;
no application behavior, production setting, deployment or ticket acceptance gate
changed. The next supported scope is bounded transient-outage resilience and
pre-mutation admission cancellation, with readiness corrected separately. Keep
the ticket in progress and the remaining production/monitoring gates intact.

## September 23 bounded fact-recovery implementation

The owner subsequently authorized investigation plus implementation/testing of
the supported fix. `RecommendationPlaybackRecorder.tsx` retains three serialized
attempts but spaces retries by 1-1.25 seconds and 8-10 seconds, expires attempted
facts after 30 monotonic seconds, and prevents new player events from bypassing
backoff. Immutable replay, count/body limits, terminal rejection and best-effort
page-exit keepalive remain. Capabilities stay in memory; no admission, privacy,
profile qualification, initial context/claim or production settings change.

The [verification report](../../operations/watch-intermittent-evidence-investigation-2026-09-23.md#bounded-fix-and-verification)
records 179 Web, 59 Admin and seven real-dependency passing cases. A local Chrome
comparison uses real HTTP and recorder code with a synthetic API/player: the old
recorder drops initial facts at 309 ms, while the new one accepts identical facts
at 9,709 ms after an eight-second outage. Five paired healthy runs retain one
claim/one fact request and show no measured startup regression. This is not full
Watch/Admin or production verification. Both app typechecks pass.

The local implementation is complete, not shipped. Shared admission cancellation,
dependency-aware readiness, issuance recovery, production proof and installed
monitoring are still open; do not mark this broad ticket complete. The
[durable learning](../../solutions/logic-errors/playback-retries-exhaust-before-dependency-recovery-20260923.md)
separates the verified recovery fix from those remaining gates.

## September 23 release continuation

The owner authorized completing bounded recovery and normal PR-to-main merge.
The [release plan](../../plans/2026-09-23-003-fix-playback-recovery-release-plan.md)
extends recovery to exact-nonce claims, bounds mandatory Redis admission before
resolver execution, and makes health check Redis with bounded outstanding work.
The [verification report](../../operations/watch-intermittent-evidence-investigation-2026-09-23.md#release-continuation)
records 182 Web tests, 95 Admin tests and seven real Redis/Postgres HTTP controls.
Initial context issuance is not blindly retried because its binding creation is
not idempotent. This remains in progress pending the broader production acceptance,
timestamp attribution, complete outcome reconciliation and installed-monitoring
gates; the narrow release does not close the whole ticket.

## September 23 completed acceptance observation

The [acceptance continuation](../../operations/recommendation-evidence-acceptance-2026-09-23.md)
verifies Web/Admin/worker actually running PR #2404 at `37e10b622`, with healthy
bounded Redis readiness. The complete 04:30–06:30 UTC primary window has **zero
playback 5xx / 4,716 POSTs**, zero fault exclusions, no observed receipt collision,
exhausted playback retries or recognized-crawler success. Selection HTTP failures
and delivery semantic fallbacks remain separate; neither timeout class occurs.

Eight real-dependency cases and eight joined Chrome/Web/Admin/PostgreSQL controls
cover recovery, silent stalls, exhaustion, early cancellation and post-commit lost
acknowledgement. Exact replay has one write per event; a local terminal response
has no retry amplification. Both natural production binding failures become 409,
but neither has retained RUM coverage, so their browser disposition remains open.

The final canonical snapshot scans **179,054 current pointers, zero ineligible**;
authenticated Admin agrees. All 81 finalized cohort outcomes match watermarks and
generations. Twenty-three committed reconciliation batches/heartbeats have no
recorded failures; 14 affected-pointer occurrences queue 14 rebuilds, so this is
convergence, not continuous zero. Web/Admin accepted batch counts agree; the report
retains indexed gaps, one initial-evidence envelope gap and the unmatched browser 503. Installed monitors/dashboard remain blocked by the verified Datadog MCP-write
policy and lack a configured destination. **Keep this ticket in progress**; do not
waive monitoring, natural-browser coverage or complete operational reconciliation.
