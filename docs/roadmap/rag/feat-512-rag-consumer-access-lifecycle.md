---
id: "feat-512"
title: "Implement formal RAG consumer access lifecycle"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-15"
duration: 5
depends_on: ["feat-511", "feat-518"]
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

Implement plan sections A, B and D: normal consumer-registration PRs open to
any Forge read/write engineer, nonempty per-consumer GitHub `owners`, narrow CI
owner/membership validation with explicit unavailable-lookup coverage, and
GitHub-identity authorization from the current merged owners list. There is no
special consumer approver or added human review gate. Non-owners must add their
handle by PR and wait for normal merge; portal changes cannot bypass this.

Provide stable consumer identity, private bearer per environment, one-time display
with secure verifier-only storage, atomic immediate replacement with no overlap,
scoped retrieval, suspension/revocation and restricted metadata privileges.
Audit owner changes/registry application and lifecycle actions without secrets.
Deliver the migration runbook; cutoff waits for feat-514 and separate approval.

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

## Owner-validation and authorization acceptance

Use the plan's ownership/CI acceptance matrix: empty or malformed owners fail;
known membership and unavailable/private-membership cases remain distinct;
non-owner and unmerged owner-addition requests are denied; a merged addition
allows management only after fresh trusted publication. Removal invalidates
management for existing sessions. Prevent last-owner loss and handle reassignment.
No review evaluator, special reviewer roster or gate on all RAG PRs is required.
Document actual live membership verification coverage before activation; do not
claim structural validation proves organisation membership. Exact registry path,
publication mechanism and stable account binding remain implementation details.
