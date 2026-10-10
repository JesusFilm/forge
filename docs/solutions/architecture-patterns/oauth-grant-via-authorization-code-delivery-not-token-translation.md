---
title: "Add an OAuth grant by delivering an authorization code, not by translating tokens"
date: 2026-08-06
last_updated: 2026-08-24
category: architecture-patterns
tags:
  - auth
  - oauth
  - better-auth
  - rfc8628
  - device-grant
related:
  - docs/solutions/auth/auth-owned-agent-login-handles-for-local-preview-oauth-20260611.md
  - docs/solutions/auth/better-auth-authorization-resource-binding-upgrade.md
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
origin: "feat-322 · PR #1865 · docs/plans/2026-08-05-001-feat-tv-device-grant-sign-in-plan.md"
---

# Add an OAuth grant by delivering an authorization code, not by translating tokens

## The situation

You need a grant type your OAuth provider library does not implement — here
RFC 8628 device authorization, so a TV with no browser can sign in. The tokens
it produces must be indistinguishable from every other client's: same prefixes,
same custom claims, same audience binding, introspectable by the same relying
apps.

The obvious two options are both traps.

**Use the library's own plugin for that grant.** `better-auth@1.6.2` ships
`deviceAuthorization()`, and it does not compose with
`@better-auth/oauth-provider`. It stores device and user codes in plaintext,
redeems with a non-atomic `findOne → branch → delete`, and returns a _session_
token — no `jfp_at_` prefix, no refresh token, no audience, no custom claims,
not introspectable. It enforces no scope and has no rate limiting. You would
override every one of its behaviours, and registering it anyway leaves five
weaker endpoints live beside yours.

**Mint tokens yourself and translate.** The provider exports no token-minting
function — `createUserTokens` and friends are module-private and unreachable
through the package's `exports` map. Translating means re-implementing issuance,
which puts `client_id` and `scope` in a second place where they can disagree
with what was bound at authorization. That divergence is the shape behind a real
IdP account-takeover, and mitigating it means a test you have to remember to
keep.

## The pattern

**Deliver an authorization code; let the provider issue.**

Authorization codes in this library are ordinary `verification` rows. So the new
grant's job is not to mint tokens — it is to reach the point where it can
legitimately write one of those rows, and then hand off:

1. The device requests a code and supplies a PKCE `code_challenge`.
2. A human approves it in an authenticated browser session.
3. The device polls. On the poll that claims the approval, write a
   `verification` row in the provider's own authorization-code shape —
   `identifier = base64url_unpadded(sha256(code))`, value
   `{type, query: {client_id, redirect_uri, scope, code_challenge,
code_challenge_method}, userId, sessionId, authTime}`.
4. Call the provider's existing `/oauth2/token` with
   `grant_type=authorization_code` and the device's `code_verifier`.

Everything downstream is the library's already-hardened path. `client_id`,
`scope`, `redirect_uri` and PKCE are **bound into the code row and re-validated
by the library's own `checkVerificationValue`** — the drift hazard is absent by
construction rather than mitigated by a test you might delete.

Two consequences worth planning for:

- **A device client needs a redirect URI even though it never redirects.** The
  authorization-code grant requires one and compares it against the code row.
  Register one sentinel URI per environment and comment it as a binding value,
  never a navigable URL. It also means you do _not_ need a policy exemption for
  empty `redirectUris` — only for `allowedOrigins`.
- **PKCE becomes available to a grant that does not specify it.** RFC 8628 has
  no PKCE, so a stolen device code alone is enough there. Because the exchange
  demands a verifier, adding one binds redemption to the device that requested
  the code. Take it — it is free.

## What this costs, stated honestly

You are depending on two internal conventions of a pinned dependency: the
identifier hashing and the stored JSON shape. Contain that in **one module** so
the coupling has a single home, and guard it at two layers:

- a unit test pinning the hash algorithm from first principles, and
- **a real-database integration test that performs the whole exchange** — the
  only thing that can prove the provider actually accepts what you wrote.

Both are needed, and neither substitutes for the other. The integration test may
remain opt-in locally only when CI supplies a database URL and runs it against a
real migrated and seeded database. Forge now does this in the affected-Auth
`auth-postgres-integration` job, although fail-closed merge enforcement remains
a follow-up. Without a CI path that both runs and blocks merging on failure,
**green CI proves nothing about the coupling** — say so out loud, and consider
pinning the dependency exactly and excluding it from automated upgrade PRs.

### The unit trap this shape hides

The stored JSON's _shape_ is discoverable by reading; its _units_ are not. Here
`authTime` is milliseconds, because the library's producer writes
`new Date(...).getTime()` and its consumer parses a number through `new Date()`.
Writing seconds is well-typed, passes every mocked test, and puts `auth_time` in
January 1970 — where it is then copied onto the refresh token and re-emitted for
the life of the session. **When you reproduce a shape from a dependency's
internals, state the unit of every numeric field at the field.**

## When NOT to use this

If the library exports a token-issuance function, call it. This pattern exists
only because that door was closed. And if the grant you are adding has its own
correct implementation that composes with your provider, use it — the point is
not to hand-roll, it is to avoid a second issuance path.

## Discovered alongside: introspection may be caller-scoped

Verify before you promise a relying app can authorize the new client's tokens.
In `@better-auth/oauth-provider` 1.6.2, both `validateJwtAccessToken` and
`validateOpaqueAccessToken` end with

```js
if (clientId && <token>.clientId !== clientId) return { active: false }
```

where `clientId` is the _calling_ client. A client can only introspect its own
tokens, and only with a client secret. Access tokens are opaque, so local JWKS
verification is not an alternative. A relying app holding a single introspection
credential therefore cannot authorize two different clients' tokens.

None of this was visible in the repo's tests, because every relying-app test
mocks `fetch` and asserts on a fabricated introspection response. That is the
mocked-shape-vs-real-contract trap exactly: those tests prove the app's own
branching and say nothing about what the identity provider actually returns.
**A real-database probe answered it in minutes.** Pin the answer as a test so a
future upgrade that relaxes the scoping is noticed.
