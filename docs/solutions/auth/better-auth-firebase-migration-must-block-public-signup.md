---
title: "Better Auth Firebase lazy migration should block public signup at the HTTP surface and use signUpEmail only internally"
category: auth
date: 2026-04-14
tags:
  - auth
  - better-auth
  - firebase
  - migration
  - rate-limiting
  - admin
problem_type: architectural_pattern
component: apps/admin/src/app/api/auth/[...all]/route.ts
---

## Context

The admin app needed a transparent migration path from legacy Firebase
email/password accounts to Better Auth. Editors should keep using a single
email/password form. On the first successful legacy login, the server should:

1. try the normal Better Auth email/password sign-in path
2. fall back to Firebase on a Better Auth miss
3. create the Better Auth user and linked `Account(providerId='firebase')`
4. issue a normal Better Auth session

That requirement creates a trap: Better Auth's `signUpEmail` API is exactly
what the server wants for the migration step, but exposing the same signup
route publicly would also let unknown users create accounts directly.

## Guidance

Keep the migration signup path **server-internal** and block public signup at
the HTTP route layer.

In Forge admin, the route handler does three separate things:

1. `POST /api/auth/sign-in/email` is rate-limited before _any_ auth work
2. the route first delegates to Better Auth's normal sign-in handler
3. only after a 401 miss does it attempt Firebase fallback and call
   `auth.api.signUpEmail(...)` programmatically

At the same time, `POST /api/auth/sign-up/email` is explicitly blocked:

```ts
if (path === "sign-up/email") {
  return Response.json({ error: "Not found" }, { status: 404 })
}
```

The internal migration path still uses Better Auth's hashing, session creation,
and adapter logic:

```ts
const signUpResponse = await auth.api.signUpEmail({
  headers: request.headers,
  asResponse: true,
  body: {
    email,
    password,
    callbackURL,
    name: email.split("@")[0] || "editor",
  },
})
```

After signup succeeds, link the Firebase identity explicitly:

```ts
await tx.account.upsert({
  where: {
    providerId_accountId: {
      providerId: "firebase",
      accountId: verified.uid,
    },
  },
  create: {
    id: randomUUID(),
    userId: user.id,
    providerId: "firebase",
    accountId: verified.uid,
  },
  update: {
    userId: user.id,
  },
})
```

For admin-only OAuth providers, use the same rule: existing editors may sign in,
but new accounts should not be created implicitly. When the standalone Auth app
also serves public Web viewer accounts, allow new email/password and trusted
social-provider signups, but keep duplicate-account protection in front of
Better Auth so existing Auth users and legacy Firebase users are asked to sign
in instead. Relying apps such as Admin and Manager must still enforce their own
app-local access checks after the OAuth callback.

## Why This Matters

Without this split, "transparent migration" quietly becomes "open enrollment."
The library API you need for a controlled server-side migration is also a user
signup primitive. If the public route stays open, any uninvited user can create
an admin account as long as they can reach the auth endpoint.

There is a second security boundary here: the rate limiter must wrap the entire
`/sign-in/email` flow, not just the Firebase fallback branch. Limiting only the
fallback still lets an attacker hammer Better Auth's primary password check
unbounded.

## When to Apply

Apply this pattern when all of the following are true:

- a legacy auth system still owns some user credentials
- the new auth system should become the session authority immediately
- users must not see a separate migration UI
- account creation is invitation-controlled or otherwise closed

Do not use a public signup endpoint as the migration mechanism in that setup.

## Examples

### Good: blocked public signup, internal migration signup

```ts
if (path === "sign-up/email") {
  return Response.json({ error: "Not found" }, { status: 404 })
}

const primaryResponse = await authRouteHandlers.POST(request.clone())
if (primaryResponse.ok || primaryResponse.status !== 401) {
  return primaryResponse
}

const firebaseSignIn = await signInWithFirebasePassword(email, password)
if (!firebaseSignIn) {
  return genericUnauthorized()
}

return auth.api.signUpEmail({
  headers: request.headers,
  asResponse: true,
  body,
})
```

### Bad: expose signup because the migration flow needs signup internally

```ts
// BAD: this lets anyone create a Better Auth user directly
export async function POST(request: Request) {
  return authRouteHandlers.POST(request)
}
```

### Good: auth-route limiter protects both Better Auth and Firebase

```ts
const limit = await rateLimitAuthRoute({
  request,
  route: "sign-in/email",
  limit: MAX_ATTEMPTS,
  windowMs: WINDOW_MS,
})

if (!limit.allowed) {
  return genericUnauthorized()
}
```

### Bad: limit only the fallback branch

```ts
const primaryResponse = await authRouteHandlers.POST(request.clone())
if (primaryResponse.ok || primaryResponse.status !== 401) {
  return primaryResponse
}

// BAD: Better Auth itself was already hit before the limit check
if (tooManyRequests(request)) {
  return genericUnauthorized()
}
```

## Related

- [spike-auth-header-must-be-env-gated.md](/workspace/docs/solutions/auth/spike-auth-header-must-be-env-gated.md)
- [route.ts](/workspace/apps/admin/src/app/api/auth/[...all]/route.ts:1)
- [config.ts](/workspace/apps/admin/src/auth/config.ts:1)
- [rate-limit.ts](/workspace/apps/admin/src/auth/rate-limit.ts:1)
