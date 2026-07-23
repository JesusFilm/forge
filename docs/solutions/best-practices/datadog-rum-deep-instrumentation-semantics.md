---
title: "Datadog Mobile RUM instrumentation semantics for Expo/react-native-tvos: view identity, timing, action naming, and GraphQL attribution"
date: "2026-07-03"
category: "best-practices"
module: "apps/tv"
problem_type: "best_practice"
component: "tooling"
severity: "high"
applies_when:
  - "Naming Datadog RUM views in an expo-router app (usePathname vs useSegments cardinality)"
  - "Firing DdRum.addTiming custom timing marks tied to screen readiness (view-key-less binding to the active view)"
  - "Guarding DatadogProvider onInitialization / any init watchdog across Fast Refresh remounts in the same JS process"
  - "Enabling RUM trackInteractions and naming tap actions on wrapped Pressable components (e.g. FocusableCard)"
  - "Attributing GraphQL/Apollo requests to RUM resources via ApolloLink headers, and configuring EAS build profiles (preview/production) that ship to external testers"
tags:
  - "datadog"
  - "rum"
  - "expo-router"
  - "react-native-tvos"
  - "apollo-client"
  - "eas-build"
  - "observability"
related_components:
  - "apps/tv/src/lib/datadog.ts"
  - "apps/tv/src/components/DatadogRouteTracker.tsx"
  - "apps/tv/src/components/DatadogRum.tsx"
  - "apps/tv/src/lib/apolloClient.ts"
  - "apps/tv/src/components/FocusableCard.tsx"
  - "apps/tv/app/series/[slug].tsx"
---

# Datadog Mobile RUM instrumentation semantics for Expo/react-native-tvos: view identity, timing, action naming, and GraphQL attribution

## Context

feat-225/226 took `apps/tv`'s Datadog Mobile RUM instrumentation from "boots without crashing" to production-depth: route-scoped views, a per-screen perf timing, GraphQL operation attribution, a dev init watchdog, and action-name privacy. None of this is documented anywhere outside `@datadog/mobile-react-native`'s own source — the SDK's public docs describe the happy path, not the six ways an Expo/react-native-tvos app's lifecycle (Fast Refresh, `usePathname`/`useSegments` churn, cache-first partial data, EAS release-vs-dev builds) breaks the SDK's implicit assumptions. Verified this session: 540 Jest tests, two live tvOS-simulator RUM sessions confirmed in the Datadog explorer, and a 9-reviewer / 4-validator code review (shipped as PR #1449, plan `docs/plans/2026-07-02-001-feat-tv-datadog-activation-rum-depth-plan.md`). Two adversarial-review findings (P0/confidence-100) died on real bugs the naive implementation would have shipped silently — worth capturing so the next Datadog surface (mobile, or a future TV feature) doesn't re-discover them the hard way.

## Guidance

**1. View identity: name by route pattern, key by literal pathname.**
`usePathname()` resolves to a literal path like `/series/mark-the-scandalous-good-news`. Naming RUM views after the raw pathname explodes view-name cardinality in the explorer — one distinct view per slug instead of one facet for the whole route shape. `resolveViewName` (`apps/tv/src/lib/datadog.ts`) splits the two concerns: `useSegments()` gives the unresolved route pattern (`series/[slug]`) for the _name_, while the pathname stays the _key_ so slug-to-slug navigation still restarts the view instead of being coalesced into one:

```ts
export function resolveViewName(
  segments: readonly string[],
  pathname: string,
): { key: string; name: string } {
  const pattern = segments.filter(Boolean).join("/")
  const name = pattern || (pathname === "/" ? "home" : pathname)
  return { key: pathname, name }
}
```

`DatadogRouteTracker` dedupes on the key _before_ any other work, because `useSegments()`'s return identity churns on every render even when the route hasn't changed — comparing pattern objects would fire spuriously:

```tsx
const lastKeyRef = useRef<string | null>(null)
useEffect(() => {
  // The view key IS the pathname, so the ref-compare runs before any work.
  if (lastKeyRef.current === pathname) return
  if (!isDatadogProvisioned()) return
  const { key, name } = resolveViewName(segments, pathname)
  lastKeyRef.current = key
  startDatadogView(key, name)
}, [pathname, segments])
```

