---
id: "feat-182"
title: "Web Watch Datadog RUM"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "observability"
  - "datadog"
---

## Problem

Forge `apps/web` now serves the redesigned Watch experience, but it does not
yet initialize Datadog RUM or provide a source-map upload path. The previous
Core `apps/watch-modern` app initialized Datadog RUM on the client, reported
React errors through the RUM SDK, enabled production browser source maps, and
had a Datadog source-map upload target. Forge Watch needs equivalent
observability without changing the static App Router render contract.

## Entry Points - Read These First

1. `docs/plans/2026-06-11-005-feat-web-watch-datadog-rum-plan.md` -
   implementation plan for this observability slice.
2. `apps/web/src/env.ts` - public Datadog env validation and Railway/Vercel
   release fallback wiring.
3. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - cacheable Watch layout
   where the client-only RUM initializer should mount.
4. `apps/web/src/app/[locale]/[htmlLang]/error.tsx` and
   `apps/web/src/app/[locale]/[htmlLang]/[...rest]/error.tsx` - existing
   client segment error boundaries to report to Datadog without replacing
   their fallback UI.
5. `apps/web/next.config.mjs` and `apps/web/package.json` - production browser
   source maps and Datadog source-map upload script.
6. Prior app reference:
   `https://github.com/JesusFilm/core/tree/main/apps/watch-modern`.

## What To Build

1. Add optional public Datadog RUM env vars for application id, client token,
   site, environment, and release version.
2. Add Datadog RUM browser dependencies to `@forge/web`.
3. Add a client-only initializer that no-ops when application id or client
   token is absent, and initializes RUM with service `watch`, resource/user
   interaction/long-task tracking, session replay sampling, privacy masking,
   tracecontext propagation for Jesus Film API hosts, and the React plugin.
4. Mount the initializer inside the Watch layout without introducing
   request-time dynamic APIs into the static route tree.
5. Report existing Watch segment-boundary errors to RUM while preserving the
   current fallback UI.
6. Enable production browser source maps and add a Datadog source-map upload
   script that uses the same service and release version as RUM.
7. Document required env vars in `apps/web/.env.example`.

## Verification

- Focused tests prove the RUM initializer no-ops without credentials and calls
  `datadogRum.init` with the expected service/env/version/sampling/plugin
  config when credentials are present.
- Focused tests prove segment boundary errors are reported to Datadog.
- `pnpm --filter @forge/web test -- src/components/__tests__/DatadogRum.test.tsx src/env.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke confirms a Watch page still renders after the initializer is
  mounted.

## Completion Notes

- Added optional Datadog RUM env validation and documented the Railway/Vercel
  env/release fallbacks in `apps/web/.env.example`.
- Added `@datadog/browser-rum` and `@datadog/browser-rum-react`, a client-only
  `DatadogRum` initializer mounted from the Watch layout, and RUM reporting for
  the existing Watch segment error boundaries.
- Enabled production browser source maps and added
  `pnpm --filter @forge/web datadog:sourcemaps` for release uploads using
  service `watch`.
- Verified focused tests, typecheck, lint, frozen offline install, and Helium
  browser smoke on
  `http://127.0.0.1:4920/watch/life-of-jesus-gospel-of-john.html/english.html`.

## Plan

Implementation plan:
`docs/plans/2026-06-11-005-feat-web-watch-datadog-rum-plan.md`
