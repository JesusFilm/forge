---
id: "feat-302"
title: "Admin GraphQL OTel operation spans"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on:
  - "feat-204"
blocks: []
tags:
  - "platform"
  - "admin"
  - "graphql"
  - "datadog"
  - "opentelemetry"
  - "observability"
---

## Problem

Production Datadog APM and Continuous Profiler collapse Admin GraphQL root
requests under generic `POST` / `POST <empty>` resources. Operators need
operation-level spans for requests such as `watchLanguageInventory` without
breaking the existing Datadog trace backbone from Web to Admin to Prisma and
Postgres.

## Entry Points

1. `apps/admin/src/observability/datadog.ts` - Datadog tracer startup and OTel
   provider registration.
2. `apps/admin/src/graphql/plugins/opentelemetry.ts` - Envelop OpenTelemetry
   plugin configuration.
3. `apps/admin/src/app/api/graphql/route.ts` - Yoga endpoint plugin list.
4. `apps/admin/CLAUDE.md` - Datadog privacy constraints for GraphQL payloads.

## Completion Notes

- Kept `dd-trace` as the Admin tracing/profiling/runtime-metrics backbone.
- Registered Datadog's OTel `TracerProvider` so official Envelop OTel spans are
  emitted through Datadog instead of a separate OTLP exporter.
- Added `@envelop/opentelemetry` to the Yoga plugin stack for operation-level
  GraphQL execution spans.
- Disabled raw GraphQL document, variables, result, and resolver-level capture.
- Left Datadog's existing GraphQL plugin enabled for the first rollout to avoid
  disturbing Web -> Admin -> Prisma trace continuity before production
  verification.

## Verification

- `pnpm --filter @forge/admin test -- src/observability/datadog.test.ts src/graphql/plugins/opentelemetry.test.ts src/components/__tests__/DatadogRum.test.tsx`
- `pnpm --filter @forge/admin lint -- src/observability/datadog.ts src/observability/datadog.test.ts src/graphql/plugins/opentelemetry.ts src/graphql/plugins/opentelemetry.test.ts src/app/api/graphql/route.ts`
- `pnpm --filter @forge/admin typecheck`
- `git diff --check`
