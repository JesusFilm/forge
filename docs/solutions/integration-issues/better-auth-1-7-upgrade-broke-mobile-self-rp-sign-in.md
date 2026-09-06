---
title: "Better Auth 1.7 on auth broke mobile hosted sign-in four ways while the mobile client stayed on 1.6.2"
date: 2026-08-28
category: integration-issues
module: apps/mobile, apps/auth
problem_type: integration_issue
component: auth_client
symptoms:
  - "TestFlight build 1.0.0 (4): tapping Sign in shows 'Something went wrong finishing sign-in. You are not signed in yet — please try again.' instantly, with no browser sheet"
  - "Production auth HTTP log: forgewatch/4 -> POST /api/auth/sign-in/oauth2 -> 404"
  - 'After the client fix, the sheet opens on {"message":"Invalid authorizationURL"} from /api/auth/expo-authorization-proxy'
  - "After the proxy fix, the callback ends on /api/auth/error?error=account_not_linked for any user without a jfp account row"
  - "Post-upgrade mobile sessions carry an empty client_kind, so the minted JWT has no mobile claim"
root_cause: dependency_version_drift
resolution_type: code_fix
severity: critical
tags:
  - better-auth
  - mobile
  - auth
  - self-rp
  - expo
  - version-lockstep
  - account-linking
---

# Better Auth 1.7 on auth broke mobile hosted sign-in four ways

## Symptom

Every sign-in from TestFlight build 1.0.0 (4) rendered the retry card at
once. Production auth's HTTP log showed the request:
`forgewatch/4` → `POST /api/auth/sign-in/oauth2` → **404**. The same card
reproduced in the iPhone 17 Pro Max simulator pointed at production admin
and production auth.

## Root cause

`apps/auth` moved Better Auth 1.6.2 → 1.7.1 on 2026-08-24 (#1978).
`apps/mobile` stayed on 1.6.2. The ticket for that upgrade said "do not
intentionally change Mobile behavior", and no test could see the drift: the
mobile client is mocked at the module boundary, and the server it talks to
lives in another package.

Better Auth 1.7 changed four things the self-RP hosted flow depends on:

1. **The generic-oauth plugin lost its own endpoints.** `/sign-in/oauth2`
   and `/oauth2/callback/:providerId` are gone; providers ride the core
   `/sign-in/social` and `/callback/:id`. `genericOAuthClient` is gone
   from the client package too. A 1.6.2 client POSTs to a route that no
   longer exists → 404 → `result.error` → retry card.
2. **`@better-auth/expo`'s browser proxy refuses same-origin targets.**
   `/expo-authorization-proxy` now throws `Invalid authorizationURL` when
   the authorization URL's origin equals the auth base URL (login-CSRF
   hardening). A self-RP authorize URL IS same-origin. The callback still
   requires the signed `state` cookie that only the proxy plants, so the
   proxy cannot be skipped.
3. **`accountLinking.requireLocalEmailVerified` arrived with a `true`
   default.** No provider account — trusted or not — links to a user whose
   local `emailVerified` is false (`oauth2/link-account.mjs`). This
   platform sends no verification email, so any user without a `jfp`
   account row (every hosted sign-up, every password user's first mobile
   sign-in) ended on `account_not_linked`. Users who had signed in on
   mobile before the upgrade kept working, which hid the break.
4. **The core callback route pattern is `/callback/:id`.** The session
   stamp read `params.providerId`, so post-upgrade mobile sessions had no
   `clientKind`, and the JWT no mobile claim.

A fifth break sat in auth's own route wrapper: `handleSocialSignIn` runs
`callbackURL` through the web-only `/watch` policy, so the mobile
`forgemobile:///` callback was dropped. The old `/sign-in/oauth2` path had
bypassed that handler.

## Fix

Mobile (`apps/mobile`):

- `better-auth` and `@better-auth/expo` → 1.7.1, exact, in lockstep with
  auth. `src/lib/__tests__/betterAuthVersionLockstep.guard.test.js` reads
  both manifests and fails on drift.
- `@better-auth/utils` pinned to `0.4.2` in BOTH manifests, and in the same
  guard. It is `@better-auth/core`'s EXACT peer while `better-call` depends
  on `^0.5.0`; once both apps carried `core`, pnpm's cross-importer peer
  dedupe resolved auth's `oauth-provider`/`prisma-adapter` peers against the
  `0.5.0` walk, split `core` into two lockfile variants, and failed auth's
  typecheck (`GenericEndpointContext` identity mismatch; `auth.api` lost
  every plugin endpoint). A full unfiltered `pnpm install` reproduced it;
  `pnpm dedupe` would also have moved mobile's `expo` graph from
  `@babel/core@7` to `@babel/core@8`. Declaring the peer at each importer
  pins the walk with a lockfile diff confined to Better Auth entries.
