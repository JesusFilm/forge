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

- Preserve immutable evidence, superseding eligibility, source attribution, retention, consent, erasure, and privacy-generation contracts.
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
