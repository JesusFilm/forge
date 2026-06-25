---
id: "feat-204"
title: "Admin Datadog GraphQL tracing"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-25"
duration: 1
depends_on:
  - "feat-203"
blocks: []
tags:
  - "platform"
  - "admin"
  - "watch-page"
  - "performance"
  - "graphql"
  - "datadog"
---

## Problem

The Watch selected-dub projection reduced payload size, but production probes
still showed 6-8 second Admin GraphQL latency for `videoBySlug` route
snapshots. The next bottleneck is not obvious from response size or code
inspection. We need production GraphQL timing inside Datadog so the slow phase
is visible as parse, validate, execute, resolver, Prisma, or external I/O.

## Entry Points - Read These First

1. `apps/admin/src/instrumentation.ts` - Next.js server instrumentation startup.
2. `apps/admin/src/app/api/graphql/route.ts` - GraphQL Yoga endpoint.
3. `apps/admin/src/graphql/types/video.ts` - `videoBySlug` and Watch-facing
   `Video` fields.
4. `apps/admin/src/services/video.service.ts` - Video service paths used by
   Watch route snapshots.
5. `apps/admin/railway.toml` - documents that Admin Railway deploy config is
   dashboard-owned, not code-owned.

## Grep These

- `dd-trace`
- `configureDatadog`
- `DATADOG_GRAPHQL_CONFIG`
- `preferredPlayableDub`
- `videoBySlug`

## What To Build

- Add the Datadog Node tracer to `@forge/admin`.
- Configure Datadog's built-in `graphql` integration for automatic parse,
  validate, execute, and resolver spans.
- Keep GraphQL query source and variables out of Datadog tags.
- Document the Railway production preload/settings required for best automatic
  instrumentation.
- Verify focused tests and typecheck for the observability module.

## Constraints

- Prefer Datadog's automatic GraphQL integration over hand-rolled operation
  spans.
- Do not add Pothos tracing until Datadog output proves resolver spans are
  insufficient or ambiguous.
- Do not tag raw query text, GraphQL variables, slugs, bearer keys, cookies, IPs,
  or user identifiers.
- `apps/admin/railway.toml` is dead config; production Railway changes must be
  applied through the dashboard or Railway service config tooling.

## Verification

- `pnpm --filter @forge/admin test -- src/observability/datadog.test.ts`
- `pnpm --filter @forge/admin lint -- src/observability/datadog.ts src/observability/datadog.test.ts src/instrumentation.ts`
- `pnpm --filter @forge/admin exec tsc --noEmit --pretty false --skipLibCheck --moduleResolution bundler --module preserve --target es2022 --jsx preserve --esModuleInterop --allowSyntheticDefaultImports src/observability/datadog.ts src/observability/datadog.test.ts`
- `git diff --check`
- `pnpm --filter @forge/admin typecheck` is currently blocked by unrelated
  current-main errors in `src/services/experience-ai/*`,
  `src/mastra/workflows/multi-step-draft-workflow.test.ts`, and
  `packages/experience-schema` missing `zod` resolution.
- Production deployment has `DD_SERVICE=forge-admin`, `DD_ENV=production`,
  `DD_VERSION=<git sha>`, and Datadog agent connectivity.
- Production `@forge/admin` process starts with Datadog loaded before GraphQL
  modules, ideally via `NODE_OPTIONS=--require dd-trace/init`.
- Datadog APM shows `graphql.parse`, `graphql.validate`, `graphql.execute`, and
  `graphql.resolve` spans for `GetWatchVideoRouteSnapshotBySlug`.

## Completion Notes

- Added `dd-trace` to `@forge/admin`.
- Added `src/observability/datadog.ts` to initialize Datadog with log injection,
  runtime metrics, service name `forge-admin`, and Datadog's built-in GraphQL
  integration.
- Configured GraphQL auto-instrumentation for all resolver depths, collapsed
  list paths, operation signatures, no raw query source, and no variables.
- Wired Datadog configuration from `src/instrumentation.ts` on the Node runtime.
- Documented Railway production preload/settings in `apps/admin/CLAUDE.md`.
