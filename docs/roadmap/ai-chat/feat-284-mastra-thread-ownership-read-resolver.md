---
id: "feat-284"
title: "Mastra thread-ownership read-path resolver (owned-existing-thread)"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-07-24"
duration: 1
depends_on: []
blocks:
  - "feat-247"
tags:
  - "ai-pipeline"
---

## Problem

`authorizeAiChatThreadAccess` (`ai-chat-thread-ownership.ts`) answers a
write-path question — "may this turn create-or-continue?" — so the history
replay handler must compose three non-obvious facts around it, all living as
comments at its call sites: the gate's missing-thread branch would admit a
vanished thread as an empty-transcript success; its `thread_limit` refusal is
reachable on reads only when the thread is missing (so the handler remaps it
to `thread_not_found`); and `recall` must always receive `resourceId` or the
store's own ownership throw is disabled. The handler also pays at runtime:
replaying an owned thread runs `getThreadById` twice (gate + explicit
existence check), and a missing thread costs three store queries where one
answers everything. feat-247's delete/rename would re-learn all of it.

This ticket is **Ruling 2** of the adjudicated Mastra/Seeker architecture
review. The authoritative spec is
`docs/handoffs/2026-07-21-mastra-seeker-architecture-review-rulings.md` —
read it first in full (note requirement 1's recall boundary and Correction
3's query counts). Do NOT run `ce-plan`; the handoff doc + this ticket are
the plan.

## Entry Points — Read These First

1. `docs/handoffs/2026-07-21-mastra-seeker-architecture-review-rulings.md` —
   Ruling 2 (6 numbered requirements), Correction 3 (the double-read /
   triple-query costs), and the Standing decision on the per-branch
   fail-mode split.
2. `apps/mastra/src/mastra/ai-chat-thread-ownership.ts` — the write-path
   gate (unchanged) and the module docstring's fail-mode contract; the
   resolver is added here.
3. `apps/mastra/src/mastra/ai-chat-history-route.ts` —
   `handleAiChatHistoryReplayRequest`: the gate call, the `thread_limit` →
   `thread_not_found` remap, the explicit `getThreadById` existence check
   (all replaced by one resolver call), and the `recall` call whose
   `resourceId` comment STAYS.
4. `apps/mastra/src/mastra/ai-chat-history-route.test.ts` — the replay deny
   matrix whose wire outcomes are frozen (foreign owner, missing thread,
   at-ceiling + missing, store outage).
5. `apps/mastra/src/mastra/ai-chat-pg-failmode-contract.test.ts` — read to
   understand what must NOT change; this file is never modified.
6. `apps/mastra/CLAUDE.md` — the "ai-chat history read surface" replay
   bullet (gate → existence check → recall) updates in the same PR.

## Grep These

- `authorizeAiChatThreadAccess` — the write-path gate (send route keeps it;
  replay stops using it)
- `thread_limit` — the write-path reason whose read-side remap disappears
- `write-path concept` — the replay-handler comment block the resolver
  absorbs
- `getThreadById` — two replay-path calls collapse to one
- `resourceId` in the replay handler — the recall obligation that STAYS
- `AiChatOwnershipMemory` — the narrow type; the resolver needs only its
  `getThreadById` member

## What To Build

One PR (branch `feat/mastra-thread-ownership-read-resolver`).

```ts
// added to src/mastra/ai-chat-thread-ownership.ts (names are the implementer's)
export type AiChatOwnedThreadResolution =
  | { ok: true }
  | { ok: false; reason: "thread_forbidden" | "thread_not_found" }

/**
 * Read-path resolution: an owned, EXISTING thread — or a fixed refusal —
 * from a single getThreadById. null → thread_not_found; owner mismatch →
 * thread_forbidden; match → ok. No ceiling branch on reads. Store errors
 * propagate (fail CLOSED — the caller maps them to its generic failure).
 * recall's always-pass-resourceId rule remains the CALLER's obligation.
 */
export async function resolveOwnedExistingThread({
  memory,
  threadId,
  resource,
}: {
  memory: Pick<AiChatOwnershipMemory, "getThreadById">
  threadId: string
  resource: string
}): Promise<AiChatOwnedThreadResolution>
```

- Replay handler: admission preamble → `resolveOwnedExistingThread` (budget-
  raced via `settleWithinBudget`, as the gate call is today) → `recall` +
  projection. The `thread_limit` remap and the explicit existence check are
  deleted; the `recall` call and its `resourceId` comment stay.
- Unit tests: the resolver directly (null / mismatch / match / store-reject
  propagation), plus the replay suite updated so the frozen wire outcomes
  pass with `listThreads` asserted NOT called on the read path.
- `apps/mastra/CLAUDE.md`: update the replay narration in the same PR.

## Constraints

- **Wire contract frozen:** foreign owner → 403 `thread_forbidden`; missing
  thread → 404 `thread_not_found` (including the at-ceiling fixture); store
  outage after admission → 500 `store_failed`, never `thread_not_found`.
- **No try/catch inside the resolver** — the fail-closed direction rests on
  the store throw propagating; `ai-chat-pg-failmode-contract.test.ts` is
  never modified.
- **The write-path gate is unchanged** — the send route keeps its ceiling
  branch and documented fail-OPEN posture.
- **Do not absorb `recall`** — the always-pass-`resourceId` rule stays a
  handler obligation (handoff Ruling 2, requirement 1).
- Scope to what replay needs today; no delete/rename pre-design (feat-247's
  brainstorm extends the resolver).
- Soft ordering: execute after feat-283 (both edit
  `ai-chat-history-route.ts` + `apps/mastra/CLAUDE.md`) — sequencing note in
  the handoff doc; not a hard dependency.
- Flip this ticket `in-progress` (+ lane README row) as the session's first
  act; `complete` + `## Resolution` + README row land in the same PR.

## Verification

- `pnpm --filter @forge/mastra test` / `typecheck` / `lint` green; the
  replay deny-matrix outcomes unchanged; a test asserts `listThreads` is not
  called on the read path.
- Real-service smoke against a locally running Mastra
  (`MASTRA_STORAGE_BACKEND=memory`): replay an owned thread, a foreign
  thread (403), and a missing id (404) through
  `/forge-ai-chat-history-replay`. The operator's implementation prompt
  supplies the local run/bearer recipe; never kill or restart a Mastra
  instance you didn't start.
- Run `/ce-code-review` before push and resolve the actionable findings
  (ownership/authorization surface — mandatory Tier-2 trigger).
- PR assigned to `jianwei1`; squash-merge to `main`.
