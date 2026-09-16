---
id: "feat-512"
title: "Implement formal RAG consumer access lifecycle"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-15"
duration: 5
depends_on: ["feat-511"]
blocks: ["feat-513"]
tags: ["rag", "auth", "observability"]
---

## Problem

Formal consumer identity and independently verified usage visibility are needed
before retiring shared-token access. Planning completion is not implementation.

## Entry Points — Read These First

1. [Implementation plan](../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md).
2. `apps/rag/src/serving/http/auth.ts` and `app.ts` — auth and counting boundary.
3. `apps/rag/scripts/serve.ts` — dependency composition.
4. `apps/rag/prisma/schema.prisma` — separate metadata schema and roles.
5. `apps/rag/docs/ops/environment-and-secrets.md` — legacy operations; this plan replaces overlap rotation.

## Grep These

`TokenRegistry`, `lookupScope`, `resolveScope`, `createApp`, `SERVE_BEARER_TOKENS`.

## What To Build

Implement plan sections A, B and D: operator-mediated registration/approval,
repository allowlist with senior PR approval enforced by required CI, verified-email authorization, multiple audited managers, stable server-side identity, private bearer
per environment, one-time display with hash-only storage, atomic immediate replacement with no overlap, scope enforcement,
suspension/revocation and restricted metadata privileges. Deliver the migration
runbook but do not execute cutoff until feat-514 and separate production approval pass.

Use the plan's proposed types and counting contract. Start date/duration are
bookkeeping estimates, not an approved release schedule.

## Constraints

Apply the approved decisions and resolve named implementation details before activation. No IP, raw query,
corpus, token value/selector or production evidence in records. Auth verifiers
stay restricted. Serving never writes corpus. No cross-app imports, portal or
implicit heavy-usage enforcement. Use the actual forge-rag-retrieve ops HTTP path in the dependent dogfood ticket. Normal PR-to-main only.

## Verification

Execute the plan's section E tests, including failure and rollback cases relevant
to this deliverable. Run RAG tests, typecheck, lint, depcruise and isolated DB
role/integration checks; contract drift checks if changed. Record actual outcomes
without sensitive content. Complete only the implemented deliverable; shared-token
cutoff additionally requires feat-514 and separate production cutover approval.
