---
title: "EAS Update setup for Expo mobile stakeholder previews via QR code"
category: mobile
date: 2026-03-31
tags:
  - expo
  - eas-update
  - eas-build
  - react-native
  - env-validation
  - mobile-deployment
  - stakeholder-preview
  - qr-code-sharing
severity: medium
module: apps/mobile
related_issues:
  - ".env.ci gitignored by .env.* glob — required !.env.ci exemption"
  - "resolveImageUrl.ts bypassed env validation with raw process.env"
  - "fetchWithTimeout silently dropped caller AbortSignal — fixed by composing signals"
  - "Silent empty-string fallback chain for missing GraphQL URL — replaced with an explicit production-default fallback"
last_updated: 2026-06-08
---

# EAS Update for Stakeholder Previews via Expo Go

## Problem

The mobile app had no OTA update infrastructure. Stakeholders needed to preview the app on their own devices without App Store/Play Store publishing and without a running dev server.

## Root Cause / Challenge

No EAS configuration existed: no `eas.json`, no `expo-updates` dependency, no EAS project linking. Environment variables were consumed via raw `process.env` without validation. There was no mechanism to publish JS bundles for remote viewing.

## Solution

### Approach: EAS Update + Expo Go (Path A)

Chosen over EAS Build internal distribution (Path B) because:

- All current dependencies (`expo-video`, `expo-blur`, etc.) are included in Expo Go SDK 54
- No Apple Developer account needed ($0 vs $99/yr)
- No device UDID registration required
- ~30 second publish time (JS bundle) vs ~15 min (native build)
- Free tier sufficient for 10-50 stakeholders

### 1. EAS Project Configuration

**`apps/mobile/app.json`** — Added EAS fields:

```json
{
  "expo": {
    "slug": "jesus-film-forge",
    "owner": "jesus-film-project",
    "runtimeVersion": {
      "policy": "sdkVersion"
    },
    "updates": {
      "url": "https://u.expo.dev/<PROJECT_ID>"
    },
    "extra": {
      "eas": {
        "projectId": "<PROJECT_ID>"
      }
    }
  }
}
```

**Critical:** `runtimeVersion` must use `{ "policy": "sdkVersion" }` for Expo Go compatibility. A hardcoded string (e.g., `"1.0.0"`) will fail — Expo Go matches updates by SDK version.

**`apps/mobile/eas.json`** — Build profiles with channel mapping:

```json
{
  "cli": { "version": ">= 16.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development"
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "environment": "preview"
    },
    "production": {
      "channel": "production",
      "environment": "production"
    }
  }
}
```

The `environment` field maps to EAS Environments on the Expo dashboard (where secrets are managed), not inline `env` blocks.

### 2. Type-Safe Environment Variables

**`apps/mobile/src/env.ts`** — Using `@t3-oss/env-core` (not `env-nextjs`):

```typescript
import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

export const env = createEnv({
  clientPrefix: "EXPO_PUBLIC_",
  client: {
    // Optional + a production default in config.ts (see §4). A required `.url()`
    // here would brick CI/EAS environments that haven't set the var.
    EXPO_PUBLIC_ADMIN_GRAPHQL_URL: z.string().url().optional(),
    EXPO_PUBLIC_FORGE_CACHE_PERSIST: z.string().optional(),
  },
  runtimeEnvStrict: {
    EXPO_PUBLIC_ADMIN_GRAPHQL_URL: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
    EXPO_PUBLIC_FORGE_CACHE_PERSIST:
      process.env.EXPO_PUBLIC_FORGE_CACHE_PERSIST,
  },
  isServer: false,
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.CI && !process.env.EAS_BUILD,
})
```

> The app moved from Strapi to admin GraphQL: the old platform-split
> `EXPO_PUBLIC_GRAPHQL_URL_IOS`/`_ANDROID` + `EXPO_PUBLIC_STRAPI_TOKEN` were
> replaced by a single `EXPO_PUBLIC_ADMIN_GRAPHQL_URL`. See the
> [mobile admin data-layer cutover](../architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md).

| Setting                  | Why                                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtimeEnvStrict`       | Metro inlines `process.env.EXPO_PUBLIC_*` as string literals. `runtimeEnvStrict` forces explicit listing, catching typos. `runtimeEnv` would silently pass `undefined`. |
| `isServer: false`        | Must be explicit. Default heuristic (`typeof window === "undefined"`) gives incorrect results in React Native.                                                          |
| `skipValidation`         | Skips in CI lint/typecheck (no env vars); enforces during EAS Build (`EAS_BUILD=true`).                                                                                 |
| `emptyStringAsUndefined` | Defensive for Expo where unset vars may arrive as empty strings.                                                                                                        |

### 3. Apollo Client — Lazy Getter Pattern

Refactored from module-scope instantiation to defer initialization until first call:

```typescript
let _client: ApolloClient | undefined

