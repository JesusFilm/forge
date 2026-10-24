---
title: "A new Admin MCP scope must reach the stored scope list of every existing dynamic client"
date: 2026-10-07
category: auth
module: apps/auth
problem_type: best_practice
component: authentication
severity: high
applies_when:
  - "A tool in ADMIN_MCP_TOOLS names a scope that existing MCP clients do not hold"
  - "A scope is added to ADMIN_MCP_DEFAULT_SCOPES or to the public DCR allowed scopes"
  - "A scope is removed from the Admin MCP resource"
  - "Better Auth is upgraded and the authorize scope check may have changed"
root_cause: missing_workflow_step
resolution_type: seed_data_update
retire_when: "Better Auth stops refusing requested scopes that are absent from a client's stored scope list, or stops freezing that list at dynamic registration; after an upgrade, read the authorize handler and persistOAuthClientRegistration in the installed @better-auth/oauth-provider dist"
tags:
  [
    better-auth,
    oauth,
    dynamic-client-registration,
    mcp,
    scopes,
    invalid-scope,
    seed,
    deploy-order,
  ]
---

# A new Admin MCP scope must reach the stored scope list of every existing dynamic client

## Context

feat-613 added the scopes `push:campaign:read` and `push:campaign:draft` for seven new `push.*` tools on the JFP Admin MCP. Planning research found that the older rule "Deploy order (scope additions)" in `apps/admin/CLAUDE.md` was not enough. That rule says the exposure is a clean `insufficient_scope` or consent error, and that users sign in again.

Three facts make a new scope a sign-in break for every MCP client that registered earlier:

1. **Admin advertises a new scope as soon as admin deploys.** `scopes_supported` comes from the tool registry (`apps/admin/src/mcp/admin-mcp-metadata.ts:16-19`). A 401 for a request that names no tool, such as the first `initialize` or `tools/list`, carries no `scope` in its challenge (`apps/admin/src/app/mcp/route.ts:209-212`, `:300`, `:304-314`). A client that follows the scope-selection rule of the MCP authorization spec then requests every value in `scopes_supported`. That rule is client behavior, not code in this repo.
2. **Better Auth freezes the scope list of a dynamic client at registration.** The row stores the server's registration scopes at that time (`apps/auth/node_modules/@better-auth/oauth-provider/dist/authorize-Crqw4_bR.mjs:1614-1616` and `:1930`, version 1.7.1; an installed package file, not tracked in git). A later change to `ADMIN_MCP_DEFAULT_SCOPES` does not change rows that exist.
3. **The authorize endpoint refuses the whole request for one unknown scope.** It checks each requested scope against `client.scopes` and redirects with `invalid_scope` (the same file, lines 5506-5512). No token is issued.

The result: an old Claude Code or Codex client cannot sign in at all. Its Experience tools stop too, not only the new tools. Signing in again does not help, because the stored list still lacks the scope. This failure did not reach production, because the seed step below shipped first.

## Guidance

Treat each new MCP scope as a data migration in apps/auth, not only as a registry change.

1. **Add the scope in apps/auth.** Add it to `AUTH_SCOPES` (`apps/auth/src/domain/scopes.ts`) and to `ADMIN_MCP_DEFAULT_SCOPES` (`apps/auth/src/domain/apps.ts`). New registrations then get it.
2. **Add a seed step for existing dynamic clients.** In production, the dashboard start command runs `seed:first-party-apps` before `node server.js` at every boot (`apps/auth/docs/railway-deployment.md:80-83`). The stage start command in `apps/auth/railway.toml` does not run it. Copy the shape of `addPushScopesToExistingDynamicClients` (`apps/auth/src/scripts/seed-first-party-apps.ts:365-402`):
   - Select clients that are not first-party, are enabled, have no secret, and use token authentication `none`.
   - Accept `public` true or null. Better Auth 1.7.1 does not write `public` on a dynamic registration. See [better-auth-authorization-resource-binding-upgrade](./better-auth-authorization-resource-binding-upgrade.md).
   - Select on a scope that only Admin MCP clients hold (`experience:read` here), so other public clients do not get the new scope.
   - Skip a row that already holds every new scope (`NOT hasEvery`), so a later boot reads nothing.
   - Check the shape of each row again in code, and skip a row with an unexpected shape (`missingPushScopes`, `:404-431`). A seed that throws stops the auth boot.
   - Log a count only, never a client id.
   - Add the new scope to `POST_REGISTRATION_SCOPES` (`:37-45`). The older `offline_access` migration uses the other default scopes as markers of a legacy client, and a new scope cannot be such a marker.
