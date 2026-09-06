---
id: "feat-450"
title: "Chat conversation rename"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-09-08"
duration: 2
depends_on:
  - "feat-241"
  - "feat-283"
  - "feat-284"
blocks:
  - "feat-247"
tags:
  - "web"
  - "ai-pipeline"
---

## Problem

feat-241 shipped view-and-resume server history. Titles are LLM-generated
(feat-405) and sometimes wrong or awkward, and a signed-in person has no way
to fix them. The original feat-247 stub bundled rename with delete; delete
carries open questions about resurrection windows that rename does not share,
so rename ships alone under this ticket and feat-247 keeps delete.

A rename must not change the thread's `updatedAt`: renaming is not
conversation activity, so it must neither move the row to the top of the rail
(the list route orders `updatedAt DESC`) nor extend the 25-day retention
window (`ai-chat-retention.ts` keys the window on the same column).

## Entry Points — Read These First

1. `docs/plans/2026-09-02-0245-feat-chat-conversation-rename-plan.md` — the
   plan; this ticket defers to it. Two PRs: Mastra route first (U1, U2), chat
   second (U3–U6).
2. `apps/mastra/src/mastra/ai-chat-history-write-route.ts` — the rename
   handler (`POST /forge-ai-chat-history-rename`). Read the module header
   for the three load-bearing arguments: direct SQL over the Memory API
   (KTD3), the `TABLE_SPANS`-only timestamp-trigger dist pin, and the
   same-store-by-construction backend gate (KTD4).
3. `apps/mastra/src/mastra/ai-chat-history-route.ts` — the feat-241 read
   handlers whose ladder, budget, and logging anatomy the write route
   mirrors.
4. `apps/mastra/src/mastra/ai-chat-lane-admission.ts` (feat-283) and
   `ai-chat-thread-ownership.ts` (`resolveOwnedExistingThread`, feat-284) —
   the only modules the write route shares with the read surface.
5. `apps/mastra/src/mastra/workflows/title-repair.ts` — the other direct-SQL
   title writer; the SQL shape, pool discipline, and `updatedAt` omission
   were copied from it.
6. `apps/chat/src/app/api/history/history-proxy.ts` and
   `apps/chat/src/lib/conversation-session.ts` — the read proxies and the
   session engine PR 2 extends (chat proxy `POST /api/history/rename`, the
   pessimistic `renameConversation` action, the stale-page fence, and the
   sidebar inline editor).
7. `docs/handoffs/2026-07-21-mastra-seeker-architecture-review-rulings.md` —
   binds route construction (lane admission, ownership resolver, no
   admission seams at `index.ts` registrations).

## Grep These

- `forge-ai-chat-history-rename` — the route path (registration in
  `apps/mastra/src/mastra/index.ts`, the `laneRoutes` pin in
  `seeker-route-isolation.test.ts`, the chat proxy target in PR 2).
- `handleAiChatHistoryRenameRequest` — the handler and its callers.
- `writes_disabled` — the KTD4 backend-gate refusal.
- `invalid_title` — the clamp-empty refusal (route, proxy, client union).
- `AI_CHAT_RENAME_POOL_OPTIONS` — the pool ceilings pinned below the budget.
- `trigger_set_timestamps` / `setupTimestampTriggers` — the dist pin.
- `renameConversation` / `renamingIds` / `renameHistoryThread` — the chat
  session action, its in-flight slot, and the client fetcher (PR 2).
- `data-escape-owner` — the drawer Escape ownership marker (PR 2, KTD10).

## What To Build

Follow the plan's Implementation Units. In summary:

**PR 1 (Mastra, this ticket in-progress):**

