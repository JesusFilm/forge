---
title: Normalize exact OAuth loopback clients and reject other unauthenticated dynamic registrations
date: 2026-08-25
last_updated: 2026-09-07
category: auth
module: apps/auth
problem_type: integration_issue
component: authentication
symptoms:
  - Codex and Claude dynamic registrations failed when they omitted application_type and used exact HTTP loopback callbacks
  - Better Auth classified the omitted type as web and rejected the local HTTP redirect before authorization could begin
  - The unauthenticated registration adapter could buffer JSON before registration rate limiting applied
  - The first passthrough-by-default adapter forwarded arbitrary unauthenticated web and confidential registrations to the provider
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

# Normalize exact OAuth loopback clients and reject other unauthenticated dynamic registrations

> **Mechanism update (2026-09-07).** The adapter this doc describes inverted
> from passthrough-by-default to reject-by-default in
> [Forge PR #2075](https://github.com/JesusFilm/forge/pull/2075) (commit
> `05852a6c0`). An unauthenticated registration now reaches Better Auth ONLY
> when it matches the native loopback public-client shape; everything else gets
> a 400 from the adapter. An authenticated registration (Bearer header or valid
> session) bypasses the classifier. This doc describes the current mechanism.

## Problem

Forge Auth's OAuth Dynamic Client Registration boundary did not understand the
registration shape used by local MCP clients such as Codex and Claude. The
supported public-client flow requires PKCE and uses a temporary loopback
callback listener, but clients may omit `application_type`. Better Auth treated
the omission as a web application and rejected otherwise valid native-client
callbacks such as `http://127.0.0.1:49173/callback`.

