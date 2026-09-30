---
id: "feat-545"
title: "Recommendation telemetry and browser evidence closeout"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: ""
duration: 2
depends_on: []
blocks:
  - "feat-372"
  - "feat-381"
  - "feat-447"
tags:
  - "admin"
  - "web"
  - "recommendations"
  - "observability"
  - "reliability"
---

## Problem

On September 24 the owner accepted the verified recovery and integrity work in
feat-464 and feat-459 and approved closing those tickets while explicitly carrying
remaining monitoring and telemetry evidence into this follow-up. This is a scope
transfer, not a claim that the original monitoring/browser requirements passed.
The [September 23 acceptance record](../../operations/recommendation-evidence-acceptance-2026-09-23.md)
retains the two-hour denominator, complete canonical audit, durable reconciliation
and every unresolved observation.

The last verified Datadog policy rejected MCP writes for organization 678835
(Jesus Film Project). Six prepared monitors and a dashboard were absent from
the visible inventory. After considering temporary REST API credentials and a
Slack alert destination, the owner deferred this optional installation on
September 24. No Datadog key or alert destination is needed for this ticket.
Deferring monitors did not accept source discrepancies or browser-response gaps.
The later explicit September 29 decision below closes their historical disposition.

The [September 28 bounded recheck](../../operations/recommendation-evidence-telemetry-followup-2026-09-28.md)
reproduced the indexed gaps and historical browser 503/204/status-zero counts.
Ten later natural browser 409 resources add partial coverage, but sampled
within-view activity cannot identify the rejected episode or establish zero
retry amplification. That recheck did not close the gaps by evidence.

The [September 29 owner-decision record](../../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)
reconciles retained arithmetic and enumerates nine separate dispositions:
Web/Admin indexed deficits, crawler rejection deficit, initial-evidence envelope,
browser 503, browser 204s, status-zero transport observations, historical terminal
retry coverage, and later terminal sample coverage. Each states missing evidence,
operational consequence, proposed bounded limitation and affected gates. The reviewed aggregate artifacts cannot
recover exact historical joins; upstream retention is not assumed. No new
production queries or runtime changes were justified by that review.

On September 29, **nisal explicitly accepted D1–D9 after explanation, with the
caveat that they will be fixed later**. The decision record names every accepted
row, its exact historical population and remaining uncertainty. This completes
this ticket by owner disposition, not by recovery of the missing evidence.
[Feat-566](feat-566-recommendation-evidence-gap-remediation.md) tracks the required
future remediation; it remains open and has no agreed delivery date. Existing
downstream dependencies remain recorded and are satisfied only as to this ticket.
Fresh health, storage, experiment and promotion gates remain separate requirements.

## Entry Points — Read These First

1. `docs/operations/recommendation-evidence-acceptance-2026-09-23.md` and
   `docs/validation/evidence-acceptance-20260923/`: acceptance populations and gaps.
2. `docs/operations/recommendation-evidence-transport.md`: source boundaries
   and the optional installation/read-back procedure.
3. `infra/datadog-monitors/recommendation-evidence/`: prepared monitor and
   dashboard definitions; these are not proof of installation.
4. `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`
   and `apps/web/src/lib/recommendation-evidence-response.ts`: browser retry
   ownership versus server disposition logs.
5. `apps/admin/src/services/recommendations/admin-ops/`: authorized durable
   evidence; avoid introducing another counter store or transport panel.

## Grep These

- `invalid_binding|retryDisposition|delivery_timeout|transport_exhausted`
- `recommendation.evidence|recommendation.reconciliation.heartbeat`
- `crawler-success|transaction-exhausted|reconciliation-unavailable`

## What To Build

- Close or explicitly disposition the retained source gaps: eight/five fewer indexed
  Web/Admin fact-batch successes than Railway; one missing indexed crawler rejection;
  one initial-evidence envelope gap; browser HTTP 503 and two HTTP 204 observations
  without trusted primary-request joins. Preserve 28 browser status-zero transport
  observations as their own population. Do not equate batch/event/request counts.
- Obtain bounded retained browser evidence for natural terminal binding responses
  with continued activity and no retry amplification, or record a specific owner
  decision on residual coverage. September 23's two 409s lack RUM resources; local
  terminal controls and the September 22 bounded browser example retain credit.
- Use bounded, targeted follow-up reads; do not restart a broad two-hour audit merely
  because this ticket remains open. Add runtime instrumentation or repairs only for
  a demonstrated consequential defect with an appropriate regression.
- Preserve the prepared Datadog definitions and runbook for a later explicit
  monitoring decision. Do not request credentials or install resources as part of
  this closeout.

## Constraints

- Do not weaken auth, distributed admission, immutable replay, payload validation,
  privacy-generation fences, retention, erasure or analytics availability.
- No secrets in chat, git, command history or captured output. Do not create a
  persistent service or broaden access to other users. Stop on policy denial
  rather than bypassing it.
- No production fault injection, manufactured evidence, direct repair or manual
  deployment. Follow normal PR-to-main deployment and preserve feature flags.
- Closing feat-464/459 does not activate mission collection, profile rollout,
  experiments, learning or promotion. Their remaining operational readiness gate
  now lives here; downstream roadmap dependencies preserve that boundary.
- Do not reopen feat-496 or widen issuance/timestamp contracts by implication.

## Verification

- Query results show real source coverage; missing data is never presented as zero.
- Terminal-response/browser proof and each source discrepancy have an evidence-backed
  resolution or an explicit owner-accepted bounded limitation recorded separately.
- Production observations remain privacy-safe and scoped by revision, environment,
  time window and units; SQL is bounded, read-only and rolled back.
- Update this ticket and downstream dependencies honestly; run roadmap generation,
  lint and formatting for metadata edits. No runtime behavior changes are implied
  by documentation closure.
