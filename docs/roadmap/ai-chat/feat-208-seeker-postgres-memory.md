---
id: "feat-208"
title: "Postgres-persisted Seeker memory + conversation persistence"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-10"
duration: 5
depends_on:
  - "feat-205"
blocks:
  - "feat-209"
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-07-05 via [PR #1462](https://github.com/JesusFilm/forge/pull/1462) (`feat(ai-chat): postgres-persisted seeker memory + thread ownership (feat-208)`).

**What landed.** The seeker's Memory moved from the deliberately non-persistent
`InMemoryStore` to a `PostgresStore` in a new dedicated `ai_chat` schema (same
DB, separate from the `mastra` schema), shared by design with future ai-chat
agents. Because Mastra 1.36 enforces no thread ownership on the message path
(verified in dist), the ticket grew a server-side ownership + per-resource
ceiling gate in `/forge-seeker` (`thread_forbidden` / `thread_limit`, wired
through the chat proxy to distinct UI notices), server-resolved namespaced
memory resources (`user:<sub>` / `anon:<uuid>` from a rolling 30-day anon
cookie), and a shipped-with-persistence retention position: 30d anon / 180d
signed-in TTL purge (boot + daily, postgres-gated), operator deletion runbook,
and a UI storage disclosure line. `AI_CHAT_MEMORY_BACKEND` (optional) is the
production kill-switch. Full design + verified package-behavior citations:
`docs/plans/2026-07-05-001-feat-seeker-postgres-memory-plan.md`.

**Residual risk / follow-ups.** The thread ceiling bounds cooperative clients
only (the purge is the adversarial storage backstop); `/api/seeker` remains
unauthenticated/un-rate-limited (accepted, restated in `apps/chat/CLAUDE.md`);
TOCTOU + existence-oracle residue accepted (v4 UUID entropy); anon→account
thread migration out of scope. feat-209 preconditions recorded in its ticket.

**Unblocked.** feat-209 (with feat-207 already complete).

## Problem

Seeker memory is in-memory and conversation history is client-side, so both
are lost on restart or refresh. Persist them to Postgres for durable
multi-turn recall and conversation history.

## Entry Points — Read These First

1. `apps/mastra/src/mastra/memory.ts` — the ai-chat section (schema
   `ai_chat`, backend-aware factory, singletons) and the experience-chat
   section it mirrors.
2. `apps/mastra/src/mastra/ai-chat-thread-ownership.ts` — the ownership +
   ceiling gate every ai-chat route must call (Mastra provides none).
3. `apps/mastra/src/mastra/ai-chat-retention.ts` — retention windows + purge.
4. `apps/mastra/src/mastra/agents/seeker-route.ts` — gate wiring
   (`thread_forbidden` / `thread_limit` frames).
5. `apps/chat/src/auth/anon-id.ts` — resource namespacing + rolling anon
   cookie; `apps/chat/src/app/api/seeker/route.ts` — server-resolved
   `resourceId` + Set-Cookie on the SSE response.
6. `docs/plans/2026-07-05-001-feat-seeker-postgres-memory-plan.md` — the full
   plan with verified Mastra-behavior citations.

## Grep These

- `AI_CHAT_SCHEMA_NAME` / `ai_chat` — schema isolation.
- `authorizeAiChatThreadAccess` — the gate + its call sites.
- `resolveAiChatMemoryBackend` / `AI_CHAT_MEMORY_BACKEND` — backend + kill-switch.
- `resolveSeekerResource` / `CHAT_ANON_ID_COOKIE` — resource keying.
- `thread_forbidden|thread_limit` — the wire vocabulary end-to-end.

## What To Build

Shipped — see Resolution and the plan doc.

## Constraints

- Never register future ai-chat agents' threads outside the `ai_chat` schema;
  never rely on `Agent.network()` delegation for shared threads (it
  auto-isolates) — pass `memory: { thread, resource }` explicitly.
- Resources are prefix-checked (`startsWith("user:")`) — never split on `:`.
- The subject (`sub`) is a memory partition key only — never authorization
  (feat-207 R7).
- Retention wording in the chat UI must track the retention constants.

## Verification

- `pnpm --filter @forge/mastra test typecheck lint` +
  `pnpm --filter @forge/chat test typecheck lint`.
- Real-DB smoke (local Postgres): two turns on one `threadId` → new store
  instance → recall; same `threadId` + different resource →
  `thread_forbidden`; `\dt ai_chat.*` shows the memory tables and `mastra`
  gained none; aged thread purged with no orphaned `mastra_messages` rows.