export function getApolloClient(): ApolloClient {
  if (_client) return _client

  const link = new HttpLink({
    uri: getGraphQLUrl(), // env var ?? production default — see §4
    fetch: fetchWithTimeout,
  })
  _client = new ApolloClient({ link, cache: new InMemoryCache() })
  return _client
}
```

The admin GraphQL endpoint serves the app's reads anonymously, so there's no
`Authorization` header — the old Strapi bearer token is gone.

### 4. Config — fall back to the production default, never to empty/localhost

> **Superseded 2026-08-07 (feat-339).** All three claims below are now false for
> `apps/mobile`: `DEFAULT_ADMIN_GRAPHQL_URL` no longer exists (it moved to
> `PRODUCTION_ADMIN_GRAPHQL_URL` in `src/lib/adminEndpoint.ts`), a **development**
> bundle now defaults to local admin rather than production, and resolution
> **does** split on `Platform.OS` (loopback is rewritten to `10.0.2.2` on the
> Android emulator). Release bundles still fall back to the production default,
> which is the part of this section that survives. The env-var-must-be-optional
> reasoning in the paragraph after the snippet is also unchanged. See
> `apps/mobile/CLAUDE.md` § Admin endpoint resolution.

The original silent chain (`?? "" || "http://localhost:1337/graphql"`) hid misconfig behind a dead localhost URL. The current resolver returns the env var **or a real production default** — never an empty string, and no `Platform.OS` split:

```typescript
// config.ts
export function getGraphQLUrl(): string {
  return env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL ?? DEFAULT_ADMIN_GRAPHQL_URL
}
// env.ts:  const DEFAULT_ADMIN_GRAPHQL_URL = "https://admin.jesusfilm.org/api/graphql"
```

This intentionally moved **away** from the earlier "throw on missing URL" posture: the var is now `.optional()` with a production default so default builds and un-provisioned CI/EAS environments need zero new env vars. See [required env var without default broke Railway deploy](../runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md) for why opt-in vars must be optional.

### 5. Fixed AbortSignal Override in fetchWithTimeout

Original code replaced caller's signal. Fixed to merge both:

```typescript
const signal = init?.signal
  ? AbortSignal.any([init.signal, controller.signal])
  : controller.signal
```

### 6. Publishing and Sharing

> **Superseded 2026-08-07 (feat-339).** Publish through the scripts, which name
> the EAS environment and disable dotenv so a developer's local env files cannot
> reach the bundle:
>
> ```bash
> pnpm --filter @forge/mobile update:preview
> pnpm --filter @forge/mobile update:production
> ```
>
> A bare `eas update` with no `--environment` runs `expo export` in production
> mode, which reads `.env.local` — that is the route by which a local admin
> endpoint could reach testers. Use a raw command only for a throwaway branch
> (`--branch <name> --environment <env>`), never for a live channel. See
> `apps/mobile/CLAUDE.md` § Publishing an EAS Update.

The original command, kept for the record:

```bash
cd apps/mobile
eas update --branch preview --message "Sprint demo" --platform all
```

#### Option A: Channel-based URL (preferred for persistent sharing)

For QR codes embedded in web pages or shared long-term, use the channel-based URL format. This always resolves to the latest update on the channel — no regeneration needed after each `eas update`:

```
exp://u.expo.dev/<PROJECT_ID>?channel-name=preview
```

This is used by the roadmap experiments page QR code panel. See [QR Code Preview Panel](../web/qr-code-preview-panel-roadmap.md) for the implementation.

#### Option B: Group-based URL (for sharing a specific update)

To share a link to one specific update (e.g., "scan this to see exactly what I just published"), use the `qr.expo.dev` format. No Expo login required:

```
https://qr.expo.dev/eas-update?projectId=<PROJECT_ID>&groupId=<GROUP_ID>
```

The `groupId` changes with each update — extract it from the `eas update` command output. EAS dashboard links require Expo login; `qr.expo.dev` URLs do not.

## Pitfalls Encountered

1. **Slug mismatch:** `eas init` failed when `app.json` slug (`forge-expo`) didn't match the Expo project slug (`jesus-film-forge`). Must match exactly.

2. **EAS dashboard links require login:** Switched to `qr.expo.dev` for unauthenticated stakeholder sharing.

3. **`.env.ci` gitignored:** `.env.*` glob matched it. Required explicit `!.env.ci` exemption in `.gitignore`.

4. **Raw `process.env` bypass:** `resolveImageUrl.ts` read `EXPO_PUBLIC_WEB_BASE_URL` directly, bypassing env validation. All `EXPO_PUBLIC_*` access must go through `env.ts`.

5. **Silent URL fallback chain:** Missing URL → `""` → dead-`localhost` fallback hid real errors. Now resolves to a real production default (`https://admin.jesusfilm.org/api/graphql`), never an empty string — see §4.

