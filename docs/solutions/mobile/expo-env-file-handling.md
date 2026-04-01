---
title: "Expo Env File Handling: Priority, Device IP, and EAS Update Gotchas"
category: mobile
date: 2026-04-01
tags: [expo, env, dotenv, eas-update, device, emulator, metro, doppler, ci, ats]
module: apps/mobile
symptom: "Network Request Failed or Aborted on real iOS devices; app works on simulators"
root_cause: "@expo/env loads .env.production over .env when NODE_ENV=production (set by Metro for device builds); real devices cannot reach localhost"
severity: high
---

## Problem

Real iOS devices showed "Network Request Failed" or "Aborted" when connecting to local Strapi, while simulators worked fine. Multiple cascading issues were discovered:

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

When Metro bundles for real devices, it sets `NODE_ENV=production`, causing `.env.production` (with production CMS URLs) to override `.env` (with local dev URLs). The old `fetch-secrets` script wrote to `.env`, which lost to `.env.production`.

### Localhost vs LAN IP

Simulators share the host's network stack (`localhost` works), but a physical phone is a separate device on the WiFi network. It needs the computer's actual LAN IP (e.g., `192.168.x.x`) to reach local Strapi.

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

### 2. `pnpm device` writes `.env.development.local` with LAN IP

```json
"device": "IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}') && [ -n \"$IP\" ] || { echo 'ERROR: Could not detect local IP.'; exit 1; } && printf 'EXPO_PUBLIC_GRAPHQL_URL_ANDROID=http://%s:1337/graphql\\nEXPO_PUBLIC_GRAPHQL_URL_IOS=http://%s:1337/graphql\\n' \"$IP\" \"$IP\" > .env.development.local && node scripts/device.mjs"
```

`.env.development.local` has the HIGHEST priority, overriding everything. The IP validation prevents silently writing empty URLs.

### 3. `pnpm emulator` cleans up device overrides

```json
"emulator": "rm -f .env.development.local && expo start"
```

Removes `.env.development.local` so simulators use localhost/10.0.2.2 from `.env.local`.

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

| Gotcha                                            | Detail                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `expo export` forces `NODE_ENV=production`        | Regardless of what you set. Don't rely on NODE_ENV for env switching.                                            |
| Shell `export` doesn't work for `EXPO_PUBLIC_*`   | Metro inlines values from `.env` files via babel, not from `process.env`. Use file-based overrides.              |
| `--channel` != `--environment` in EAS             | Channel = which builds receive the update. Environment = which env vars are injected. Must pass both explicitly. |
| SDK 54: `--environment` is optional but critical  | Without it, `eas update` falls back to local `.env` files (which don't exist in CI). In SDK 55+, it's required.  |
| EAS "secret" visibility                           | NOT available during `eas update`, only during `eas build`. Use "sensitive" for `EXPO_PUBLIC_*` tokens.          |
| `fromJson` on empty string crashes GitHub Actions | Guard with `services != '' && services != '[]'` before `contains(fromJson(...))`.                                |

## Prevention

1. **Never store production secrets in `.env.production`** locally. Delete it — production secrets belong exclusively in EAS Environments dashboard.
2. **Use `.env.development.local`** for per-machine overrides (LAN IP). It's gitignored and highest priority.
3. **Always pass `--environment` explicitly** with `eas update`. Wrap in npm scripts to prevent forgetting.
4. **Use atomic writes** for secrets scripts (temp file + `mv`). Never redirect directly into the target file.
5. **Validate computed values** in shell scripts. Check `[ -n "$IP" ]` before using it.
6. **Document the env file priority** in `apps/mobile/CLAUDE.md` so every contributor knows the precedence rules.

## Related

- [EAS Update Stakeholder Preview Setup](../mobile/eas-update-stakeholder-preview-setup.md) — **NOTE: references `.env` which is now `.env.local`**
- [New App CI and Deployment Patterns](../platform/new-app-ci-and-deployment-patterns.md) — `skipValidation` guard and `EAS_BUILD` explanation
- [Adding New Apps](../platform/adding-new-apps.md) — env validation convention
- `@expo/env` source: `node_modules/.pnpm/@expo+env@2.0.8/node_modules/@expo/env/build/index.js`
