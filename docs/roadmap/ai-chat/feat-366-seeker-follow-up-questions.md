---
id: "feat-366"
title: "Seeker suggested follow-up questions (post-hoc chips)"
owner: "jian wei"
priority: "P1"
status: "in-progress"
start_date: "2026-08-19"
duration: 6
depends_on: []
blocks:
  - "feat-367"
tags:
  - "ai-pipeline"
---

## Resolution (partial — U1 / PR 1 of the arc; feature NOT complete)

**U1 shipped:** 2026-08-20 via PR #TBD-U1 (number filled at ship time). The
`apps/mastra` half of the feature landed behind `SEEKER_FOLLOWUPS_ENABLED`
(default-off, and inert on every path while no chat consumer exists): post-hoc
generation runs after the answer stream on the seeker's own model chain, its
questions ride the terminal `result` frame as the optional `followUps` field,
and they persist into the stored assistant message's
`content.metadata.seekerFollowUps` under a carrier scan bounded on BOTH sides
by the turn's own clock and re-checked client-side for thread and resource
ownership before the write. Replay re-derives them through the shared
projection and puts them on the wire for the thread's last text-bearing
assistant message only; the generator's Langfuse capture was verified live to
join the turn's own trace. Three review rounds are absorbed into the shipped
shape — the emitted-flag disconnect gate, the settle-on-every-branch race fix
in the shared budget helper, and the Cf-category invisible-character rung on
the projection.

**Compound docs (PR 1):**
`docs/solutions/best-practices/settle-caller-promise-on-every-budget-race-helper-exit-path.md`
(new) and
`docs/solutions/best-practices/mastra-model-entry-timeout-retry-and-stream-abort-pattern.md`
(amended — caller-signal scope limit).

**Remaining:** U2 (apps/chat chips UI + the client mirror of the projection,
including the format-char rung and its ZWNJ/ZWJ carve-outs) and U3 (managed-prompt
closing-question softening via the experiments ledger). The full `## Resolution`
replaces this section when the arc's final PR flips status to complete.

## Problem

After a grounded Seeker answer, the conversation stalls: the person composes every next question from scratch. Live-measured prototyping (2026-08-14/16) settled the mechanism — post-hoc generation after the answer stream (20/20 fire rate, ~270 ms median added latency, zero answer damage) beat a mid-turn tool declaration (fired 14/22, corrupted 5/23 answers on the gateway model) and a heuristic (poor questions). The approved implementation-ready plan is `docs/plans/2026-08-18-0406-feat-seeker-follow-up-questions-plan.md` — the authoritative contract for this ticket (4 Key Decisions + 13 KTDs; it survived two six-reviewer doc-review rounds, a public-repo security sweep, and an independent peer review).

## Entry Points — Read These First

1. `docs/plans/2026-08-18-0406-feat-seeker-follow-up-questions-plan.md` — THE contract. Read the Goal Capsule, then the unit being implemented with its cited R/KD/KTD entries. Units land as separate PRs in order U1 (`apps/mastra`) → U2 (`apps/chat`) → U3 (managed prompt, two PRs by process); U1 deploys first (its wire field is inert with no consumer). All work branches from current `main` — the prototypes were never merged.
2. `apps/mastra/src/mastra/agents/seeker-route.ts` — `handleSeekerRouteRequest`: the drain loop, the `closed`/`enqueue` mechanics and `cancel()`, and the terminal `result` frame enqueue. Generation slots between the `toolResults` extraction block and that enqueue.
3. `apps/mastra/src/mastra/agents/seeker-turn-projection.ts` — `resolveTurnAttachments`, the shared projection module the replay path reuses.
4. `apps/mastra/src/mastra/ai-chat-history-route.ts` — the replay adapter precedent (`extractStoredToolChunks`), `AI_CHAT_HISTORY_WORST_CASE_THREAD_BYTES`, and the measured budget test in `ai-chat-history-replay-attachments.test.ts`.
5. `apps/mastra/src/mastra/langfuse-tracing.ts` — `buildSeekerTracingCallOptions`. Its trace metadata already stamps `promptSource` with prompt provenance; the click-source stamp is `sendOrigin` (plan KTD11).
6. `apps/mastra/src/config/env.ts` — flag conventions: `SEEKER_VIDEO_ENABLED` is the shape to copy (`z.string().optional()`, accessor compares `=== "true"`).
7. `apps/chat/src/lib/chat-stub.ts` (the `toVideo`/`toSources` mirror pattern + terminal-frame parse), `apps/chat/src/lib/conversation-session.ts` (`send`, finalize, `mergeReplayMessages`), `apps/chat/src/components/chat/message-list.tsx` (the sibling-block render pattern), `apps/chat/src/app/api/seeker/route.ts` (the body guard the click-source field crosses).
8. `apps/mastra/evals/experiments/README.md` — U3's managed-prompt process (immutable experiment PR, then a separate promotion PR updating `seeker-production-config.ts`).
9. `apps/mastra/CLAUDE.md` ("Seeker agent", "ai-chat history read surface", "Langfuse prompt management") and `apps/chat/CLAUDE.md` ("Mastra Connection", "Server-side conversation history").

