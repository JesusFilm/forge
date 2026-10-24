---
id: "feat-144"
title: "LaunchDarkly Feature Flag Foundation"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-27"
duration: 2
depends_on: []
blocks:
  - "feat-146"
  - "feat-169"
  - "feat-172"
tags:
  - platform
  - web
  - admin
  - feature-flags
  - rollout
---

## Problem

Forge currently uses per-environment boolean env vars for rollout gates such as
the watch-player migrations. Those flags are safe but build-time and
environment-wide, so they cannot support per-request targeting, percentage
rollouts, or consistent cross-service rollout evaluation. The watch-page Mux
parity plan explicitly deferred percentage rollout infrastructure to a
separate platform ticket.

## Entry Points -- Read These First

1. `apps/web/CLAUDE.md` -- current web feature flag conventions and the
   build-time limitation of `NEXT_PUBLIC_*` flags.
2. `apps/web/src/env.ts` -- existing optional-env discipline and boolean flag
   parsing patterns.
3. `apps/web/.env.example` -- where new local web configuration must be
   documented.
4. `docs/plans/2026-04-29-001-feat-watch-page-mux-parity-plan.md` -- prior
   LaunchDarkly/Unleash deferral note.
5. `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`
   -- why opt-in platform env vars must not brick boot when unset.

## Grep These

- `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION`
- `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO`
- `createEnv({`
- `WEB_ADMIN_API_KEYS`
- `@forge/video-player`

## What To Build

1. Add a shared `@forge/feature-flags` package that wraps LaunchDarkly's
   Node.js server-side SDK behind a typed interface.
2. Keep LaunchDarkly configuration optional:
   - `LAUNCHDARKLY_SDK_KEY` enables remote evaluation.
   - When unset, all evaluation falls back to local defaults or explicit local
     override env vars.
   - No client-side LaunchDarkly IDs or mobile keys in this first slice.
3. Define a typed registry for the existing web rollout flags:
   - `forge.watch.playerMigration`
   - `forge.watch.heroMuxVideo`
4. Expose a server-only evaluation API that accepts a stable context:
   - `kind`
   - `key`
   - optional `name`, `email`, and custom attributes
5. Wire `apps/web` to consume the shared package for server-side rollout reads
   while preserving current `NEXT_PUBLIC_*` build-time flags as local defaults
   and emergency fallback.
6. Document the operational setup:
   - how to create matching LaunchDarkly flag keys
   - which env vars to set in Railway
   - local fallback behavior
   - rollback procedure when LaunchDarkly is unavailable
7. Add a temporary production-smoke copy flag for the watch page:
   - `forge.watch.ctaTextCopy`
   - `false`: Download CTA renders `Download`
   - `true`: Download CTA renders `Save Video`

## Constraints

- Do not make LaunchDarkly required at app boot. The SDK key must be optional.
- Do not expose server-side SDK keys to browser bundles.
- Do not introduce client-side React LaunchDarkly SDK usage until a specific
  UI/client-targeting use case requires it.
- Do not remove existing env flags in the first slice. They stay as defaults
  and rollback fallback.
- Do not hand-edit generated GraphQL artifacts; this feature should not touch
  GraphQL schema or gql.tada outputs.

## Verification

- `pnpm --filter @forge/feature-flags test`
- `pnpm --filter @forge/feature-flags typecheck`
- `pnpm --filter @forge/web test -- src/lib/feature-flags.test.ts`
- `pnpm --filter @forge/web typecheck`
- Local smoke: run web with no `LAUNCHDARKLY_SDK_KEY` and confirm flag reads use
  the existing env defaults without throwing.
