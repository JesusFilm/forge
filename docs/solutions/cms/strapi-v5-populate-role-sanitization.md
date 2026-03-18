---
title: "Strapi v5 content API sanitization strips populate=role from /api/users/me"
category: cms
date: 2026-03-18
tags:
  - strapi-v5
  - users-permissions
  - authentication
  - manager
---

# Strapi v5 content API sanitization strips `populate=role`

## Problem

The manager app's login flow called `/api/users/me?populate=role` using the user's own JWT. Strapi v5's `contentAPI.sanitize.query()` stripped the `populate=role` parameter because the user's role lacked permission to read the `users-permissions.role` content type via the REST API. The role was never returned, so `auth.ts` saw `user.role === undefined` and rejected every login as "Invalid or expired token".

## Root Cause

In Strapi v5, the `/api/users/me` controller runs the query through `contentAPI.sanitize.query()` (line 214 of the plugin's `controllers/user.js`). This sanitizer checks if the authenticated user's role has permission to populate the requested relation. If the role doesn't have "find" permission on `plugin::users-permissions.role`, the populate parameter is silently dropped.

This differs from `fetchAuthenticatedUser()` (used internally by Strapi middleware for JWT validation), which hard-codes `populate: ['role']` and bypasses content API sanitization.

## Solution

Use the admin-level `STRAPI_API_TOKEN` to fetch user details with role, instead of the user's own JWT:

1. Verify the JWT is valid via `/api/users/me` (no populate) — this confirms identity and returns the user ID
2. Fetch `/api/users/{id}?populate=role` with `Authorization: Bearer ${STRAPI_API_TOKEN}` — the API token has full access and bypasses per-role sanitization

The fetcher function (`fetchUserWithRole`) is kept private to prevent IDOR — only the public `verifyStrapiJwtWithRole(jwt)` function is exported, which binds the user ID to a verified JWT.

## Key Pattern

```typescript
// Private — only accepts IDs from verified sources
async function fetchUserWithRole(userId: number): Promise<StrapiUser | null> {
  const response = await fetch(
    `${env.STRAPI_URL}/api/users/${userId}?populate=role`,
    { headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` } },
  )
  return (await response.json()) as StrapiUser
}

// Public — JWT-verified path is the only way to get a user with role
export async function verifyStrapiJwtWithRole(
  jwt: string,
): Promise<StrapiUser | null> {
  const meResponse = await fetch(`${env.STRAPI_URL}/api/users/me`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })
  const me = (await meResponse.json()) as { id: number }
  return await fetchUserWithRole(me.id)
}
```

## Alternatives Considered

- **Grant the Manager role permission to read `users-permissions.role` via Strapi admin** — works but fragile; any future role changes could break login again.
- **Use GraphQL `/graphql` with a `me` query** — returns role correctly but adds unnecessary complexity for a simple auth check.

## Files

- `apps/manager/src/lib/auth.ts` — `fetchUserWithRole` (private) + `verifyStrapiJwtWithRole` (public)
- `apps/manager/src/app/api/auth/login/route.ts` — uses `verifyStrapiJwtWithRole(jwt)`
- `apps/cms/node_modules/@strapi/plugin-users-permissions/server/controllers/user.js` — the sanitization source (line 214)
