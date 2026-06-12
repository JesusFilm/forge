---
title: "Web Watch Datadog RUM"
status: completed
date: "2026-06-11"
origin: "user request: establish Datadog for web/watch, mirroring Core apps/watch-modern"
roadmap: "docs/roadmap/platform/feat-182-web-watch-datadog-rum.md"
---

# Web Watch Datadog RUM

## Problem Frame

Forge `apps/web` has become the Watch surface but currently lacks the Datadog
RUM bootstrapping and source-map upload path that existed in the previous
Core `apps/watch-modern` app. The implementation should make Datadog available
in production/stage when credentials are configured, while keeping local and
preview environments bootable when Datadog env vars are absent.

## Scope Boundaries

- In scope: browser RUM initialization, React plugin wiring, existing error
  boundary reporting, env validation, source-map generation/upload script,
  `.env.example`, and focused tests.
- Out of scope: GTM, GA4, Meta Pixel, Algolia Insights, server APM, Datadog
  monitors/dashboards, and changing Watch analytics/event collection.
- Preserve the cacheable Watch App Router tree; do not add `headers()`,
  `cookies()`, or request-time dynamic APIs to `apps/web/src/app/[locale]`.
- Preserve existing user-facing error fallback UI.

## Decisions

1. Use a client-only initializer component in
   `apps/web/src/components/DatadogRum.tsx`.
   Rationale: this mirrors the previous app's client RUM init while leaving the
   server layout static.
2. Use service name `watch`.
   Rationale: the live production inventory used `service: watch`, and source
   maps must share the same service value as emitted RUM events.
3. Do not wrap the app in Datadog's React `ErrorBoundary`.
   Rationale: Forge already has App Router segment error boundaries; reporting
   those caught errors to RUM preserves current fallback behavior.
4. Enable `productionBrowserSourceMaps: true` and add a package script for
   Datadog source-map upload.
   Rationale: RUM errors are much more useful when their release version has
   matching browser source maps.
5. Make Datadog credentials optional.
   Rationale: local, CI, and preview environments should still boot without
   Datadog application id/client token.

## Existing Patterns

- Previous app reference:
  `https://github.com/JesusFilm/core/tree/main/apps/watch-modern`
- Prior init component:
  `apps/watch-modern/src/components/Datadog/Init/Init.tsx`
- Prior source-map target:
  `apps/watch-modern/project.json`
- Forge env schema:
  `apps/web/src/env.ts`
- Forge Watch layout:
  `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`
- Forge segment error boundaries:
  `apps/web/src/app/[locale]/[htmlLang]/error.tsx`
  `apps/web/src/app/[locale]/[htmlLang]/[...rest]/error.tsx`

## Implementation Units

### U1 - Env And Dependencies

Files:

- Modify `apps/web/package.json`
- Modify `pnpm-lock.yaml`
- Modify `apps/web/src/env.ts`
- Modify `apps/web/.env.example`

Approach:

- Add `@datadog/browser-rum` and `@datadog/browser-rum-react`.
- Add public env schema entries for application id, client token, site, env,
  and version.
- Default site to `datadoghq.com`, env to a normalized deployment env, and
  version to Railway/Vercel/git commit env when present.
- Add `datadog:sourcemaps` using `datadog-ci sourcemaps upload` with
  `--service=watch`, release version from `DATADOG_RELEASE_VERSION` or git env,
  and `--minified-path-prefix=/watch/_next/static/`.

Test scenarios:

- Missing Datadog vars does not fail env parsing.
- Provided Datadog vars are surfaced through `env`.
- Empty optional Datadog vars are treated as unset.

### U2 - Client RUM Bootstrap

Files:

- Create `apps/web/src/components/DatadogRum.tsx`
- Create `apps/web/src/components/__tests__/DatadogRum.test.tsx`
- Modify `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`

Approach:

- Add a `"use client"` component that checks config, guards duplicate init,
  and calls `datadogRum.init` with the React plugin.
- Mount it inside `NextIntlClientProvider` in the Watch layout.

Test scenarios:

- No application id/client token means no SDK init call.
- Application id/client token means one init call with service `watch`, env,
  version, privacy, sampling, and plugin config.
- Re-render does not initialize twice.

### U3 - Segment Error Reporting

Files:

- Modify `apps/web/src/app/[locale]/[htmlLang]/error.tsx`
- Modify `apps/web/src/app/[locale]/[htmlLang]/[...rest]/error.tsx`
- Extend `apps/web/src/components/__tests__/DatadogRum.test.tsx`

Approach:

- Export a small `reportDatadogRumError` helper from the client component
  module.
- Call it from both existing segment error boundary `useEffect` blocks with a
  boundary tag, then keep the current console-in-dev and fallback UI behavior.

Test scenarios:

- Reporting helper calls `datadogRum.addError` with boundary context.
- Reporting helper swallows SDK failures so error boundaries do not cascade.

### U4 - Source Maps

Files:

- Modify `apps/web/next.config.mjs`
- Covered by `apps/web/package.json` in U1.

Approach:

- Set `productionBrowserSourceMaps: true`.
- Keep the upload command opt-in; deployment orchestration can call it after a
  successful production build with `DATADOG_API_KEY` and release env set.

Test scenarios:

- `typecheck` accepts the Next config.
- Build-oriented validation is covered by existing CI after dependency install.

## Verification

- `pnpm --filter @forge/web test -- src/components/__tests__/DatadogRum.test.tsx src/env.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke: launch `apps/web` and load a representative Watch URL to
  confirm the page still renders with the RUM initializer mounted.

## Completion Evidence

- `pnpm install --frozen-lockfile --offline`
- `pnpm --filter @forge/web test -- src/components/__tests__/DatadogRum.test.tsx src/env.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Helium/agent-browser smoke:
  `http://127.0.0.1:4920/watch/life-of-jesus-gospel-of-john.html/english.html`
  rendered the Watch title, chapter carousel, Download, Bible Quotes, Search,
  and language controls.
- Screenshot:
  `output/playwright/web-watch-datadog-rum-smoke.png`
