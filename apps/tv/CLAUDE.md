# apps/tv — Expo TV App (Apple TV + Android TV)

## Stack

- React Native with Expo (SDK 54, managed workflow)
- react-native-tvos (aliased as react-native) for TV platform support
- @react-native-tvos/config-tv Expo plugin with EXPO_TV=1
- Expo Router for file-based navigation (stack only, no tabs)
- @forge/admin-graphql with gql.tada for typed GraphQL operations
- Apollo Client for GraphQL data fetching
- expo-video for HLS playback
- expo-image for optimized image loading

## Architecture

This is a TV adaptation of the Server-Driven UI (SDUI) app. Same pipeline
as mobile, different renderers optimized for 10-foot UI and D-pad navigation.

### SDUI Pipeline

```
Admin GraphQL → gql.tada typed query → normalizer (adds `kind`) → dispatcher → TV renderers
```

- **Queries**: Imported from mobile or copied with sync comment
- **Normalizer**: Copied from mobile (identical logic)
- **Dispatcher**: TV version with subset of block kinds
- **Renderers**: All new, designed for 10-foot UI with D-pad focus

## Design Systems

The TV app runs two coexisting design systems. Which one applies depends on the
surface.

### Crimson Gallery (`COLORS` in `src/lib/colors.ts`)

Governs the SDUI experience renderer, series, and the remaining legacy surfaces.
From the Stitch mockups:

- Background: `#161311` (warm stone, never pure black)
- Surface container: `#221F1D`
- Surface container high: `#2D2927`
- Primary accent: `#CB333B` (Crimson Red — sparingly, for CTAs and focus rings)
- Text: `#F5F5F4`
- Muted: `#A8A29E`
- Font: System (SF Pro on tvOS, Roboto on Android TV)
- No 1px borders — use background color shifts
- 16px border radius on cards
- Focus state: 1.05x scale + white ring (the app-wide default). The `focusRing="crimson"` opt-in for near-white surfaces is retired — no active instances; the Related Questions FallbackPill was migrated to the invert-on-focus fill.

### WATCH_THEME (`src/components/watch/watchDetailTheme.ts`)

Governs the watch detail, Home, and Search screens. Ported from the Claude
Design handoff and adopted across those surfaces — a deliberate product decision:

- Primary accent: `#E1241E` (brighter red than Crimson Gallery)
- Near-black surfaces/scrims (`NEAR_BLACK` = `#0a0a0b`); never warm stone
- Focus state: white-fill focus with near-black ink (white ring, not crimson glow)
- Frosted-glass pills approximated with translucent white fill (no backdrop blur on TV)

`SEARCH_THEME` (`src/components/search/searchTheme.ts`) extends WATCH_THEME with
search-layer-specific tokens (letter-strip keys, result-card ring, thumb chips).

- Font: System (SF Pro on tvOS, Roboto on Android TV)

## Conventions

- Build with `EXPO_TV=1 npx expo prebuild --clean` before running.
- Dev-client builds only (no Expo Go on TV).
- System font (`fontFamily: 'System'`) for platform-native typography.
- `hexToRgba(color, 0)` for gradient stops — never `"transparent"`.
- Validate all CMS-sourced URLs via `validateUrl.ts` before use.
- Composite React keys: `key={\`${item.kind}-${item.id}-${index}\`}`.
- Hardcoded English locale: `{ locale: "en" }` for all GraphQL queries.

## Test builds & distribution

- EAS profiles live in `apps/tv/eas.json`; every profile sets `EXPO_TV: "1"` so the
  managed prebuild produces a TV target (native dirs are gitignored).
- Getting stakeholder test builds onto real Apple TV / Android TV: see `DISTRIBUTION.md`
  (Android = `--profile preview` APK link; Apple TV = TestFlight via `xcrun altool -t appletvos`
  — NOT `eas submit`, which delivers tvOS as iOS and is rejected).

## Observability (Datadog)

