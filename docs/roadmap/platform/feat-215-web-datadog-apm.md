---
id: feat-215
title: Add Web Datadog APM and server log forwarding
status: in-progress
lane: platform
depends_on:
  - feat-182
  - feat-204
  - feat-210
blocks: []
---

## Problem

Production Watch single-video cold TTFB is still too slow, but Datadog only
shows Admin, Prisma, and Postgres spans. The `@forge/web` process is missing
server-side APM spans, so we cannot prove how much of the cold render is spent
inside Next route rendering, web data cache misses, route manifest fetches,
feature-flag calls, or HTML/RSC serialization.

## Scope

- Add `dd-trace` to `@forge/web` and initialize it from Next
  `src/instrumentation.ts` on the Node runtime.
- Keep GraphQL source and variables disabled in Datadog tracing.
- Forward web server console logs to the shared Railway Datadog Agent over
  syslog UDP when `DD_AGENT_HOST` is configured.
- Add `apps/web/railway.toml` so the runtime start command can preload
  `dd-trace/init` without setting global `NODE_OPTIONS` during Railpack setup.
- Align Web RUM, sourcemap upload, APM, and logs on service name `forge-web`.
- Document the exact production Railway variables and Config-as-code setup.

## Verification

1. `pnpm --filter @forge/web test -- env DatadogRum`
2. `pnpm --filter @forge/web exec eslint src/instrumentation.ts src/observability/datadog.ts src/observability/datadog-logs.ts src/env.ts src/env.test.ts src/components/DatadogRum.tsx src/components/__tests__/DatadogRum.test.tsx`
3. `pnpm --filter @forge/web typecheck`
4. `ADMIN_GRAPHQL_URL=http://localhost:3003/api/graphql WEB_ADMIN_API_KEYS=test-admin-bearer-key REVALIDATION_SECRET=test-revalidation-secret STRAPI_PREVIEW_SECRET=test-preview-secret pnpm --filter @forge/web build`

## Production Follow-Up

After merge, set the `@forge/web` Railway service Config-as-code Path to
`apps/web/railway.toml`, configure the Datadog env vars documented in
`apps/web/CLAUDE.md`, deploy, then confirm Datadog APM has `service:forge-web`
spans for `https://watch.jesusfilm.org/watch/jesus.html/english.html`.
