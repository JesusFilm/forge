---
id: "feat-250"
title: "Migrate /forge-seeker onto the dedicated ai-chat lane service key"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-08-03"
duration: 1
depends_on:
  - "feat-241"
blocks: []
tags:
  - "web"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-07-14 via [PR #1554](https://github.com/JesusFilm/forge/pull/1554) (`feat(chat,mastra): migrate /forge-seeker onto the dedicated ai-chat lane service key (feat-250)`).

**What landed.** A hard cutover rather than the stub's dual-accept rotation (owner decision, recorded under Decision context): `/forge-seeker` validates only the `AI_CHAT_SERVICE_API_KEYS` lane CSV, chat presents `AI_CHAT_MASTRA_API_KEY` as its single Mastra bearer, and `SEEKER_MASTRA_API_KEY` was removed from chat's env schema entirely — no rotation flag or fallback shipped, so no removal ticket is owed. `seeker-route-isolation.test.ts` pins the registration wiring (lane binding present, pool binding banned) because the handler tests inject key lists and would not catch a revert. The minutes-long deploy-skew 401 window (`auth_failed`) is accepted; rollback and disjointness-trap notes live in Operator follow-through below.

**Residual risk / follow-ups.** Operator follow-through steps below remain (post-deploy verification, deleting the now-unread `SEEKER_MASTRA_API_KEY` from chat's Railway env, lane-key handoff to any out-of-repo `/forge-seeker` caller — none found in-repo).

**Unblocked.** None (`blocks: []`).

## Problem

feat-241 minted a dedicated lane bearer for the ai-chat read surface: the two
history routes validate only against `AI_CHAT_SERVICE_API_KEYS`, so the shared
`MASTRA_SERVICE_API_KEYS` pool (whose other holders — admin, manager — run
unrelated embedding/eval pipelines) never gains bulk conversation-read access.
The send path, `POST /forge-seeker`, still validates against the shared pool,
so a leaked pool key can still send turns into (and read streamed replies
from) arbitrary resources. Finish the carve-out: move `/forge-seeker` onto the
same lane key so ONE narrow credential covers the whole ai-chat lane and the
pool's blast radius no longer touches conversation data at all.

## Entry Points — Read These First

1. `apps/mastra/src/mastra/index.ts` — `seekerServiceKeys`
   (`parseServiceApiKeys(env.AI_CHAT_SERVICE_API_KEYS)`) threaded into the
   `/forge-seeker` registration; every other `/forge-*` route stays on the
   pool-only `serviceKeys`.
2. `apps/mastra/src/mastra/agents/seeker-route.ts` — the handler is unchanged
   in shape (`serviceKeys` is injected); only the wired allowlist moved.
3. `apps/mastra/src/config/env.ts` — `assertAiChatServiceKeysDisjoint`
   (feat-241) stays the boot invariant across both CSVs.
4. `apps/chat/src/config/env.ts` + `apps/chat/src/app/api/seeker/route.ts` —
   `AI_CHAT_MASTRA_API_KEY` is the single Mastra bearer chat presents (sends
   AND history); `SEEKER_MASTRA_API_KEY` was removed from the schema.

## Grep These

```
AI_CHAT_SERVICE_API_KEYS
AI_CHAT_MASTRA_API_KEY
seekerServiceKeys
isValidServiceBearer
```

## What To Build

A hard cutover — no dual-accept window, no rotation flag (a considered
simplification of the original dual-accept stub; decision recorded below):

1. **Mastra:** `/forge-seeker` validates only the dedicated
   `AI_CHAT_SERVICE_API_KEYS` lane CSV (the same list the feat-241 history
   routes use). Fail closed: an unprovisioned lane CSV = empty allowlist =
   every send 401s.
2. **Chat:** the seeker proxy presents `env.AI_CHAT_MASTRA_API_KEY` — the same
   lane bearer the history proxies already use. `SEEKER_MASTRA_API_KEY` is
   removed from chat's env schema entirely; chat holds no pool key.

**Deploy-skew consequence (accepted).** Both lane vars are already provisioned
in production (feat-241), but the two services redeploy independently off the
same merge, so there is a short window where one side is old: old chat → new
Mastra presents the pool key (401), or new chat → old Mastra presents the lane
key (401). Sends fail with the existing `auth_failed` UX (chat's proxy maps
an upstream 401/403 to that reason —
`apps/chat/src/app/api/seeker/route.ts`) for at most the deploy skew
(minutes) and self-heal once both are live. The
dogfood audience made this acceptable versus carrying dual-accept scaffolding
and its removal ticket.

**Operator follow-through (after merge deploys):**

1. Confirm a chat send streams (proves the lane key is accepted end-to-end).
2. Probe `/forge-seeker` with a pool key — expect 401 (the security goal).
3. After a short soak, remove the now-unread `SEEKER_MASTRA_API_KEY` var from
   the chat Railway service; hand the lane key to any other internal
   `/forge-seeker` caller (the `SEEKER_DEFAULT_RESOURCE_ID` audience), if any
   exist.

Rollback + incident notes: rolling back either service ALONE re-opens the 401
window indefinitely — roll back both together or roll forward; after step 3 a
chat rollback additionally requires re-adding `SEEKER_MASTRA_API_KEY` first.
Never "fix" skew-window 401s by copying a key value across the two CSVs —
`assertAiChatServiceKeysDisjoint` then throws at boot and takes down every
`/forge-*` route.

## Constraints

- Do NOT touch the bearer validation of any other `/forge-*` route — the
  shared pool remains their allowlist.
- Do NOT weaken `assertAiChatServiceKeysDisjoint`.
- Chat must keep booting clean with zero env vars set (all `.optional()`).
- No new required-at-boot env vars on either service.
- The history proxies' lane-bearer usage (feat-241) is untouched.

## Verification

```bash
pnpm --filter @forge/mastra test -- src/mastra/agents/seeker-route.test.ts src/config/env.test.ts
pnpm --filter @forge/chat test -- src/config/env.test.ts src/app/api/seeker
pnpm --filter @forge/mastra typecheck && pnpm --filter @forge/chat typecheck
```

- Handler tests pin lane-key 200 / pool-style-key 401 against a lane-shaped
  allowlist.
- Deployed end-state: a pool-key `curl` to `/forge-seeker` 401s while chat
  sends and `/forge-ai-chat-history-*` stay green.

## Decision context

Original stub proposed a zero-downtime dual-accept rotation
(`SEEKER_LANE_KEY_REQUIRED` flag + chat legacy-wins fallback). Implemented,
reviewed, then deliberately simplified to the hard cutover above (2026-07-14,
owner decision): the dual-accept machinery bought only a minutes-long deploy
window on a dogfood-only surface at the cost of a flag, a fallback, and a
dedicated removal ticket. feat-241's plan
(`docs/plans/2026-07-13-001-feat-chat-server-history-sidebar-plan.md`, KTD2)
and
`docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md`.
