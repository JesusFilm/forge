---
title: "chore: Mobile Doppler env validation and EAS Build config"
type: chore
status: active
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-mobile-doppler-env-setup-requirements.md
---

# chore: Mobile Doppler env validation and EAS Build config

## Overview

Wire the mobile Expo app's environment variables through proper validation and EAS Build integration, mirroring the web app's pattern: Doppler for local dev secrets, platform dashboard (EAS Environments) for staging/production, and `@t3-oss/env` for validation. Currently the app reads `process.env` directly with no validation and EAS builds have no env var configuration.

## Problem Statement

- `apps/mobile/src/lib/config.ts` reads `process.env.EXPO_PUBLIC_*` with no validation — missing vars silently produce empty strings
- EAS Build profiles (preview, production) have no environment variable configuration
- `.env.example` is stale and doesn't document all vars or their sources
- No `.env.ci` for GitHub Actions consistency
- `apolloClient.ts` instantiates at module scope, creating a fragile initialization chain

(see origin: `docs/brainstorms/2026-03-31-mobile-doppler-env-setup-requirements.md`)

## Proposed Solution

1. Add `@t3-oss/env-core` + `zod` to the mobile app
2. Create `src/env.ts` with `createEnv()` — client vars only, `EXPO_PUBLIC_` prefix
3. Refactor `config.ts` to use the validated env internally while preserving its getter API
4. Convert `apolloClient.ts` to lazy-getter pattern (per monorepo convention)
5. Add `environment` field to `eas.json` profiles (EAS Environments feature)
6. Update `.env.example` and create `.env.ci`

## Technical Considerations

### Critical: `skipValidation` must distinguish CI from EAS Build

Both GitHub Actions and EAS Build set `CI=true`. Using `skipValidation: !!process.env.CI` would skip validation during EAS Build, silently producing an app with empty env vars.

**Solution:** `skipValidation: !!process.env.CI && !process.env.EAS_BUILD`

EAS Build sets `EAS_BUILD=true` as a distinguishing environment variable.

### Metro bundler compatibility

`@t3-oss/env-core` is ESM-only with `exports` field. React Native 0.81.5 (this project) has Metro package exports enabled by default — no compatibility issue.

**Critical:** Must use `runtimeEnvStrict` (not `runtimeEnv: process.env`) because Metro inlines `process.env.EXPO_PUBLIC_*` at build time as string literals. Passing the whole `process.env` object does not work since Metro does not populate it as a real dictionary.

### `isServer: false`

Must be set explicitly. The default heuristic (`typeof window === "undefined"`) can give incorrect results in some React Native contexts.

### EAS Environments vs `env` block

Use the `environment` field per profile (not the `env` block). EAS Environments support sensitive/secret visibility levels and are consistent across EAS Build, Update, and Workflows. The profile names already match the default environment names (`development`, `preview`, `production`).

## Acceptance Criteria

- [ ] `pnpm fetch-secrets` populates `.env` from Doppler with all required vars
- [ ] Importing env module fails fast with a clear Zod error if a required var is missing (except in CI without EAS_BUILD)
- [ ] EAS preview builds use staging values; production builds use production values
- [ ] No private keys or secrets in `eas.json` or committed files
- [ ] `apolloClient.ts` uses lazy-getter pattern — no module-scope SDK instantiation
- [ ] `.env.ci` exists with placeholder values for CI builds
- [ ] TypeScript strict mode passes with no errors

## Implementation Plan

### Phase 1: Add dependencies and create env validation

#### 1.1 Install packages

```bash
cd apps/mobile && pnpm add @t3-oss/env-core zod
```

#### 1.2 Create `apps/mobile/src/env.ts`