**2. Custom timings bind to whatever view is active — latch once, on real content.**
`DdRum.addTiming(name)` takes no view-key argument; it attaches to whichever view is currently active at the moment it fires. Two consequences: fire it more than once per screen instance and you get duplicate/garbage timings on the _same_ view; fire it too early (on a placeholder/partial render) and you poison the metric's percentiles with near-zero values. The series screen uses cache-first + `returnPartialData`, so a record can render before its episodes array is populated — the gate can't be "record exists," it must be "content actually rendered":

```ts
// apps/tv/src/components/series/seriesScreenState.ts
export function shouldFireFirstRailTiming(
  record: { episodes: readonly unknown[] } | null | undefined,
): boolean {
  return record != null && record.episodes.length > 0
}
```

The screen latches this once per slug instance via a ref, and — the detail an adversarial reviewer specifically probed for — pop-back revisits must never re-fire (a ~0ms re-fire poisons the percentile):

```ts
// apps/tv/app/series/[slug].tsx
const firstRailFiredForRef = useRef<string | null>(null)
useEffect(() => {
  if (firstRailFiredForRef.current === decodedSlug) return
  if (!isDatadogProvisioned()) return
  if (!shouldFireFirstRailTiming(record)) return
  firstRailFiredForRef.current = decodedSlug
  addDatadogTiming(SERIES_FIRST_RAIL_READY_TIMING)
}, [record, decodedSlug])
```

The closing detail: the same screen's push-away affordance (`EpisodeRail`) must be gated by the _identical_ condition (`episodes.length > 0`, see `apps/tv/src/components/series/EpisodeRail.tsx` line 96: `if (episodes.length === 0) return null`) — otherwise there's a window where the timing has fired but the rail the user could act on doesn't exist yet (or vice versa), which is exactly the misattribution gap a review construct tried to exploit.

**3. The init watchdog must be one-shot per JS process, not per mount.**
`DatadogProvider`'s `onInitialization` callback fires **at most once per process** — the SDK gates native init behind a `globalThis` singleton (`DatadogProviderState`). A watchdog timer armed on every component mount will re-fire (falsely) on every Fast Refresh or `ErrorBoundary` remount, because the SDK never calls `onInitialization` again for an already-initialized process. `createDatadogInitWatchdog` (`apps/tv/src/lib/datadog.ts`) is deliberately a closure over module-scope state, not a per-render hook, and `markInitialized` permanently disarms it:

```ts
export function createDatadogInitWatchdog({
  deadlineMs = INIT_WATCHDOG_DEADLINE_MS,
  dev = __DEV__,
}: { deadlineMs?: number; dev?: boolean } = {}) {
  let armed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    arm(): void {
      if (!dev || armed) return
      armed = true
      timer = setTimeout(() => {
        /* ...console.warn... */
      }, deadlineMs)
    },
    markInitialized(): void {
      // Once initialized, later arms are meaningless for this process.
      armed = true
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
export const datadogInitWatchdog = createDatadogInitWatchdog()
```

The injectable `dev`/`deadlineMs` params exist solely so tests can exercise the double-mount case under fake timers without waiting 10 real seconds or mocking `__DEV__` globally.

**4. Action-name privacy: label-derived action names leak user input; the fix must reach the native Pressable, not just the JS prop.**
Datadog's `trackInteractions` names TAP actions from `accessibilityLabel` by default. Any label that embeds user-typed text becomes telemetry — the recent-search chips built `Recent search: ${q}`, putting search queries directly into RUM action names. The precedent fix (`KeyButton.tsx`) sets a non-typed `dd-action-name` attribute directly on the native `Pressable`:

```tsx
// apps/tv/src/components/search/KeyButton.tsx
{...{ "dd-action-name": "keyboard-key" }}
```

The trap: `FocusableCard` is a wrapper that destructures a **fixed** prop set and forwards only those named props to its internal `Pressable` — a call-site `{...{"dd-action-name": ...}}` spread at the JSX call site does nothing, because `FocusableCard` never sees or forwards an arbitrary spread. Two independent reviewers flagged this at confidence 100/P0: the "obvious" one-line fix (spread `dd-action-name` onto the `<FocusableCard>` element) would have silently no-oped, leaving the leak in place while looking fixed. The real fix threads an explicit typed prop through the wrapper:

```tsx
// FocusableCardProps
/** Overrides Datadog RUM's tap-action name (which defaults to the accessibility
 *  label). Set a generic value when the label carries user-typed text. */
ddActionName?: string

// inside the component, onto the internal Pressable:
{...(ddActionName ? { "dd-action-name": ddActionName } : {})}
```

