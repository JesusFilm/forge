---
id: "feat-226"
title: "TV RUM instrumentation depth: route views, GraphQL op attribution, render timing"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-07-04"
duration: 3
depends_on: []
blocks: []
tags:
  - "platform"
  - "tv"
  - "observability"
  - "graphql"
---

## Problem

The shipped TV RUM (PR #1434) captures sessions, resources, errors, and logs — but three gaps keep it from answering real performance questions. (1) Expo-router route changes are not tracked as RUM views, so every event lands under the implicit `ApplicationLaunch` view and "which screen regressed?" is unanswerable. (2) Every Apollo call POSTs to `/api/graphql`, so per-operation slicing (the 835KB series query vs search) is impossible. (3) The dominant felt cost from the 2026-06-30 perf sweep — ~2.8-3.2s client-side parse/render on series detail — has no tracked number. Bonus gap from review finding #6: an async SDK init failure is completely silent (telemetry dead, app fine, nothing in logs).

## Entry Points — Read These First

1. `apps/tv/src/components/DatadogRum.tsx` — `TvDatadogProvider`; new instrumentation hooks mount here or beside it.
2. `apps/tv/src/lib/datadog.ts` — pure helpers (`reportDatadogError`, `datadogLog`, `toFirstPartyHostConfigs`); new pure logic goes here with colocated tests.
3. `apps/tv/app/_layout.tsx` — the expo-router `Stack`; route-change observation lives inside the router context.
4. `apps/tv/src/lib/apolloClient.ts` — the Apollo link chain (`authLink.concat(HttpLink)`); the operation-name link slots in here.
5. `apps/tv/app/series/[slug].tsx` + `apps/tv/src/lib/normalizeVideo.ts` — the series parse/render path to bracket with a custom timing.
6. `docs/brainstorms/2026-06-30-tv-client-performance-sweep-requirements.md` — the perf baseline these metrics must make measurable.

## Grep These

- `DdRum` and `startView` (in `@datadog/mobile-react-native` typings)
- `DATADOG_GRAPH_QL_OPERATION_NAME_HEADER` (exported by `@datadog/mobile-react-native` — no extra package needed)
- `usePathname` / `useSegments` (expo-router)
- `addTiming`
- `GetSeriesBySlug` (the heavy series operation)
- `onInitialization` (DatadogProvider prop, SDK typings)

## What To Build

1. **Route-level RUM views**: a small component (mounted inside the router, gated on `getDatadogRumConfig() != null`) that watches `usePathname()` and calls `DdRum.startView(pathname, pathname)` on change. Fire-and-forget with `.catch(() => undefined)` per the established never-throw pattern.
2. **Per-operation GraphQL attribution**: an `ApolloLink` before `HttpLink` that sets the SDK's exported GraphQL headers (`DATADOG_GRAPH_QL_OPERATION_NAME_HEADER`, optionally operation type) from `operation.operationName` — the SDK's resource interceptor picks these up and attaches them to RUM resources. Pure mapping logic in `datadog.ts` with tests.
3. **Series render timing**: `DdRum.addTiming("series_first_rail_ready")` fired when the series screen's lean query has normalized and the first rail is rendered — turns the perf sweep's ~3s felt cost into a per-view tracked metric.
4. **Dev-visible init-failure signal** (review finding #6 remainder): pass `onInitialization` to `DatadogProvider` (or a delayed `__DEV__` check) that `console.warn`s if the SDK has not initialized within ~10s of a provisioned mount — closes the "provisioned but native init rejected -> silently dead telemetry" hole.

## Constraints

- Telemetry must never throw into app code — mirror the existing null-gate + `.catch(() => undefined)` patterns in `datadog.ts`.
- Do not rename GraphQL operations to make attribution work; attribution adapts to existing names.
- Keep the search-keyboard privacy fix intact (`dd-action-name="keyboard-key"` on KeyButton) — do not let view/action instrumentation reintroduce per-letter names.
- Follow the WatchSessionProvider precedent: providers stay thin shells over pure exported helpers that get unit-tested directly (apps/tv has no @testing-library/react-native).

## Verification

- RUM Explorer shows one view per visited route (home, series, watch, search) instead of only `ApplicationLaunch`.
- RUM resources for GraphQL calls carry the operation name (facetable in the explorer); the series query is distinguishable from search.
- The series view shows the `series_first_rail_ready` custom timing with values in the expected ~2-4s range on a cold sim load.
- With creds provisioned but the native module absent (JS-only reload against a stale binary), the dev console warns about failed init within ~10s.
- `pnpm --filter @forge/tv test && pnpm --filter @forge/tv typecheck && pnpm --filter @forge/tv lint` green; new pure helpers have colocated tests.
