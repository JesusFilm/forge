---
id: "feat-204"
title: "Admin Datadog APM and RUM observability"
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
is visible as parse, validate, execute, resolver, Prisma, or external I/O. We
also need Admin browser RUM so client-side timings, long tasks, errors, session
replay samples, and GraphQL resource timings can be correlated to backend APM.

## Entry Points - Read These First

1. `apps/admin/src/instrumentation.ts` - Next.js server instrumentation startup.
2. `apps/admin/src/components/DatadogRum.tsx` - Admin Browser RUM startup.
3. `apps/admin/src/config/env.ts` - Admin server/client env contract.
4. `apps/admin/src/app/api/graphql/route.ts` - GraphQL Yoga endpoint.
5. `apps/admin/src/graphql/types/video.ts` - `videoBySlug` and Watch-facing
   `Video` fields.
6. `apps/admin/src/services/video.service.ts` - Video service paths used by
   Watch route snapshots.
7. `infra/datadog-agent/` - repo-owned Datadog Agent service definition.
8. `docs/observability/datadog.md` - operator setup and env variables.
9. `apps/admin/railway.toml` - documents that Admin Railway deploy config is
   dashboard-owned, not code-owned.

## Grep These

- `dd-trace`
- `configureDatadog`
- `DATADOG_GRAPHQL_CONFIG`
- `DatadogRum`
- `NEXT_PUBLIC_DATADOG`
- `datadog-agent-production`
- `preferredPlayableDub`
- `videoBySlug`

## What To Build

- Add the Datadog Node tracer to `@forge/admin`.
- Configure Datadog's built-in `graphql` integration for automatic parse,
  validate, execute, and resolver spans.
- Add Admin Browser RUM with React plugin, resource/action/long-task tracking,
  masked input privacy, session replay sampling, and Admin GraphQL trace
  propagation.
- Add Admin RUM env validation and sourcemap upload support.
- Add a repo-owned Datadog Agent Railway service definition for production APM
  trace transport.
- Document exact Datadog and Railway setup using the `Forge-production` API key.
- Keep GraphQL query source and variables out of Datadog tags.
- Document the Railway production preload/settings required for best automatic
  instrumentation.
- Verify focused tests and typecheck/lint for the observability modules.

## Constraints

- Prefer Datadog's automatic GraphQL integration over hand-rolled operation
  spans.
- Do not add Pothos tracing until Datadog output proves resolver spans are
  insufficient or ambiguous.
- Do not tag raw query text, GraphQL variables, slugs, bearer keys, cookies, IPs,
  or user identifiers.
- Do not commit Datadog API keys, RUM client tokens, or generated Railway
  private domains.
- `apps/admin/railway.toml` is dead config; production Railway changes must be
  applied through the dashboard or Railway service config tooling.

## Verification

- `pnpm --filter @forge/admin test -- src/observability/datadog.test.ts src/components/__tests__/DatadogRum.test.tsx`
- `pnpm --filter @forge/admin lint -- src/observability/datadog.ts src/observability/datadog.test.ts src/components/DatadogRum.tsx src/components/__tests__/DatadogRum.test.tsx src/app/layout.tsx src/config/env.ts`
- `git diff --check`
- `pnpm --filter @forge/admin typecheck` is currently blocked by unrelated
  current-main errors in `src/services/experience-ai/*`,
  `src/mastra/workflows/multi-step-draft-workflow.test.ts`, and
  `packages/experience-schema` missing `zod` resolution.
- Production deployment has `DD_SERVICE=forge-admin`, `DD_ENV=production`,
  `DD_VERSION=<git sha>`, `DD_AGENT_HOST`, `DD_TRACE_AGENT_PORT=8126`, and
  Datadog agent connectivity.
- Production `@forge/admin` process starts with Datadog loaded before GraphQL
  modules, ideally via `NODE_OPTIONS=--require dd-trace/init`.
- Production Admin RUM has `NEXT_PUBLIC_DATADOG_APPLICATION_ID`,
  `NEXT_PUBLIC_DATADOG_CLIENT_TOKEN`, `NEXT_PUBLIC_DATADOG_ENV=production`, and
  `NEXT_PUBLIC_DATADOG_VERSION=<same git sha as DD_VERSION>`.
- Admin sourcemaps upload with `pnpm --filter @forge/admin datadog:sourcemaps`
  using `DATADOG_RELEASE_VERSION=<same git sha as DD_VERSION>`.
- Datadog APM shows `graphql.parse`, `graphql.validate`, `graphql.execute`, and
  `graphql.resolve` spans for `GetWatchVideoRouteSnapshotBySlug`.
- Datadog RUM shows Admin views, resource timing for `/api/graphql`, errors,
  long tasks, and replay samples.

## Completion Notes

- Added `dd-trace` to `@forge/admin`.
- Added `src/observability/datadog.ts` to initialize Datadog with log injection,
  runtime metrics, service name `forge-admin`, and Datadog's built-in GraphQL
  integration.
- Configured GraphQL auto-instrumentation for all resolver depths, collapsed
  list paths, operation signatures, no raw query source, and no variables.
- Wired Datadog configuration from `src/instrumentation.ts` on the Node runtime.
- Added Admin Browser RUM bootstrap, env validation, root layout mount, tests,
  production sourcemaps, and `datadog:sourcemaps` upload script.
- Added `infra/datadog-agent/` as the repo-owned Railway Datadog Agent service
  definition.
- Documented Railway production Agent/APM/RUM/sourcemap setup in
  `docs/observability/datadog.md` and `apps/admin/CLAUDE.md`.
