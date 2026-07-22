---
id: "feat-285"
title: "Extract the Mastra ai-chat memory module + keying policy (ride-along)"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-08-17"
duration: 1
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

`apps/mastra/src/mastra/memory.ts` hosts two domains that — per its own
header — "share nothing but this module and the connection string": the
ai-chat lane half (8 exports: schema name, store + Memory factories and
singletons, `AI_CHAT_TITLE_MODEL`, reset hooks) and the experience-chat half
(10 exports serving out-of-scope agents). The lane's one real memory
_policy_ — signed-in-only titling (feat-241 KTD12) — lives as a ternary in
`agents/seeker-route.ts` (`options: { generateTitle: false }` for non-`user:`
resources), away from the title model and `""`-sentinel semantics it belongs
beside. A future lane route that forgets the override would title junk
threads on a third-party model.

This ticket is **Ruling 3** of the adjudicated Mastra/Seeker architecture
review. The authoritative spec is
`docs/handoffs/2026-07-21-mastra-seeker-architecture-review-rulings.md` —
read it first in full. Do NOT run `ce-plan`.

## Ride-along trigger — do not schedule standalone

Calibrated by the review: only one route builds a per-call memory config
today (feat-247's delete/rename run no agent turn; feat-209 adds no Mastra
surface; feat-248 may never happen), so the forgotten-override bug class
materializes only when a **second agent-turn route** exists. Execute this
ticket as a ride-along with the next PR that materially touches
`memory.ts`'s ai-chat half or adds a second agent-turn route. Until that
trigger fires, this ticket exists so the design isn't lost.

## Entry Points — Read These First

1. `docs/handoffs/2026-07-21-mastra-seeker-architecture-review-rulings.md` —
   Ruling 3 (5 numbered requirements; the trigger calibration), Correction 1
   (the real export counts), and the Standing decisions.
2. `apps/mastra/src/mastra/memory.ts` — the ai-chat section (top half,
   delimited by the `===` divider): everything above the divider moves; the
   experience half stays.
3. `apps/mastra/src/mastra/agents/seeker-route.ts` — the titling-scope
   ternary (`USER_RESOURCE_PREFIX` branch building the memory config) that
   becomes a policy-helper call.
4. `apps/mastra/src/mastra/ai-chat-thread-ownership.ts` — the single
   mastra-side home of `USER_RESOURCE_PREFIX` (import it; never re-declare).
5. Importers whose paths update: `agents/seeker-agent.ts`
   (`getAiChatMemory`), `ai-chat-history-route.ts` (`getAiChatMemory`),
   `ai-chat-retention.ts` (`getAiChatStorage`), `memory.test.ts` (ai-chat
   cases move with the code).
6. `apps/mastra/CLAUDE.md` — the "Seeker agent" memory paragraph and the
   feat-208 memory section; update in the same PR.

## Grep These

- `buildAiChatMemory` / `getAiChatMemory` / `getAiChatStorage` /
  `AI_CHAT_SCHEMA_NAME` / `AI_CHAT_TITLE_MODEL` — the 8 moving exports
- `generateTitle: false` — the policy leaving `seeker-route.ts`
- `ai-chat-memory-storage` — the InMemoryStore id (backend seam carries
  as-is)
- `USER_RESOURCE_PREFIX` — must be imported from the ownership module
- `pool arithmetic` — the header note that splits per-module with
  cross-pointers

## What To Build

```ts
// src/mastra/ai-chat-memory.ts (name is the implementer's): the 8 ai-chat
// exports move verbatim, plus the keying-policy helper:
import { USER_RESOURCE_PREFIX } from "./ai-chat-thread-ownership"

/**
 * Per-call memory config for an ai-chat agent turn (feat-241 KTD12 scope):
 * signed-in (`user:`) resources title; anonymous/dogfood resources carry
 * `generateTitle: false` (permanently unlistable — titling them wastes a
 * model call per junk POST and sends conversation content to a third-party
 * model).
 */
export function aiChatMemoryConfigFor(
  threadId: string,
  resource: string,
):
  | { thread: string; resource: string }
  | { thread: string; resource: string; options: { generateTitle: false } }
```

- `memory.ts` keeps the experience-chat half; out-of-scope consumers'
  imports are untouched.
- `seeker-route.ts`'s ternary becomes `aiChatMemoryConfigFor(threadId,
resource)`.
- Header conventions split with the file: pool-arithmetic note per-module
  with cross-pointers; the mirrored-not-imported-from-admin note carries to
  the new module's header.
- `memory.test.ts`'s ai-chat cases move to a colocated test of the new
  module; a policy-helper test covers the `user:` / non-`user:` branches.

## Constraints

- **Seam relocation only — zero behavior change.** KTD12 semantics carry
  verbatim: TOP-LEVEL `generateTitle` option key (the deprecated
  `threads.generateTitle` nesting throws mid-turn), `""` untitled sentinel,
  fire-and-forget timing, `AI_CHAT_TITLE_MODEL` as a plain model-router
  string (no static `@ai-sdk/*` import — trips the Mastra CLI bundler).
- `USER_RESOURCE_PREFIX` is imported from `ai-chat-thread-ownership.ts`,
  never re-declared (contract-locality — handoff Ruling 3, requirement 1).
- The retention purge keeps building over the persisted store
  (`getAiChatStorage`, never the backend-resolved `getAiChatMemory`) — the
  import moves, the rule does not.
- Singletons, `__reset*ForTesting` hooks, lazy construction, and the
  backend-aware `buildAiChatMemory` seam carry as-is.
- Soft ordering: if executed while feat-283 is in flight, land after it
  (both edit `seeker-route.ts`).
- Flip this ticket `in-progress` (+ lane README row) as the session's first
  act; `complete` + `## Resolution` + README row land in the carrying PR.

## Verification

- `pnpm --filter @forge/mastra test` / `typecheck` / `lint` green; the moved
  ai-chat memory cases pass at their new home; the policy-helper test covers
  both branches.
- Real-service smoke against a locally running Mastra
  (`MASTRA_STORAGE_BACKEND=memory`): a seeker turn on a `user:` resource and
  on the dogfood fallback both succeed (titling difference is
  fire-and-forget and needs no assertion here). The operator's
  implementation prompt supplies the local recipe; never kill or restart a
  Mastra instance you didn't start.
- Run `/ce-code-review` on the carrying PR and resolve the actionable
  findings.
- PR assigned to `jianwei1`; squash-merge to `main`.
