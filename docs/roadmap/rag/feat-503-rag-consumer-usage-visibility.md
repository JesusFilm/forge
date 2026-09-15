---
id: "feat-503"
title: "Deliver RAG consumer usage reporting and dogfood proof"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-15"
duration: 4
depends_on: ["feat-501", "feat-502"]
blocks: []
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
5. `apps/rag/docs/ops/environment-and-secrets.md` — receiver-first operations.

## Grep These

`TokenRegistry`, `lookupScope`, `resolveScope`, `createApp`, `SERVE_BEARER_TOKENS`.

## What To Build

Implement plan sections C and E as a separate deliverable: privacy-minimised,
unsampled usage aggregates, coverage health/watermarks, restricted read-only
report command, and repeatable actual-RAGBot-client HTTP proof. Report consumer
request count, successful count, last activity and UTC window. Prove +3 then +2
requests, second-integration isolation, denied revocation with no success
increment, and honest partial/unavailable coverage rather than false zero.

Use the plan's proposed types and counting contract. Start date/duration are
bookkeeping estimates, not an approved release schedule.

## Constraints

Resolve applicable Jaco decisions before gated operations. No IP, raw query,
corpus, token value/selector or production evidence in records. Auth verifiers
stay restricted. Serving never writes corpus. No cross-app imports, portal or
implicit heavy-usage enforcement. Locate the real RAGBot client; a Seeker client
or curl smoke cannot replace its release proof. Normal PR-to-main only.

## Verification

Execute the plan's section E tests, including failure and rollback cases relevant
to this deliverable. Run RAG tests, typecheck, lint, depcruise and isolated DB
role/integration checks; contract drift checks if changed. Record actual outcomes
without sensitive content. Complete only the implemented deliverable; shared-token
cutoff additionally requires both implementation tickets and Jaco's approval.
