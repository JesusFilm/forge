---
id: "feat-281"
title: "Chat conversation session module (deepen the engine + honest gate denial)"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-07-22"
duration: 4
depends_on: []
blocks:
  - "feat-209"
tags:
  - "web"
---

## Problem

`apps/chat/src/lib/use-conversations.ts` (742 lines) holds every conversation
machine in one hook — 15 mutable cells, ~13 responsibilities, a 116-line 4-way
send finalize, KTD10 stamping across 4 sites — and its interface (16 returned
fields) is nearly as complex as the implementation. Its load-bearing behavior
is testable only through a 304-line harness plus 1,531 lines of whole-tree
suites. Compounding it, the reply seam (`chat-stub.ts`) silently remaps a gate
denial into a fake stub success unless callers know to pass
`allowStubFallback: false`. feat-209 (per-conversation URLs) names exactly
this surface and would otherwise wire routing into the hook and be redone.

This ticket is **Rulings 1 + 3 + 4b** of the adjudicated architecture review.
The authoritative spec — design requirements, corrections, amendment protocol,
stop-and-report clause — is
`docs/handoffs/2026-07-21-chat-architecture-review-rulings.md`. Read it first
in full. Do NOT run `ce-plan`; the handoff doc + this ticket are the plan.

## Entry Points — Read These First

1. `docs/handoffs/2026-07-21-chat-architecture-review-rulings.md` — the
   rulings (this ticket implements Rulings 1, 3, 4b; note the 8 numbered
   design requirements under Ruling 1).
2. `apps/chat/src/lib/use-conversations.ts` — the module being deepened: the
   `UseConversations` type, `send()`'s 4-way finalize, `controllersRef` /
   `stoppedRef` abort slots, the StrictMode mount effect (cleanup mutates
   hook-lifetime refs; setup restores them), `HistoryListUi` +
   `listConversations` (moving out, Ruling 4b).
3. `apps/chat/src/lib/chat-stub.ts` — the reply seam; the `gate_denied` →
   inline stub fallback (`allowStubFallback`) that Ruling 3 removes from the
   interface. Note it builds the stub terminal IMMEDIATELY (no 800ms delay).
4. `apps/chat/src/components/shell/app-shell-test-harness.tsx` +
   `app-shell.test.tsx` + `app-shell.history.test.tsx` — the acceptance gate.
   The `Remount safety (dev StrictMode cycle)` describe must stay green.
5. `apps/chat/src/lib/conversations.ts` — `REPLY_FAILURE_REASONS` (the
   feat-236 compile-forced lever lives here; do not remove `gate_denied`).
6. `docs/roadmap/ai-chat/feat-236-chat-remove-seeker-dogfood-gate.md` — its
   step-2 prose and Grep-These bullets name client files this refactor
   relocates: the `chat-stub.ts (streamSeekerReply)` client site AND the
   hydration condition in `lib/use-conversations.ts`. Repoint every
   relocated reference in the same PR that moves the mapping.
7. `apps/chat/CLAUDE.md` — Architecture + state-ownership sections describe
   the hook; update in the same PR (feat-275 just audited this file).

## Grep These

- `UseConversations` / `controllersRef` / `stoppedRef` / `markServerPersisted`
  — the machines moving into the session module