3. **Deploy apps/auth first, then apps/admin.** Both apps autodeploy from `main` in parallel, so one pull request cannot set this order. Merge the auth change, read the seed count in the deploy log, and verify. Then merge the admin change that registers the tool.
4. **Verify on dynamic rows only.** Run a read-only count on the production auth database: the eligible dynamic clients, and how many of them hold every new scope. The first-party `jfp_admin_mcp_codex` row is not evidence, because the seed writes its scopes again on every run (`seed-first-party-apps.ts:511-517`).
5. **Remove a scope in the reverse order.** First deploy admin without the tools, so `scopes_supported` stops listing the scope. Then remove the scope in apps/auth. If auth removes it first, admin still advertises it, and auth refuses new registrations and refreshes that carry it.

The operational steps for the push scopes are in `apps/admin/CLAUDE.md` ("Deploy order (push scopes, KTD3)") and in `apps/auth/docs/railway-deployment.md` ("Public MCP client-resource repair").

## Why This Matters

Claude and Codex agents edit Experiences only through this MCP. One missing migration turns a new tool into a full sign-in outage for every client that registered before the deploy. The error comes back at the OAuth redirect, not at the tool call. An operator who reads the older rule expects a scope error on the new tool only, so the real cause is hard to find.

Signing in again is the last step of the rollout, not the fix. It works only after the stored scope list holds the new scope.

## When to Apply

- A tool in `ADMIN_MCP_TOOLS` names a scope that existing clients do not hold.
- A scope is added to `ADMIN_MCP_DEFAULT_SCOPES` or to the public DCR allowed scopes.
- A scope is removed from the Admin MCP resource.
- Better Auth is upgraded. Read the authorize scope check and the registration write again before you rely on this note.

## Examples

The feat-613 production rollout: #2596 (auth) and then #2597 (admin) merged on 2026-10-06, and the checks below ran on 2026-10-07.

- The auth deploy log ended with "58 dynamic clients updated for push campaign scopes."
- A read-only check of the auth database found both push scopes on 58 of 58 eligible dynamic clients. It found no duplicate scope and no change to a client outside the eligible set.
- After the admin deploy, `scopes_supported` listed both push scopes. A Claude Code client signed in, received both push scopes, and created a campaign draft.

A gap that this rollout did not close: the feat-320 scopes `experience:create` and `experience:generate` have no such migration (the comment at `seed-first-party-apps.ts:37-39`). This session did not count the dynamic clients that lack them. A client that registered before feat-320 and still lacks them can fail sign-in for the same reason. Count these rows before the next scope change.

## Related

- [better-auth-authorization-resource-binding-upgrade](./better-auth-authorization-resource-binding-upgrade.md): the `public: null` registration shape and the seed repair of resource links.
- [oauth-loopback-dynamic-client-registration-normalization](./oauth-loopback-dynamic-client-registration-normalization.md): how Claude and Codex dynamic registrations are admitted.
- [oauth-protected-mcp-tool-parity-pattern-20260721](../architecture-patterns/oauth-protected-mcp-tool-parity-pattern-20260721.md): the tool registry that `scopes_supported` comes from.
- Plan: `docs/plans/2026-10-06-1100-feat-push-campaign-mcp-drafts-plan.md` (KTD3).