[Forge PR #2021](https://github.com/JesusFilm/forge/pull/2021) (2026-08-25)
added a pre-provider adapter that normalized that one unambiguous shape and
forwarded every other request unchanged. That posture left a gap: the endpoint
is public, and registration creates a durable OAuth client identity. A
passthrough default let any unauthenticated caller register arbitrary web or
confidential metadata, name internal resources, and request non-public scopes,
with only the provider's schema validation in the way.
[Forge PR #2075](https://github.com/JesusFilm/forge/pull/2075) closed the gap:
for unauthenticated callers the adapter is now a fail-closed gate, and only the
loopback native shape passes.

Registration still grants nothing. Forge separately evaluates the user, target
environment, scopes, and approved grants during authorization, exchange, and
refresh (`apps/auth/src/services/changelog-oauth-grant.service.ts:109-183`).
The companion Changelog implementation in
[PR #79](https://github.com/JesusFilm/jfp-changelog/pull/79) separately
validates the resulting bearer token and `changelog:read` capability at `/mcp`.

## Symptoms

- Codex- and Claude-style registrations failed when they omitted
  `application_type` and supplied HTTP loopback callbacks.
- The same HTTP URI is invalid for an ordinary web client but expected for a
  native CLI listening temporarily on a local port.
- A broad workaround risked accepting public HTTP redirects or overriding
  metadata the caller deliberately supplied.
- Reading and rewriting the public registration request introduced a second
  risk: the body needed a byte limit before JSON parsing.
- The first fix's passthrough default left unauthenticated registration policy
  entirely to the provider, on a public endpoint that mints client identities.

A minimal request that must succeed is:

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
  (`apps/auth/src/app/api/auth/[...all]/route.ts:1259-1263`).
- Relaxing HTTPS for all web registrations would fix the symptom at the wrong
  layer and allow insecure public-network callbacks. The accepted exception is
  structural: `http:` plus the exact parsed hostname `localhost`, `127.0.0.1`,
  or `[::1]` (`route.ts:67-82`).
- Accepting a registration when only one of several redirects is loopback would
  permit a public redirect beside the safe local one. Every redirect must pass
  the predicate (`route.ts:162-167`).
- Pre-seeding a shared client would bypass the registration failure, but would
  not prove that Codex and Claude establish independent identities and token
  families. (session history)
- Forwarding non-matching unauthenticated requests unchanged (the PR #2021
  posture) kept the provider as the only validator on a public
  identity-minting endpoint. PR #2075 superseded it: the adapter now rejects
  those requests itself (`route.ts:141-170,187-195`).
- Parsing before enforcing a body limit exposed an unauthenticated endpoint to
  excessive buffering. Matching `application/json` case-sensitively was also
  insufficient because downstream parsing accepts mixed-case media types
  (`route.ts:110-117`; the mixed-case case is pinned at
  `route.test.ts:331-344`).

## Solution

`normalizeLoopbackDcrRequest` (`route.ts:84-185`) runs only for
`POST /oauth2/register` (`route.ts:1259-1263`). It returns either a `Response`
that short-circuits the route, or a rebuilt `Request` that replaces the
original.

1. Bound the body FIRST, for every caller. `readBoundedBody` streams at most
   `MAX_DCR_BODY_BYTES` (64 KiB, `route.ts:47`), counts streamed bytes instead
   of trusting `Content-Length`, and cancels the reader over the cap
   (`route.ts:197-222`). Over-cap returns 413 (`route.ts:87-93`).
2. Rebuild the request without `Content-Length`, so a changed body does not
   retain a stale length (`route.ts:94-101`).
3. Bypass the classifier for an authenticated caller. A `Bearer` Authorization
   header (matched case-insensitively) or a valid session forwards the bounded
   request unchanged; registration policy for those callers stays
   provider-owned (`route.ts:103-108`). A non-Bearer scheme such as `Basic`
   is not a bypass (`route.test.ts:376-396`).
4. Reject unauthenticated requests that are not well-formed JSON objects: a
   non-`application/json` content type (lowercased before the check), malformed
   JSON, and null/primitive/array JSON all return 400 without calling the
   provider (`route.ts:110-127`).
5. Default the omitted fields: `application_type` → `native`,
   `token_endpoint_auth_method` → `none`, `grant_types` →
   `["authorization_code", "refresh_token"]`, `response_types` → `["code"]`
   (`route.ts:130-133`).
6. Accept only the loopback native public-client shape (`route.ts:141-170`):
   effective `native` + `none`; `grant_types` a subset of
   `authorization_code`/`refresh_token` that includes `authorization_code`;
   `response_types` exactly `["code"]`; `require_pkce` absent or `true`;
   `resources`, when present, all inside `publicDcrResources`; every scope
   inside `publicDcrAllowedScopes` (both sets come from the OAuth resource
   catalog, `route.ts:48-55`); and every redirect an exact HTTP loopback.
   Anything else returns `invalidDcrRequest()`: 400,
   `error: "invalid_client_metadata"`, `Cache-Control: no-store`
   (`route.ts:187-195`).
7. Rewrite the accepted body before delegation: stamp
   `application_type: "native"`, `require_pkce: true`,
   `token_endpoint_auth_method: "none"`, and the normalized grant and response
   types, preserving all other fields (`route.ts:172-185`).

Before (unauthenticated, non-matching):

```text
explicit web client, public redirect, or unknown resource
→ adapter returns 400 invalid_client_metadata
→ provider is never called
```

After (unauthenticated, matching):

```text
omitted or native application_type + every callback is exact HTTP loopback
→ adapter stamps native public-client metadata + require_pkce
→ provider performs normal registration validation
```

Authenticated:

```text
Bearer header or valid session
→ adapter forwards the byte-capped request unchanged
→ provider owns registration policy
```

Focused tests pin each edge: implicit web loopback normalization
(`route.test.ts:103`, "normalizes implicit web loopback DCR clients to the
native application type"), the pre-registration reject table for explicit web,
confidential, public, mixed, and empty redirect lists (`route.test.ts:131-177`),
the authenticated bypass (`route.test.ts:179`, "leaves authenticated
registration policy to the provider"), the explicit native acceptance
(`route.test.ts:202`), the `it.each` "rejects $name without invoking the
provider" table — non-JSON body, malformed JSON, disabled PKCE, private-use
redirect, HTTPS loopback redirect, internal resource, unknown resource,
non-public scope — asserting the provider stand-in `authPost` is never invoked
(`route.test.ts:229-303`), full-body IPv4/IPv6 normalization
(`route.test.ts:305-329`), and the 413 cap for anonymous, Bearer, and
session callers alike (`route.test.ts:331-374`).

## Why This Works

A local CLI callback is distinguishable without trusting a client name or user
agent. Parsing the URL and requiring `http:`, no userinfo, no fragment, and one
of three exact loopback hostnames makes the exception structural rather than
substring-based. Requiring every callback to match prevents a safe URI from
laundering a public one (`route.ts:67-82,162-167`). An HTTPS loopback redirect
is rejected on purpose — the classifier admits only `http:`, and the reject
table pins that case (`route.test.ts:256-262`).

Reject-by-default matches the asymmetry of the endpoint. An unauthenticated
caller can only ever need the one shape this platform supports for local MCP
clients, so refusing everything else costs no legitimate flow and removes the
open registration proxy. An authenticated caller has already proven an
identity, so richer registration policy stays where it belongs — with the
provider (`route.ts:103-108`). The adapter is therefore no longer only
compatibility normalization; for anonymous callers it is a fail-closed gate,
and Better Auth remains the final registration authority for everything it
still receives.

`token_endpoint_auth_method: "none"` matches an installed client that cannot
keep a client secret. It still grants nothing. Changelog authorization is
recognized and downscoped separately in the route wrapper, while the grant
service requires an active user, approved environment, approved grants, and
the production activation decision
(`changelog-oauth-grant.service.ts:109-183`).

The byte cap protects the adapter itself and runs before the authentication
check, so no caller — anonymous or not — can make the endpoint buffer more
than 64 KiB. It counts streamed bytes instead of trusting `Content-Length`,
cancels after the ceiling, and parses only the bounded result. Lowercasing the
media type keeps the boundary aligned with HTTP header semantics
(`route.ts:87-117,197-222`).

## Prevention

- Test both sides of every classifier axis: omitted metadata with `localhost`,
  `127.0.0.1`, and `[::1]`; then explicit web/native types, confidential token
  methods, public hosts, mixed lists, empty lists, disabled PKCE, private-use
  and HTTPS-loopback redirects, internal and unknown resources, and non-public
  scopes (`route.test.ts:103-329`).
- On every reject case, assert the provider stand-in is never invoked — a 400
  alone does not prove the request stopped at the adapter
  (`route.test.ts:229-303`).
- Keep the 413-before-auth ordering pinned: the oversized-body tests cover the
  anonymous caller AND the Bearer/session callers (`route.test.ts:331-374`),
  and the Basic-scheme negative pins that only `Bearer` bypasses
  (`route.test.ts:376-396`).
- Widen `publicDcrResources` / `publicDcrAllowedScopes` in the OAuth resource
  catalog (`route.ts:48-55`), never by loosening the adapter's gate.
- Add malformed URLs, loopback-looking subdomains, user-info tricks, and
  alternate IP spellings before expanding the accepted host set.
- Exercise two clean clients end to end: distinct registrations and token
  families, PKCE exchange, refresh/reconnect, a granted MCP read, and denial of
  an ungranted capability. Keep registration, Forge grant enforcement, and
  Changelog resource enforcement as separate assertions. (session history)
- Do not whitelist client names, infer privilege from successful registration,
  or move user grants and MCP authorization into this adapter.

## Related Issues

- [Forge PR #2021](https://github.com/JesusFilm/forge/pull/2021) — original passthrough-by-default adapter
- [Forge PR #2075](https://github.com/JesusFilm/forge/pull/2075) — reject-by-default inversion + authenticated bypass (current mechanism)
- [Changelog issue #71](https://github.com/JesusFilm/jfp-changelog/issues/71) — primary integration contract
- [Verify Local Changelog grants with eligibility, fresh OAuth, and an authorized read](./verify-local-changelog-grants-with-fresh-oauth-token.md) — separate user-grant and post-grant verification workflow
- [Better Auth authorization resource binding upgrade](./better-auth-authorization-resource-binding-upgrade.md) — prerequisite provider safety
- [OAuth-protected MCP tool parity pattern](../architecture-patterns/oauth-protected-mcp-tool-parity-pattern-20260721.md) — downstream resource-server boundary
- [Buffered HTTP response byte-cap guard](../best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md) — related stream-limiting pattern
