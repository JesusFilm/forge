---
title: "Datadog RN resourceEventMapper is FileBasedConfiguration-only — mobile content-key RUM attribution pivoted to GraphQL op-name headers"
date: "2026-07-15"
category: integration-issues
module: apps/mobile
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "Neither `DatadogProviderConfiguration` (config/DatadogProviderConfiguration.d.ts) nor its parent `CoreConfiguration` (config/features/CoreConfiguration.d.ts) constructor declares a `resourceEventMapper` parameter — only `FileBasedConfiguration` (config/FileBasedConfiguration.d.ts) does, as a named top-level constructor arg"
  - "The plan's U2 step (docs/plans/2026-07-14-001-feat-mobile-datadog-observability-plan.md KTD5) had no supported config surface to attach a per-resource content key to on the `<DatadogProvider configuration={...}>` path apps/mobile/src/components/DatadogRum.tsx already uses"
  - "Switching to `FileBasedConfiguration` would give up the env-var provisioning gate (`getDatadogRumConfig()` in apps/mobile/src/lib/datadog.ts:70-98) that lets a creds-less build no-op telemetry instead of requiring a native config file"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - development_workflow
tags:
  [
    datadog,
    react-native,
    graphql,
    apollo-client,
    rum,
    trace-correlation,
    resource-event-mapper,
    first-party-hosts,
  ]
---

# Datadog RN resourceEventMapper is FileBasedConfiguration-only — mobile content-key RUM attribution pivoted to GraphQL op-name headers

## Problem

The mobile Datadog observability plan (`docs/plans/2026-07-14-001-feat-mobile-datadog-observability-plan.md`, KTD5) called for attaching a bounded content-key attribute — `slug` for `videoBySlug`, `coreIds` for `watchHomeVideos`, `search_request_id` for search — directly onto each GraphQL RUM resource event, via `@datadog/mobile-react-native@3.5.2`'s `resourceEventMapper` hook. That hook is real and documented, but it is not reachable from the config class this app actually uses to stand up the SDK, so the planned "attach an attribute mapper in provider config" approach was infeasible as scoped.

## Symptoms

- `apps/mobile/src/components/DatadogRum.tsx:68-93` constructs `new DatadogProviderConfiguration(config.clientToken, config.envName, TrackingConsent.GRANTED, { ..., rumConfiguration: { applicationId, trackInteractions, trackResources, trackErrors, nativeCrashReportEnabled, sessionSampleRate, resourceTraceSampleRate, firstPartyHosts } })` — no `resourceEventMapper` field, by design; there is no supported way to add one on this constructor.
- Reading the installed package's type declarations directly confirms the split:
  - `node_modules/.pnpm/@datadog+mobile-react-native@3.5.2.../lib/typescript/config/FileBasedConfiguration.d.ts` — `FileBasedConfiguration`'s constructor takes `{ configuration?, errorEventMapper?, resourceEventMapper?, actionEventMapper? }` as **named, top-level, documented parameters**.
  - `node_modules/.pnpm/@datadog+mobile-react-native@3.5.2.../lib/typescript/config/DatadogProviderConfiguration.d.ts` and `.../config/features/CoreConfiguration.d.ts` — the class the app actually instantiates — declare **no** `resourceEventMapper` parameter anywhere in their constructors.
