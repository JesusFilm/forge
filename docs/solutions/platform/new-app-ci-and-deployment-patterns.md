---
title: "New App CI & Deployment Patterns — Lessons from apps/manager"
category: platform
date: 2026-03-18
tags:
  - ci
  - env-validation
  - t3-oss-env-nextjs
  - lazy-initialization
  - sdk-clients
  - next-js
  - railway
  - deployment
  - security
  - auth
  - structured-logging
  - pipeline
components:
  - apps/manager
  - src/config/env.ts
  - src/lib/auth.ts
  - src/services/mux.ts
  - src/services/openrouter.ts
  - src/services/storage.ts
  - src/workflows/videoEnrichment.ts
  - railway.toml
severity: high
related:
  - docs/solutions/platform/adding-new-apps.md
  - docs/solutions/platform/videoforge-manager-integration.md
---

# New App CI & Deployment Patterns

Reusable patterns discovered while adding `apps/manager` (VideoForge) to the Forge monorepo. These apply to any new Next.js app deployed on Railway.

See also: [Adding New Apps](./adding-new-apps.md) for scaffolding, [VideoForge Integration](./videoforge-manager-integration.md) for architecture decisions.

---

## Problem 1: CI Build Failures with `@t3-oss/env-nextjs`

**Symptom:** Builds crash in CI because `@t3-oss/env-nextjs` validates environment variables at build time, and CI environments don't have service secrets (`MUX_TOKEN_ID`, `OPENROUTER_API_KEY`, etc.).

**Root cause:** Two compounding issues:

1. Env validation runs unconditionally — no `skipValidation` guard for CI.
2. SDK clients (Mux, OpenRouter, S3, Apollo) instantiate at module scope, so they crash on import even when `skipValidation` is set, because the env vars are still `undefined`.

**Fix:**

Add `skipValidation: !!process.env.CI` to `createEnv()` in `src/config/env.ts`:

```typescript
export const env = createEnv({
  skipValidation: !!process.env.CI,
  // ...server and client schemas
})
```

Lazify ALL SDK clients with getter functions so initialization is deferred to first call:

```typescript
// Before — crashes at import time when env vars are missing
const mux = new Mux({
  tokenId: env.MUX_TOKEN_ID,
  tokenSecret: env.MUX_TOKEN_SECRET,
})
export { mux }

// After — defers initialization to first call
let _mux: Mux | undefined
export function getMux(): Mux {
  if (!_mux) {
    _mux = new Mux({
      tokenId: env.MUX_TOKEN_ID,
      tokenSecret: env.MUX_TOKEN_SECRET,
    })
  }
  return _mux
}
```

Apply the same lazy-getter pattern to OpenRouter (openai SDK), `S3Client`, and Apollo Client.

---

## Problem 2: Security — Auth Not Validated

**Symptom:** JWT cookies were trusted without server-side validation. API key comparison used `===` (vulnerable to timing attacks). A dev bypass allowed unauthenticated access in development.

**Fix:**

- Added `validateStrapiJwt()` that calls `/api/users/me?populate=role` with a 5s timeout and checks for the Manager role
- Replaced `===` API key comparison with `crypto.timingSafeEqual`, with a length pre-check:

```typescript
import { timingSafeEqual } from "node:crypto"

const a = Buffer.from(token)
const b = Buffer.from(apiKey)
if (a.length === b.length && timingSafeEqual(a, b)) {
  return null // authenticated
}
```

- Removed the dev bypass entirely — auth is enforced in all environments
- Replaced `as` type casts in the login route with Zod schemas for safe runtime validation

---

## Problem 3: Railway Deployment — Standalone Output

**Symptom:** Next.js `output: 'standalone'` doesn't automatically copy static files or bind to the correct host, so the deployed app serves no assets and is unreachable.

**Fix in `railway.toml`:**

```toml
[build]
buildCommand = "pnpm install --frozen-lockfile && pnpm --filter @forge/manager... build && cp -r apps/manager/.next/static apps/manager/.next/standalone/apps/manager/.next/static"

[deploy]
startCommand = "HOSTNAME=0.0.0.0 node apps/manager/.next/standalone/apps/manager/server.js"
```

- `HOSTNAME=0.0.0.0` — Next.js standalone defaults to `127.0.0.1`, unreachable from Railway's proxy
- `cp -r .next/static` — standalone output omits static assets; they must be copied manually

---

## Problem 4: Pipeline Performance — Sequential Workflow Steps

**Symptom:** Workflow steps (transcription -> translation -> chapters -> metadata -> embeddings) ran sequentially when steps 2-5 are independent of each other.

**Fix:** After transcription completes, parallelize steps 2-5 with `Promise.all()`:

```typescript
const transcript = await runTranscription(input)

const [translation, chapters, metadata, embeddings] = await Promise.all([
  runTranslation(transcript),
  runChapterDetection(transcript),
  runMetadataExtraction(transcript),
  runEmbeddingGeneration(transcript),
])
```

Added structured JSON logging at step boundaries to make pipeline progress observable in Railway logs.

---

## Prevention Checklists

### Adding a New App

- [ ] Define env vars in `src/config/env.ts` with `skipValidation: !!process.env.CI`
- [ ] Never instantiate SDK clients at module scope — use lazy getter functions
- [ ] Test that the app builds with env vars unset (simulates CI)
- [ ] Commit `railway.toml` alongside the initial scaffold
- [ ] Commit `.env.example` listing every required var

### Auth Security

- [ ] Validate JWT server-side — never trust claims from an unverified token
- [ ] Use `crypto.timingSafeEqual` for API key comparison, never `===`
- [ ] No dev auth bypasses — use real tokens in development
- [ ] Replace `as` casts on external responses with Zod validation
- [ ] Set cookies as `HttpOnly; Secure; SameSite=Lax`

### Railway Deployment (Next.js Standalone)

- [ ] Set `HOSTNAME=0.0.0.0` in startCommand
- [ ] Copy `.next/static` into standalone output in buildCommand
- [ ] Copy `public/` into standalone output if used
- [ ] Start with `node .next/standalone/server.js`, not `next start`
- [ ] Implement `GET /api/health` (no auth required) with `healthcheckPath` in railway.toml

### Lazy SDK Initialization Pattern

```typescript
// Apply to: OpenAI/OpenRouter, Mux, S3Client, Apollo, any third-party SDK
let _client: ClientType | undefined
export function getClient(): ClientType {
  if (!_client) {
    _client = new ClientType({ apiKey: env.API_KEY })
  }
  return _client
}
```

### Structured Logging from Day One

- [ ] Use `console.log(JSON.stringify({ event, ...data }))` minimum, or `pino` for production
- [ ] Log at the boundary of every external call (before + after)
- [ ] Log LLM parse fallbacks with context identifier
- [ ] Log errors with stack traces as structured fields

### Parallelizing Independent Pipeline Steps

- [ ] Before writing sequential awaits, ask: do these depend on each other?
- [ ] Use `Promise.all()` for independent async work
- [ ] 4 sequential 5s steps = 20s; parallel = 5s

---

## Cross-References

- [Adding New Apps](./adding-new-apps.md) — scaffolding checklist (complements this doc)
- [VideoForge Integration](./videoforge-manager-integration.md) — architecture decisions for apps/manager
- PR [#499](https://github.com/JesusFilm/forge/pull/499) — implementation PR
- Todos 014-027 — code review findings (all resolved)
