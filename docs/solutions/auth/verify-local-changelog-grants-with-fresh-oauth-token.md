---
title: Verify Local Changelog grants with eligibility, fresh OAuth, and an authorized read
date: 2026-08-27
category: auth
module: apps/auth
problem_type: workflow_issue
component: authentication
severity: medium
applies_when:
  - A developer receives insufficient scope from the Local Changelog MCP while it uses hosted Jesus Film Auth
  - The Local Changelog Reader command fails and recipient eligibility must be diagnosed
  - A Local Changelog grant was added after the developer's current OAuth token was issued
  - The local Changelog database is empty but the authorization path still needs an end-to-end smoke test
symptoms:
  - The grant command reports a generic failure for a verified human whose membership is still invited
  - A successful grant is not visible to an MCP client until it completes a fresh OAuth login
  - A successful read returns no entries from an empty local database and can be mistaken for failed access
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - development_workflow
  - database
  - tooling
tags:
  - auth
  - changelog
  - oauth
  - mcp
  - app-grants
  - membership-status
  - token-refresh
  - operator-verification
---

# Verify Local Changelog grants with eligibility, fresh OAuth, and an authorized read

## Context

Forge PR [#2066](https://github.com/JesusFilm/forge/pull/2066) added a supported operator command that grants one existing user `changelog:read` for the canonical Local Changelog environment. During the 2026-08-27 operator smoke, the first attempt correctly failed for a Google-linked user whose email was verified and actor type was human, but whose membership was still `INVITED`. After the user's membership was corrected through a separate one-time operational action, the grant succeeded and a fresh OAuth login could call the local MCP.

That observed smoke returned no entries because local PostgreSQL was empty. It was still a successful authorization result: the MCP tool call completed without an insufficient-scope error.

## Guidance

1. Treat provider linkage, verified identity, and active membership as separate facts. An Auth `Account` links a provider identity to a user, while membership status belongs to the user and defaults to `INVITED` (`apps/auth/prisma/schema.prisma:83-110`, `apps/auth/prisma/schema.prisma:133-153`). A Google account row therefore does not prove that the user is eligible for an application grant.
2. Check eligibility before retrying provisioning. The recipient must be one existing user with a verified email, `HUMAN` actor type, and `ACTIVE` membership. The grant service rejects every other state before writing a grant (`apps/auth/src/services/changelog-local-reader-grant.service.ts:79-111`).
3. Keep membership lifecycle separate from application access. The command writes a Local Application Grant and its audit event; it never activates the user (`apps/auth/src/services/changelog-local-reader-grant.service.ts:140-164`). Resolve an unexpected `INVITED` status through the approved membership process rather than teaching the grant command to widen its own authority.
4. Run the command against the Auth deployment that issues the token. Per the Auth deployment runbook, Local Changelog normally uses hosted Auth, so running against a local Auth database cannot grant access to that default setup (`apps/auth/docs/railway-deployment.md:164-205`).
5. Reconnect or log out and log back in after the grant. Authorization, exchange, and refresh evaluate the applicable approved grants when producing the scope decision (`apps/auth/src/services/changelog-oauth-grant.service.ts:109-183`); an access token issued before the grant does not acquire a new scope by itself.
6. Verify authorization by the MCP outcome, not by the number of Changelog rows. In the 2026-08-27 smoke, `list_entries` completed successfully with an empty entries array because local PostgreSQL contained no entries; the earlier failed authorization had instead produced an insufficient-scope error.

## Why This Matters

Sign-in, provider linkage, global membership, application access, token issuance, and application data are different layers. Collapsing them produces misleading diagnoses such as “the Google account exists, so the grant should work” or “an empty list means authorization failed.”

Keeping the layers separate also preserves the command's safety boundary. The command resolves the fixed Local environment and fixed Reader scope internally, accepts no role or environment argument, and grants nothing broader (`apps/auth/src/services/changelog-local-reader-grant.service.ts:38-77`, `apps/auth/src/scripts/grant-changelog-local-reader.ts:37-73`).

## When to Apply

- A developer receives an insufficient-scope response from `http://localhost:3000/mcp` after signing in successfully.
- `changelog:grant-local-reader` returns its generic failure and the recipient or target Auth environment must be diagnosed.
- A provider account exists but the user's eligibility for first-party application access is unclear.
- The grant command succeeds but the MCP client still presents an old authorization result.
- `list_entries` succeeds but returns no entries from a fresh local database.

Do not use this workflow as permission to activate arbitrary invited users, grant Production or write access, or make direct production-database edits routine.

## Examples

This diagnostic describes a linked identity that is still ineligible:

```json
{
  "emailVerified": true,
  "actorType": "HUMAN",
  "membershipStatus": "INVITED",
  "accounts": [{ "providerId": "google" }]
}
```

After the user is legitimately `ACTIVE`, run the guarded hosted-Auth procedure from `apps/auth/docs/railway-deployment.md`, then reconnect the MCP client so it completes a fresh OAuth flow. For an empty local database, this is a successful verification result:

```json
{ "entries": [] }
```

## Related

- [OAuth loopback dynamic client registration normalization](./oauth-loopback-dynamic-client-registration-normalization.md)
- [Better Auth authorization resource binding upgrade](./better-auth-authorization-resource-binding-upgrade.md)
- [Auth-owned agent login handles for local and preview OAuth](./auth-owned-agent-login-handles-for-local-preview-oauth-20260611.md)
- [OAuth-protected MCP tool parity pattern](../architecture-patterns/oauth-protected-mcp-tool-parity-pattern-20260721.md)
- [Forge PR #2066](https://github.com/JesusFilm/forge/pull/2066)
- [Changelog documentation follow-up #81](https://github.com/JesusFilm/jfp-changelog/issues/81)
