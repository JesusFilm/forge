---
id: "feat-566"
title: "Remediate accepted recommendation evidence gaps"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: ""
duration: 5
depends_on: []
blocks: []
tags: [admin, web, recommendations, observability, reliability]
---

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
