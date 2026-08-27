---
title: Normalize exact OAuth loopback clients before Better Auth dynamic registration
date: 2026-08-25
category: auth
module: apps/auth
problem_type: integration_issue
component: authentication
symptoms:
  - Codex and Claude dynamic registrations failed when they omitted application_type and used exact HTTP loopback callbacks
  - Better Auth classified the omitted type as web and rejected the local HTTP redirect before authorization could begin
  - The unauthenticated registration adapter could buffer JSON before registration rate limiting applied
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - mcp
  - api_layer
  - testing_framework
tags:
  - better-auth
  - oauth
  - dynamic-client-registration
  - loopback-redirect
  - mcp
  - codex
  - claude
  - request-bounds
---

# Normalize exact OAuth loopback clients before Better Auth dynamic registration

## Problem

Forge Auth's OAuth Dynamic Client Registration boundary did not understand the
registration shape used by local MCP clients such as Codex and Claude. The
supported public-client flow requires PKCE and uses a temporary loopback
callback listener, but clients may omit `application_type`. Better Auth treated the omission as a web application
and rejected otherwise valid native-client callbacks such as
`http://127.0.0.1:49173/callback`.

This was a provider-boundary integration issue, not a reason to relax redirect
validation globally. The adapter needed to translate one unambiguous client
shape into metadata the provider already validates, without turning the
unauthenticated registration endpoint into an unbounded JSON-buffering surface.

