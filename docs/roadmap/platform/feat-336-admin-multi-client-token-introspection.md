---
id: "feat-336"
title: "Admin introspection for more than one client id"
owner: "unassigned"
priority: "P1"
status: "not-started"
start_date: "2026-08-11"
duration: 2
depends_on:
  - "feat-322"
blocks: []
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "tv"
---

## Problem

Admin cannot authorize TV tokens, and this blocks shipping a TV client build.

`@better-auth/oauth-provider@1.6.2` scopes introspection to the caller. Both
`validateJwtAccessToken` and `validateOpaqueAccessToken` end with

```js
if (clientId && <token>.clientId !== clientId) return { active: false }
```

where `clientId` is the _calling_ client, and the endpoint additionally requires
a `client_secret`. Access tokens are opaque (`jfp_at_…`, one segment, not a
JWT), so local JWKS verification is not an alternative — introspection is the
only way for a relying app to authorize one.

`apps/admin` holds exactly one `AUTH_WEB_USER_INTROSPECTION_CLIENT_ID`
(`apps/admin/src/auth/web-user-token.ts`), so it can authorize `jfp_web_*` or
`jfp_tv_*`, not both. feat-322 gave the TV client `web:watch-events:write` and
added the four `jfp_tv_*` ids to admin's allowlist, which is necessary but not
sufficient: the allowlist check never runs, because introspection returns
`active: false` first.

**This was verified against a real database, not by reading.** It is also worth
confirming whether web's signed-in watch-events path works in production today
— every admin-side test mocks `fetch` and asserts on a fabricated introspection
response, so no test in this repo establishes the real contract in either
direction.

## Entry Points — Read These First

1. `apps/admin/src/auth/web-user-token.ts` — `resolveWebUserPrincipalFromToken`
   builds one Basic credential from `AUTH_WEB_USER_INTROSPECTION_CLIENT_ID` /
   `_SECRET`; `usableWebUserSubject` then checks issuer, client-id allowlist,
   environment claim, `web:watch-events:write`, and expiry.
2. `apps/admin/src/config/env.ts` (~:194-199) — the three env vars involved.
3. `apps/auth/src/services/device-grant.integration.test.ts` — the two tests
   that pin this constraint (`refuses to introspect a token minted for a
different client` / `introspects a token when the caller is the client that
owns it`). If a library upgrade relaxes the scoping, the first goes red and
   this ticket can be closed as unnecessary.
4. `apps/auth/src/app/api/oauth/introspect/route.ts` — auth's own forwarding
   route, the seam for option 2 below.
5. `docs/solutions/architecture-patterns/oauth-grant-via-authorization-code-delivery-not-token-translation.md`
   — the finding in context.

## Grep These

- `AUTH_WEB_USER_INTROSPECTION_CLIENT_ID` — every consumer
- `getExpectedClientIds` in `apps/admin/` — the allowlist that never runs today
- `validateOpaqueAccessToken` in `node_modules/.pnpm/@better-auth+oauth-provider@1.6.2/` — the scoping itself
- `verifyStoredClientSecret` — note secrets must carry the `jfp_cs_` prefix, and
  the stored hash is of the value _after_ the prefix

## What To Build

Pick one. Option 1 is preferred: it is contained to admin and needs no change to
the identity provider.

**Option 1 — a client-id → secret map in admin.** Introspect with the web
credential; on `active: false`, retry with the TV credential. At most one extra
round trip, and only on the path that would otherwise fail. Needs a new env var
holding the TV introspection secret, `.optional()` so an environment without it
behaves exactly as today.

**Option 2 — a trusted-introspector path in auth.** Let one designated internal
client introspect any token, in auth's own `/api/oauth/introspect` route rather
than the library's. More capable and useful to future relying apps, but it
widens what a single leaked credential can read, so it needs its own threat
review.

Either way, a `clientSecret` must be provisioned on the `jfp_tv_*` OAuth client
rows out of band. The seeder's update branch never writes `clientSecret`, so an
out-of-band secret survives re-seeding — confirmed. Secrets must be prefixed
`jfp_cs_`, and the stored value is `sha256(secret-without-prefix)` base64url.

## Constraints

- Do **not** relax `usableWebUserSubject`'s `web:watch-events:write` check. The
  TV client was given that scope precisely so this check keeps working
  unchanged; weakening it would make TV a special case, which is what feat-322's
  design exists to avoid.
- Do not give the TV client a secret it has to hold. A television cannot keep
  one — the secret here belongs to whichever server does the introspecting.
- Whatever is built, add a test that fails when introspection is misconfigured.
  The current failure mode is silent: an anonymous principal and no watch events,
  with nothing pointing at this allowlist.

## Verification

- A `jfp_tv_production` token is accepted by admin as a `WEB_USER` principal,
  with the TV client id visible in admin's logs. This is feat-322's origin
  success criterion and it is not satisfied until this ticket lands.
- A `jfp_web_production` token still works, with no extra round trip on that
  path.
- An environment with the new variable unset behaves exactly as before.
- Confirm whether web's signed-in watch-events path was working in production
  before this change, and record the answer either way.
