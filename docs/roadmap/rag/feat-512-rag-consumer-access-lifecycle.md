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

Implement plan sections A, B and D: a repository portal-user allowlist changed
through normal PRs, safe contributor/read-write CI validation with explicit
unverified coverage, and trusted merged admission for GitHub OAuth. CI validates
portal admission entries, never runtime consumer ownership. No special approver.

Build authenticated direct consumer creation with globally unique `^[a-z0-9-]+$`
name, server-derived initial owner, random secret returned once and verifier-only
storage. Consumer memberships live in the database. Only existing owners may
Add member from the current allowlist; added members can manage/regenerate.
Retain at least one owner, transaction/version checks and restricted audit.

Provide stable identity, explicit server-authorized source scope/environment,
immediate atomic rotation, suspension/revocation and isolated metadata privileges.
Supply the same backend to the pre-portal dogfood harness; the full UI remains
feat-515 after dogfood. Deliver the migration runbook; cutoff waits for feat-514
and separate production authorization.

## Constraints

No plaintext persistence/re-reveal, consumer-registration PRs, Git-backed consumer
owner lists, cross-app imports, corpus writes or implicit usage enforcement.
No raw query, IP, corpus, token/selector or production evidence in records.
Resolve allowlist publication, account binding and safe CI coverage before activation.

## Verification

Execute plan E, including allowlist before/after merge, removed-user sessions,
all-consumer visibility versus owner-only mutations, direct creation/name races,
initial-owner tampering, allowed-member selection, last-owner concurrency,
rotation/revocation, secret-response loss and audit leakage. Run RAG tests,
typecheck, lint, depcruise and isolated DB role/integration checks; contract drift
if changed. Complete only this deliverable, not future dogfood/cutoff or UI.