## Grep These

- `SEEKER_FOLLOWUPS_ENABLED` — the new flag (nothing matches until U1)
- `seekerFollowUps` — the `content.metadata` storage key; `suggestFollowUps` — the synthetic replay chunk name
- `resolveTurnAttachments`, `extractStoredToolChunks` — the shared projection + replay adapter
- `AI_CHAT_HISTORY_WORST_CASE_THREAD_BYTES` — the measured replay budget this extends
- `promptSource`, `sendOrigin` — the click-source tag and the key-collision rule (plan KTD11)
- `SEEKER_VIDEO_ENABLED`, `toVideo` — the flag/kill-switch and client-mirror precedents
- `__registerMastra` — the span-emission registration the generator needs (plan KTD5/KTD9)

## What To Build

The plan's three units, in order — full detail lives in the plan; do not re-derive it here:

- **U1** (`apps/mastra`, PR 1, deploys first): `SEEKER_FOLLOWUPS_ENABLED` flag; the pure core `seeker-follow-ups.ts` (projection up-to-3 × 120 UTF-16 units, drop-never-repair incl. control-char and lone-surrogate rungs; suppression gate grounded + ≥200 chars; tail-only prompt builder with the question capped to its own tail; parser); the out-of-registry generator on `buildSeekerModelList()` with a one-time Mastra registration (zero-tool/zero-processor, test-pinned); route wiring — generation before the terminal frame under a `min(2.5 s, remaining budget)` deadline + `Promise.race`, persist AFTER the frame gated on the emitted flag, enum outcomes `skipped | persisted | no_carrier | store_failed | timeout | undelivered`, client-side ownership re-check before `Memory.updateMessages`; the replay adapter (last-turn-only wire); the Langfuse ladder (no-spans → sibling → same-trace) with the `userId`-listing assertion as a ship-blocker; token counts + `prompt_source` on the `[seeker-follow-ups]` log line; the measured byte budget; the real-Postgres smoke `src/scripts/followups-pg-smoke.ts`; the opt-in trace smoke with its in-suite egress pin.
- **U2** (`apps/chat`, PR 2): the `FollowUps` chip component (last-turn-only, verbatim send, two-moment focus handoff), the `toFollowUps` mirror + drift test, replay reads, `promptSource: "follow_up"` across all four hops, browser verification (reload loop, on-arrival visibility, mobile wrap) plus page-load performance evidence.
- **U3** (managed prompt, two PRs by process): soften the answer's closing engagement question via the experiments ledger — step 0 first (is the closing question even an instruction in the pinned managed revision, or emergent?); a refused verdict closes the requirement as not-achievable-this-way per the plan's DoD branch.

Wire shape: optional `followUps: string[]` on the terminal `result` frame — omitted, never null. Storage: `content.metadata.seekerFollowUps` via `Memory.updateMessages` — NEVER a synthetic tool-invocation part (falsified live: the gateway 400'd on the replayed fabricated call and broke every later turn in the thread).

## Constraints

- Session-settled in the plan — do not reopen: post-hoc over tool/heuristic; metadata-never-parts; code-owned generator prompt; replay NOT flag-gated (mirrors the PR #1836 ruling; levers are flag off → `SEEKER_ROUTE_ENABLED=false` → thread purge); verbatim send with no composer pre-fill; no user-facing toggle; generation NOT gated on the model configuration; stored caps stay 3 × 120; no adoption-metrics requirement (owner decision).
- Generation and persist can never produce an error frame — local try/catch containment, sync-throw tested; a mid-turn disconnect generates and persists nothing (emitted-flag gate).
- Question text never reaches a log line; never log caught error objects (parse errors embed the reply); counts, enums, timings, and token counts only.
- The no-parts persist regression test and the measured (never computed) byte-budget test are load-bearing and must survive.
- The flag is `.optional()`; default-off deploys have zero new env prerequisites.
- The U1 PR adds the dated feat-339 register entry naming BOTH chip suppression surfaces (generation gate + ungated replay) with the stored-chips lever.

## Verification

Per the plan's Verification Contract: `pnpm --filter @forge/mastra test` + `typecheck`; `pnpm --filter @forge/chat test` + `typecheck`; `DATABASE_URL=postgresql://…/followups_smoke pnpm --filter @forge/mastra smoke:followups-pg` against a throwaway Postgres 16; the opt-in trace smoke (`SEEKER_FOLLOWUPS_TRACE_SMOKE_TEST=1`, local-dev Langfuse pair — span existence and the `userId`-listing assertion must pass); the browser loop under `next build` + `next start` (send → chips → reload → same chips → click → new turn → fresh chips, zero console errors); U3 via `node scripts/check-seeker-experiment-ledger.mjs --base=origin/main --head=HEAD` and the `eval:seeker:experiment:run` / `:verdict` / `:promote` commands.
