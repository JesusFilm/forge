---
title: "Verify recommendation evidence recovery and production acceptance"
type: fix
status: active
date: 2026-09-23
origin: docs/roadmap/content-discovery/feat-464-recommendation-evidence-transport-crawler-integrity.md
---

# Evidence production acceptance

## Scope and decisions

Continue feat-464 from current main in an owned worktree. Credit PR #2404's
bounded recovery, admission and readiness implementation and the existing
authenticated Admin repair proof. The #2404 task owns immediate release checks
and its existing report/learning files; this continuation owns the broader
acceptance record. Use existing repository procedures, with sequential review
per AGENTS.md. No new product or issuance/timestamp contract is proposed.

Production inspection is bounded, read-only and privacy-safe. Keep HTTP failures,
HTTP 200 semantic fallbacks and terminal rejection populations separate. Preserve
all observed failures, report collection gaps, and never infer durable acceptance
or browser acknowledgement from HTTP status alone. Do not reopen feat-496.

## Implementation units

### U1. Establish release and monitoring gates

Record exact running Web/Admin/worker revisions, promotion times and health in
`docs/operations/recommendation-evidence-acceptance-2026-09-23.md`, with compact
sanitized evidence under `docs/validation/evidence-acceptance-20260923/`.
Coordinate with the release task before overlapping checks. Resolve service
identities afresh. Check Datadog write policy once and inventory required alerts;
if policy remains blocked, record the unmet gate without a workaround.

### U2. Close local browser and durable proof gaps

Start from `apps/admin/src/graphql/plugins/rate-limit-recovery.db.test.ts`,
`apps/web/scripts/verify-playback-recovery-browser.mjs`, the playback route and
recorder tests. Use only owned containers, ephemeral loopback ports and synthetic
local identities. Prefer a joined browser/Web/Admin request path when feasible;
state every remaining simulated boundary explicitly.

Scenarios: healthy request, Redis disconnect/reconnect, silent stall, early caller
cancellation, bounded retry exhaustion, terminal rejection with continued player
activity, and lost acknowledgement after commit. Verify exact event identities,
payloads, ordering, receipts and one-write replay directly in PostgreSQL. Add
regression code only for a demonstrated gap. Any application fix requires a
failing regression, real-dependency verification, scope-specific CI and frontend
load measurements where applicable. Never persist production capabilities.

### U3. Complete the production observation and integrity audit

Select a fixed interval of at least two hours after all relevant services run
the recovery revision. Primary-environment HTTP metrics supply denominators;
structured outcomes and bounded Railway logs supply reasons and collector-gap
reconciliation. Count claim/fact/context and replay separately. Report exclusions
(including zero), retained deployment overlap and traffic not exercising a gate.

Run the unchanged canonical current-pointer predicate in a bounded read-only
snapshot using `apps/admin/src/services/recommendations/admin-ops/` as authority.
Check durable reconciliation batches, heartbeat cadence and stored receipts/facts.
Retain prior authenticated repair proof with its timestamp. Do not manufacture
production evidence or induce a production outage/terminal rejection.

### U4. Review, compound and publish the evidence

Use sequential ce-code-review lenses for correctness, evidence completeness,
security/privacy, feasibility and scope. Compound any new durable learning into
the new acceptance record or a narrowly scoped solution. Update feat-464 and
feat-459 honestly; retain in-progress while mandatory gates remain unmet.
Incorporate newer main before final validation. Run formatting, documentation
links, roadmap generation/lint where metadata changes, and affected tests for
any code changes. Release changes only through normal PR-to-main automation.

## Acceptance checklist

- Exact running revisions and healthy admission/readiness verified.
- At least two hours of post-release production requests, playback 5xx below 1%,
  with numerator, denominator, exclusions and missing coverage explicit.
- HTTP timeouts, semantic delivery timeouts and terminal rejections separated.
- No observed replay-receipt collision, exhausted playback transaction retries or
  successful recognized-crawler evidence; observation limits retained.
- Complete canonical current-pointer audit is clean after reconciliation;
  durable worker batches/cadence and outcome accounting reconcile.
- Exact replay and post-commit acknowledgement-loss proof preserve one write;
  terminal browser response does not amplify retries.
- Required operational dashboard and actionable alerts installed and verified,
  or explicitly blocked without claiming ticket completion.

## Review

Sequential coherence, feasibility, security and adversarial review preserves the
distinction between shipped fixes, local fault controls and natural production
coverage. The monitoring policy and absence of naturally observed failures may
prevent complete acceptance despite successful unblocked work. No relaxed gate,
production write, shared-service mutation or new privileged credential is allowed.
