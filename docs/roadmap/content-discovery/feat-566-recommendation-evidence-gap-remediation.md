---
id: "feat-566"
title: "Remediate accepted recommendation evidence gaps"
owner: "nisal"
priority: "P2"
status: "cancelled"
start_date: ""
duration: 5
depends_on: []
blocks: []
tags: [admin, web, recommendations, observability, reliability]
---

## October 2, 2026 scope decision

Cancelled the proposed historical-forensics and extra cross-source correlation
programme after reviewing **each** September 29 promise to fix D1–D9 later.
That earlier acceptance was confined to the named old samples; this decision
changes the future work scope, not the historical verdict. None of the missing
joins is claimed recovered, and none of the old discrepancies is called healthy.
The [retained decision record](../../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)
found only grouped counts and a whole-set digest, not exact cross-source
members or browser attempt/episode joins. New instrumentation cannot reconstruct
those absent historical members. Existing bounded logs, durable receipts, Admin
trace/reconciliation, and terminal-response behavior remain in place; they are
not a complete HTTP or browser-attempt denominator.

| Gap | Historical status and current disposition                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Web indexed-versus-Railway accepted-batch net deficit of eight has unknown membership, cardinality and cause. No exact historical join in reviewed artifacts. Future accepted-batch failures or fresh measured pipeline loss require investigation; a second correlation store is not required without such evidence. |
| D2  | Admin deficit of five has the same missing membership and unknown overlap with D1; it cannot be added to D1 as 13 lost facts. Fresh Admin transport or indexing failure remains actionable.                                                                                                                           |
| D3  | Indexed crawler-rejection deficit of one does not prove crawler acceptance. Its exact historical member is unknown. Recognized-machine admission remains fail-closed and a reproduced accepted machine fact would be a current integrity defect.                                                                      |
| D4  | Primary 200/499 versus application initial-evidence net difference of one lacks commit, abort and acknowledgement identity. Matching durable counts cannot resolve it. A fresh failed issuance/persistence or contradictory final response is a current defect.                                                       |
| D5  | The retained browser 503 has no trusted primary/durable/recovery join. Its old cause and recovery remain unknown. A fresh 503 is a reliability event even if playback later succeeds; investigate by recorded cause and current trace.                                                                                |
| D6  | Two old browser 204 resources lack method, path and evidence disposition. No assertion that they were POST successes or lost facts is made. A new unexpected status on the evidence endpoint needs bounded method/path and application review.                                                                        |
| D7  | All 28 old status-zero resources have unknown transport, commit and retry dispositions; they are not HTTP failures or successes by inference. Current ambiguous acknowledgements keep bounded retry/idempotency behavior, and fresh exhaustion or duplicate effects need investigation.                               |
| D8  | Two old primary 409s lack exact response body, episode and continued-viewer-activity joins. Server terminal policy and local tests do not prove historical browser behavior. A reproduced current rejected-episode retry loop or playback interruption is a defect.                                                   |
| D9  | Ten later 409 resources and same-view 200s do not prove whether activity was new, permitted fallback or replay amplification, and cannot repair D8. The same current terminal-response trigger applies; no natural-failure wait or production fault injection is needed to retire this old evidence gate.             |

