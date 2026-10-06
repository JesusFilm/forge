---
id: "feat-613"
title: "Agents draft push campaigns through the admin MCP, and a person publishes"
owner: "urim"
priority: "P2"
status: "in-progress"
start_date: "2026-10-06"
duration: 7
depends_on:
  - "feat-524"
blocks: []
tags:
  - "cms"
  - "i18n"
  - "platform"
---

## Problem

Announcement Campaigns (feat-524) are written by hand in the admin dashboard. The slowest step is the copy: each language needs its own title of at most 50 characters and its own body of at most 120 characters. A new author must also learn the campaign form before the first send.

Editors already use Claude and Codex through the JFP Admin MCP for Experiences, but the MCP has no campaign tools. This ticket adds tools that let an agent write a campaign draft. A person still reviews, tests, and publishes the campaign in the dashboard.

## Entry Points — Read These First

1. `docs/plans/2026-10-06-1100-feat-push-campaign-mcp-drafts-plan.md` — the requirements-only plan. It holds R1-R40, AE1-AE12, the key decisions, and the questions deferred to planning. It is the authority for every decision below.
2. `apps/admin/CLAUDE.md`, section "Admin MCP (JFP Admin MCP — feat-276 + feat-320 + feat-405)" — the three-edit tool registration, the scope check, and the deploy order for a new scope.
3. `apps/admin/src/mcp/admin-mcp-tools.ts` — `ADMIN_MCP_TOOLS`, the tool registry.
4. `apps/admin/src/app/mcp/route.ts` — `callAdminMcpTool`, the dispatch branch for each tool, and the JSON-only `initialize` answer.
5. `apps/admin/src/auth/admin-mcp-oauth.ts` — `resolveAdminMcpPrincipal` and `isAdminMcpRole` (EDITOR or ADMIN only).
6. `apps/admin/src/services/experience-mcp.service.ts` — the pattern for an MCP service: permission check inside the service, `toolFailure` envelopes, and the `draftAttribution` AI marker.
7. `apps/admin/src/services/push/campaign.service.ts` — `createPushCampaignDraft`, `updatePushCampaign` (an edit moves TESTED back to DRAFT and replaces all copy rows), and `EDITABLE_STATUSES`.
8. `apps/admin/src/services/push/contracts.ts` — the copy, audience, and destination limits. Language slugs are checked for format only.
9. `apps/admin/src/services/push/dashboard.service.ts` — `listPushLanguageOptions` and `searchPushDestinations`.
10. `apps/admin/src/services/push/destinations.ts` — the published check that schedule and send now use.
11. `apps/auth/src/domain/scopes.ts` (`AUTH_SCOPES`) and `apps/auth/src/domain/apps.ts` (`ADMIN_MCP_DEFAULT_SCOPES`).
12. `plugins/jfp-admin/skills/forge-bulk-locale-factory/SKILL.md` and `apps/admin/src/app/dashboard/mcp/page.tsx` — the plugin skill pattern and the starter prompts.

## Grep These

- `ADMIN_MCP_TOOLS` — every MCP tool and its `requiredScopes`
- `callAdminMcpTool` — the dispatch branches; the route test fails when a tool has no branch
- `isAdminMcpRole` — the MCP role rule, which must not change
- `write:push-campaigns` — the dashboard permission that the tools must also check
- `EDITABLE_STATUSES` — the campaign statuses that an edit accepts
- `PushCampaignUpdateInputSchema` — the fields a campaign edit carries
- `PUSH_ENGLISH_LANGUAGE_SLUG` — the copy that every campaign must carry
- `refuseUnpublishedDestination` — the published check, which runs at schedule and send now only
- `draftAttribution` — how MCP-made Experience drafts carry the AI marker
- `ADMIN_MCP_DEFAULT_SCOPES` — the scopes an MCP client can get

## What To Build

Build R1-R40 of the plan:

- New push campaign scopes in apps/auth (R4).
- Read tools: languages (R5), destination search that includes unpublished destinations and shows the published state (R6), active Push Registration counts per app language for an audience (R7), and campaign list and read (R8).
- Write tools: create a DRAFT (R9) and edit a DRAFT or TESTED campaign by language row (R10, R11). Admin refuses an unknown language (R12) and warns about an unpublished destination (R13).
- A result on each write with the dashboard link, the remaining steps, and the changed languages (R19, R20).
- A campaign-level AI marker that the campaign page shows (R21, R22).
- Starter prompts on `/dashboard/mcp` (R23), a campaign skill in the `jfp-admin` plugin (R24-R27), tool descriptions that work without the plugin (R28), the English-fallback and language-filter rules (R29, R30), the extra refusals and the audience patch (R31-R33), the dashboard version checks (R34-R37), and the cross-use guards with tool annotations (R38-R40).

## Constraints

- No MCP tool sends a test, schedules, sends now, or cancels a campaign (R16).
- No MCP tool changes a campaign whose status is not DRAFT or TESTED (R17).
- The MCP role rule stays EDITOR or ADMIN (R2). Do not open the MCP to VIEWER users.
- The tools act as the signed-in person and check `write:push-campaigns` inside the service (R3).
- An edit must not delete a language row that the call does not name (R11).
- The language counts hold totals only, with no data about any one device (R7).
- apps/auth deploys the new scope before apps/admin deploys the tools. Every MCP user signs in again to get the scope.

## Verification

```bash
pnpm --filter @forge/auth test
pnpm --filter @forge/auth typecheck
pnpm --filter @forge/admin exec vitest run src/app/mcp src/mcp src/services/push src/app/dashboard/mcp src/app/dashboard/push-campaigns
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin lint
```

- The route test's registry-dispatch parity loop passes with the new tools.
- Each acceptance example AE1-AE12 in the plan has a test.
- A local smoke from Claude or Codex creates a draft in two languages, then edits one language. The dashboard shows the AI marker, and the other language row does not change.