- `allowStubFallback` — every site (hook computation + seam consumption) goes
- `gate_denied` — client mapping sites (must keep feat-236's lever intact)
- `HistoryListUi` / `listConversations` — the projection moving to a
  sidebar-facing module
- `Remount safety` — the StrictMode acceptance suites
- `useSyncExternalStore` — should be absent today; the adapter introduces it

## What To Build

Two stacked PRs from one session (branch `feat/chat-conversation-session`,
then `feat/chat-honest-gate-denial` stacked on it).

**PR 1 — extract the session module + adapter (zero behavior change):**

```ts
// src/lib/conversation-session.ts (framework-agnostic, no React imports)
export type ConversationSession = {
  subscribe(listener: () => void): () => void
  getSnapshot(): ConversationSessionSnapshot // cached; new identity only on real change
  send(text: string): void
  stopReply(): void
  selectConversation(id: string): void
  newConversation(): void
  retryHistory(): void
  loadMoreHistory(): void
  retryReplay(): void
}
export type ConversationSessionDeps = {
  streamReply: typeof streamReply
  fetchHistoryPage: typeof fetchHistoryPage
  fetchHistoryThread: typeof fetchHistoryThread
  seekerEnabled: boolean
}
export function createConversationSession(
  deps: ConversationSessionDeps,
): ConversationSession
```

- `useConversations` becomes a thin adapter (`useSyncExternalStore` +
  the mount/StrictMode lifecycle). Its returned shape to `AppShell` stays
  identical in PR 1.
- `apps/chat/CLAUDE.md`: rewrite the Architecture / state-ownership sections
  this PR invalidates (the hook no longer owns the machines) — each PR
  updates the sections it invalidates (handoff Ruling 1, requirement 7).
- New: direct unit suite for the session module (injected deps, real
  `ReadableStream`s where needed, no DOM) + a StrictMode-rendered suite for
  the adapter.
- The exact internal split (draft handling, snapshot versioning scheme, file
  layout) is the implementer's; deviations from what the handoff doc
  SPECIFIES get amendments (see its protocol).

**PR 2 — fold Ruling 3 + the projection move + prose:**

- `streamReply` loses `allowStubFallback`; `gate_denied` always returns
  `{ ok: false, reason: "gate_denied", partialText: "" }`. The session
  reconstructs the immediate stub result for never-persisted conversations
  (inline `buildStubReply`, engine `"stub"`, NO `streamStubReply` re-entry,
  no delay); persisted conversations render the failure notice (KTD10,
  unchanged behavior).
- `HistoryListUi` + `listConversations` move to a sidebar-facing module
  (e.g. `src/components/shell/sidebar-projection.ts`); imports in
  `sidebar.tsx` + `sidebar-conversation-list.tsx` update.
- feat-236 step-2 + Grep-These references repointed — EVERY client-file
  pointer the refactor relocates: the `chat-stub.ts (streamSeekerReply)`
  client-site mention AND the hydration-condition reference to
  `lib/use-conversations.ts` (hydration moves into the session module).
- `apps/chat/CLAUDE.md`: update the sections this PR invalidates (reply
  seam, KTD10 story).

## Constraints

- **Behavior-preserving throughout.** R21/R22/KTD10 semantics relocate, never
  change. No SSE/proxy/server code changes in this ticket.
- The 8 numbered design requirements under the handoff doc's Ruling 1 are
  binding — notably: cached identity-stable `getSnapshot`; session instance
  survives StrictMode setup→cleanup→setup with side-effect-free construction;
  the interface serves anonymous/stub users; no whole-tree suite deleted.
- Do not remove `gate_denied` from `REPLY_FAILURE_REASONS` (feat-236's
  compile-forced teardown lever).
- If the StrictMode re-arm discipline cannot be made to pass, STOP and report
  (handoff doc's stop-and-report clause) — do not redesign mid-flight.
- Flip this ticket `in-progress` (+ lane README row) as the session's first
  act; `complete` + `## Resolution` + README row land in PR 2.

## Verification

- `pnpm --filter @forge/chat test` / `typecheck` / `lint` green on both PRs;
  every pre-existing suite passes unmodified (renames of imports excepted).
- Browser (headless Chromium, `chrome-devtools` MCP): send/stream/stop on the
  zero-env stub path; new/select/switch conversations mid-stream; sidebar
  states. Gate-granted path (history hydration, replay, R22 send blocking) —
  the operator's handoff prompt supplies the local gate-granted sign-in
  recipe (workspace-specific; not recorded here).
- Tier-2 `/ce-code-review` after implementation, before each push (mandatory
  triggers fire); apply P2+ findings at confidence 75+.
- PRs assigned to `jianwei1`; squash-merge to `main`.