```typescript
// apps/mobile/src/env.ts
import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

export const env = createEnv({
  clientPrefix: "EXPO_PUBLIC_",
  client: {
    EXPO_PUBLIC_GRAPHQL_URL_IOS: z.string().url(),
    EXPO_PUBLIC_GRAPHQL_URL_ANDROID: z.string().url(),
    EXPO_PUBLIC_STRAPI_TOKEN: z.string().optional(),
  },
  runtimeEnvStrict: {
    EXPO_PUBLIC_GRAPHQL_URL_IOS: process.env.EXPO_PUBLIC_GRAPHQL_URL_IOS,
    EXPO_PUBLIC_GRAPHQL_URL_ANDROID:
      process.env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID,
    EXPO_PUBLIC_STRAPI_TOKEN: process.env.EXPO_PUBLIC_STRAPI_TOKEN,
  },
  isServer: false,
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.CI && !process.env.EAS_BUILD,
})
```

#### 1.3 Refactor `apps/mobile/src/lib/config.ts`

Preserve the getter API so `apolloClient.ts` consumer interface stays stable, but use validated env internally:

```typescript
// apps/mobile/src/lib/config.ts
import { Platform } from "react-native"
import { env } from "../env"

export const config = {
  get graphqlUrl(): string {
    if (Platform.OS === "ios") {
      return env.EXPO_PUBLIC_GRAPHQL_URL_IOS ?? ""
    }
    if (Platform.OS === "android") {
      return env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID ?? ""
    }
    // Expo Web fallback
    return (
      env.EXPO_PUBLIC_GRAPHQL_URL_IOS ??
      env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID ??
      ""
    )
  },
  get strapiToken(): string | undefined {
    return env.EXPO_PUBLIC_STRAPI_TOKEN
  },
} as const
```

#### 1.4 Convert `apps/mobile/src/lib/apolloClient.ts` to lazy-getter pattern

Per monorepo convention from `docs/solutions/platform/new-app-ci-and-deployment-patterns.md`: never instantiate SDK clients at module scope.

```typescript
// apps/mobile/src/lib/apolloClient.ts
import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { config } from "./config"

const REQUEST_TIMEOUT_MS = 15_000

const fetchWithTimeout = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(id),
  )
}

let _client: ApolloClient<unknown> | undefined

export function getApolloClient(): ApolloClient<unknown> {
  if (!_client) {
    const uri = config.graphqlUrl || "http://localhost:1337/graphql"
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

**Migration note:** This changes the export from `apolloClient` (value) to `getApolloClient()` (function). All consumers must be updated. Search for imports:

```bash
grep -r "apolloClient" apps/mobile/src/ --include="*.ts" --include="*.tsx"
```

### Phase 2: EAS Build configuration

#### 2.1 Update `apps/mobile/eas.json`

Add `environment` field to each profile. This maps profiles to EAS Environments where secrets and env vars are managed via the Expo dashboard.

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

#### 2.2 Set up EAS Environment variables

Use the Expo dashboard or CLI to configure env vars per environment:

**Preview environment:**

```bash
eas env:create --environment preview --name EXPO_PUBLIC_GRAPHQL_URL_IOS --value "https://cms-stage.jesusfilm.org/graphql" --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_GRAPHQL_URL_ANDROID --value "https://cms-stage.jesusfilm.org/graphql" --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_STRAPI_TOKEN --value "<staging-token>" --visibility secret
```

**Production environment:**

```bash
eas env:create --environment production --name EXPO_PUBLIC_GRAPHQL_URL_IOS --value "https://cms.jesusfilm.org/graphql" --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_GRAPHQL_URL_ANDROID --value "https://cms.jesusfilm.org/graphql" --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_STRAPI_TOKEN --value "<production-token>" --visibility secret
```

**Development environment:** No EAS env vars needed — developers use local `.env` from Doppler.

> **Security note:** Scope secrets per environment. Do NOT create global secrets that leak production tokens into development builds.

### Phase 3: Documentation and CI

#### 3.1 Update `apps/mobile/.env.example`

```env
# Expo environment variables for @forge/mobile
# ─────────────────────────────────────────────
# Local dev: pull secrets from Doppler
#   pnpm fetch-secrets
#
# EAS builds: env vars come from EAS Environments (expo.dev dashboard)
#   Preview  → "preview" environment
#   Production → "production" environment
#
# New to the project? If you don't have Doppler access, copy this file
# to .env and fill in values manually.

