---
title: "Expo Env File Handling: Priority, Device IP, and EAS Update Gotchas"
category: mobile
date: 2026-04-01
tags: [expo, env, dotenv, eas-update, device, emulator, metro, doppler, ci, ats]
module: apps/mobile
symptom: "Network Request Failed or Aborted on real iOS devices; app works on simulators"
root_cause: "@expo/env loads .env.production over .env when NODE_ENV=production (set by Metro for device builds); real devices cannot reach localhost"
severity: high
last_updated: 2026-06-22
---

> **Superseded in part — 2026-08-07 (feat-339, `apps/mobile` only).** Three
> things below no longer hold for mobile:
>
> 1. **`.env.development.local` is the general per-machine endpoint slot**, not
>    just the physical-device LAN IP. `fetch-secrets` replaces `.env.local`
>    wholesale, so an endpoint kept there is lost on the next run; a
>    development-scoped file survives it and is never loaded in production mode,
>    so it also cannot reach a published bundle. Section 3's "fall back to the
>    `127.0.0.1:3003` endpoint in `.env.local`" no longer describes the setup.
> 2. **Both `localhost` and `127.0.0.1` work.** Section 3's warning that
>    `localhost` "loops through admin's auth-host proxy" no longer reproduces:
>    measured 2026-08-07 against a running local admin, both spellings return
>    HTTP 200, and `apps/admin` has no `middleware.ts`. The in-code default uses
>    `localhost`, and either spelling is rewritten to `10.0.2.2` on the Android
>    emulator.
> 3. **No endpoint file is needed at all for simulator work.** A development
>    bundle defaults to local admin, refuses to start against production admin
>    without `EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN`, and prints its resolved
>    endpoint at startup. See `apps/mobile/CLAUDE.md` § Admin endpoint
>    resolution.
>
> The env-file priority order, the ATS exception, and every EAS Update gotcha
> below are unchanged and still current. `apps/tv` is unaffected throughout.

## Problem

Real iOS devices showed "Network Request Failed" or "Aborted" when connecting to the local admin GraphQL API, while simulators worked fine. Multiple cascading issues were discovered:

1. `.env.production` overrode local dev secrets due to Expo's env file priority
2. Real devices can't reach `localhost` — they need the computer's LAN IP
3. Shell env var overrides (`export EXPO_PUBLIC_X=...`) don't propagate to Metro bundler
4. `eas update --channel preview` does NOT auto-select the preview EAS Environment
5. EAS "secret" visibility variables are NOT available during `eas update`

## Root Cause

### Env File Priority

`@expo/env` (confirmed in `node_modules/.pnpm/@expo+env@2.0.8`) loads env files in this priority order (highest to lowest):

```
.env.[mode].local    # e.g. .env.development.local  ← HIGHEST
.env.local
.env.[mode]          # e.g. .env.production
.env                                                 ← LOWEST
```

When Metro bundles for real devices, it sets `NODE_ENV=production`, causing `.env.production` (with production GraphQL URLs) to override `.env` (with local dev URLs). The old `fetch-secrets` script wrote to `.env`, which lost to `.env.production`.

### Localhost vs LAN IP

Simulators share the host's network stack (`localhost` works), but a physical phone is a separate device on the WiFi network. It needs the computer's actual LAN IP (e.g., `192.168.x.x`) to reach the local admin GraphQL API.

### Shell Env Vars vs Metro

`@expo/env` parses `.env` files at Metro startup and inlines `EXPO_PUBLIC_*` values via babel transform at bundle time. Shell-level `export` is ignored because the babel plugin re-reads from parsed env files, not `process.env`.

## Solution

### 1. `fetch-secrets` writes to `.env.local` (atomic)

```json
"fetch-secrets": "rm -f .env && doppler secrets download --project forge-mobile --config dev --format env --no-file > .env.local.tmp && mv .env.local.tmp .env.local"
```

- `.env.local` has higher priority than `.env.production` in the load order
- Atomic write: temp file + `mv` prevents empty `.env.local` on Doppler failure
- `rm -f .env` cleans up stale files from the old convention

### 2. Real device: write `.env.development.local` with your LAN IP

A physical phone can't reach `localhost`/`127.0.0.1` — point it at the host's LAN IP. `.env.development.local` has the HIGHEST priority, overriding everything, and is gitignored:

```bash
IP=$(ipconfig getifaddr en0) && [ -n "$IP" ] || { echo 'ERROR: no LAN IP'; exit 1; }
printf 'EXPO_PUBLIC_ADMIN_GRAPHQL_URL=http://%s:3003/api/graphql\n' "$IP" > .env.development.local
```

The app reads a single `EXPO_PUBLIC_ADMIN_GRAPHQL_URL` (admin dev runs on `:3003`), not the old platform-split `EXPO_PUBLIC_GRAPHQL_URL_IOS`/`_ANDROID`. Validate the IP before writing so you never silently emit an empty URL.

