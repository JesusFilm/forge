---
title: "Admin search trace retention and sampling ownership pattern"
date: "2026-05-26"
category: "platform"
module: "apps/admin"
problem_type: "architecture_pattern"
component: "database"
severity: "high"
applies_when:
  - "Admin records production search traces for eval sampling or quality analysis"
  - "Raw per-query search data must expire under a hard 30-day retention ceiling"
  - "Mastra needs future eval input without joining the live search path or reading Admin Postgres"
tags:
  - admin
  - search
  - retention
  - sampling
  - mastra
  - pgvector
  - privacy
  - observability
related:
  - "docs/solutions/integration-issues/mastra-studio-api-auth-guard.md"
  - "docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md"
  - "docs/solutions/architecture-patterns/db-backed-vs-env-csv-credential-storage-20260518.md"
  - "docs/solutions/platform/admin-hybrid-search-r4-pattern.md"
  - "docs/solutions/workflow-issues/new-step-in-durable-workflow-loop-needs-worker-restart-after-deploy.md"
last_updated: "2026-09-30"
---

# Admin Search Trace Retention Pattern

## Context

Mastra owns background embedding workflows, provider calls, retries,
diagnostics, and Studio observability. Admin owns live search orchestration,
live query embedding generation, vector storage, public REST/GraphQL contracts,
production search traces, retention, aggregates, and sampling contracts.

That ownership line matters because production user search must not depend on a
Mastra workflow hop. Search tracing exists to improve later eval work, not to
move the live request path.

## Pattern

- Store short-lived raw traces in Admin only. `search_trace` may contain query
  text only after deterministic first-pass privacy handling has normalized,
  labeled, and redacted obvious sensitive or abusive input.
- Keep query usefulness labels separate from privacy labels. Deterministic
  rules write `queryQualityLabel`, `sensitiveQueryLabel`, `abuseLabel`, rule
  source/version, and label timestamp. Optional LLM review writes only
  LLM-specific label/provenance fields and must run outside live search.
- Expire raw traces before the legal/product ceiling. The default and maximum
  `SEARCH_TRACE_RAW_RETENTION_DAYS` is 29 days, giving the daily purge workflow
  a one-day margin before the 30-day raw-retention limit.
- Keep aggregate rollups query-free. `search_trace_aggregate` stores counts and
  non-query dimensions only, so it can survive raw trace deletion.
- Keep trace writes out of the availability path. GraphQL `Query.watchSearch`
  puts each trace on a bounded queue that runs after the response
  (`enqueueWatchSearchTrace`). A full queue drops the trace. The Experience
  editor video library search awaits `recordSearchTraceSafely` behind a short
  timeout. Both paths swallow write failures. Safe counters and key/value logs
  show the loss without query text.
- Sample through Admin HTTP only. Future Mastra eval jobs use
  `POST /api/internal/search-traces/sample` with
  `SEARCH_TRACE_SAMPLING_API_KEYS`; Mastra must not import Admin packages or
  read Admin Postgres directly.
- Enforce retention before raw capture in production. The trace writer reads
  the retention health: a fresh scheduler heartbeat or a recent successful
  purge. If the health is not healthy, the writer runs
  `purgeExpiredSearchTraces` inline, logs `event=trace_retention_inline_purge`,
  and then stores the raw row (feat-272). Only an explicit
  `retentionHealthy: false` input disables raw capture.
- Treat stale retention schedulers as unhealthy. A QUEUED/RUNNING scheduler
  ledger only counts as healthy when its `updatedAt`/`createdAt` heartbeat is
  inside the health window; startup marks stale active ledgers failed before
  creating a replacement. Neither check reads the runtime status of the run,
  so a fresh ledger can hide a dead run until the heartbeat goes stale.
- Keep the sampling route deliberately narrow. It accepts JSON-only bounded
  request bodies, strict typed filters, a dedicated sampling bearer allowlist,
  and rejects public `jfp_search_*` partner-token shaped values even if one is
  accidentally pasted into the sampling environment variable.
- Default sampling to conservative eval candidates: valid viewer intent,
  non-sensitive, non-abusive, sample-eligible, unexpired rows only. Catalog,
  ambiguous, sensitive, abusive, or LLM-candidate classes require explicit
  allowlisted filters.

## Data Safety Rules

Raw trace rows must not store bearer tokens, cookies, IP addresses, full user
identifiers, caller-supplied key ids, vectors, or debug scoring payloads.
Aggregate rows and workflow ledger details must not store raw query text.

Sensitive rows are redacted and marked non-sampleable by default. The only data
that may survive raw deletion is aggregate data or future human-approved,
sanitized eval queries created by a separate approval workflow.

Query quality labels are not moderation controls in the live path. They do not
censor, rerank, or alter REST/GraphQL search results; they only explain trace
sampling and later eval workflows.

## Implementation Anchors

- Schema: `apps/admin/prisma/schema.prisma` models `SearchTrace` and
  `SearchTraceAggregate`.
- Capture: `apps/admin/src/services/search-trace.service.ts`.
- Privacy labels: `apps/admin/src/services/search-trace-privacy.ts`.
- Purge and health: `apps/admin/src/services/search-trace-retention.service.ts`
  and `apps/admin/src/services/search-trace-retention/job.ts`.
- Scheduler: `apps/admin/src/workflows/searchTraceRetention.ts`, started by
  `apps/admin/src/instrumentation.ts`.
- Public instrumentation: `apps/admin/src/graphql/queries/watch-search.ts`
  (`Query.watchSearch`). PR #1622 removed REST `/api/search` and GraphQL
  `Query.search`.
- Internal sampling:
  `apps/admin/src/app/api/internal/search-traces/sample/route.ts`.
- Deterministic labels:
  `apps/admin/src/services/search-trace-privacy.ts`.
- Optional offline classifier:
  `apps/admin/src/services/search-trace-query-classifier.ts`.

## Gotchas

- A daily purge with a 30-day raw expiry can retain rows for almost 31 days.
  Use 29-day expiry with daily purge.
- Do not add a public GraphQL trace field. The sampling contract is internal
  REST, bearer-gated, bounded, and rate-limited.
- Do not log raw queries on trace failures. Logs should use
  `[search] event=... key=value` and safe dimensions only.
- Do not let a long-lived scheduler ledger mask a dead retention loop. Health
  must use a fresh scheduler heartbeat or a recent successful purge.
- A fresh heartbeat does not prove a live run. A replay failure at worker boot
  can leave a fresh `running` ledger row beside a `failed` runtime run. The
  boot check reads only the heartbeat age, so a worker restart inside the
  health window does not repair the loop. After a deploy that changes the
  durable call sequence of `runSearchTraceRetentionScheduler`, read the
  runtime status of the run. The new-step learning in `related` gives the
  procedure.
- Do not add LLM classification to the live search path, GraphQL
  `Query.watchSearch`. The classifier is bounded eval code for sampled traces
  only.