# ── GraphQL endpoint (required) ──────────────────────────────────────
# Android emulator uses 10.0.2.2 to reach host machine's localhost
EXPO_PUBLIC_GRAPHQL_URL_ANDROID=http://10.0.2.2:1337/graphql
# iOS simulator uses localhost directly
EXPO_PUBLIC_GRAPHQL_URL_IOS=http://localhost:1337/graphql

# ── Strapi API token (optional for local dev) ────────────────────────
# Required if Strapi restricts public read access.
# In EAS builds, set via EAS Secrets (visibility: secret).
# EXPO_PUBLIC_STRAPI_TOKEN=
```

#### 3.2 Create `apps/mobile/.env.ci`

```env
# CI placeholder values — used by GitHub Actions when Doppler is unavailable
EXPO_PUBLIC_GRAPHQL_URL_ANDROID=http://localhost:1337/graphql
EXPO_PUBLIC_GRAPHQL_URL_IOS=http://localhost:1337/graphql
EXPO_PUBLIC_STRAPI_TOKEN=ci-placeholder
```

#### 3.3 Doppler is dev-only — no `stg`/`prd` configs needed

Following the web app's pattern: Doppler is used exclusively for **local dev** secrets (`fetch-secrets` → `--config dev`). Staging and production secrets are managed through the deployment platform's dashboard — Railway for web/cms, **EAS Environments for mobile**.

The `fetch-secrets` script stays hardcoded to `--config dev`. No Doppler `stg` or `prd` configs are needed.

## Dependencies & Risks

| Risk                                     | Likelihood                           | Mitigation                                                                                           |
| ---------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `@t3-oss/env-core` Metro incompatibility | Low (RN 0.81.5 supports ESM exports) | Test locally before merging; fallback to hand-rolled Zod validation                                  |
| `getApolloClient()` breaking consumers   | Medium                               | Grep for all imports; only one consumer identified (`apolloClient.ts` is imported elsewhere)         |
| EAS Build missing env vars               | High if misconfigured                | `skipValidation` is false during EAS Build (`EAS_BUILD=true`), so missing vars fail the build loudly |
| Zod v4 compatibility                     | Low (t3-env uses Standard Schema)    | Zod v4 in monorepo already works with web app's env-nextjs                                           |

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-31-mobile-doppler-env-setup-requirements.md](docs/brainstorms/2026-03-31-mobile-doppler-env-setup-requirements.md) — Key decisions: `@t3-oss/env-core` over `env-nextjs`, EAS Secrets dashboard for build secrets, non-secret env vars in version control

### Internal References

- Web app env pattern: [apps/web/src/env.ts](apps/web/src/env.ts)
- Current mobile config: [apps/mobile/src/lib/config.ts](apps/mobile/src/lib/config.ts)
- Apollo client (sole consumer): [apps/mobile/src/lib/apolloClient.ts](apps/mobile/src/lib/apolloClient.ts)
- CI env fallback pattern: [apps/web/.env.ci](apps/web/.env.ci)
- Lazy SDK init pattern: [docs/solutions/platform/new-app-ci-and-deployment-patterns.md](docs/solutions/platform/new-app-ci-and-deployment-patterns.md)
- Adding new apps checklist: [docs/solutions/platform/adding-new-apps.md](docs/solutions/platform/adding-new-apps.md)

### External References

- [@t3-oss/env-core docs](https://env.t3.gg/docs/core)
- [EAS Environment variables](https://docs.expo.dev/eas/environment-variables/)
- [EAS Build configuration (eas.json)](https://docs.expo.dev/build/eas-json/)
- [t3-env Metro compatibility discussion](https://github.com/t3-oss/t3-env/issues/260)
