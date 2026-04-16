---
title: "Better Auth secret must not fall back to a hardcoded value; use a runtime production guard with NEXT_PHASE skip"
category: auth
date: 2026-04-14
tags:
  - auth
  - better-auth
  - security
  - env
  - admin
problem_type: security_issue
component: apps/admin/src/auth/config.ts
---

## Problem

The Better Auth config used a nullish-coalescing fallback for the session-
signing secret:

```ts
secret: env.BETTER_AUTH_SECRET ?? "forge-admin-dev-secret-change-me"
```

Combined with the Zod env schema marking `BETTER_AUTH_SECRET` as
`.optional()`, a production deploy missing the env var would silently sign
all session cookies with a publicly visible string — enabling session
forgery for any role including ADMIN.

## Root cause

Same pattern as the spike-auth env gate (see
`docs/solutions/auth/spike-auth-header-must-be-env-gated.md`): dev-time
convenience became a production exploit vector because no runtime guard
enforced the requirement.

Making the env var required in the Zod schema (`z.string().min(32)`)
initially seemed correct, but `next build` sets `NODE_ENV=production`
during the build phase, causing the build to crash when the env var isn't
available at build time (build hosts typically don't have runtime secrets).

## Solution

Two-part fix:

1. **Keep the env var optional in the Zod schema** so builds pass:

   ```ts
   BETTER_AUTH_SECRET: z.string().min(1).optional()
   ```

2. **Add a runtime production guard in the auth config module** that
   skips during the build phase:
   ```ts
   const isNextBuild = process.env.NEXT_PHASE === "phase-production-build"
   if (
     env.NODE_ENV === "production" &&
     !isNextBuild &&
     !env.BETTER_AUTH_SECRET
   ) {
     throw new Error("BETTER_AUTH_SECRET is required in production.")
   }
   ```

This way:

- `next build` (where `NEXT_PHASE === "phase-production-build"`) succeeds
  without the secret
- `next start` in production crashes immediately on startup if the secret
  is missing — fail-closed, no silent degradation
- Local dev and test environments work with or without the secret

## Prevention

For any auth-critical env var in a Next.js app:

- Never use `??` fallback for cryptographic secrets
- Don't make it `.required()` in the Zod schema if it's not available at
  build time — use a runtime guard instead
- Check `process.env.NEXT_PHASE` to distinguish build from runtime

## Related

- `apps/admin/src/auth/config.ts` — the guarded config
- `docs/solutions/auth/spike-auth-header-must-be-env-gated.md` — same
  class of issue (dev convenience → production exploit)
