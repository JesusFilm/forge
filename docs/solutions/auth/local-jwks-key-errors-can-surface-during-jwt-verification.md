---
title: "Local JWKS key errors can surface during JWT verification"
date: "2026-09-29"
category: auth
module: apps/auth
problem_type: best_practice
component: authentication
severity: medium
applies_when:
  - "A jose local JWK set is built from stored keys and an endpoint distinguishes invalid credentials from unavailable authority"
tags: [auth, oauth, jose, jwks, error-classification, changelog]
---

# Local JWKS key errors can surface during JWT verification

## Context

The Changelog current-permission endpoint returns `401 invalid-credential` for
bad tokens and `503 permission-unavailable` when Auth cannot establish current
permission. Its first implementation caught stored-key parsing, JWT verification,
and an OAuth-client database lookup together, so a storage fault looked like a bad
credential. The route maps unexpected errors to 503
(`apps/auth/src/app/api/changelog/current-permission/route.ts:20-24`).

## Guidance

Keep stored-key parsing and database lookups outside the catch that maps token
verification failures to 401. Moving `createLocalJWKSet` outside that catch is
necessary but insufficient: in the installed `jose` 6.2.9 implementation, the
local set selects and imports a matching key when `jwtVerify` calls its resolver.
Key-data errors can therefore still be thrown _inside_ `jwtVerify`.

At that boundary, propagate `JWKInvalid`, `JWKSInvalid`,
`JWKSMultipleMatchingKeys`, and unexpected non-JOSE errors to the route's 503
handler. Map ordinary JOSE token verification failures to 401. After verification,
reject missing or disabled OAuth clients explicitly with a typed 401 error, while
letting a failed client lookup propagate as 503. The current separation is in
`apps/auth/src/services/changelog-current-permission.service.ts:43-99`.

## Why This Matters

A protected consumer must fail closed on either response, but the distinction
controls whether it treats an issued credential as invalid or retries a temporary
Auth failure. Key-set construction alone does not prove that the stored keys are
usable; the selected key may fail only when verification runs. The general rule
for keeping storage faults outside invalid-token catches is documented in
[`prisma-raw-serialization-retry-and-token-error-boundaries-20260916.md`](../database-issues/prisma-raw-serialization-retry-and-token-error-boundaries-20260916.md).

## When to Apply

- A service verifies JWTs against a `jose` local JWK set loaded from storage.
- Its HTTP contract distinguishes invalid credentials from unavailable
  verification or authorization state.
- A refactor moves key-set construction but leaves a broad catch around
  `jwtVerify`.

## Examples

The route-service regression tests make the boundary observable: rejected OAuth
client lookup, malformed stored JSON, and a simulated `JWKSInvalid` rejection
from `jwtVerify` return 503; an invalid JWT and a disabled client return 401
(`apps/auth/src/app/api/changelog/current-permission/route.service.test.ts:57-103`).
The native OAuth case also verifies an issued token and rejects a modified one
(`apps/auth/src/services/changelog-oauth-grant.integration.test.ts:2216-2297`).

## Related

- [Forge PR #2456](https://github.com/JesusFilm/forge/pull/2456) contains the
  current-permission implementation and regression tests.
- [Changelog issue #152](https://github.com/JesusFilm/jfp-changelog/issues/152)
  requires fresh permission decisions for protected website requests.