Client-side Mobile RUM + Logs + native crash via `@datadog/mobile-react-native` (3.5.2).
Pure config/reporting helpers live in `src/lib/datadog.ts` (`getDatadogRumConfig`,
`reportDatadogError`, `datadogLog` — no JSX, so they're unit-testable without the native SDK);
the `TvDatadogProvider` wrapper lives in `src/components/DatadogRum.tsx` and is mounted in
`app/_layout.tsx` below the root `ErrorBoundary`. Service = `forge-tv`.

- **Opt-in / no-op when unprovisioned.** `getDatadogRumConfig()` returns `null` unless BOTH
  `EXPO_PUBLIC_DATADOG_CLIENT_TOKEN` and `EXPO_PUBLIC_DATADOG_APPLICATION_ID` are set, so an
  unprovisioned build boots normally (dev builds log a `[datadog] RUM disabled` warning).
  Provision via `eas env:create` per environment (see `.env.example` and the TV runbook in
  `docs/observability/datadog.md`). `EXPO_PUBLIC_DATADOG_ENV` defaults by build type
  (`__DEV__` → development, release → production); the preview EAS environment sets
  `EXPO_PUBLIC_DATADOG_ENV=preview` explicitly — preview is a release build and would
  otherwise tag external testers' sessions `env:production`.
- **Client token, never an API key** — RUM creds ship in the bundle (`EXPO_PUBLIC_*`).
- **Site is the mobile enum** (`US1`, `EU1`, …), NOT web's `datadoghq.com`. Default `US1`.
- **firstPartyHosts** targets the admin GraphQL host so RUM resources trace-link to admin APM.
- **Agent telemetry access (feat-228):** query `service:forge-tv` read-only via the `datadog` MCP in repo `.mcp.json` (see `docs/observability/datadog.md`, "Datadog MCP for agents").
- **Instrumentation depth (feat-226):** route changes become pattern-named RUM views via
  `DatadogRouteTracker` (name = route pattern e.g. `series/[slug]`, key = literal pathname;
  mounted in `app/_layout.tsx`); GraphQL resources carry the SDK's operation-name headers via
  an ApolloLink before HttpLink (spread-merge preserves the SemanticSearch bearer); the series
  screen reports a `series_first_rail_ready` view timing once per slug instance (latch in
  `seriesScreenState.ts`, partial-data safe); a one-shot-per-process dev watchdog warns when a
  provisioned mount never completes SDK init within ~10s (`createDatadogInitWatchdog`).
- **Action-name privacy:** RUM names tap actions from `accessibilityLabel`. Surfaces whose
  label carries user-typed text must override with a generic `dd-action-name` — `KeyButton`
  (`keyboard-key`) and the recent-search chips (`recent-search`, threaded through
  `FocusableCard`'s `ddActionName` prop, which forwards to its internal Pressable).
- **tvOS SDK patch (load-bearing):** `@datadog/mobile-react-native@3.5.2` does NOT compile on
  tvOS out of the box — `patches/@datadog__mobile-react-native@3.5.2.patch` guards two unguarded
  WebView refs the SDK missed (a stray `import DatadogWebViewTracking` in `DdSdkImplementation.swift`
  and the `RCT_REMAP_METHOD(consumeWebviewEvent...)` export in `DdSdk.mm`). No SessionReplay /
  WebViewTracking on tvOS — never add those packages. Re-create this patch on any SDK bump.
- **`expo-datadog` config plugin is intentionally NOT enabled.** Its build phases run
  `datadog-ci` dSYM/source-map upload and **hard-fail without `DATADOG_API_KEY` even in Debug**,
  and its datadog-ci path resolution assumes a hoisted (non-pnpm) layout. Build-time symbol upload
  is a **deferred, secret-gated CI step** (mirror web/admin's `datadog:sourcemaps` via
  `pnpm dlx @datadog/datadog-ci`, only when the key is present) — not a mandatory build phase.
- **Deferred (later):** Datadog does NOT profile the Hermes JS bundle — pair a dedicated Hermes
  profiler (`react-native-release-profiler`) for client-render root-cause (the ~2.8–3.2s series parse).
- **Status:** development + preview EAS environments carry credentials; sessions verified from
  the tvOS simulator. Still pending (runbook in `docs/observability/datadog.md`): the intake
  alert, real Apple TV / Android TV hardware sessions, and the privacy-gated production
  provisioning.

## TV-Specific Patterns

- Every interactive element must be focusable via D-pad.
- Visible focus ring on focused elements: a white ring is the app-wide default on all surfaces (cards get a white border ring; the primary red CTA keeps its colored drop shadow). The `focusRing="crimson"` opt-in is retired; pills on dark glass (e.g. the former Related Questions FallbackPill, the hero next-chevron) use the invert-on-focus fill (dark glass -> white fill + near-black ink/icon on focus).
- `TVFocusGuideView` to constrain focus within horizontal rails.
- `hasTVPreferredFocus` for initial (first-mount) focus control. For back-navigation focus restore use `createFocusMemory()` + `requestTVFocus()` in a `useFocusEffect` (Home; see `src/components/home/focusMemory.ts`) — `hasTVPreferredFocus` is one-shot mount-only and does not restore on pop.
- Stack navigation only: Home → Experience Detail → Video Playback.
- Menu/Back button pops navigation stack.

## Common Pitfalls

- Android TV VideoView z-order: renders on top of all RN Views.
- Focus lost on back-navigation (react-native-tvos #852): Home remembers the focused node (`createFocusMemory`) and re-focuses it via `requestTVFocus()` on `useFocusEffect` re-entry. `hasTVPreferredFocus` is mount-only and does not restore on pop.
- Lazy Apollo Client init: never module-scope. Use `getApolloClient()` getter.
- `Math.round()` all scaled font sizes on Android (sub-pixel = blurry).
- Must run `EXPO_TV=1 npx expo prebuild --clean` when switching between TV and phone targets.
- `Pressable.onFocus`/`onBlur` (and `FocusableCard`/`HomeCard`/`KeyButton` built on them) only fire on **tvOS** out of the box. On **Android TV** react-native-tvos delivers per-view focus solely as a global `onHWKeyEvent` (`ReactViewGroup.onFocusChanged` is a no-op) and `Pressability` never registers with `tvFocusEventHandler` — so without intervention D-pad focus moves natively but every JS focus visual (ring/scale/showcase) and the focus-driven auto-scroll go dead, looking like "nothing is focusable." Bridged in `patches/react-native-tvos@0.81.5-2.patch` (Pressable registers its host tag with `tvFocusEventHandler` on Android). If a future RN-tvos bump regenerates that patch, re-apply the Pressable bridge or Android focus visuals break again.
