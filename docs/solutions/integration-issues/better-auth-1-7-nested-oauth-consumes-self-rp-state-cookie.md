---
title: "Better Auth 1.7: a Google/Okta sign-in inside the mobile self-RP flow consumes the shared state cookie, so /callback/jfp fails state_mismatch"
date: 2026-09-07
category: integration-issues
module: apps/auth, apps/mobile
problem_type: integration_issue
component: auth_client
symptoms:
  - "TestFlight build 1.0.0 (5): sign in with Google or Okta, the hosted page reports success, the sheet closes, and the Profile tab still shows Sign in — also after an app restart"
  - "Production auth deploy log: ERROR [Better Auth]: Failed to parse state [BetterAuthError: State mismatch: State not persisted correctly] { code: 'state_security_mismatch', errorURL: 'forgemobile:///' }"
  - "Production auth HTTP log, one browser: GET /api/auth/callback/google 302 → GET /api/auth/oauth2/authorize 302 → GET /api/auth/callback/jfp 302 → forgewatch/5 GET /api/auth/get-session 200 (empty)"
root_cause: dependency_version_drift
resolution_type: code_fix
severity: critical
tags:
  - better-auth
  - mobile
  - auth
  - self-rp
  - expo
  - oauth-state
  - nested-oauth
  - login-csrf
---

# Better Auth 1.7: a nested provider flow consumes the self-RP state cookie

## Symptom

On TestFlight build 1.0.0 (5), the first build after PR #2176, every sign-in
through Google or Okta looked successful on the hosted page. The browser
sheet closed. The Profile tab still showed **Sign in**, and an app restart
did not change that. The next tap opened the whole login flow again.

