---
id: "feat-528"
title: "Deliver RAG consumer usage reporting"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-15"
duration: 4
depends_on: ["feat-526", "feat-527"]
blocks: ["feat-529", "feat-563"]
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

Implement plan sections C and E as a separate deliverable: privacy-minimised,
unsampled usage aggregates, coverage health/watermarks, restricted read-only
report capability restricted to Jaco and RAGBot (no general DB credential). Register RAGBot through the feat-530 portal UI with an allowlisted initial owner first; its later narrow internal reporting tool is separate from retrieval and ownership does not grant reports. Keep durable aggregates for growth insight; no raw sensitive events or retention/deletion implementation. Record future capacity review. Deliver synthetic HTTP acceptance tests; actual ops dogfood follows in feat-529. Report consumer
request count, successful count, last activity and UTC window. Prove +3 then +2
requests, second-integration isolation, denied revocation with no success
increment, and honest partial/unavailable coverage rather than false zero.

Use the plan's proposed types and counting contract. Start date/duration are
bookkeeping estimates, not an approved release schedule.

V1 has one runtime environment per consumer and no staging environment. Key
usage and reporting by stable consumer ID; no environment column, filter or
report argument. Credential rotation preserves usage identity.

## Constraints

Apply the approved decisions and resolve named implementation details before activation. No IP, raw query,
corpus, token value/selector or production evidence in records. Auth verifiers
stay restricted. Serving never writes corpus. No cross-app imports, portal or
implicit heavy-usage enforcement. Use the actual forge-rag-retrieve ops HTTP path in the dependent dogfood ticket. Normal PR-to-main only.

## Production report access

After production activation, Jaco reads reports with the operator command below
or the authenticated `GET /internal/usage` endpoint on the production RAG service.
The current delivery returns JSON; it does not add a portal report page.

```bash
pnpm --filter @forge/rag usage:report \
  --consumer "<consumer-uuid>" \
  --from "2026-10-01T00:00:00Z" \
  --to "2026-10-02T00:00:00Z"
```

The approved operator receiver injects `RAG_USAGE_REPORT_URL` (the production
service's `/internal/usage` URL) and `RAG_USAGE_REPORT_SECRET` from its secret
manager. Do not put the secret in command arguments. The output includes the
consumer label, request/success counts, last activity, UTC window and coverage.
Windows must be minute-aligned and at most 31 days. Partial coverage is visibly
marked; unavailable coverage exits nonzero rather than presenting a reliable zero.

Only Jaco and RAGBot receive independent report credentials. Portal ownership
and retrieval keys grant no report access. RAGBot must first be created through
feat-530's portal UI, then receive a separate report capability using the same
bounded endpoint; its later ops-tool integration is separate from retrieval.
Production requires the restricted metadata roles, server report configuration,
receiver secrets and independently maintained deployment inventory described in
[the operator runbook](../../../apps/rag/docs/ops/consumer-usage.md).
These activation steps and actual dogfood remain pending.

## Verification

Execute the plan's section E tests, including failure and rollback cases relevant
to this deliverable. Run RAG tests, typecheck, lint, depcruise and isolated DB
role/integration checks; contract drift checks if changed. Record actual outcomes
without sensitive content. Complete only the implemented deliverable; shared-token
cutoff additionally requires feat-529 and separate production cutover approval.

## Resolution

Implemented in [Forge draft PR #2455](https://github.com/JesusFilm/forge/pull/2455):
isolated usage accounting and report views, real HTTP
completion/disconnect accounting, independently maintained deployment inventory,
honest coverage gaps and crash reconciliation, and restricted read-only reporting.
See [local verification](evidence/feat-528/local-verification.md) and
[operator instructions](../../../apps/rag/docs/ops/consumer-usage.md).

The implemented deliverable is complete. Production provisioning, RAGBot portal
registration/report grant and actual ops dogfood remain activation/dependent
work; shared-token cutoff still requires feat-529 and separate approval.
Capacity review is feat-563. The PR is open for approach review; production
activation has not been performed.