Registration creates an OAuth client identity; it does not grant Changelog
access. Forge separately evaluates the user, target environment, scopes, and
approved grants during authorization, exchange, and refresh
(`apps/auth/src/services/changelog-oauth-grant.service.ts:109-183`). The
companion Changelog implementation in
[PR #79](https://github.com/JesusFilm/jfp-changelog/pull/79) separately validates
the resulting bearer token and `changelog:read` capability at `/mcp`.

The implementation merged in
[Forge PR #2021](https://github.com/JesusFilm/forge/pull/2021) on 2026-08-25.

## Symptoms

- Codex- and Claude-style registrations failed when they omitted
  `application_type` and supplied HTTP loopback callbacks.
- The same HTTP URI is invalid for an ordinary web client but expected for a
  native CLI listening temporarily on a local port.
- A broad workaround risked accepting public HTTP redirects or overriding
  metadata the caller deliberately supplied.
- Reading and rewriting the public registration request introduced a second
  risk: the body needed a byte limit before JSON parsing.

A minimal failing request was:

```json
{
  "client_name": "Claude Code",
  "redirect_uris": ["http://localhost:3118/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"]
}
```

Treating every omitted type as `native` would be too permissive. Treating this
specific local shape as `web` blocks a valid native flow.

## What Didn't Work

- Relying on the provider default failed because omitted `application_type`
  became `web` before the HTTP callback was evaluated. The compatibility seam
  therefore has to run before the provider handler
  (`apps/auth/src/app/api/auth/[...all]/route.ts:1163-1172`).
- Relaxing HTTPS for all web registrations would fix the symptom at the wrong
  layer and allow insecure public-network callbacks. The accepted exception is
  structural: `http:` plus the exact parsed hostname `localhost`, `127.0.0.1`,
  or `[::1]` (`apps/auth/src/app/api/auth/[...all]/route.ts:55-67`).
- Accepting a registration when only one of several redirects is loopback would
  permit a public redirect beside the safe local one. Every redirect must pass
  the predicate (`apps/auth/src/app/api/auth/[...all]/route.ts:108-120`).
- Pre-seeding a shared client would bypass the registration failure, but would
  not prove that Codex and Claude establish independent identities and token
  families. (session history)
- Overwriting explicit `application_type` or confidential-client metadata would
  change the caller's chosen security model. Those requests stay provider-owned
  (`apps/auth/src/app/api/auth/[...all]/route.ts:109-120`).
- Parsing before enforcing a body limit exposed an unauthenticated endpoint to
  excessive buffering. Matching `application/json` case-sensitively was also
  insufficient because downstream parsing accepts mixed-case media types
  (`apps/auth/src/app/api/auth/[...all]/route.ts:72-87`).

## Solution

Add a pre-provider adapter only for `POST /oauth2/register`:

1. Forward non-JSON requests unchanged.
2. Stream at most 64 KiB before decoding JSON. Cancel the reader and return 413
   after the limit (`apps/auth/src/app/api/auth/[...all]/route.ts:42,81-87,135-160`).
3. Remove `Content-Length` when rebuilding a request so a changed body does not
   retain a stale length (`apps/auth/src/app/api/auth/[...all]/route.ts:88-96`).
4. Forward malformed, primitive, null, or array JSON unchanged so Better Auth
   retains schema-error ownership (`apps/auth/src/app/api/auth/[...all]/route.ts:98-107`).
5. Normalize only when `application_type` is omitted,
   `token_endpoint_auth_method` is omitted or `none`, and every redirect is an
   exact HTTP loopback (`apps/auth/src/app/api/auth/[...all]/route.ts:108-121`).
6. Add `application_type: "native"` and
   `token_endpoint_auth_method: "none"`, preserve all other fields, and delegate
   to Better Auth (`apps/auth/src/app/api/auth/[...all]/route.ts:123-132`).

Before:

```text
omitted application_type + http://127.0.0.1:<port>/callback
→ provider default: web client
→ HTTP callback rejected
```

After:

```text
omitted application_type + every callback is exact HTTP loopback
→ adapter supplies native public-client metadata
→ provider performs normal registration validation
```

Counterexample:

```text
omitted application_type + http://example.com/callback
→ adapter makes no change
→ provider retains authority to reject the insecure callback
```

Focused tests cover `localhost`, IPv4, and IPv6 success cases
(`apps/auth/src/app/api/auth/[...all]/route.test.ts:103-129,186-207`), explicit
and ambiguous pass-through cases (`route.test.ts:131-184`), mixed-case
oversized JSON (`route.test.ts:209-222`), and malformed JSON forwarding without
a stale length header (`route.test.ts:224-242`).

## Why This Works

A local CLI callback is distinguishable without trusting a client name or user
agent. Parsing the URL and requiring both `http:` and one of three exact
loopback hostnames makes the exception structural rather than substring-based.
Requiring every callback to match prevents a safe URI from laundering a public
one (`apps/auth/src/app/api/auth/[...all]/route.ts:55-67,113-118`).

This remains compatibility normalization rather than a second OAuth validator.
Explicit or ambiguous registrations stay untouched, malformed content remains
the provider's concern, and the existing handler is still the final
registration authority (`apps/auth/src/app/api/auth/[...all]/route.ts:98-120,1163-1172`).

`token_endpoint_auth_method: "none"` matches an installed client that cannot
keep a client secret. It still grants nothing. Changelog authorization is
recognized and downscoped separately (`route.ts:658-712`), while the grant
service requires an active user, approved environment, approved grants, and the
production activation decision (`changelog-oauth-grant.service.ts:113-183`).

The byte cap protects the new adapter itself. It counts streamed bytes instead
of trusting `Content-Length`, cancels after the ceiling, and parses only the
bounded result. Lowercasing the media type keeps the boundary aligned with HTTP
header semantics (`route.ts:72-100,135-160`).

## Prevention

- Test both sides of the classifier: omitted metadata with `localhost`,
  `127.0.0.1`, and `[::1]`; then explicit web/native types, confidential token
  methods, public hosts, mixed lists, and empty lists
  (`route.test.ts:103-207`).
- Add malformed URLs, loopback-looking subdomains, user-info tricks, and
  alternate IP spellings before expanding the accepted host set.
- Test the size limit at the boundary and one byte over, including mixed-case
  and parameterized JSON content types. Assert that the provider is not called
  after a 413 (`route.test.ts:209-222`).
- Keep forwarding tests for malformed JSON, request cancellation, and stale
  `Content-Length`; request reconstruction can regress independently of OAuth
  policy (`route.test.ts:224-242`).
- Exercise two clean clients end to end: distinct registrations and token
  families, PKCE exchange, refresh/reconnect, a granted MCP read, and denial of
  an ungranted capability. Keep registration, Forge grant enforcement, and
  Changelog resource enforcement as separate assertions. (session history)
- Do not whitelist client names, infer privilege from successful registration,
  or move user grants and MCP authorization into this adapter.

## Related Issues

- [Forge PR #2021](https://github.com/JesusFilm/forge/pull/2021) — merged implementation
- [Changelog issue #71](https://github.com/JesusFilm/jfp-changelog/issues/71) — primary integration contract
- [Verify Local Changelog grants with eligibility, fresh OAuth, and an authorized read](./verify-local-changelog-grants-with-fresh-oauth-token.md) — separate user-grant and post-grant verification workflow
- [Better Auth authorization resource binding upgrade](./better-auth-authorization-resource-binding-upgrade.md) — prerequisite provider safety
- [OAuth-protected MCP tool parity pattern](../architecture-patterns/oauth-protected-mcp-tool-parity-pattern-20260721.md) — downstream resource-server boundary
- [Buffered HTTP response byte-cap guard](../best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md) — related stream-limiting pattern