- (Deeper grounding note, not part of the original blocker but found while verifying the claim: `RumConfigurationType` — the interface backing `CoreConfiguration.rumConfiguration`, per `.../config/features/RumConfiguration.type.d.ts` — nominally _includes_ `resourceEventMapper` in its shape, and `DdSdkReactNative.js`'s `enableFeatures()` (`.../lib/module/DdSdkReactNative.js:336,370-372`) registers `configuration.rumConfiguration?.resourceEventMapper` unconditionally, regardless of which config class supplied it. So the field is technically reachable by manually nesting it inside `rumConfiguration` on `DatadogProviderConfiguration` too — but this is not how Datadog documents or exemplifies the hook anywhere, `FileBasedConfiguration` is the only class with a dedicated, discoverable constructor param for it, and relying on an unexemplified nested field is exactly the kind of undocumented-surface risk the team correctly declined to build on.)

## What Didn't Work

- Passing `resourceEventMapper` under `rumConfiguration` in the programmatic path was the plan's stated approach (KTD5) but was never actually implementable against a _documented_ API — the only class Datadog exemplifies the hook on is `FileBasedConfiguration`, which reads from a native/JSON-driven config rather than the JS-constructed object this app passes to `<DatadogProvider configuration={...}>`.
- Re-architecting onto `FileBasedConfiguration` to unlock the hook was considered and rejected: it would abandon the env-var-driven provisioning gate in `getDatadogRumConfig()` (`apps/mobile/src/lib/datadog.ts:70-98`) that lets a creds-less build boot with telemetry as a no-op, and would diverge from the programmatic-config pattern the app otherwise uses end-to-end in `DatadogRum.tsx`.

## Solution

**Path A**: attribute the RUM resource through the GraphQL operation name/type headers the SDK's XHR proxy already recognizes natively (no mapper needed), and reserve a purpose-built bounded join key for the one case — search — where the useful correlation value isn't an operation name.

Before (the plan's intended approach — not implemented; sketch only, per KTD5):

```ts
// apps/mobile/src/components/DatadogRum.tsx — NOT what shipped
rumConfiguration: {
  applicationId: config.applicationId,
  // ...
  resourceEventMapper: (event) => {
    // intended: attach a bounded content key (slug / coreIds / search_request_id)
    // based on which operation produced this resource
    event.context.content_key = contentKeyForOperation(event)
    return event
  },
}
```

After (shipped — GraphQL op-name/type headers via an Apollo link, read natively by the SDK's XHR proxy):

```ts
// apps/mobile/src/lib/datadog.ts:126-140
// The SDK's XHR interception strips these headers post-init and attaches the
// operation name/type to the RUM resource; anonymous operations get none.
export function datadogGraphqlHeaders(
  operationName: string | undefined,
  operationType: string | undefined,
): Record<string, string> {
  if (!operationName) return {}
  const headers: Record<string, string> = {
    [DATADOG_GRAPH_QL_OPERATION_NAME_HEADER]: operationName,
  }
  if (operationType) {
    headers[DATADOG_GRAPH_QL_OPERATION_TYPE_HEADER] = operationType
  }
  return headers
}
```

```ts
// apps/mobile/src/lib/apolloClient.ts:83-99
// Datadog op-name/type attribution rides every named op. RUM's XHR proxy maps
// these onto the RUM resource, so trackResources attributes each GraphQL
// resource by operation (path A content correlation — no resource attribute).
const datadogLink = new ApolloLink((operation, forward) => {
  const def = getMainDefinition(operation.query)
  mergeContextHeaders(
    operation,
    datadogGraphqlHeaders(
      operation.operationName,
      def.kind === "OperationDefinition" ? def.operation : undefined,
    ),
  )
  return forward(operation)
})

// Unprovisioned builds skip the attribution link entirely (null-gate).
return isDatadogProvisioned() ? authLink.concat(datadogLink) : authLink
```

For search specifically — where the correlation value that matters is a request identity, not an operation name, and the raw query term must never leave the device as a join key — a bounded, monotonic id is generated client-side and threaded through structured Logs instead of a RUM resource attribute:

```ts
// apps/mobile/src/lib/watchSearchLog.ts:9-15
let searchRequestCounter = 0

/** Fresh correlation id for one search; monotonic within the JS process. */
export function generateSearchRequestId(): string {
  searchRequestCounter += 1
  return `search-${searchRequestCounter}`
}
```

```ts
// apps/mobile/app/(tabs)/watch.tsx:291-293, 320-326
// One correlation id per search, joined by result_clicked (R33/R35).
const searchRequestId = generateSearchRequestId()
searchRequestIdRef.current = searchRequestId
// ...
datadogLog.info("watch_search", {
  term: trimmed,
  outcome,
  result_count,
  latency_ms: Date.now() - startedAt,
  request_type: "initial",
  search_request_id: searchRequestId,
})
```

> **Superseded 2026-08-04 (mobile search observability parity, feat-334):**
> the two snippets above show retired shapes. The monotonic counter id was
> replaced by a UUID (admin's echoed request id adopted on success), and the
> log now uses the shared cross-client message `watch_search analytics` with
> `watch_search.*`-prefixed attributes (raw text under `watch_search.query`;
> no bare `term` field). The Log-not-RUM principle this section illustrates
> still holds. Runbook: `docs/operations/watch-search-analytics-datadog.md`.

Trace linking (RUM → APM) is a fully independent mechanism that needed no mapper at all — it rides on `firstPartyHosts` + the W3C `traceparent` header:

```ts
// apps/mobile/src/lib/datadog.ts:34-42
/** Maps bare hosts to the SDK's first-party shape (tracecontext → admin APM). */
export function toFirstPartyHostConfigs(
  hosts: string[],
): { match: string; propagatorTypes: PropagatorType[] }[] {
  return hosts.map((match) => ({
    match,
    propagatorTypes: [PropagatorType.TRACECONTEXT],
  }))
}
```

```ts
// apps/mobile/src/components/DatadogRum.tsx:80-91
rumConfiguration: {
  applicationId: config.applicationId,
  trackInteractions: true,
  trackResources: true, // auto-instruments fetch/XHR into per-request RUM
  trackErrors: true,
  nativeCrashReportEnabled: true,
  sessionSampleRate: config.sessionSampleRate,
  resourceTraceSampleRate: 100,
  firstPartyHosts: toFirstPartyHostConfigs(config.firstPartyHosts),
},
```

## Why This Works

Tracing the installed SDK's transpiled runtime confirms the header-based path is the SDK's actual, first-class mechanism for GraphQL attribution (not a workaround): `XHRProxy.js`'s `setRequestHeader` override recognizes `DATADOG_GRAPH_QL_OPERATION_NAME_HEADER`/`_TYPE_HEADER` (exported constants, `.../lib/module/rum/instrumentation/resourceTracking/graphql/graphqlHeaders.js:7-9`, also re-exported from the package's public `index.js`) and stores them on the proxied XHR's `_datadog_xhr.graphql` bag (`.../requestProxy/XHRProxy/XHRProxy.js:196-201`). `ResourceReporter.js`'s `formatResourceStopContext` (`.../requestProxy/XHRProxy/DatadogRumResource/ResourceReporter.js:34-51`) then folds `graphqlAttributes.operationType`/`operationName` into the native resource context as `_dd.graphql.operation_type` / `_dd.graphql.operation_name` before calling `DdRum.stopResource`. This is a documented, purpose-built recognized-header path — unlike `resourceEventMapper`, which is only exemplified off `FileBasedConfiguration`.

Trace linking is orthogonal to all of the above: `firstPartyHosts` with `PropagatorType.TRACECONTEXT` makes the SDK attach a W3C `traceparent` to requests against admin's host, which admin's existing `dd-trace` APM instrumentation picks up and continues — no event mapper of any kind is involved.

Both mechanisms were verified live in the Datadog dev environment: a `GetVideoBySlug` RUM resource resolved a trace through `forge-mobile` → `forge-admin` (the GraphQL POST) → `forge-admin-prisma` DB spans, with the GraphQL operation name visible as an attribute on the resource event.

## Prevention

- Before planning an implementation around a named SDK hook, grep the **installed** package's `.d.ts` for exactly which config _class's constructor_ exposes it — not just whether the type name exists anywhere in the package. Here, `resourceEventMapper` exists in the package, but only `FileBasedConfiguration`'s constructor (`config/FileBasedConfiguration.d.ts`) takes it as a documented top-level param; the programmatic `DatadogProviderConfiguration`/`CoreConfiguration` classes used by `<DatadogProvider configuration={...}>` do not, even though the underlying `RumConfigurationType` interface nominally allows nesting it (an undocumented, unexemplified path — don't build on it).
- Reusable correlation pattern for future GraphQL-RUM attribution needs: attribute via the SDK's already-recognized operation name/type headers (`datadogGraphqlHeaders` in `apps/mobile/src/lib/datadog.ts`) whenever the join value _is_ naturally an operation name; reach for a bounded, purpose-built id (like `search_request_id`) only when it isn't — and never let a raw user-entered value (like a search query term) become the join key.
- Trace-linking (RUM → APM) and content/resource attribution are separate concerns with separate mechanisms in this SDK: `firstPartyHosts` alone is sufficient for the former; no event mapper is required.

## Related Issues

- `docs/plans/2026-07-14-001-feat-mobile-datadog-observability-plan.md` (KTD5, KTD10 — original correlation-strategy planning)
- PR #1572 `feat(mobile): Datadog observability — RUM + Logs + Session Replay, end-to-end trace` (merged 2026-07-15)
- `docs/solutions/integration-issues/datadog-rum-apollo-abort-error-double-reporting.md` (downstream — the errorEventMapper file-config-only limitation documented here is why RUM client-abort noise had to be filtered in the Apollo error link instead of at the SDK layer; PR #1616)
- `docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md` (prior `@datadog/mobile-react-native` SDK-surface integration issue on `apps/tv`)
- `docs/solutions/integration-issues/datadog-rn-source-map-upload-eas-hook.md` (sibling — the same feature's EAS dSYM/source-map upload hooks)
- `docs/solutions/best-practices/mobile-datadog-rich-posture-data-governance-20260714.md` (same feature — the R43 rich-posture data-governance deliverable; `search_request_id` is the privacy-preserving alternative to logging the raw term as a join key)
- `apps/tv/CLAUDE.md` Observability section (sibling programmatic-config pattern)
