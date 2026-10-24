---
id: "feat-274"
title: "Web Google Analytics integration"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "analytics"
  - "observability"
---

## Problem

`apps/web` has Datadog RUM for product observability, but no Google Analytics
tag for standard GA4 traffic reporting. Production needs a configurable browser
integration that can be disabled in local and preview environments until a
measurement id is provisioned.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - shared Watch layout
   where browser observability components are mounted.
2. `apps/web/src/components/DatadogRum.tsx` - existing optional browser
   telemetry component pattern.
3. `apps/web/src/env.ts` - typed public environment variable schema.
4. `apps/web/.env.example` - documented local and deployment env surface.

## Grep These

- `DatadogRum`
- `NEXT_PUBLIC_DATADOG`
- `NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID`
- `gtag`
- `usePathname`

## What To Build

1. Add an optional `NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID` client env var.
2. Render GA4 scripts only when the measurement id is configured.
3. Mount the integration in the shared Watch layout beside Datadog RUM.
4. Track App Router client-side navigation changes with `gtag("config", ...)`.
5. Track bounded custom events for high-value Watch interactions.
6. Add focused regression coverage for disabled, configured, route-change, and
   custom-event behavior.

## Constraints

- Do not hardcode the GA measurement id.
- Do not send server-side admin keys, user identifiers, query contents, or
  private GraphQL details to GA.
- Do not change Datadog RUM behavior.
- Keep local and preview environments quiet when the GA env var is unset.

## Verification

- `pnpm --filter @forge/web test -- src/components/__tests__/GoogleAnalytics.test.tsx src/env.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`

## Completion Notes

- Added `NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID` to the typed Web env
  schema and `.env.example`.
- Added an optional GA4 client component that renders no scripts when unset,
  bootstraps `gtag` when configured, and reports App Router client-side
  navigation changes.
- Mounted the component in the shared Watch layout beside Datadog RUM.
- Added GA4 custom events for search result clicks, download intent,
  language picker opens, share opens, and legacy-compatible video playback
  names: `videostarts`, `videoplay`, `video_pause`, `videocomplete`,
  `video_progress`, and `a_media_progress10/25/50/75/90`.
- GA event normalization strips the app-local `watch_` prefix before sending
  events to the property.
- Focused tests, typecheck, and lint passed.