> Earlier revisions shipped `pnpm device` / `pnpm emulator` npm scripts that automated this against the retired Strapi `:1337` endpoint. Both scripts were removed in the admin cutover — the manual technique here is the current path.

### 3. Back to the simulator: remove the device override

```bash
rm -f .env.development.local && npx expo start --clear
```

Deleting `.env.development.local` lets the simulator fall back to the `127.0.0.1:3003` admin endpoint in `.env.local`. Simulators share the host network stack, so `127.0.0.1` reaches local admin — use `127.0.0.1`, not `localhost`, which loops through admin's auth-host proxy.

### 4. iOS ATS exception for local networking

```json
"NSAppTransportSecurity": {
  "NSAllowsLocalNetworking": true
}
```

Added to `app.json` infoPlist. Allows HTTP to LAN IPs on real devices. Scoped to local network only — does not weaken production security.

### 5. EAS Update CI with explicit `--environment`

```yaml
- run: eas update --channel preview --environment preview --message "$EAS_MESSAGE" --non-interactive
  env:
    EAS_MESSAGE: "PR #${{ github.event.pull_request.number }}: ${{ github.event.pull_request.title }}"
```

- `--channel preview` routes to preview builds; `--environment preview` selects EAS Environment variables (independent concepts!)
- PR title flows through `env:` block to prevent shell injection
- Fork guard: `head.repo.full_name == github.repository`
- EAS "secret" visibility vars are NOT available during `eas update` — use "sensitive" or "plain text" for `EXPO_PUBLIC_*` vars

## Key Gotchas

| Gotcha                                                   | Detail                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo export` forces `NODE_ENV=production`               | Regardless of what you set. Don't rely on NODE_ENV for env switching.                                                                                                                                                                                         |
| Shell `export` doesn't work for `EXPO_PUBLIC_*`          | Metro inlines values from `.env` files via babel, not from `process.env`. Use file-based overrides.                                                                                                                                                           |
| `--channel` != `--environment` in EAS                    | Channel = which builds receive the update. Environment = which env vars are injected. Must pass both explicitly.                                                                                                                                              |
| SDK 54: `--environment` is optional but critical         | Without it, `eas update` falls back to local `.env` files (which don't exist in CI). In SDK 55+, it's required.                                                                                                                                               |
| EAS "secret" visibility                                  | NOT available during `eas update`, only during `eas build`. Use "sensitive" for `EXPO_PUBLIC_*` tokens.                                                                                                                                                       |
| `fromJson` on empty string crashes GitHub Actions        | Guard with `services != '' && services != '[]'` before `contains(fromJson(...))`.                                                                                                                                                                             |
| `--tunnel` poisons the bundle host for localhost clients | A `--tunnel` Metro bakes the ngrok URL into the manifest it serves to _every_ client, so a simulator connecting via `localhost` still fetches the bundle through the tunnel. Run plain-localhost Metro for sim work; reserve `--tunnel` for physical devices. |

## Prevention

1. **Never store production secrets in `.env.production`** locally. Delete it — production secrets belong exclusively in EAS Environments dashboard.
2. **Use `.env.development.local`** for per-machine overrides (LAN IP). It's gitignored and highest priority.
3. **Always pass `--environment` explicitly** with `eas update`. Wrap in npm scripts to prevent forgetting.
4. **Use atomic writes** for secrets scripts (temp file + `mv`). Never redirect directly into the target file.
5. **Validate computed values** in shell scripts. Check `[ -n "$IP" ]` before using it.
6. **Document the env file priority** in `apps/mobile/CLAUDE.md` so every contributor knows the precedence rules.

## Related

- [Mobile admin data-layer cutover](../architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md) — the Strapi → admin migration that replaced platform-split `EXPO_PUBLIC_GRAPHQL_URL_*` (+ `:1337`) with the single `EXPO_PUBLIC_ADMIN_GRAPHQL_URL`
- [Verifying mobile Expo worktree changes in the simulator](../developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md) — the local admin endpoint trap (`:3003`) and the second-Metro / full-reload verification loop
- [Metro crashes with RangeError when watchman is missing](../runtime-errors/metro-node-crawler-rangerror-missing-watchman-20260622.md) — the watchman prerequisite, and why a `--tunnel` Metro forces even localhost-connected simulators through the tunnel
- [EAS Update Stakeholder Preview Setup](../mobile/eas-update-stakeholder-preview-setup.md) — references `.env` which is now `.env.local`
- [New App CI and Deployment Patterns](../platform/new-app-ci-and-deployment-patterns.md) — `skipValidation` guard and `EAS_BUILD` explanation
- [Adding New Apps](../platform/adding-new-apps.md) — env validation convention
- `@expo/env` source: `node_modules/.pnpm/@expo+env@2.0.8/node_modules/@expo/env/build/index.js`
