---
id: "feat-405"
title: "Sidebar: untitled threads show a date label until you open them"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-09-01"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
---

## Resolution

**Shipped:** 2026-08-28 via [#NNNN](https://github.com/JesusFilm/forge/pull/NNNN) (`fix(mastra): gateway-first titling and daily title-repair sweep`). <!-- fill the real PR number in the shipping commit -->

**What landed.** Per-turn titling moved off the retired single free-Gemma
`AI_CHAT_TITLE_MODEL` string onto a function-valued default returning the
seeker's gateway-first chain (`buildSeekerModelList()`, read per turn from a
new `seeker-model-list.ts` leaf module) — so `AI_GATEWAY_SEEKER_ENABLED` now
governs titling and answering together, and even flag-off is a two-entry
retrying chain. A new daily `title-repair` workflow (06:00 UTC, default-off
behind `AI_CHAT_TITLE_REPAIR_ENABLED`) heals stranded `user:` threads via the
gateway model only, with guarded direct-SQL writes that preserve `updatedAt`
(no rail reorder, no retention reset). Titles crossing the list wire are
clamped to 120 UTF-16 units via a shared `ai-chat-title-clamp.ts` at
`projectThreadRow`, covering both writers plus the framework's unclamped
`createThread` path. The `""` untitled wire sentinel survives — now
repairable, not permanent.

The sweep's gate matrix (plan KTD4):

| `AI_GATEWAY_SEEKER_ENABLED` | `AI_GATEWAY_CHAT_API_KEY` | `AI_CHAT_TITLE_REPAIR_ENABLED` | Per-turn titling      | Sweep              |
| --------------------------- | ------------------------- | ------------------------------ | --------------------- | ------------------ |
| true                        | set                       | true                           | Gateway-first chain   | Runs on gateway    |
| true                        | set                       | false/unset                    | Gateway-first chain   | Skips (flag)       |
| false                       | set                       | true                           | Two-entry Gemma chain | Runs on gateway    |
| false                       | set                       | false/unset                    | Two-entry Gemma chain | Skips (flag)       |
| any                         | unset                     | any                            | Two-entry Gemma chain | Skips (no gateway) |

(The sweep additionally requires `SEEKER_ROUTE_ENABLED="true"`, a postgres
ai-chat backend, and an explicit `DATABASE_URL`.)

**Residual risk / follow-ups.** Arming the sweep is a recorded operator step
(plan Q2: set `AI_CHAT_TITLE_REPAIR_ENABLED=true` in Railway after deploy).
Old untitled threads keep their date label until the sweep heals them or the
25-day retention window purges them (KD1 — option B deliberately not built;
revisit on audience widening). Erasure-race residual accepted per plan KTD11
(one message pair per thread per day, guarded no-op write).

## Problem

A conversation with a real question in it renders in the rail as
`Conversation — 21 Aug`. Clicking it restores the proper title; refreshing
loses it again. Observed locally and in production (2026-08-21), on the
signed-in gate-granted sidebar.

The date label is not a rendering bug — it is the UNTITLED state
(`sidebar-conversation-list.tsx:68` renders `fallbackTitle(lastActivityAt)`
whenever `title.trim()` is empty). Those threads genuinely have `title: ""`
stored server-side. Three facts compose into the observed loop:

1.  **Titles come from a free-tier model that is failing.** Mastra's
    `generateTitle` is pinned to `AI_CHAT_TITLE_MODEL` =
    `"openrouter/google/gemma-4-26b-a4b-it:free"`
    (`apps/mastra/src/mastra/ai-chat-memory.ts:107`). Captured from a live
    local run, 2026-08-21:

        "statusCode": 429,
        "raw": "google/gemma-4-26b-a4b-it:free is temporarily rate-limited
                upstream. Please retry shortly, or add your own key..."
        "limit_source": "upstream_provider_shared_pool"

    Titling is fire-and-forget after a completed turn, so a 429 costs the turn
    nothing and leaves the stored title `""`.

2.  **The retry hook is "next turn", so single-turn threads never heal.**
    `buildAiChatMemory`'s docstring states it: titling "fires only for threads
    whose stored title is still empty ... so a title-model failure leaves `""`
    and retries on the next turn." A thread is permanently untitled exactly
    when its title call failed AND it never got another turn. That is why only
    SOME production threads show the label while most carry real LLM titles.

3.  **The client's repair is in-memory only.** On replay,
    `conversation-session.ts:640` runs `titleFromFirstUser(...)`, filling a
    blank title from the first user message. It is never written back, so the
    next refresh discards it.

