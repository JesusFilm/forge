---
id: "feat-402"
title: "Add durable support research dry-run authorization budget"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-08-21"
duration: 3
depends_on:
  - "feat-401"
blocks: []
tags:
  - "platform"
  - "mastra"
  - "security"
  - "support"
---

## Problem

Support-research browser launches are admin-only and each dry run is limited to
five conversations with an explicit idempotency key. Those per-request bounds
do not provide a durable single-use authorization or aggregate budget. An admin
could submit multiple distinct keys while provider processing is approved,
expanding Help Scout reads and model processing beyond one operator-approved
verification attempt.

## Entry Points — Read These First

1. `docs/plans/2026-08-21-0913-fix-support-research-migration-readiness-plan.md`
   — settled R15 boundary between the first operator dry run and routine
   self-service.
2. `apps/mastra-gateway/src/lib/support-research-access.ts` — current
   per-request launch policy.
3. `apps/mastra/src/mastra/workflows/daily-support-research.ts` — workflow
   input validation, run claims, and dry-run execution.
4. `docs/runbooks/support-research-agent.md` — production approval and evidence
   sequence.

## Grep These

- `isBoundedSupportResearchDryRun`
- `MAX_OPERATOR_DRY_RUN_CONVERSATIONS`
- `support-research:dry-run:`
- `SUPPORT_RESEARCH_PROVIDER_APPROVED`
- `idempotencyKey`

## What To Build

1. Define an explicit authorization model for one operator dry-run attempt,
   including issuer, expiry, aggregate conversation budget, and concurrency.
2. Consume authorization atomically before repository or Help Scout access and
   reject reused, expired, concurrent, or over-budget attempts.
3. Keep live scheduled dispatch independent and default-off; authorization for
   a dry run must never enable a scheduled non-dry run.
4. Persist non-sensitive audit evidence that correlates the approval, operator,
   run key, consumed budget, and terminal report without customer content.
5. Add concurrency and retry tests plus gateway tests for revoked, editor,
   unauthenticated, expired, reused, and approved admin cases through the real
   authorization seam.

## Constraints

- Do not treat an arbitrary idempotency key as authorization.
- Do not store provider credentials, Help Scout content, or raw session tokens
  in the authorization record.
- Do not grant browser access to live dispatch.
- Do not advance the live Help Scout cursor from a dry run.

## Verification

- Two simultaneous requests cannot consume one authorization twice.
- A second distinct run key cannot exceed the authorization's aggregate budget.
- Rejected attempts touch neither the support-research repository nor Help
  Scout, the model, validator, or Linear.
- The approved bounded attempt retains zero-network Linear behavior and leaves
  the live cursor unchanged.
