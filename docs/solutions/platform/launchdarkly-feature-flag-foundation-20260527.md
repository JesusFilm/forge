# LaunchDarkly Feature Flag Foundation

## Context

Forge previously used per-environment env booleans for rollout gates. That is
still useful for build-time decisions, but it cannot support request-level
targeting or percentage rollouts. LaunchDarkly's docs split server-side Node.js
SDK usage from React/client SDK usage; the server-side SDK uses an SDK key and
the client must be a singleton per project/environment.

## Pattern

Use `@forge/feature-flags` for server-side flag evaluation:

- Add flag keys to `packages/feature-flags/src/registry.ts`.
- Evaluate with `createFeatureFlagClient()` or app-local helpers such as
  `apps/web/src/lib/feature-flags.ts`.
- Keep `LAUNCHDARKLY_SDK_KEY` optional. If unset, the evaluator returns local
  defaults.
- Keep local fallback env vars as `FORGE_*_DEFAULT` so Railway environments can
  roll forward before LaunchDarkly is provisioned.
- Never expose the LaunchDarkly server-side SDK key through `NEXT_PUBLIC_*` or
  client components.

## Operational Setup

Create these LaunchDarkly boolean flags in the desired project/environment:

- `forge.watch.playerMigration`
- `forge.watch.heroMuxVideo`

Then set Railway service env vars:

- `LAUNCHDARKLY_SDK_KEY=<server-side SDK key>`
- `FORGE_WATCH_PLAYER_MIGRATION_DEFAULT=false`
- `FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT=false`

The existing `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` and
`NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` flags remain build-time inputs for
player dynamic-import dead-code elimination. Do not replace those callsites with
runtime LaunchDarkly reads until the bundling strategy is intentionally changed.

## Gotcha Fixed

`z.coerce.boolean()` treats any non-empty string, including `"false"`, as true.
For env-driven booleans in `apps/web/src/env.ts`, use the local boolish parser
that recognizes `true/false`, `1/0`, `yes/no`, and `on/off`.

## Verification

- `pnpm --filter @forge/feature-flags test`
- `pnpm --filter @forge/feature-flags typecheck`
- `pnpm --filter @forge/feature-flags lint`
- `pnpm --filter @forge/web test -- src/lib/feature-flags.test.ts src/lib/admin-client.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
