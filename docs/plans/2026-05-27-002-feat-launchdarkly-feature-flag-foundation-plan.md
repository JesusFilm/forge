---
status: complete
created: 2026-05-27
feature: feat-144
---

# LaunchDarkly Feature Flag Foundation Plan

## Problem And Scope

Forge has several rollout gates implemented as per-environment env booleans.
That keeps deploys simple, but it cannot do percentage rollout, request-level
targeting, or cross-service flag decisions. This slice adds a LaunchDarkly
foundation that is safe to merge before operators provision LaunchDarkly keys.

In scope:

- Shared server-side LaunchDarkly wrapper package.
- Typed flag registry for the existing web rollout flags.
- Web server-side helper that evaluates LaunchDarkly when configured and falls
  back to existing env booleans when not configured.
- Env examples and operational docs.

Out of scope:

- Browser-side LaunchDarkly React SDK.
- Mobile/TV client SDKs.
- Replacing every existing build-time flag callsite.
- Creating flags through the LaunchDarkly API.

## Decisions

- Use LaunchDarkly's Node.js server-side SDK, `@launchdarkly/node-server-sdk`,
  as the first integration point. Official docs separate this from React/client
  SDKs, and the server-side key must never ship to browser bundles.
- Keep `LAUNCHDARKLY_SDK_KEY` optional. If unset, evaluation uses local
  fallbacks. This follows the repo's existing opt-in env-var rule.
- Preserve `NEXT_PUBLIC_*` flags as defaults for the existing watch-player
  build-time decisions. LaunchDarkly becomes a runtime evaluation layer for new
  server-side decisions and future migrations, not an immediate destructive
  rewrite of dynamic-import DCE behavior.
- Centralize typed keys in `@forge/feature-flags` so future apps add flags in
  one registry instead of scattering string literals.

## Implementation Units

### Unit 1 -- Shared Package

Files:

- `packages/feature-flags/package.json`
- `packages/feature-flags/tsconfig.json`
- `packages/feature-flags/eslint.config.mjs`
- `packages/feature-flags/src/index.ts`
- `packages/feature-flags/src/registry.ts`
- `packages/feature-flags/src/launchdarkly.ts`
- `packages/feature-flags/src/launchdarkly.test.ts`

Build:

- Export `featureFlags`, `evaluateFlag`, `createFeatureFlagClient`, and typed
  `FeatureFlagKey`.
- Wrap the LaunchDarkly client as a singleton per SDK key.
- Use `variation(flagKey, context, fallback)` for evaluation.
- Return fallback immediately when SDK key is absent.
- Add a short timeout or readiness guard so request rendering is not held
  indefinitely by SDK initialization.

Tests:

- Missing SDK key returns fallback.
- Local override env values are parsed as booleans.
- LaunchDarkly client is not initialized when SDK key is absent.
- Unknown/invalid local override values fall back instead of throwing.

### Unit 2 -- Web Integration

Files:

- `apps/web/package.json`
- `apps/web/src/env.ts`
- `apps/web/src/lib/feature-flags.ts`
- `apps/web/src/lib/feature-flags.test.ts`
- `apps/web/.env.example`
- `apps/web/CLAUDE.md`

Build:

- Add `@forge/feature-flags` as a workspace dependency.
- Add optional server env vars:
  - `LAUNCHDARKLY_SDK_KEY`
  - `FORGE_WATCH_PLAYER_MIGRATION_DEFAULT`
  - `FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT`
- Implement web helper functions that map existing web defaults into the shared
  evaluator.
- Keep existing `NEXT_PUBLIC_*` values for current client/build-time branches.
  The new helper is available for server-side route gates and future callsite
  migrations.

Tests:

- Web helper returns the existing env default when LaunchDarkly is unconfigured.
- Explicit local default env values override registry defaults.
- No server-side SDK key appears in client env.

### Unit 3 -- Docs And Roadmap Hygiene

Files:

- `docs/roadmap/platform/feat-144-launchdarkly-feature-flag-foundation.md`
- `docs/roadmap/README.md`
- `docs/solutions/platform/launchdarkly-feature-flag-foundation-20260527.md`

Build:

- Record LaunchDarkly operational setup and fallback behavior.
- Add the new roadmap row.
- Mark the ticket complete after validation.

## Verification Plan

- `pnpm --filter @forge/feature-flags test`
- `pnpm --filter @forge/feature-flags typecheck`
- `pnpm --filter @forge/web test -- src/lib/feature-flags.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`

For live smoke, run web without `LAUNCHDARKLY_SDK_KEY` and load an existing
watch page. The app must render and logs should not contain env schema errors.

## Risks

- LaunchDarkly SDK startup can add request latency if evaluation waits too long.
  The wrapper must prefer fallback over blocking.
- Existing `NEXT_PUBLIC_*` flags are build-time DCE inputs. Runtime
  LaunchDarkly evaluation cannot replace those callsites without changing the
  bundling strategy, so this PR intentionally exposes the foundation first.
- Operators still need to create the matching LaunchDarkly flags and configure
  Railway env vars after merge.
