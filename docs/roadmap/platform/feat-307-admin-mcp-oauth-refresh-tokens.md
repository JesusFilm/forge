---
id: "feat-307"
title: "Persist Admin MCP OAuth sessions for Codex"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "oauth"
  - "mcp"
---

## Problem

Codex can authenticate to the production Admin MCP resource, but the access
token expires after roughly one hour and Codex has no refresh token to renew
the session. Better Auth 1.6.2 only issues refresh tokens when the authorized
scope set includes `offline_access`; Auth and the Admin MCP protected-resource
metadata currently omit that scope.

## Entry Points - Read These First

1. `apps/auth/src/auth/config.ts` - Better Auth OAuth provider scope,
   dynamic-registration, and token lifetime configuration.
2. `apps/auth/src/domain/scopes.ts` - Auth-supported scope catalog.
3. `apps/auth/src/domain/apps.ts` - first-party Admin MCP client scope seeds.
4. `apps/auth/src/scripts/seed-first-party-apps.ts` - production seeding and
   existing OAuth client updates.
5. `apps/admin/src/mcp/admin-mcp-metadata.ts` - Admin MCP protected-resource
   metadata advertised to Codex.

## Grep These

- `offline_access`
- `ADMIN_MCP_DEFAULT_SCOPES`
- `clientRegistrationAllowedScopes`
- `grantTypes: ["authorization_code", "refresh_token"]`
- `scopes_supported`

## What To Build

1. Add `offline_access` to the Auth scope catalog so the provider supports and
   advertises it.
2. Add `offline_access` only to Admin MCP OAuth client defaults and protected
   resource metadata.
3. Preserve public PKCE client shape: `authorization_code`, `refresh_token`,
   and `token_endpoint_auth_method: none`.
4. Safely append `offline_access` to existing dynamically registered Codex MCP
   loopback clients whose stored scopes predate this fix.

## Constraints

- Do not widen Admin application, Web, Chat, Manager, or Mastra Studio OAuth
  permissions.
- Do not weaken redirect URI, PKCE, resource audience, or scope validation.
- Do not log or expose tokens, authorization codes, client secrets, or callback
  parameters.
- Do not delete OAuth clients or modify production data outside the normal
  deploy-time seeding path.

## Verification

- Focused Auth/Admin tests prove metadata, seed scopes, dynamic-client
  migration, and public PKCE grant shape.
- Auth/Admin suites, typecheck, lint/format checks, and `git diff --check`
  pass for the touched scope.

## Completion Notes

Implemented 2026-07-24.

Root cause: Better Auth 1.6.2 only mints refresh tokens when the authorized
scope set contains `offline_access`. Auth supported the Admin MCP operational
scopes and one-hour access tokens, but neither Auth metadata nor Admin MCP
protected-resource metadata advertised `offline_access`, so Codex did not ask
for it and received no refresh token.

Fix: Auth now supports and advertises `offline_access`; Admin MCP first-party
clients include it in their default scopes; Admin MCP protected-resource
metadata advertises it so Codex requests it for this resource; and the seeder
appends it to existing dynamically registered Codex loopback Admin MCP clients
that already have the full pre-existing Admin MCP scope set, public PKCE shape,
and `authorization_code` + `refresh_token` grants.

Security notes: non-MCP first-party app defaults remain unchanged. The dynamic
client migration does not touch clients with non-loopback redirects, disabled
PKCE, missing refresh-token grant support, partial Admin MCP scopes, or existing
`offline_access`.

Operational note: after Auth/Admin deploy and seeding, existing full-scope Codex
dynamic clients can be upgraded in place for their next authorization. Any
client with a partial old scope registration or cached authorization lacking
`offline_access` should remove and re-add/reconnect the MCP server once to get
a fresh authorization containing the persistent scope.
