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

Implement privacy-minimised, unsampled usage aggregates, coverage health and
read-only reports. **2026-09-29 direction supersedes the Jaco/RAGBot-only human
access policy: every admitted portal user can view every consumer's report.**
Existing GitHub login/session and current portal admission are sufficient; no
consumer ownership check, new human credential or report allowlist is required.
Consumer management remains owner-restricted. Retrieval keys do not grant reports.
Keep the optional independent operator/RAGBot HTTP/CLI capability for automation.

Add **Usage** beside RAG, Consumers and Knowledge. Jaco selected option A on 2026-09-29 after reviewing three
layouts: implement the table-first comparison with 20-row pagination and a UTC
date/time window. Consumer names open report details with the watermark and
generated time. The Usage script loads on demand; each protected batch reads up
to 20 consumers with one current admission check.
Use the selected layout to display request/success counts, last activity, UTC
window, complete-through watermark and honest partial/unavailable coverage.
All admitted users can select any registered consumer, including revoked consumers.
Do not expose credentials, owner contacts or corpus content.

Keep durable aggregates for growth insight; no raw sensitive events or retention
implementation. Synthetic HTTP acceptance and role tests precede actual ops
dogfood in feat-529. Accounting proves +3 then +2 requests, integration isolation,
denied revocation without a success increment and honest coverage rather than
false zero.
Use the plan's proposed types and counting contract. Start date/duration are
bookkeeping estimates, not an approved release schedule.

V1 has one runtime environment per consumer and no staging environment. Key
usage and reporting by stable consumer ID; no environment column, filter or
report argument. Credential rotation preserves usage identity.

## Constraints

Apply the approved decisions and resolve named implementation details before activation. No IP, raw query,
corpus, token value/selector or production evidence in records. Auth verifiers
stay restricted. Serving never writes corpus. No cross-app imports or implicit heavy-usage enforcement. Use the actual forge-rag-retrieve ops HTTP path in the dependent dogfood ticket. Normal PR-to-main only.

## Production report access

After production activation, all admitted portal users open **Usage** in the
existing `/portal` UI and select a UTC window and any consumer. Human access
uses the existing GitHub OAuth login and session cookie. Each protected read
rechecks the merged allowlist, stable GitHub identity and live Forge permission.
`GET /portal/usage?consumer=<UUID>&from=<UTC Z>&to=<UTC Z>` uses that session,
returns only aggregate fields and is never cached. No ownership restriction.

The authenticated `GET /internal/usage` endpoint and operator command remain
available for approved automation through independent report credentials:

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

The optional machine report credentials remain scoped to Jaco/RAGBot; this
restriction does not apply to session-authenticated portal reads. RAGBot must
first be created through feat-530's portal UI before its machine report grant.
The portal uses the restricted server-side report reader without exposing its
URL or credentials to the browser.
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

Accounting, machine reporting and selected **option A** portal comparison page
are implemented in the same draft PR. The Usage menu uses existing GitHub login
for every admitted user's all-consumer reports. UTC minute-aligned windows,
search, 20-row pagination, explicit partial/unavailable coverage and read-only
report details are included. Browser checks cover real local report reads,
coverage presentation, fully covered zero, pagination/search/window validation,
read failure, session expiry and responsive rendering. Initial Consumers page
loads no Usage script or report requests; measured resource/performance evidence
is recorded in the local verification document.

Production provisioning, RAGBot machine grant and actual ops dogfood remain
activation/dependent work; shared-token cutoff requires feat-529 and separate
approval. Capacity review remains feat-563. Production activation has not been
performed by this implementation.
