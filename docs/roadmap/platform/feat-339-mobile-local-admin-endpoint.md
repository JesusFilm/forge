---
id: "feat-339"
title: "Mobile local admin endpoint by default"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-08-07"
duration: 1
depends_on: []
blocks: []
tags:
  - "mobile"
  - "infrastructure"
---

## Problem

`apps/mobile` reaches production admin whenever `EXPO_PUBLIC_ADMIN_GRAPHQL_URL`
is unset, because `src/lib/config.ts` fell back to a hardcoded production URL
with no signal. The variable was set to a local endpoint by hand in the main
checkout, which is the fragile state rather than a safe one: absent on a fresh
clone, absent in a fresh worktree, and removed by the next `fetch-secrets` —
each of which returns the app to production silently.

The cost is not only read traffic. Since `#1823` mobile issues
`RecordWatchSearchEvent`, a public mutation that writes rows into admin's
`watchSearchEvent` table, and admin separately writes two rows per search on the
read path with query text only pattern-redacted. Opening Discover fires six
searches unattended per cold launch, before anyone types.

There is a leak direction too: `eas update` runs `expo export` in production
mode, which reads `.env.local`, and `update:preview` passed no `--environment`.
The only thing keeping a local endpoint out of a preview bundle was a swap to
`.env.production` — dead Strapi-era configuration carrying no admin endpoint, no
search bearer, and no Datadog variables, so the swap also stripped published
previews of telemetry and their rate-limit bucket.

`apps/tv` does not share this shape: its endpoint variable is required with no
fallback.

## Entry Points — Read These First

1. `apps/mobile/src/lib/adminEndpoint.ts` — the dependency-free leaf that owns
   the local default, host normalization, host classification, the access
   decision, the startup report, and the unreachable-endpoint store.
2. `apps/mobile/src/env.ts` — module-scope refusal and report. The earliest
   app-owned code, and the only seam guaranteed to run before all three
   `getGraphQLUrl()` callers.
3. `apps/mobile/app/_layout.tsx` — the `__DEV__`-gated require and mount of
   `DevEndpointNotice`, and the pre-existing require try/catch. Note that the
   try/catch does **not** reliably catch the endpoint refusal: expo-router
   evaluates route modules eagerly and `useWatchHome.ts` reaches `env.ts`
   outside it, so the throw surfaces as the dev error overlay instead
   (observed 2026-08-07). The message is verbatim and selectable either way.
4. `apps/mobile/src/lib/apolloClient.ts` — `isUnreachableEndpointError` plus the
   dev-gated emit riding `createErrorLink`.
5. `apps/mobile/CLAUDE.md` — § Admin endpoint resolution, § Publishing an EAS
   Update.
6. `docs/plans/2026-08-05-004-feat-mobile-local-admin-endpoint-plan.md` — the
   full plan, its Key Technical Decisions, and the manual verification contract.

## Grep These

- `resolveAdminGraphqlUrl` — the single resolution path both the report and
  `getGraphQLUrl()` use, so they cannot diverge.
- `EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN` — the override, wired through all three
  places `env.ts` requires or Metro will not inline it.
- `classifyAdminHost` — local / production / other. Only `production` refuses.
- `noteAdminEndpointUnreachable` — the one-shot module-scope signal.
- `EXPO_NO_DOTENV` — the publish scripts in `apps/mobile/package.json`.

## What To Build

Shipped in this ticket:

- A development bundle resolves to `http://localhost:3003/api/graphql` by
  default, rewritten to `10.0.2.2` on the Android emulator. Release bundles are
  unchanged.
- A development bundle resolving to a known production admin host throws at
  `env.ts` module scope, naming the host and the override.
- `EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN` opts back in; both variables stay
  `.optional()` in the zod schema — a required variable passes every pre-merge
  gate and crashes on a device.
- Every development launch prints
  `[admin-endpoint] admin_endpoint.url=… admin_endpoint.kind=…`.
- An endpoint that refuses connections raises a dev-only banner over Home rather
  than letting the frozen `fallbackConfig` masquerade as loaded content.
- `.env.development.local` documented as the per-machine slot;
  `scripts/setup-sim-env.sh` no longer propagates an endpoint into worktrees.
- Both publish channels have a script that names its EAS environment and sets
  `EXPO_NO_DOTENV=1`; `update:production` did not previously exist.
- The three dead Strapi variables removed from every EAS environment and from
  Doppler `forge-mobile/dev`.

## Constraints

- **No `apps/admin` change.** Nothing here requires one.
- **No admin endpoint in any EAS environment.** With dotenv disabled, resolution
  falls through to the in-code production default, which is already correct.
  A dashboard-typed URL runs zod on the device and can hard-fail startup for
  every beta tester.
- **Only a known production host refuses.** A LAN address, a tunnel, or an
  emulator alias must boot normally, or the documented physical-device workflow
  breaks.
- **Host parsing must never throw.** `classifyAdminHost` and
  `normalizeAdminHost` run in release bundles.
- **`apps/tv` is out of scope** and reads a differently named variable; neither
  the defect nor the fix transfers by copying.
- **Getting production-shaped content into local admin belongs to `feat-328`.**
  Until that lands, a local admin holds whatever the developer restored, and an
  empty one makes Home fall through to its frozen fallback. That degrades what a
  local session exercises; it does not affect whether the endpoint switch works.
- Media bytes stay on production — streams and card art are absolute Mux and
  Cloudflare URLs in admin's rows. "Nothing points at production" is not
  achievable and is not the goal.

## Verification

```bash
pnpm --filter @forge/mobile test
pnpm --filter @forge/mobile typecheck
pnpm --filter @forge/mobile lint
```

Manual, and not automatable:

- **The refusal.** Put a production endpoint in `.env.development.local`,
  cold-restart Metro, confirm the panel names the host and the override; set the
  override and confirm boot. A reload proves nothing — values inline at bundler
  startup.
- **Local admin reachable, iOS and Android emulator.** Confirm a real query
  landed by admin's request log, not by the app looking populated.
- **Local admin down.** Confirm the unreachable notice names the endpoint.
- **Sentinel publish, both channels.** Write a unique local endpoint into
  `.env.local`, publish through the script, grep the export for it (absent) and
  for the Datadog application id and bearer prefix (present). The production
  sentinel goes to a throwaway branch (`--branch sentinel-check --environment
production`), never the live channel.
- **`fetch-secrets` does not revert the endpoint.** Run it, confirm
  `.env.development.local` is untouched, cold-start Metro.
