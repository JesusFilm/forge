---
id: "feat-329"
title: "Replay persistence: featured video + sources survive thread reload"
owner: "jian wei"
priority: "P1"
status: "complete"
start_date: "2026-08-10"
duration: 2
depends_on:
  - "feat-327"
  - "feat-328"
blocks: []
tags:
  - "ai-pipeline"
  - "web"
---

## Resolution

**Shipped:** 2026-08-05 via [PR #NNNN](https://github.com/JesusFilm/forge/pull/NNNN) (`feat(chat): replay persistence for featured videos and cited sources (ai-chat feat-329)`).

**What landed.** Featured videos and cited sources now survive a thread reload, re-derived at replay time from the tool parts Mastra already persists — the plan's named fallback (a compact record written at send time) was not needed, because the pre-work gate confirmed stored assistant parts carry the tool name and result. The send path's projection and declaration ladder were extracted into a shared pure module (`agents/seeker-turn-projection.ts`) that both the live and replay routes consume through their own thin adapters, so the two cannot drift; the module returns its rejection reason instead of logging, because replay re-resolves every stored turn on every thread open and must stay silent. Two decisions diverge from the brief. The replay wire deliberately carries no `grounded` field — R21 forbids the badge and the sources disclosure needs only the list — and the replay-only byte bounds grew past the brief's `<=5 sources / 512-unit snippets`: review found the derivation counted only `snippet` while `sourceName`, `title`, `url`, and the video `title` crossed the wire uncapped, so every variable-length field is now bounded (display strings truncate, an over-long URL drops its whole source) and the budget is proven by a test that serializes a maximal thread and measures real bytes. This closes the accepted D7 rollout gap for the feat-326 → feat-330 arc.

**Compound docs.** `docs/solutions/architecture-patterns/turn-association-when-re-deriving-from-a-message-store.md`; `docs/solutions/architecture-patterns/kill-switch-completeness-follows-data-lifetime.md`; a measurement corollary added to `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`.

**Residual risk / follow-ups.**

- **`SEEKER_VIDEO_ENABLED=false` does not retract already-stored replay videos** (decided, not an oversight). The send path is inert with the flag off only because its tools go unregistered; replay's chunks persist in the store and the replay route reads no flag. Levers in escalation order: the flag stops new declarations, `SEEKER_ROUTE_ENABLED=false` darkens the whole ai-chat lane, purging the threads removes the rows. Revisit on audience widening (the feat-236 era) or an incident class needing visual retraction. Cited sources were never gated by this flag on any path. Dated amendment at the plan's rollback step 5.
- **One operator check closes both remaining verification residuals at once:** reopen a pre-existing video-featuring thread after merge. That exercises the post-fix video render half (browser-verified pre-fix only — the admin agent-tools upstream was timing out during the post-fix re-run; the sole video-affecting change since is 128-unit title truncation, unit-tested) AND the `PostgresStore`-preserves-tool-parts half, which the real-memory smoke's second scope limit explicitly does not cover (it pins the in-memory backend).
- A pre-existing flake unrelated to this work can trip under whole-suite load: `apps/mastra/src/mastra/ai-chat-lane-admission.test.ts` "discriminates pool vs lane" takes ~4.0s against a 5s timeout and passes in isolation.

## Problem

Featured videos (feat-327/328) and cited sources both VANISH when a persisted
thread is reopened: the feat-241 replay wire projects `{ id, role, text,
createdAt }` only, so tool-derived attachments are unrepresentable. The arc
plan (`docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md`, unit
U4, decision D8) fixes both TOGETHER across all three layers — mastra replay
route → wire type → chat client/session merge. This closes the accepted D7
rollout gap.

## Entry Points — Read These First

1. `docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md` — read
   D8, D9, P8, and unit U4.
2. `apps/mastra/src/mastra/ai-chat-history-route.ts` — the replay handler +
   wire projection (the 8,192-unit per-message text cap lives here; the
   "tool internals are unrepresentable" contract this ticket supersedes).
3. `apps/mastra/src/mastra/agents/seeker-route.ts` — `extractSources` + the
   feat-327 video extraction/projection (the code that moves into the shared
   module).
4. `apps/chat/src/lib/history-client.ts` — the never-throw typed client that
   parses the replay wire.
5. `apps/chat/src/lib/conversation-session.ts` — replay merge
   (single-flight, session-cached) + R21 badge-stripping semantics.
6. `apps/chat/src/app/api/history/history-proxy.ts` — the 8 MiB thread
   byte-cap whose worst-case arithmetic this ticket revises.
7. `apps/chat/CLAUDE.md` "Server-side conversation history (feat-241)" +
   `apps/mastra/CLAUDE.md` "ai-chat history read surface (feat-241)".

## Grep These

- `extractSources` (moves to the shared module)
- `recall(` in `ai-chat-history-route.ts` (where stored parts arrive)
- `toSources` / `toVideo` in apps/chat (reused on the replay path)
- `8 MiB` / `readJsonCapped` (the byte-cap to re-derive)
- `R21` (badge-stripping — preserved)

## What To Build

Per plan U4 (full detail there):

0. **Pre-work gate (runnable before starting — plan U4):** confirm the
   load-bearing persistence assumption by inspecting an existing dogfood
   `ai_chat` thread with a `retrieveAnswer` turn: the stored assistant
   message parts must carry the tool name AND result payload. Record the
   observed part shape. If not recoverable, STOP and surface the plan's
   named fallback (compact video record persisted at send time) instead of
   building the re-derivation path.
1. `apps/mastra/src/mastra/agents/seeker-turn-projection.ts` (new,
   extracted): pure projections + `resolveTurnAttachments` over normalized
   `{ toolName, result }` chunks (plan P8). Each route supplies its own thin
   adapter: the send path normalizes `toolResults` chunks
   (`{ payload: { toolName, result } }`), the replay path normalizes stored
   `tool-invocation` parts — the two native shapes are structurally
   different; only projection+resolution is shared. `seeker-route.ts`
   refactor is behavior-preserving.
2. Replay wire: per-assistant-message optional `sources` and `video`,
   extracted via the shared module. **Turn association (plan U4):** stored
   tool parts can land on their own tool-only assistant message (the client
   drops empty-text messages for exactly this case) — group stored messages
   into turns and attach extractions to the LAST text-bearing assistant
   message; the empty-text drop stays unchanged. Badges stay stripped (R21)
   — decide `grounded`'s presence at implementation per what SourcesList
   needs.
3. `history-client.ts`: parse the new optional fields defensively
   (reuse/adapt `toSources` + `toVideo`); malformed fields degrade to absent,
   never a failed replay.
4. Session replay merge: attach parsed sources/video to replayed messages;
   `message-list.tsx` renders them (badge stripping unchanged).
5. **Byte-cap budget (plan U4 — the send-path bounds do NOT fit):** the
   replay projection ENFORCES ≤5 sources per replayed message + 512-UTF-16-
   unit snippet truncation (deterministic). Arithmetic: 200 × (8,192×3 text
   - 5×512×3 sources + ~0.5 kB video) ≈ 6.6 MB < 8 MiB. Name the constants
     beside `AI_CHAT_HISTORY_TEXT_CAP_CHARS`; revise the arithmetic comment
     beside the 8 MiB cap and the superseded "tool internals are
     unrepresentable" wording in both CLAUDE.mds. Never raise the cap.

## Constraints

- Video and sources ship TOGETHER (plan D8) — do not split.
- The send path's observable behavior is UNCHANGED by the extraction
  (existing seeker-route suites must pass unmodified).
- Replayed turns still carry NO engine/grounded badges (R21) — attachments
  render, badges do not.
- The replay deny ladder (KTD8), lane admission, thread-ownership
  resolution, and the 8s/10s budgets are untouched.
- All projections stay field-by-field allowlists (plan D9); the chat side
  re-validates (never trusts the replay wire more than the live wire).

## Verification

- Both suites + typecheck green
  (`pnpm --filter @forge/mastra --filter @forge/chat test`).
- **Real-memory round-trip smoke (required — mocked-shape-vs-real-contract
  discipline):** persist a video-featuring turn through a REAL Memory store,
  replay it, assert the video + sources fields AND the turn association
  (parts and reply text attach to the same rendered message even if the
  store split them). This pins the stored-part shape the mocked tests
  assume; note re-verify-on-`@mastra/*`-bump beside it.
- Turn-association mocked fixture: tool parts on a SEPARATE tool-only
  message still attach to the text-bearing message (a single-message fixture
  alone is vacuous).
- Byte-cap ENFORCEMENT test: over-budget fixtures come back truncated to the
  ≤5-source / 512-unit bounds, and the documented worst-case arithmetic is
  asserted over the named constants — prove the projection enforces the
  bound, not that a payload happens to fit.
- Browser: reload a dogfood thread that featured a video — the player and
  sources render on the replayed transcript.
