---
id: "feat-377"
title: "Authenticated machine recommendation parity"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 5
depends_on:
  - "feat-368"
  - "feat-372"
  - "feat-376"
blocks: []
tags:
  - "admin"
  - "mastra"
  - "recommendations"
  - "machine"
  - "api"
  - "authentication"
---

## Problem

Forge automation needs the same semantic recommendation core and provenance as Watch without impersonating viewers or changing human learning.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U9 contract.
2. `apps/admin/src/app/api/internal/`
3. `apps/admin/src/services/recommendations/`
4. `apps/mastra/src/services/`
5. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `internal.*recommend|machine|callerClass`
- `Mastra|mastra`
- `quota|purpose`

## What To Build

- Add an authenticated internal adapter over the shared recommendation service with server-derived caller class, allowed purpose, locale, seed/query, catalog constraints, pagination, and strategy provenance.
- Return caller-bound request IDs and accept idempotent selected or used-in-artifact receipts.
- Consume atomic caller quota before expensive retrieval and bind caches, cursors, and receipts to the caller.
- Expose aggregate machine utility and parity without raw operator traces or viewer profiles.

## Admin Evidence Gate

- Show human and machine requests, dispositions, artifact-use receipts, fallback, quota, and latency separately.
- Prove machine actions never enter human profile, co-watch, experiment, or training eligibility.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Do not expose the public viewer token contract as machine authentication.
- Server configuration owns caller class, purposes, scopes, and quotas; clients cannot self-assert them.
- Secrets and raw operator traces must be redacted from logs and Admin.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Test authentication, retry, purpose escalation, cross-caller replay, response isolation, credential rotation/revocation, quota-before-retrieval, pagination, and redaction.
- Run Watch-versus-machine parity fixtures and Mastra client tests.
- Reconcile actor-separated counts and contamination checks in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`; `pnpm --filter @forge/mastra test`, `pnpm --filter @forge/mastra lint`, and `pnpm --filter @forge/mastra typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
