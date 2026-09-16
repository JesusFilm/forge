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

Implement plan sections A, B and D: operator-mediated registration/approval,
repository allowlist with the path-limited non-author review policy below, verified-email authorization, multiple audited managers, stable server-side identity, private bearer
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

## Discovery handoff: path-limited review gap (option B)

[feat-518 evidence](evidence/feat-518/consumer-access-discovery.md) records the latest
user decision and supersedes senior-only language in the original programme plan.
Only PRs changing `config/rag-consumer-engineers.json` or
`config/rag-consumer-engineers.schema.json` should require one valid approval
from someone other than the PR author. Any such reviewer may approve; no senior,
team or CODEOWNER roster. Do not additionally exclude a non-author latest pusher.
Jaco remains sole recovery authority, independent of PR review eligibility.

The discovery selected the explicitly authorized **option B**: native team/owner
path rules do not match unrestricted reviewer eligibility, branch-wide counts
broaden scope, and existing `forge-ci` / `ci-gate` has no reliable exact evaluator.
This ticket owns the documented enforcement gap; it is not currently configured.
A future custom gate is possible but must prove the report's complete file/review
enumeration, rename/deletion handling, trusted status source, current-head review,
dismissal/re-evaluation and merge-race requirements before claiming enforcement.

Prove both directions: protected-path changes without non-author approval cannot
pass, and unrelated RAG/Forge PRs gain no human approval wait. Do not substitute
`config/**`, `apps/rag/**`, `.github/**`, global minimum reviews or broad CODEOWNERS.
A path-skipped required workflow is not sufficient; it can leave unrelated PRs
pending. Preserve a fast not-applicable path if implementing an automated check.
Record exact check/rule names only after implementation verification. No settings
change is authorized by this discovery; carry any still-unresolved gap into the
implementation release review instead of silently broadening review requirements.
