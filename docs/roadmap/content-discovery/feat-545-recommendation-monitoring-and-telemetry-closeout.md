---
id: "feat-545"
title: "Recommendation monitoring and telemetry closeout"
owner: "nisal"
priority: "P0"
status: "blocked"
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
(Jesus Film Project). Six required monitors and the dashboard were absent from
the visible inventory, and notification destinations were not configured. The
owner chose a separate, temporary service-account REST API credential on September
24, keeping MCP policy and other users unchanged. That credential and the intended
alert destination are not yet supplied.
This explicit non-dependency blocker is why status is blocked.

## Entry Points — Read These First

1. `docs/operations/recommendation-evidence-acceptance-2026-09-23.md` and
   `docs/validation/evidence-acceptance-20260923/`: acceptance populations and gaps.
2. `infra/datadog-monitors/recommendation-evidence/`: six monitor definitions and
   `dashboard.json`; these are definitions, not proof of installation.
3. `docs/operations/recommendation-evidence-transport.md`: installation/read-back
   procedure, source boundaries and Datadog access instructions.
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

- Use the owner's temporary REST API approach documented in the transport runbook:
  a dedicated service account with only monitor/dashboard read/write and log-read
  permissions, a dedicated API key, and its application key. Log monitor APIs
  require an unscoped application key; bound authority through the narrow account
  role. Keep MCP policy and other users unchanged. Set status in-progress once
  credentials and the intended alert destination are available.
- Resolve current primary service/environment identity, inventory existing resources
  to avoid duplicates, validate the six definitions and dashboard, configure the
  owner's alert destination, install/publish them and read back their IDs, enabled
  status, queries, thresholds and destinations. A draft monitor is not actionable
  installed monitoring. Retain the resulting URLs in an operations record.
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

## Constraints

- Do not weaken auth, distributed admission, immutable replay, payload validation,
  privacy-generation fences, retention, erasure or analytics availability.
- No secrets in chat, git, command history or captured output. Use private local
  secret configuration or secret-manager injection for the dedicated credentials;
  revoke both keys after installation/read-back. Do not create a persistent service
  or broaden access to other users. Stop on policy denial rather than bypassing it.
- No production fault injection, manufactured evidence, direct repair or manual
  deployment. Follow normal PR-to-main deployment and preserve feature flags.
- Closing feat-464/459 does not activate mission collection, profile rollout,
  experiments, learning or promotion. Their remaining operational readiness gate
  now lives here; downstream roadmap dependencies preserve that boundary.
- Do not reopen feat-496 or widen issuance/timestamp contracts by implication.

## Verification

- Six active monitors and the dashboard are read back from the intended organization
  with correct definitions, queries, notification destination and usable URLs.
- Query results show real source coverage; missing data is never presented as zero.
- Terminal-response/browser proof and each source discrepancy have an evidence-backed
  resolution or an explicit owner-accepted bounded limitation recorded separately.
- Production observations remain privacy-safe and scoped by revision, environment,
  time window and units; SQL is bounded, read-only and rolled back.
- Update this ticket and downstream dependencies honestly; run roadmap generation,
  lint and formatting for metadata edits. No runtime behavior changes are implied
  by documentation closure.