```tsx
// apps/tv/src/components/search/SearchBrowse.tsx
<FocusableCard
  onPress={() => onRunQuery(q)}
  accessibilityLabel={`Recent search: ${q}`}
  ddActionName="recent-search"
  ...
>
```

**5. GraphQL attribution: set the SDK's own headers via a spread-merging ApolloLink, never a header-replacing one.**
The SDK exports `DATADOG_GRAPH_QL_OPERATION_NAME_HEADER` / `_TYPE_HEADER` from its root package — no extra Datadog package needed. They must be set in an `ApolloLink` staged _before_ `HttpLink`, and that link must merge into whatever headers a prior link already set, not replace them — mobile's fleet-bearer incident (PR #1226) is the precedent for why: an unscoped consumer bearer set by an earlier auth link would be silently dropped by a naive `setContext` that overwrites `headers` wholesale.

```ts
// apps/tv/src/lib/apolloClient.ts
function mergeContextHeaders(
  operation: ApolloLink.Operation,
  headers: Record<string, string>,
): void {
  if (Object.keys(headers).length === 0) return
  const prev = operation.getContext()
  operation.setContext({ headers: { ...(prev.headers ?? {}), ...headers } })
}
```

The only test shape that actually catches a future regression to a non-spread `setContext` is a **composed-chain** test: run the auth link and the Datadog link together against a terminal link and assert both sets of headers survive. `createRequestChain()` exists purely so tests can get "the chain minus transport":

```ts
export function createRequestChain(): ApolloLink {
  const authLink = new ApolloLink((operation, forward) => {
    /* merges auth headers */
  })
  const datadogLink = new ApolloLink((operation, forward) => {
    /* merges dd headers */
  })
  return isDatadogProvisioned() ? authLink.concat(datadogLink) : authLink
}
```

Driving it requires Apollo Client v4's three-argument `execute`, with the terminal link returning an `Observable` (not `null`, and not the two-argument v3-era call — both are runtime/typecheck failures under v4):

```ts
// apps/tv/src/lib/apolloClient.test.ts
const terminal = new ApolloLink((operation) => {
  captured = operation.getContext().headers as Record<string, string>
  return new Observable<ApolloLink.Result>((subscriber) =>
    subscriber.complete(),
  )
})
ApolloLink.execute(
  createRequestChain().concat(terminal),
  { query },
  { client },
).subscribe({ error: () => undefined })
```

