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
  - "fetchWithTimeout silently dropped caller AbortSignal — fixed with AbortSignal.any()"
  - "Silent empty-string fallback chain for missing GraphQL URL — now throws explicitly"
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
    EXPO_PUBLIC_GRAPHQL_URL_IOS: z.string().url(),
    EXPO_PUBLIC_GRAPHQL_URL_ANDROID: z.string().url(),
    EXPO_PUBLIC_STRAPI_TOKEN: z.string().optional(),
    EXPO_PUBLIC_WEB_BASE_URL: z.string().optional(),
  },
  runtimeEnvStrict: {
    EXPO_PUBLIC_GRAPHQL_URL_IOS: process.env.EXPO_PUBLIC_GRAPHQL_URL_IOS,
    EXPO_PUBLIC_GRAPHQL_URL_ANDROID:
      process.env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID,
    EXPO_PUBLIC_STRAPI_TOKEN: process.env.EXPO_PUBLIC_STRAPI_TOKEN,
    EXPO_PUBLIC_WEB_BASE_URL: process.env.EXPO_PUBLIC_WEB_BASE_URL,
  },
  isServer: false,
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.CI && !process.env.EAS_BUILD,
})
```

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
  if (!_client) {
    const uri = config.graphqlUrl
    const headers: Record<string, string> = {}
    if (config.strapiToken) {
      headers.Authorization = `Bearer ${config.strapiToken}`
    }
    const link = new HttpLink({ uri, headers, fetch: fetchWithTimeout })
    _client = new ApolloClient({ link, cache: new InMemoryCache() })
  }
  return _client
}
```

### 4. Config — Fail Fast on Missing URL

Replaced silent fallback chain (`?? "" || "http://localhost:1337/graphql"`) with explicit error:

```typescript
get graphqlUrl(): string {
  const url =
    Platform.OS === "android"
      ? env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID
      : env.EXPO_PUBLIC_GRAPHQL_URL_IOS
  if (!url) {
    throw new Error(`Missing EXPO_PUBLIC_GRAPHQL_URL for platform: ${Platform.OS}`)
  }
  return url
}
```

### 5. Fixed AbortSignal Override in fetchWithTimeout

Original code replaced caller's signal. Fixed to merge both:

```typescript
const signal = init?.signal
  ? AbortSignal.any([init.signal, controller.signal])
  : controller.signal
```

### 6. Publishing and Sharing

```bash
cd apps/mobile
eas update --branch preview --message "Sprint demo" --platform all
```

Share via direct QR URL (no Expo login required):

```
https://qr.expo.dev/eas-update?projectId=<PROJECT_ID>&groupId=<GROUP_ID>
```

The `groupId` changes with each update — extract it from the `eas update` command output. EAS dashboard links require Expo login; `qr.expo.dev` URLs do not.

## Pitfalls Encountered

1. **Slug mismatch:** `eas init` failed when `app.json` slug (`forge-expo`) didn't match the Expo project slug (`jesus-film-forge`). Must match exactly.

2. **EAS dashboard links require login:** Switched to `qr.expo.dev` for unauthenticated stakeholder sharing.

3. **`.env.ci` gitignored:** `.env.*` glob matched it. Required explicit `!.env.ci` exemption in `.gitignore`.

4. **Raw `process.env` bypass:** `resolveImageUrl.ts` read `EXPO_PUBLIC_WEB_BASE_URL` directly, bypassing env validation. All `EXPO_PUBLIC_*` access must go through `env.ts`.

5. **Silent URL fallback chain:** Missing URL → `""` → localhost fallback hid real errors in production. Removed all silent fallbacks.

6. **Doppler is dev-only:** Staging/production secrets are managed in EAS Environments dashboard, not Doppler. The `fetch-secrets` script stays hardcoded to `--config dev`.

## Secrets Management by Environment

| Environment            | Secret Source    | Mechanism                                  |
| ---------------------- | ---------------- | ------------------------------------------ |
| Local dev              | Doppler          | `pnpm fetch-secrets` → `.env`              |
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
4. **No silent URL fallbacks:** Required env vars should throw on missing, not fall back to empty string or localhost.
5. **Log resolved config at startup:** `console.info("Config:", { graphqlUrl })` makes misconfig visible in EAS build logs.

## Related Documentation

- [Lazy SDK Initialization Pattern](../platform/new-app-ci-and-deployment-patterns.md) — Core pattern for `skipValidation` + lazy getter
- [Adding New Apps Checklist](../platform/adding-new-apps.md) — Monorepo onboarding including `@t3-oss/env` setup
- [Expo GraphQL Schema Drift](../integration-issues/expo-graphql-schema-drift-and-fragment-validation.md) — Mobile app's local GraphQL queries (not codegen)
- [Quiz Button WebView Pipeline](../mobile/quiz-button-section-webview-modal-pipeline.md) — References EAS Build vs Update distinction
