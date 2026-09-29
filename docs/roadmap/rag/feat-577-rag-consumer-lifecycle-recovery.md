---
id: "feat-577"
title: "Recover and delete RAG portal consumers"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-30"
duration: 3
depends_on: []
blocks: []
tags: ["rag", "auth", "portal"]
---

## Problem

An accidental consumer revoke is unrecoverable, and the globally reserved name
prevents recreation. Owners also cannot remove obsolete consumer records.

## Entry Points — Read These First

1. `docs/plans/2026-09-30-002-rag-consumer-lifecycle-recovery.md` — lifecycle matrix.
2. `apps/rag/src/adapters/postgres/consumer-access.ts` — owner-locked changes.
3. `apps/rag/src/serving/http/portal-consumers.ts` and `portal-assets/portal.js` — routes and UI.
4. `apps/rag/prisma/migrations/20260923000000_consumer_registry_foundation/migration.sql` — identity guard and references.

## Grep These

`TransitionConsumer`, `guard_consumer_identity`, `lifecycle_audit`, `revoked_at`.

## What To Build

Replace Revoke with confirmed Delete; free the name while keeping audit and
usage by UUID. Recover legacy revoked consumers only with a fresh one-time key.
Expose Active and Suspended filters and a conditional legacy Revoked filter.
Version lifecycle changes and reject stale owner actions.

## Constraints

Never reactivate a revoked credential, reveal a prior key, or erase usage/audit.
Keep RAG's restricted writer/auth reader roles and normal PR deployment path.

## Verification

Run `pnpm --filter @forge/rag` typecheck, lint, depcruise, portal tests and
database lifecycle tests; verify old-key denial, name reuse, history retention,
authorization, concurrency and page-load cost.

## Resolution

Implemented in the Forge consumer lifecycle recovery PR. Local verification
and page-load evidence are recorded in the plan linked above.
