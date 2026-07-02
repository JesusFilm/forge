---
id: "feat-225"
title: "TV Datadog production activation and fleet verification"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: "2026-07-03"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "tv"
  - "infrastructure"
  - "observability"
---

## Problem

PR #1434 shipped opt-in Datadog Mobile RUM for `apps/tv` (service `forge-tv`), verified live from the tvOS simulator. But telemetry is gated on `EXPO_PUBLIC_DATADOG_CLIENT_TOKEN` + `EXPO_PUBLIC_DATADOG_APPLICATION_ID`, and no EAS profile has them — every real build (preview APK, TestFlight) boots with telemetry silently off. The `__DEV__`-gated boot-smoke event still fires a fake error on every dev launch (temporary verification scaffolding, flagged for removal in the PR). Android TV and real Apple TV hardware are unverified, and production credentials are gated on a privacy decision (`TrackingConsent.GRANTED` hardcoded at 100% session sampling).

## Entry Points — Read These First

1. `apps/tv/CLAUDE.md` — "Observability (Datadog)" section: the full setup, gate semantics, and caveats.
2. `docs/observability/datadog.md` — "TV production variables" section: the exact `eas env:create` var list.
3. `apps/tv/src/components/DatadogRum.tsx` — the `TvDatadogProvider`; the `useEffect` contains the boot-smoke block to remove (keep the `[datadog] RUM disabled` warning).
4. `apps/tv/.env.example` — var documentation incl. the site-enum gotcha (`US1`, not `datadoghq.com`).
5. `apps/tv/eas.json` — build profiles (`development`, `preview`, `production`), all with `EXPO_TV=1`.
6. `apps/tv/DISTRIBUTION.md` — Apple TV TestFlight path (`xcrun altool -t appletvos`, NOT `eas submit`) and Android preview APK flow.

## Grep These

- `tv boot smoke`
- `EXPO_PUBLIC_DATADOG_CLIENT_TOKEN`
- `getDatadogRumConfig`
- `SdkVerbosity`
- `TrackingConsent.GRANTED`

## What To Build

1. **Provision EAS env vars per profile** (`eas env:create`): `EXPO_PUBLIC_DATADOG_CLIENT_TOKEN` (the `pub...` client token from the "Forge TV" RUM application in Datadog — Digital Experience -> RUM -> Applications), `EXPO_PUBLIC_DATADOG_APPLICATION_ID` (same page), `EXPO_PUBLIC_DATADOG_SITE=US1`. Leave `EXPO_PUBLIC_DATADOG_ENV` unset — it defaults by build type (`__DEV__` -> development, release -> production). Set `EXPO_PUBLIC_DATADOG_VERSION` from the build's git SHA if available in the profile.
2. **Remove the boot-smoke scaffolding** in `DatadogRum.tsx`: delete the `reportDatadogError(new Error("[datadog] tv boot smoke")...)` and `datadogLog.info("[datadog] tv boot smoke"...)` calls; keep the `__DEV__` RUM-disabled `console.warn`. Keep `verbosity: __DEV__ ? DEBUG : WARN` as is.
3. **Create a Datadog usage/intake alert** for `service:forge-tv` — the client token is public-by-design (ships in the bundle), so an alert is the abuse-detection mechanism.
4. **Android TV verification**: `eas build --profile preview` (APK), install on an Android TV device or emulator, confirm the gradle build autolinks the SDK (the pnpm patch is iOS-only by design — Android needs no patch) and a session appears in RUM.
5. **Apple TV hardware verification**: TestFlight build via the DISTRIBUTION.md altool flow; confirm a session with mobile vitals from real hardware (vitals are source-confirmed but not product-warranted on tvOS).
6. **Privacy gate**: before setting the production profile's credentials, get product/legal sign-off on `TrackingConsent.GRANTED` + `sessionSampleRate: 100` (documented residual risk from the PR review).

## Constraints

- Do NOT re-add the `expo-datadog` config plugin (its dSYM phase hard-fails keyless builds; see `docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md`).
- Do NOT add SessionReplay or WebViewTracking packages (unsupported on tvOS).
- Client token only in `EXPO_PUBLIC_*` — never an API key (API keys are server secrets).
- Do not weaken the null-gate: unprovisioned builds must keep booting normally.

## Verification

- Fresh dev launch shows NO `[datadog] tv boot smoke` error in Error Tracking; the RUM-disabled warning still appears when creds are absent.
- A preview EAS build (no local .env) produces a live session in RUM Explorer filtered `service:forge-tv` with the correct `env` for its build type.
- Sessions confirmed from BOTH an Android TV device/emulator and a physical Apple TV.
- `pnpm --filter @forge/tv test && pnpm --filter @forge/tv typecheck && pnpm --filter @forge/tv lint` green after the smoke removal (update `datadog.test.ts` only if it referenced removed code).
