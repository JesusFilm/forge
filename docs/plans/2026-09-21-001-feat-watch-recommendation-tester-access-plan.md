---
title: "Private Watch recommendation tester access"
type: feat
status: completed
date: 2026-09-21
ticket: feat-524
---

## Scope

Implement the approved no-UI pilot for Nisal, Vlad, and Tataihono. An operator
issues a private activation link. Opening it establishes a signed HttpOnly
cookie and redirects to Watch. Only the homepage recommendation flag evaluates
this identity. No login, account authorization, content publication, or public
rollout is added.

## Decisions

- Use the installed `jose` HS256 implementation and a separate optional server
  secret (`WATCH_RECOMMENDATION_TESTER_SECRET`, at least 32 characters). Missing
  or invalid configuration disables tester activation and recognition.
- Activation and cookie JWTs use separate audiences, the configured canonical
  origin as issuer, an opaque UUID subject, and the exact homepage flag scope.
- Activation links last 24 hours. Cookie validity ends seven days after the
  activation token's issuance, including repeated activations. Links are
  intentionally reusable during their short lifetime; this is browser rollout
  eligibility, not account authentication or a one-time credential store.
- Put the activation credential in the URL fragment. A standalone, blank HTML
  bridge removes the fragment from history before a bounded same-origin JSON
  POST. It loads no app assets or analytics, uses restrictive CSP/no-referrer,
  and redirects to the fixed `/watch` path on success or failure.
- Store the session token in a host-only, HttpOnly, SameSite=Lax, production-Secure
  cookie scoped to `/watch/api/recommendations`. Do not extend its lifetime on
  reads. Activation tokens cannot be used as cookies and vice versa.
- The shared homepage flag helper first enforces `WATCH_FOR_YOU_ENABLED`, then
  recognizes the tester cookie, then preserves the existing account/anonymous
  path. Tester contexts have kind `watch-recommendation-tester` and UUID key;
  they carry no email, token, account subject, or recommendation profile data.
- LaunchDarkly remains the per-request rollout authority. Target only three
  tester IDs, with unmatched/off variations false. Removing a target revokes
  eligibility; rotating/removing the secret invalidates all issued credentials.

## Work and validation

1. Build the token helper and operator CLI; test algorithm, scope, issuer,
   audience, expiry, bounded lifetime, malformed input, and secrets.
2. Build activation GET/POST handlers using existing bounded request validation;
   test security headers, request rejection, token non-reflection, and cookie flags.
3. Wire the existing shared gate; test real activation-to-availability behavior,
   no account impersonation, disabled LD, and existing anonymous/account behavior.
4. Run local browser smoke and measure anonymous gate overhead, then review,
   document operations, configure the three LD IDs, and prepare a PR. Keep
   production activation pending until the normal deployment and secret are ready.

## Existing patterns

- `apps/web/src/auth/web-session.ts`: existing jose cookie validation style.
- `apps/web/src/lib/recommendation-route-policy.ts`: bounded same-origin JSON.
- `docs/solutions/integration-issues/watch-runtime-feature-flag-static-route-cache.md`:
  preserve private dynamic availability evaluation and static Watch pages.
- `docs/analytics-and-recommendation-policy.md`: preserve analytics and no consent prerequisite.