The app showed no error. The Expo client reads only the `cookie` query
parameter off the `forgemobile://` callback, so a callback that carries
`?error=` settles as a quiet cancel by design (PR #2176).

## Root cause

Better Auth 1.7 binds every OAuth callback to ONE signed browser cookie,
`better-auth.state` (`better-auth/dist/state.mjs`, `parseGenericState`):

1. `generateGenericState` plants the cookie with the flow's `state` value
   and stores the same value in the `verification` table.
2. `parseGenericState` reads the cookie back on the callback. A missing or
   different value throws `State mismatch: State not persisted correctly`
   (`state_security_mismatch`). The callback then redirects to the flow's
   `errorCallbackURL` with `?error=state_mismatch`.
3. After a successful compare, `parseGenericState` EXPIRES the cookie.

The mobile flow nests two OAuth flows in the same browser sheet:

| Hop | Request                                                              | State cookie after the response          |
| --- | -------------------------------------------------------------------- | ---------------------------------------- |
| 1   | `POST /sign-in/social` (provider `jfp`) from the app                 | none in the browser yet                  |
| 2   | `GET /expo-authorization-proxy` (browser)                            | `S` (planted by the proxy)               |
| 3   | `GET /oauth2/authorize?state=S` → `302 /login`                       | `S`                                      |
| 4   | Hosted page: `POST /sign-in/social` (Google)                         | `S2` — the inner flow OVERWRITES `S`     |
| 5   | `GET /callback/google?state=S2`                                      | expired — the inner callback consumed it |
| 6   | `GET /oauth2/authorize?state=S` → `302 /callback/jfp?code=…&state=S` | none                                     |
| 7   | `GET /callback/jfp?state=S`                                          | no cookie → `state_security_mismatch`    |
| 8   | `302 forgemobile:///?error=state_mismatch`                           | the sheet closes, the app reads a cancel |

Hops 5 to 8 are the exact sequence in the production HTTP log at 02:32:44Z
and 03:00:30Z on 2026-09-07, and the deploy log carries the matching
`Failed to parse state` error with `errorURL: 'forgemobile:///'`.

Better Auth 1.6 had no state-cookie check, so the nested flow worked. The
1.7 verification for PR #2176 used the hosted page's email and password
form, which starts no second OAuth flow, so it could not see this break.
The memory note for that work said it plainly: "Apple/Google inside the
self-RP not exercised."

## Fix

`apps/auth/src/auth/self-rp-state-cookie-plugin.ts` registers one `after`
hook on the oauth-provider endpoints that can hand a browser an
authorization code (`/oauth2/authorize`, `/oauth2/consent`,
`/oauth2/continue`). When the response redirects to THIS server's own
`/callback/jfp` with a `state` value, the hook plants the signed
`better-auth.state` cookie again with that value. It uses the same cookie
factory and the same `maxAge` as `generateGenericState`, so the name,
prefix, and attributes match what `parseGenericState` reads. The plugin is
registered in `config.ts` next to `mobileAwareExpoPlugin`.

The hook reads the redirect from the `location` header. It also reads the
`{ redirect: true, url }` body the provider returns to a `fetch` caller
instead of a 302, so a hosted page that continues the flow with `fetch`
gets the cookie on that response.

### Why this keeps the login-CSRF protection

The 1.7 check exists so that an attacker cannot make a victim's browser
load `/callback/jfp?code=<attacker code>&state=<attacker state>` and sign
the victim into the attacker's account. The re-planted cookie lands only on
the browser that RECEIVED the code redirect from `/oauth2/authorize`. A
victim's browser that is sent straight to the callback URL still has no
cookie for that state and is still refused. The browser proxy already
plants a state cookie for any authorize URL it admits, so this hook adds no
binding weaker than the one the flow already had.

## Verification

- `apps/auth/src/auth/self-rp-state-cookie-plugin.test.ts`: the hook plants
  the cookie for a 302 and for the JSON redirect shape, ignores every other
  target (another provider's callback, a third-party redirect URI, the
  self-RP path on another origin, the login page, the callback path outside
  the base path), and ignores a redirect with no `state`. A second block
  dispatches a redirecting endpoint through Better Auth's own hook runner
  (`dispatchAuthEndpoint`) with the real cookie factory, so the
  `__Secure-better-auth.state` name and the header merge are the vendor's.
- Falsified once: with the matcher neutered, the planting cases go red.
- `config.test.ts` pins the plugin's registration.
- `pnpm --filter @forge/auth test`, `typecheck`, and `lint` are clean.
- NOT verified before merge: a live Google or Okta sign-in on a device. That
  needs the fix deployed to production auth, because the nested provider
  flow needs the real provider credentials and redirect URIs. No new mobile
  build is needed: the fix is server-side only, and build 1.0.0 (5) already
  carries the 1.7.1 client.

## Prevention

- When a flow is a self-RP, the hosted page's PROVIDER buttons run a second
  OAuth flow inside the first. Any verification of the self-RP must exercise
  at least one provider button, not only the password form. The recipe in
  `docs/solutions/auth/self-rp-oauth-discovery-deadlock-standalone-proxy-recipe.md`
  can replay the loss with curl: run hop 2, then plant a different state
  cookie value, then run hops 6 and 7.
- Any Better Auth bump must re-read `better-auth/dist/state.mjs`. A change
  to the cookie name, the `maxAge`, or the compare in `parseGenericState`
  changes what this hook must plant. The dispatch-pipeline test fails on a
  changed cookie prefix but not on a changed cookie NAME, so read the source.
- A quiet cancel hides every server-side callback failure from the user.
  Production auth's deploy log is the first place to look when the sheet
  closes and nothing changes: grep for `Failed to parse state`.

## Related

- `docs/solutions/integration-issues/better-auth-1-7-upgrade-broke-mobile-self-rp-sign-in.md`
  — the five breaks PR #2176 fixed; this is the sixth, found on the first
  device sign-in after that PR shipped.
- `docs/solutions/auth/self-rp-oauth-discovery-deadlock-standalone-proxy-recipe.md`
  — the local replay recipe.
- `apps/auth/CLAUDE.md` — "Mobile hosted sign-in — the self-RP flow on
  Better Auth 1.7".
- `apps/mobile/CLAUDE.md` — "Auth + watch progress".