**Why it always looks like the OTHER conversation.** The thread in the URL is
replayed automatically on load and therefore backfilled; every other row is
lazy and stays unlabelled. Both rows are equally untitled — the open one is
just masked. Two rows in the same rail can appear to swap states on refresh
with nothing else having changed.

Separately benign, do not treat as this bug: a refresh within seconds of a
first turn can legitimately show the label before the fire-and-forget title
lands. That self-heals; this ticket is about the threads that never do.

**Not caused by feat-401.** That change alters which rows render, never their
titles; its only `title`-touching lines are in test files. Confirmed present
in production, which does not carry that branch.

## What To Build

Two parts, both in `apps/mastra` only. The detailed authority is the plan:
`docs/plans/2026-08-27-2221-feat-ai-chat-title-reliability-plan.md` — its
Key Technical Decisions, gates, budgets, and per-unit test scenarios bind;
this ticket does not restate them.

1. **Reliable per-turn titling.** Thread the seeker's gateway-first model
   fallback chain into `buildAiChatMemory`'s `titleModel` seam as a
   function-valued default (extracting the model list into a leaf module
   first to avoid an ESM cycle). Gateway-first when `AI_GATEWAY_SEEKER_ENABLED`
   is on (confirmed set in production, 2026-08-27); the free Gemma chain stays
   as failover — even flag-off is an upgrade over today's single un-retried
   model.
2. **Daily title-repair sweep.** A new Mastra workflow on a declarative
   `0 6 * * *` UTC schedule that finds `user:` threads stored with `title = ''`
   and titles them via the gateway model only — bounded per run, default-off
   behind `AI_CHAT_TITLE_REPAIR_ENABLED`, counts-only logging, `updatedAt`
   preserved so repairs never reorder the rail or reset retention.

Plus a title clamp at the list projection (bounds both writers) and the docs
updates the plan's U5 enumerates.

## Considered and rejected

- **Option B — deriving a fallback label from the first user message at list
  time** (this ticket's original alternative): rejected as KD1 in the plan.
  Dogfood audience; old untitled threads may keep the date label until healed
  by the sweep or purged by the 25-day retention window. The `""` untitled
  wire sentinel therefore SURVIVES — it is now repairable, not permanent.
- **Persisting the client's backfill** (a browser write path for something the
  server can do alone) and **retrying titling at list or replay time** (model
  calls on read paths): rejected — see the plan's Key Decisions and the
  feat-405 planning discussion.

## Entry Points — Read These First

1. `docs/plans/2026-08-27-2221-feat-ai-chat-title-reliability-plan.md` — the
   implementation authority. Read Goal Capsule, then work units in dependency
   order.
2. `apps/mastra/src/mastra/ai-chat-memory.ts` — the `titleModel` seam, the
   `""` sentinel docstring, and `aiChatMemoryConfigFor`'s
   `generateTitle: false` override for non-`user:` resources.
3. `apps/mastra/src/mastra/agents/seeker-agent.ts` — `buildSeekerModelList`
   and the gateway-entry construction the leaf module extracts.
4. `apps/mastra/src/mastra/ai-chat-retention.ts` and
   `workflows/datadog-mobile-triage.ts` — the bounded-sweep and
   scheduled-workflow patterns the sweep copies.

## Constraints

- Do NOT fix this at the render layer by hiding the date label — it is the
  honest display of an empty title, and a genuinely empty thread (no user
  turn) still renders it.
- Do NOT make listing or replay a model-calling path. The sweep is the only
  read-side titler, and it runs on a schedule, not on requests.
- Titling must stay fire-and-forget: it never delays or fails the turn it
  rides on.
- Preserve `aiChatMemoryConfigFor`'s `generateTitle: false` for non-`user:`
  resources, and keep `generateTitle` on the TOP-LEVEL options key (the
  deprecated `threads.generateTitle` nesting throws mid-turn).
- The full constraint set (sweep gates, budgets, privacy posture, logging)
  lives in the plan's KTDs — do not re-derive it from this ticket.

## Verification

- Signed in, gate-granted: send ONE message into a new conversation, wait for
  the reply, refresh. The rail row shows a real title. The masking check:
  open conversation A, refresh, and read conversation B's label WITHOUT
  clicking it — B must be titled.
- One sweep run against a store seeded with stranded threads reports
  `titled=N remaining=0`; a second run reports `scanned=0`.
- `pnpm --filter @forge/mastra test && pnpm --filter @forge/mastra typecheck
&& pnpm --filter @forge/mastra build` — `build` is the only gate that
  catches the `@ai-sdk/*` bundler trap.
- Full verification contract: the plan's Verification Contract table.
