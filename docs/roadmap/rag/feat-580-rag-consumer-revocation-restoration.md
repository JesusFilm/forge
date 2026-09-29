---
id: "feat-580"
title: "Revoke and restore RAG portal consumers"
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

An accidentally revoked consumer cannot be restored with a fresh key.
Its reserved name prevents recreation. Owners need an explicit revoke and
restore flow that keeps the same consumer identity and usage history.

## Entry Points — Read These First

1. `docs/plans/2026-09-30-002-rag-consumer-lifecycle-recovery.md` — lifecycle matrix.
2. `apps/rag/src/adapters/postgres/consumer-lifecycle.ts` — owner-locked changes.
3. `apps/rag/src/serving/http/portal-consumers.ts` and `portal-assets/portal.js` — routes and UI.
4. `apps/rag/prisma/migrations/20260923000000_consumer_registry_foundation/migration.sql` — identity guard and references.

## Grep These

`TransitionConsumer`, `guard_consumer_identity`, `lifecycle_audit`, `revoked_at`.

## What To Build

Show Active, Suspended, and Revoked filters. Confirm Revoke for active and
suspended consumers. Keep names reserved and records visible when revoked.
Offer Restore with new key for revoked consumers and return them to Active.
Version lifecycle changes and reject stale owner actions.

## Constraints

Never reactivate a revoked credential, reveal a prior key, or erase usage/audit.
Keep RAG's restricted writer/auth reader roles and normal PR deployment path.

## Verification

Run RAG typecheck, lint, depcruise, portal and database lifecycle tests; verify
old-key denial, name reservation, history retention, authorization, concurrency,
and page-load cost.

## Resolution

Implemented in [Forge PR #2496](https://github.com/JesusFilm/forge/pull/2496).
Local verification and page-load evidence are recorded in the plan linked above.