Current Web handling recognizes a returned `playback_binding_invalid` 409 as
terminal, while a stale linked claim may fall back once to standalone context;
see `RecommendationPlaybackRecorder.tsx` and the
[transport contract](../../operations/recommendation-evidence-transport.md).
This is a code/test observation, **not** a new production attempt-level proof.
The October 2 [delivery policy](../../analytics-and-recommendation-policy.md#delivery-health-and-accepted-coverage)
keeps server/GraphQL errors, timeouts, failed persistence and broken playback as
real issues even when an HTTP 200 or fallback follows. A missing current cause
gets bounded investigation. The [October 2 coverage sample](../../reports/2026-10-02-recommendation-coverage-acceptance.md)
checked recorded issued requests only; it cannot rule out pre-ledger failures or
settle these historical evidence gaps.

The Watch closeout also retains 195 historically unattributed shared Admin loss
rejections as an unresolved error-attribution observation. Their cause is
unknown; they are not benign exposure coverage, and this ticket does not call
them repaired. Any fresh loss/error signal needs bounded root-cause review under
the current reliability rule, independent of retiring D1–D9's forensic campaign.

This cancellation retires an optional cross-source forensic proof campaign. It
does not waive future release health, privacy, machine exclusion, deletion,
bounded retries or any demonstrated correctness defect. Datadog dashboard and
monitor installation remains a separate operational decision.

## Problem

On September 29, nisal accepted the nine historical limitations D1–D9 in
`docs/operations/recommendation-evidence-closeout-decisions-2026-09-29.md` with
the caveat that they will be fixed later. Feat-545 closes the historical
disposition; this ticket preserves the commitment to remediation. No delivery
date was agreed. Missing historical records may be irrecoverable, so completion
must distinguish recovered old evidence from verified future coverage.

## Entry Points — Read These First

1. `docs/operations/recommendation-evidence-closeout-decisions-2026-09-29.md` —
   row-by-row acceptance, residual risks and evidence needed for D1–D9.
2. `docs/operations/recommendation-evidence-transport.md` — distinct source units,
   bounded transport and definitive terminal response handling.
3. `docs/solutions/logic-errors/recommendation-outcome-accounting-boundaries-20260921.md`
   — population, membership and point-in-time boundaries.
4. `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`
   and `apps/web/src/lib/recommendation-evidence-response.ts` — claim fallback,
   terminal fact rejection and retry ownership.
5. `apps/admin/src/services/recommendations/admin-ops/` — current reconciliation
   and authorized durable evidence; reuse existing surfaces.

## Grep These

`retryDisposition|playback_binding_invalid|transport_exhausted|recommendation.evidence|recommendation.reconciliation.heartbeat`

## What To Build

- Plan bounded, privacy-safe membership reconciliation for D1–D4 across exact
  primary-host, application, indexed and durable populations. Detect and explain
  compensating discrepancies instead of relying on matching aggregate counts.
- Make browser attempts in D5–D7 traceable to method/path, transport outcome,
  application/durable disposition and subsequent retry/activity where observed.
  Unknown transport status remains distinct from HTTP failures and committed facts.
- Establish natural terminal-response evidence for D8–D9: exact recognized body,
  action and episode, trusted continued activity and sufficiently complete bounded
  attempt coverage to distinguish allowed fallback/new activity from amplification.
- First inspect existing retained fields and supported observability. Add only
  the instrumentation necessary for demonstrated proof gaps; keep scope, access,
  retention, erasure and cardinality bounded. Do not add a parallel counter store.
- Attempt historical recovery only after identifying a retained source capable
  of the exact join. Record irrecoverable historical rows honestly and verify the
  forward fix on a fresh, revision-pinned natural sample. Never manufacture proof.

## Constraints

- Acceptance of D1–D9 remains bounded to the named old samples; it does not waive
  current collection health, experiment integrity or live-promotion requirements.
- This future work is not an automatic new promotion dependency. Any demonstrated
  current consequential defect still blocks the applicable fresh readiness gate.
- No raw viewer identities, secrets, unbounded telemetry, production fault
  injection, direct SQL repair or manual deployment. Preserve privacy fences,
  disable/reset/deletion, retention, machine exclusion and bounded retries.
- Datadog monitor/dashboard installation remains separately deferred. No Slack,
  credentials or alert setup is included by implication.

## Verification

- Map each D1–D9 row to its forward repair, exact evidence and historical status.
- Use regression tests for changed reconciliation/transport behavior, including
  ambiguous acknowledgement, definitive rejection and permitted claim fallback.
- Verify natural browser/server/durable joins with explicit population, release,
  window, sampling completeness and missing-data accounting; equal counts alone
  are insufficient. Retain only privacy-safe aggregate evidence.
- Close only after future coverage is demonstrated and unrecoverable historical
  limits remain explicit in the decision record; ticket creation is not a fix.