6. **Doppler is dev-only:** Staging/production secrets are managed in EAS Environments dashboard, not Doppler. The `fetch-secrets` script stays hardcoded to `--config dev`.

## Secrets Management by Environment

| Environment            | Secret Source    | Mechanism                                  |
| ---------------------- | ---------------- | ------------------------------------------ |
| Local dev              | Doppler          | `pnpm fetch-secrets` → `.env.local`        |
| CI (lint/typecheck)    | `.env.ci`        | Committed placeholders, validation skipped |
| EAS Build (preview)    | EAS Environments | Dashboard: preview environment             |
| EAS Build (production) | EAS Environments | Dashboard: production environment          |

## When to Use `eas update` vs `eas build`

| Change Type                                             | Command                                        |
| ------------------------------------------------------- | ---------------------------------------------- |
| JS/TS code, components, hooks                           | `eas update`                                   |
| Static assets bundled by Metro                          | `eas update`                                   |
| `EXPO_PUBLIC_*` env var values                          | `eas update` (values are baked into JS bundle) |
| Native dependency added/removed                         | `eas build`                                    |
| `app.json` native fields (plugins, permissions, splash) | `eas build`                                    |
| Expo SDK version upgrade                                | `eas build`                                    |
| `runtimeVersion` policy change                          | `eas build`                                    |

**Critical gotcha:** `EXPO_PUBLIC_*` variables are inlined by Metro at bundle time. Changing a value in EAS Environments dashboard alone does nothing — you must run `eas update` or `eas build` to produce a new bundle with the new value.

## Checklist: Adding a New `EXPO_PUBLIC_*` Env Var

- [ ] Added to `env.ts` schema with Zod validator
- [ ] Added to `runtimeEnvStrict` mapping in `env.ts`
- [ ] Consuming code imports from `env.ts`, not `process.env` directly
- [ ] Added to `.env.ci` with placeholder value
- [ ] Added to `.env.example` with documentation
- [ ] Added to EAS Environments dashboard (preview + production)
- [ ] Added to Doppler (`forge-mobile` project, `dev` config) for local dev
- [ ] Verified `.gitignore` doesn't block updated env files (`git check-ignore -v`)
- [ ] Tested locally with `npx expo start --clear` (Metro caches aggressively)

## Prevention Strategies

1. **Lint against raw `process.env` access:** Add ESLint rule forbidding `process.env.EXPO_PUBLIC_*` outside `env.ts`.
2. **Audit `.gitignore` after adding `.env.*` files:** Run `git check-ignore -v <file>` before committing.
3. **Compose AbortSignals, never replace:** Use `AbortSignal.any()` when adding timeout to existing fetch wrappers.
4. **No silent fallback to empty/localhost:** A missing URL must resolve to a real default (the production admin endpoint) or throw — never to `""` or a dead `localhost`. Opt-in vars use a production default so un-provisioned environments still boot (see §4).
5. **Log resolved config at startup:** `console.info("Config:", { graphqlUrl })` makes misconfig visible in EAS build logs.

## Related Documentation

- [Mobile admin data-layer cutover](../architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md) — replaced the Strapi env vars/endpoint this doc's snippets used to show
- [Verifying mobile Expo worktree changes in the simulator](../developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md) — local admin endpoint (`:3003`) + simulator verification loop
- [Lazy SDK Initialization Pattern](../platform/new-app-ci-and-deployment-patterns.md) — Core pattern for `skipValidation` + lazy getter
- [Adding New Apps Checklist](../platform/adding-new-apps.md) — Monorepo onboarding including `@t3-oss/env` setup
- [Expo GraphQL Schema Drift](../integration-issues/expo-graphql-schema-drift-and-fragment-validation.md) — Mobile app's local GraphQL queries (not codegen)
- [Quiz Button WebView Pipeline](../mobile/quiz-button-section-webview-modal-pipeline.md) — References EAS Build vs Update distinction
- [Expo Env File Handling](../mobile/expo-env-file-handling.md) — Env file priority, device IP detection, and EAS Update CI gotchas