- `signIn.social({ provider: "jfp", callbackURL: "/" })` replaces
  `signIn.oauth2`; the generic-oauth client plugin is removed. The provider
  id lives in the leaf `src/lib/authProvider.ts`, because the actions suite
  mocks `authSession` wholesale and a constant there reached the call as
  `undefined` with the suite green.
- `createSecureStorageAdapter` carries the async pair the 1.7 client
  drives every request through.

Auth (`apps/auth`):

- `mobileAwareExpoPlugin` wraps `expo()` and replaces
  `expoAuthorizationProxy` under the same key and path. It admits ONE
  same-origin target: `/oauth2/authorize` for the self-RP client id, read
  from the same expression the provider uses. Every other upstream rule
  stays verbatim.
- `resolveMobileCallbackURL` lets `handleSocialSignIn` pass a
  `forgemobile://` callback through; Better Auth still vets it against
  `trustedOrigins`. The same value feeds `errorCallbackURL` when the web
  policy did not claim the callback, so a provider-side failure returns to
  the app as `forgemobile:///?error=<code>` instead of stranding the sheet
  on `/api/auth/error`. The Expo client reads only the `cookie` param, so
  the app still settles session-less (a quiet cancel); the gain is that the
  sheet closes.
- `accountLinking.requireLocalEmailVerified: false` restores the pre-1.7
  posture. R1 is intact: consumer providers still need a verified provider
  email. Tier-2 review flagged the flip alone as re-opening account
  pre-hijacking (a pre-registered password row with a victim's email
  captures the victim's later Google/Apple sign-in), so
  `refuseUnverifiedConsumerLink` (`account-linking-guard.ts`) runs as
  `databaseHooks.account.create.before`: consumer providers only, `jfp` and
  `credential` pass, a fresh consumer sign-up passes, a link onto an
  unverified existing user throws `CONSUMER_LINK_REQUIRES_VERIFIED_EMAIL`,
  a missing user row fails closed.
- `resolveSessionClientKind` reads `params.id` as well as
  `params.providerId`.

Deploy order: auth first, then the mobile build. The mobile change alone
opens the sheet on the proxy's 400.

## Verification

- Production, before any change: `POST /api/auth/sign-in/oauth2` → 404;
  proxy with a same-origin URL → 400, foreign https → 302.
- Production, after the mobile change: `POST /api/auth/sign-in/social` →
  200 with the `jfp_mobile_production` authorize URL; the simulator sheet
  opened on the proxy's `{"message":"Invalid authorizationURL"}` — exactly
  the auth-side gap.
- Local auth (standalone build behind a discovery proxy) with every auth
  change: the full chain through the simulator's sheet —
  `sign-in/social` 200 → proxy 302 with the signed `state` cookie →
  authorize → hosted login → `/callback/jfp` → `302 forgemobile:///?cookie=…`
  → the app's `get-session`. Session rows for the user existed.
- Local auth, error path (2026-08-29): `sign-in/social` with the
  `forgemobile:///` callback → proxy 302 → `/callback/jfp?state=…&code=bogus`
  → `302 forgemobile:///?error=invalid_code&cookie=…`; the same callback
  after a web-shaped sign-in → `302 /api/auth/error?error=invalid_code`.
- Unit: mobile 2742 tests, auth 550 tests, both typechecks and lints clean;
  `pnpm install --frozen-lockfile` clean with ONE `@better-auth/core`
  variant in the lockfile.

What was NOT verified: the app rendering the signed-in Profile. The
simulator's dev client is unsigned, `securityd` refuses every SecureStore
call with `-34018` ("neither application-identifier nor
keychain-access-groups entitlements"), and this iOS 26 runtime refuses to
launch an ad-hoc-signed app that carries `application-identifier`. That
step needs a signed build. See `todos/025`.

## Prevention

- Bump Better Auth in both apps in one PR; the lockstep guard enforces it,
  `@better-auth/utils` included — re-pin it when core's peer range moves.
- Re-read `@better-auth/expo`'s `src/routes.ts` and
  `better-auth/dist/oauth2/link-account.mjs` on every bump.
- When a security default is switched off for one provider, keep it as a
  hook for the providers it was protecting; a flag flip is global.
- A "do not change X behavior" line in an upgrade ticket is a claim to
  test at X's layer, not a constraint that holds itself. The upgrade PR's
  own test suite could not have seen any of the four breaks.

## Related

- `apps/auth/CLAUDE.md` — "Mobile hosted sign-in — the self-RP flow on
  Better Auth 1.7"
- `apps/mobile/CLAUDE.md` — "Auth + watch progress"
- `docs/solutions/auth/better-auth-authorization-resource-binding-upgrade.md`
  (the upgrade)
- `todos/025-*` (local iOS build toolchain), `todos/026-*` (self-RP
  discovery deadlock at cold start)
