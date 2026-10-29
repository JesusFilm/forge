---
id: "feat-908"
title: "Recover durable Manager to Mastra enrichment execution"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-28"
duration: 5
depends_on:
  - "feat-892"
  - "feat-907"
blocks: []
tags: [manager, mastra, enrichment, security]
---

## Scope

Recover PR #1087 with real source, correction, translation, chapters, metadata,
embeddings and optional scene analysis. Manager owns durable job state and Mux
publication; Admin owns atomic execution authority; Mastra owns provider work.

## Entry Points

- `apps/mastra/src/services/video-enrichment/graph.ts`
- `apps/mastra/src/server/enrichment-admission-store.ts`
- `apps/manager/src/lib/enrichment-execution.ts`
- `apps/manager/src/lib/enrichment-artifact-namespace.ts`
- `apps/admin/src/services/manager-execution.service.ts`
- `docs/plans/2026-10-28-manager-enrichment-graph.md`
- `docs/plans/2026-10-28-manager-job-artifact-isolation.md`

## Constraints

Preserve default-off flags, dedicated service authorization, durable at-most-once
admission, per-stage operation claims, revision-checked callbacks and job-owned
artifact namespaces. Ambiguous provider outcomes stay consumed for explicit
reconciliation. Explicit unsupported source modes fail before provider spending.
No cross-app imports, paid-provider acceptance calls, activation or deployment.

## Verification

Run the full Manager and Mastra suites, Admin fencing/revision concurrency tests,
typechecks, strict lint, generated-schema drift checks and production builds.
Exercise the committed workflow through actual Manager HTTP handlers and Admin
GraphQL into disposable PostgreSQL, with deterministic external provider adapters.
Repeat independent review after material fixes. Publish the existing PR only
after its declared stack and checks are validated.
