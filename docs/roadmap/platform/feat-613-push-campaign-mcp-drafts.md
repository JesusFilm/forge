---
id: "feat-613"
title: "Agents draft push campaigns through the admin MCP, and a person publishes"
owner: "urim"
priority: "P2"
status: "complete"
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

## Results — 2026-10-07

#2596 shipped the apps/auth scopes and the seed step. #2597 shipped the apps/admin tools, the dashboard changes, and the plugin skill. Both are merged and live in production.

- **Checks** — Admin: 9,121 unit tests and 906 real-Postgres tests pass. Auth: 629 tests pass. Typecheck, lint, and the production build pass for both apps. One local failure, `profiler-source-maps.test.ts`, also fails on code identical to `main`.
- **Acceptance examples** — each of AE1–AE12 has at least one tagged test.
- **Scale** — local Postgres with 1,000,000 registrations, median times: `push.audience.count` 42–59 ms, an MCP update with 40 copy rows 4–9 ms, and a dashboard save of all 300 copy rows about 72 ms.
- **Auth rollout** — the auth seed added the push scopes to 58 dynamic clients. A read-only check of the production auth database found both push scopes on 58 of 58 eligible dynamic clients.
  - The check found no duplicate scope and no change to a client outside the eligible set.
  - The only first-party clients with the push scopes are the 5 Admin MCP clients.
- **Admin rollout** — the deploy applied migration `0138_push_campaign_agent_drafts`. `/api/health` returned 200, and `scopes_supported` lists both push scopes.
- **Live check in production** — Claude Code with the `jfp-admin` plugin 0.2.0 did these steps against `admin.jesusfilm.org`:
  - New campaign: the agent created the DRAFT `cmux7uytt06ltp10s5gu3pr99`. It opens the `jesus` video, goes to Mexico, and has `english` and `spanish-latin-american` copy.
  - Fix one language: the agent changed only the Spanish row. The revision went from 1 to 2, and the English row did not change.
  - Stale save (AE10): the dashboard refused a save from a page loaded at revision 1. The message named the newer change, the typed text stayed in the form, and nothing was saved.
  - "Load the latest version" loaded revision 2.
  - A save with no change showed "Nothing changed, so the campaign keeps its status." The revision stayed 2.
  - Hand edit after an agent write (AE7): a hand save raised the revision to 3, and the AI marker still showed the agent write.
  - Without the plugin (R28, R38): a headless Claude Code run had no plugin, and its write tools were blocked. It found the destination and the language slug, explained the English fallback, and set no language filter.
  - The same run saw the live-check draft in the list and did not read its copy, because the author had not named it.

### Learnings

- `docs/solutions/auth/new-mcp-scope-needs-stored-scope-migration-for-dynamic-clients.md` — a new MCP scope needs a migration of the stored scopes of existing dynamic clients, or their sign-in fails.
- `docs/solutions/architecture-patterns/agent-and-person-share-one-versioned-write-path.md` — the agent and the dashboard write through one versioned path, bound to the version that the write read.

### Carried forward

- **No test send after this change.** The owner tested the send path under feat-524 and closed this item. This work changed that path: a test send now records the content version that it sends.
  - The finish step records TESTED only when that version still matches. Real-Postgres tests cover both parts.
  - The first test send after `PUSH_CAMPAIGNS_ENABLED` is on runs this path in production for the first time.
- **No Codex run.** The owner closed this item. The Codex CLI is not installed on the machine that ran the checks.
- **Without the plugin, the agent chose the Spanish variant itself.** The skill tells the agent to ask. With the write tools blocked, the run cannot show if the agent asks before it creates.
- **One question at a time.** #2601 adds this rule to the skill and sets the plugin to 0.2.1. It waits for the owner's merge.
- **The live-check draft** `cmux7uytt06ltp10s5gu3pr99` stays in production as a DRAFT with the approved copy.
- **Review findings not applied** (from `ce-code-review` run `20261006-184848-9a6dacb2`):
  - P2: a browser form changes a line break in agent copy. An unchanged hand save of that copy then moves TESTED back to DRAFT.
  - A stale-save refusal can name the person who sent a test, not the person who changed the content.
  - The test pin is written before the run starts. If the start fails, the earlier-version notice disappears, and the campaign stays DRAFT.
  - `push.campaign.create` is not idempotent. The skill lists drafts before a retry.
  - If a worker stops, the test-running refusal can name a receipts time that has passed.
  - The known-language predicate and the zod issue mapper each exist twice.
  - No suite renders the campaign editor under `<StrictMode>`.
  - The auth seed reads and then writes a client's scope list with no compare-and-set. Two auth instances that boot together can drop one added scope until the next boot.