**6. EAS env defaulting: preview is a release build — pin `EXPO_PUBLIC_DATADOG_ENV` explicitly, don't rely on the `__DEV__` default.**
`getDatadogRumConfig()` defaults the env tag by build type when the var is unset: `__DEV__ ? "development" : "prod"` (the release value is `prod`, matching web's canonical `normalizeDatadogEnv` output). That default is correct for local dev builds and correct for real production — but EAS **preview** profiles are release builds (`__DEV__` is `false`), so an unset var on preview tags every external tester's session `env:prod`, contaminating production metrics before any privacy/consent gate is even relevant. The fix is operational, not code: preview's EAS environment sets `EXPO_PUBLIC_DATADOG_ENV=preview` explicitly (`docs/observability/datadog.md`). Use plaintext visibility when provisioning — the value is bundle-inlined by design (`EXPO_PUBLIC_*` vars ship in the JS bundle), so Datadog's `secret` visibility tier never actually reaches the built app at `eas update` time; picking `secret` would just make the value unavailable where it's needed.

## Why This Matters

Every one of these six items is a case where the SDK's naive/default behavior is _plausible_ — it would compile, it would even work in the simplest manual test — but breaks under one specific condition an Expo/TV app hits constantly: pathname-based routing (1), cache-first partial data (2), Fast Refresh (3), user-typed search input (4), an existing operation-scoped bearer (5), and EAS's dev/release build split (6). Two of these (item 2's pop-back re-fire and item 4's silent-drop wrapper) were caught only because a 9-reviewer / 4-validator review specifically constructed adversarial scenarios — a straightforward "does it work once" smoke test would have shipped both bugs. The cost of not knowing this up front is either silently corrupted telemetry (a percentile that looks fine but is built on poisoned samples) or a privacy leak that looks fixed in the diff but does nothing at runtime — both are the kind of failure that's invisible until someone goes looking at the Datadog explorer months later and can't explain what they see.

## When to Apply

- Instrumenting Datadog Mobile RUM (or any RUM SDK with the same view/timing/action model) in `apps/tv` or `apps/mobile`, or extending it to a new screen.
- Adding a new Expo Router screen that should get its own RUM view — reuse `resolveViewName`'s pattern/pathname split rather than reinventing view naming.
- Adding a new custom timing anywhere the underlying screen uses cache-first/`returnPartialData` — always gate the latch on real content, never on "record is non-null," and always ref-guard against revisits.
- Adding any UI element whose `accessibilityLabel` could carry user-typed or otherwise sensitive text, especially through a wrapper component (`FocusableCard`, or any future prop-destructuring wrapper) — verify the override prop is threaded all the way to the native primitive, not just declared.
- Adding a new outbound GraphQL/HTTP client header (auth, attribution, tracing) anywhere multiple `ApolloLink`s compose — default to spread-merge; write a composed-chain test, not an isolated single-link test.
- Provisioning any new EAS environment/profile for a build that ships telemetry — check whether it's a release build (`__DEV__` false) before trusting an env-based default.

## Examples

- `apps/tv/src/lib/datadog.ts` — `resolveViewName`, `shouldFireFirstRailTiming`-adjacent `addDatadogTiming`, `createDatadogInitWatchdog`, `datadogGraphqlHeaders`.
- `apps/tv/src/components/DatadogRouteTracker.tsx` — pathname-keyed dedup before any work.
- `apps/tv/src/components/DatadogRum.tsx` — arms the watchdog once, disarms via `onInitialization`.
- `apps/tv/src/components/series/seriesScreenState.ts` + `apps/tv/app/series/[slug].tsx` — the latch-once-per-instance timing pattern, paired with `apps/tv/src/components/series/EpisodeRail.tsx`'s identical `episodes.length > 0` gate on the push-away affordance.
- `apps/tv/src/components/FocusableCard.tsx` (`ddActionName` prop) + `apps/tv/src/components/search/SearchBrowse.tsx` (`ddActionName="recent-search"`) + `apps/tv/src/components/search/KeyButton.tsx` (the original `dd-action-name` precedent).
- `apps/tv/src/lib/apolloClient.ts` (`createRequestChain`, `mergeContextHeaders`) + `apps/tv/src/lib/apolloClient.test.ts` (the composed-chain, three-arg `ApolloLink.execute` test).
- `docs/observability/datadog.md` "TV activation runbook" — the `EXPO_PUBLIC_DATADOG_ENV=preview` pin and plaintext-visibility rationale.
- Plan: `docs/plans/2026-07-02-001-feat-tv-datadog-activation-rum-depth-plan.md` (R2/R6/R10, KTD6, U3/U6/U7 — the post-review fixes for `ddActionName` threading and explicit `env=preview`).
- Precedent: `docs/solutions/architecture-patterns/fleet-client-bearer-must-be-operation-scoped-not-global.md` (mobile PR #1226) — the spread-merge discipline this pattern reuses.

## Related

- `docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md` — the build/toolchain layer of the same feature family (tvOS pnpm patch, excluded expo-datadog config plugin); this doc is the runtime instrumentation layer on top.
- `docs/solutions/architecture-patterns/fleet-client-bearer-must-be-operation-scoped-not-global.md` — the spread-merge / operation-scoped header discipline the attribution link preserves.
- `docs/solutions/mobile/eas-update-stakeholder-preview-setup.md` — the apps/mobile instance of the "preview EAS environment must be selected explicitly" gotcha; item 6 here is the apps/tv Datadog-specific recurrence.
- `docs/solutions/mobile/expo-env-file-handling.md` — EAS env visibility semantics (secret never reaches EXPO_PUBLIC bundles).
- `docs/solutions/conventions/tv-mobile-clients-consume-only-public-admin-queries.md` — the Apollo client baseline the attribution link must not disturb.
- `docs/solutions/architecture-patterns/canonical-server-search-analytics-supplemental-rum-pattern.md` — the repo's cross-app "RUM is supplemental, never load-bearing" philosophy.
- `docs/solutions/conventions/datadog-rum-env-tag-cross-app-canonical-value.md` — the cross-app rule item 6's env default feeds: every app must tag the same canonical `env` value (`prod`) or a fleet-wide `env:` filter silently misses apps.