- `POST /forge-ai-chat-history-rename` with body `{ resourceId, threadId,
title }` → `{ ok: true, title }` (the clamped title). Ladder: lane
  admission → body guard (`threadId` ≤200, raw `title` ≤1,024 UTF-16 units)
  → `user:` prefix (403 `resource_forbidden`) → backend gate (503
  `writes_disabled` unless `resolveAiChatMemoryBackend() === "postgres"`,
  before any store/pool construction) → `resolveOwnedExistingThread` over a
  Memory built on `getAiChatStorage()` (403 `thread_forbidden` / 404
  `thread_not_found`) → `clampAiChatTitle` (400 `invalid_title` when the
  clamp returns `""`) → `UPDATE ai_chat.mastra_threads SET title = $1 WHERE
id = $2 AND "resourceId" = $3` over a lazy `max: 2` pool on
  `getMastraDatabaseUrl()` (`rowCount === 0` → 404 `thread_not_found`).
  Catch: 504 `timeout` when the 8s budget aborted, else 500 `store_failed`.
- Registration in `index.ts` passes no admission seams; the path joins
  `laneRoutes` in `seeker-route-isolation.test.ts`.
- Required tests: every U1 scenario in the plan, including the SQL-shape
  invariant (SET has `title = $1` and neither `"updatedAt"` nor
  `"updatedAtZ"`), the `@mastra/pg` timestamp-trigger dist pin, the
  unhandled-rejection pin for the new `settleWithinBudget` caller, and the
  enum-only logging sweep. Opt-in real-Postgres smoke
  (`ai-chat-history-write-route.smoke.test.ts`).

**PR 2 (chat):**

- Proxy `POST /api/history/rename` (`write-proxy.ts` + `rename/route.ts`)
  sharing the read proxies' deny ladder; failure vocabulary
  `invalid_body | invalid_session | gate_denied | thread_forbidden |
thread_not_found | invalid_title | timeout | unavailable`; a reasonless
  404 (the not-yet-deployed route) is `unavailable`.
- Session `renameConversation(id, title)`: pessimistic commit, `renamingIds`
  slot released in a `finally` around the whole fetch, per-id rename fence
  against stale page merges, `deactivate()` rollback.
- Sidebar row restructure: select button + pencil button per `<li>`, inline
  editor (Enter commits, Escape cancels, blur cancels), controls only on
  `grantedShell`, drawer Escape ignores events the editor owns by target.

## Constraints

- No new env vars or flags. `SEEKER_ROUTE_ENABLED=false` darkens rename with
  the lane; `AI_CHAT_MEMORY_BACKEND=memory` refuses rename writes (503).
- Never bump `updatedAt` or `updatedAtZ` on rename — no Memory-API title
  write (`updateThread` / `saveThread` both SET `updatedAt`).
- Never construct a Memory over `getAiChatMemory()` on this path; the
  ownership read and the SQL write must target the same Postgres.
- Refuse 400 `invalid_title` whenever the clamp returns `""`, whatever the
  raw input — never a raw-vs-clamped comparison.
- No title, thread id, or resource id in any log line on any hop.
- No admission seams (`getEnabled` / `getServiceKeys`) at the `index.ts`
  registration; do not add the literal `seekerAgent` to any new comment in
  `index.ts` (the isolation suite pins its exact count).
- No delete (feat-247), no rename for `anon:*` or the dogfood fallback, no
  agent-facing rename tool, no cross-tab sync, no per-user rate limit.

## Verification

- `pnpm --filter @forge/mastra test`, `typecheck`, `lint` green, including
  `seeker-route-isolation.test.ts` with the new `laneRoutes` entry and the
  dist-pin + SQL-shape tests.
- Opt-in real-database round trip: `AI_CHAT_RENAME_SMOKE_TEST=1
DATABASE_URL=<throwaway> pnpm --filter @forge/mastra test --
ai-chat-history-write-route.smoke` — `updatedAt` byte-identical, stored
  title equals the clamp, no user trigger on `mastra_threads`.
- PR 2: `pnpm --filter @forge/chat test`, `typecheck`, `lint` green; browser
  smoke via the minted-cookie recipe under `next build` + `next start`
  (desktop and drawer); page-load evidence per
  `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.
- `npx prettier --check` on every edited markdown file.
