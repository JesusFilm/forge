---
title: "feat: AI chat thumb-rating into Mastra scorer system"
type: feat
status: active
date: 2026-05-25
origin: docs/brainstorms/2026-05-25-ai-chat-thumb-rating-mastra-scorer-requirements.md
---

# feat: AI chat thumb-rating into Mastra scorer system

## Summary

Wire 👍/👎 + optional comment ratings onto workflow-generated assistant messages in the admin AI chat panel. Persist each click via Mastra's built-in scores store (`saveScore` against a logical `chat-thumb-rating` scorer) using the `ExperienceChatMessage` cuid as the score entity id. v1 is capture-only; read paths are Mastra Studio in dev and a small admin CLI in prod.

---

## Problem Frame

The admin AI chat drives high-value generations (full-page draft, add-section, rewrite-copy, critique, multi-step draft) but captures zero user judgment on the output. Without that signal, every prompt tweak and model swap is unmeasured. The origin doc (`docs/brainstorms/2026-05-25-ai-chat-thumb-rating-mastra-scorer-requirements.md`) establishes the WHAT: rate workflow outputs only, thumb + optional comment on both, mutable, persist via Mastra's scorer system, Studio-only review for v1.

This plan establishes the HOW: identify each ratable output by its existing `ExperienceChatMessage.id`, tag the producing agent/workflow on the message row so the panel knows when to render the control, append a new Mastra score per click (latest wins), and ship a thin CLI so prod operators can read the scores without Studio.

---

## Requirements

- R1. (origin R1) Rating control renders on assistant turns whose `producedBy` is in the ratable set: `draft-experience`, `add-section`, `rewrite-copy`, `experience-critic`, `multi-step-draft`. Plain `experience-default-chat` turns get no control.
- R2. (origin R2) Either thumb opens an optional comment field; submitting without a comment is the expected fast path.
- R3. (origin R3) Toggling 👍 ↔ 👎, editing the comment, and clearing are all supported. The most recent record is the current value.
- R4. (origin R4) The control reflects the current user's own rating only; no aggregation in v1.
- R5. (origin R5) UI is optimistic; failed saves surface a quiet inline error without blocking the panel.
- R6. (origin R6+R7) Every ratable assistant message has a stable identifier (the `ExperienceChatMessage.id` cuid) that flows through the chat stream and is the Mastra score's `entityId`. Each persisted record carries: scorer id (`chat-thumb-rating`), score (`1`/`0`), optional comment, rater user id, `producedBy` (agent/workflow name), and Mastra workflow `runId` when available.
- R7. (origin R8) A single `chat-thumb-rating` scorer is registered at Mastra init — not invoked as an LLM evaluator; purely a logical bucket for `saveScore` calls.
- R8. (origin R9) Rating writes go through `mastra.getStorage().getStore('scores').saveScore(...)`. No parallel Prisma table.
- R9. (origin R10) Mutability is implemented as append-and-latest-wins: every click writes a new score record; reads filter by `(entityId, raterUserId)` and pick the latest by `createdAt`. See Key Technical Decisions for the rationale.
- R10. (origin R11+R12) Rating endpoints require an authenticated admin session and the existing `write:experiences` permission. The rater identity comes from the session, not from the request body. Endpoints are `apps/admin`-only.

---

## Scope Boundaries

- No custom admin dashboard, filters, charts, or aggregations over ratings. Review surface for v1 = Mastra Studio (dev) + a `chat-ratings:list` CLI (prod).
- No prompt selection, automated eval, fine-tuning, or A/B comparison driven by ratings.
- No per-block or per-section rating. One rating per generated artifact (== one assistant message).
- No rating on `experience-default-chat` replies, tool-call events, or system messages.
- No backfill of ratings against historical generations.
- No notifications, threshold alerts, moderation, or comment redaction in v1.

### Deferred to Follow-Up Work

- A read-side GraphQL `chatRatings(...)` query exposing scores to a future custom admin dashboard. Out of scope here; the CLI in U7 is sufficient for v1 operator inspection.
- Surfacing Mastra workflow `runId` end-to-end in Studio's trace view. The score metadata stamps `runId` when available (multi-step workflow path), but no extra wiring is added.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/mastra/index.ts` — Mastra singleton, agents/workflows registry. U1 attaches the scorer here (or, if the surface requires it elsewhere, U1 picks the right seam — see Open Questions).
- `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts` — chat-turn streaming service. Already persists assistant messages to `ExperienceChatMessage` and emits their id on the `done` event (line ~698-701). The seam for U2/U3.
- `apps/admin/src/mastra/chat-stream-event.ts` — `ChatStreamEvent` union (the boundary contract between streaming bridge and the panel consumer). `done` already carries `messageId`; U3 extends it with `producedBy`.
- `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx` — chat panel React component. Renders assistant messages from local state populated via the SSE stream. The "Generate full page" button now lives inside this panel (commit `6f00a39d`).
- `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts` — server action that runs `multiStepDraftWorkflow`. Today it returns `{ ok, draft }` but does NOT persist a chat message. U2 changes that.
- `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts` — the workflow whose output we want rated; surfaces a `runId` via Mastra's workflow run API.
- `apps/admin/prisma/schema.prisma` (model `ExperienceChatMessage` at line ~1327; `@@map("experience_chat_message")`) + migration sequence — last applied migration is `0016_mastra_schema`, so U2's new migration is `0017_chat_message_produced_by`.
- `apps/admin/src/app/api/experience-chat/stream/route.ts` — REST handler pattern (Better Auth session → coarse-tier gate → ABAC inside service). U5's rating route follows the same shape.
- `apps/admin/src/auth/permissions.ts` — `hasPermission()` matrix. The rating routes reuse `write:experiences`; no new permission key.

### Institutional Learnings

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — tests must throw the real typed shape, not generic Error. U1's "scores store exists" check and U4's `saveScore` round-trip use the actual `@mastra/core` surface; the test mocks must mirror the real Mastra Storage shape.
- Memory: `feedback_admin_is_cms.md` (apps/admin is the user's CMS, port 3003). All wiring lives in `apps/admin`; no apps/cms or apps/web changes.
- Memory: `feedback_local_dev_stack_scripts.md` — verification commands in U1/U7 prefer `pnpm run:admin-web-mastra` over starting services by hand.

### External References

- Mastra `@mastra/core@1.33.1` ships `storage/domains/scores/{base,inmemory}.d.ts` — confirmed locally under `node_modules/.pnpm/@mastra+core@1.33.1.../@mastra/core/dist/storage/domains/scores/`. The `listScoresBy*` API matches the upstream docs (`listScoresByScorerId`, `listScoresByRunId`, `listScoresByEntityId`, `listScoresBySpan`).
- The `createScorer(...).generateScore(...)` API exists but is for LLM-driven evaluation. We do NOT invoke it for human feedback; we use `saveScore` directly against a logical scorer id (`createScorer` is still called once at registration so Studio/Storage recognise the bucket — see Open Questions).

---

## Key Technical Decisions

- **Entity identity = `ExperienceChatMessage.id`, not Mastra `runId`** (resolves origin Q1). Workflow runs have a `runId`, but agent-only chat generations don't surface a stable workflow-tier identity to the panel. Every ratable assistant turn already lands as an `ExperienceChatMessage` row with a cuid — a single, universal anchor across chat replies and workflow outputs. The Mastra workflow `runId` is stamped in the score's metadata when available so Studio's run→score navigation still works for multi-step outputs; it just isn't load-bearing for the read path.
- **`producedBy` column on `ExperienceChatMessage`** is the stream-tagging seam (resolves origin Q3). Putting the producer on the persisted row means: (a) panel filters ratability deterministically; (b) score metadata records what produced the rated artifact for later analysis; (c) no transient stream-only flag the consumer has to special-case. Streaming the value through `done` is then a single-line additive change to `ChatStreamEvent`.
- **Append-and-latest-wins mutability** (resolves origin Q2). Mastra's `saveScore` returns a new score with a generated id; the storage domain has no documented upsert-by-composite-key. Read-modify-write under concurrent clicks (rapid 👍→👎→clear) is a race trap. Appending every click and resolving "current state" by `MAX(createdAt) WHERE entityId=? AND raterUserId=?` is simpler, race-free, and gives us per-rating revision history for free. A score value of `null` represents "cleared".
- **Single logical scorer, registered via `createScorer({ id: "chat-thumb-rating", name: "Chat thumb rating" })`** in U1. We don't call its `generateScore` — we register it so Storage / Studio recognise it as a known bucket, then write through `saveScore`. This matches Mastra's storage-domain shape (scorerId is a string).
- **REST, not GraphQL, for the rating endpoints.** Mirrors the existing `apps/admin/src/app/api/experience-chat/stream/route.ts` shape, keeps the chat-panel UI client free of an additional GraphQL operation, and avoids a Pothos type that we'd remove again when the v2 dashboard arrives.
- **No new permission key.** `write:experiences` already gates the chat itself; if a user can prompt the agent, they can rate its output. Adding a separate `write:chat-ratings` key would be ceremony without an authorisation boundary to enforce.
- **Workflow output now persists as a chat message.** Today `generate-draft-action.ts` returns the draft without touching `ExperienceChatMessage`. U2 persists a small assistant row with `producedBy: "multi-step-draft"` so the workflow output is identifiable, rateable, and consistent with the rest of the chat history. The persisted row stores a short summary (e.g. the workflow's `reason` / first-line) — the full draft already lives in the canvas + revision log, no need to duplicate it.

---

## Open Questions

### Resolved During Planning

- **Q1 (identifier strategy).** Resolved: use `ExperienceChatMessage.id` as the universal entity id; stamp Mastra `runId` in score metadata when available. See Key Technical Decisions.
- **Q2 (mutability mechanics).** Resolved: append-and-latest-wins. See Key Technical Decisions.
- **Q3 (stream-tagging seam).** Resolved: persist `producedBy` on the message row, extend `ChatStreamEvent.done` to carry it. See Key Technical Decisions.
- **A1 (Mastra scorer surface).** Confirmed: `@mastra/core@1.33.1` exposes `storage/domains/scores/{base,inmemory}.d.ts`; `saveScore` + `listScoresBy*` are available. U1's verification step round-trips a synthetic score against `getMastra().getStorage()`.
- **A2 (Studio availability).** Mastra Studio is not deployed to Railway — only available via `pnpm --filter @forge/admin mastra:dev` locally. U7 ships a `chat-ratings:list` CLI as the prod inspection path.

### Deferred to Implementation

- **Exact `MastraScorer` registration seam.** `createScorer(...)` returns a scorer object; depending on the `@mastra/core@1.33.1` surface, it may need to be passed to `new Mastra({ scorers: { ... } })`, attached to an agent's `scorers` config, or simply referenced by id when calling `saveScore`. U1 picks the surface that lets `listScoresByScorerId('chat-thumb-rating')` round-trip; this is a code-level discovery, not an architectural decision.
- **Studio scorers-view shape on `@mastra/core@1.33.1`.** R6's success criterion is "queryable in Studio". The plan doesn't depend on a particular Studio layout — if Studio doesn't expose scores at this version, U7's CLI is the fallback regardless and we accept the dev-time gap.
- **Comment length cap.** Pick at implementation time; suggest 2000 chars as a sane bound. Stored as `null` when omitted.

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Write path (👍/👎 click)                                                    │
│                                                                              │
│   ExperienceChatPanel (U6)                                                   │
│        │ POST /api/experience-chat/messages/{messageId}/rating               │
│        ▼                                                                     │
│   Rating route (U5)  ──┐                                                     │
│        │               │ Better Auth session + write:experiences gate        │
│        ▼               │                                                     │
│   chat-rating.service (U4)                                                   │
│        │ verify producedBy ∈ ratable set                                     │
│        │ verify principal owns/can-read the message                          │
│        ▼                                                                     │
│   mastra.getStorage().getStore('scores').saveScore({                         │
│      scorerId: 'chat-thumb-rating',                                          │
│      score: 1 | 0 | null,                                                    │
│      entityId: messageId,    entityType: 'experience_chat_message',          │
│      runId?: workflowRunId,  metadata: { comment, raterUserId, producedBy }, │
│   })                                                                         │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Read path (panel mount + post-save refresh)                                 │
│                                                                              │
│   Panel mounts thread                                                        │
│        │ GET /api/experience-chat/threads/{threadId}/ratings                 │
│        ▼                                                                     │
│   Rating route (U5)                                                          │
│        │                                                                     │
│        ▼                                                                     │
│   chat-rating.service (U4)                                                   │
│        │ list message ids for the thread + producedBy ∈ ratable set          │
│        │ for each, listScoresByEntityId({entityId, ...})                     │
│        │ filter by raterUserId = principal; pick MAX(createdAt)              │
│        ▼                                                                     │
│   { [messageId]: { score, comment, updatedAt } | null }                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

The `producedBy` column on `ExperienceChatMessage` is the join key between "is this message ratable?" (panel) and "what produced this rated artifact?" (score metadata).

---

## Implementation Units

### U1. Register `chat-thumb-rating` scorer in the Mastra runtime

**Goal:** Mastra has a logical `chat-thumb-rating` scorer that downstream code can `saveScore` against and inspect via `listScoresByScorerId`. Validates the A1 assumption against `@mastra/core@1.33.1`.

**Requirements:** R7, R8.

**Dependencies:** None.

**Files:**

- Create: `apps/admin/src/mastra/scorers/chat-thumb-rating.ts`
- Create: `apps/admin/src/mastra/scorers/chat-thumb-rating.test.ts`
- Modify: `apps/admin/src/mastra/index.ts` (register scorer on the Mastra instance)
- Modify: `apps/admin/src/mastra/index.test.ts` (assert the scorer is reachable)

**Approach:**

- Define `CHAT_THUMB_RATING_SCORER_ID = "chat-thumb-rating"` plus a `createScorer({ id, name })` registration. Export both.
- Attach the scorer in `buildMastraInstance()` via whichever Mastra 1.33.1 surface enables `listScoresByScorerId('chat-thumb-rating')` to round-trip — registry-style (`new Mastra({ scorers: { ... } })`) is the first probe. If that surface is absent at this version, fall back to writing through `getStorage().getStore('scores').saveScore({ scorerId: 'chat-thumb-rating', ... })` directly with no upfront registration (scorerId is just a string in storage). The plan-time decision is "the scorer id is a stable string"; the runtime-level wiring is U1's job to land cleanly.
- Confirm Mastra exposes a `getStorage()` (or equivalent) on the instance and the returned object has a `getStore('scores')` with `saveScore` + `listScoresByScorerId`. If any of those calls don't exist on 1.33.1, fail the unit loudly and surface to the user before continuing — this is the A1 verification gate.

**Patterns to follow:**

- `apps/admin/src/mastra/index.ts` — module-level singleton with lazy build, side-effect-free imports. Mirror the existing agent/workflow registration shape (one extra property on the `new Mastra({...})` config).

**Test scenarios:**

- Happy path: `getMastra()` exposes the scorer via the documented Mastra surface (e.g. `mastra.getScorer?.('chat-thumb-rating')` or scores store recognises the id).
- Integration: a synthetic `saveScore({ scorerId, score: 1, entityId: "test-msg", entityType: "experience_chat_message" })` against the in-memory store round-trips via `listScoresByScorerId('chat-thumb-rating')` returning the same record.
- Integration: `listScoresByEntityId({ entityId: "test-msg", entityType: "experience_chat_message" })` returns the same record.
- Edge case: `__resetMastraForTesting()` between cases — the scorer must register cleanly on the rebuilt instance (no module-load side effects that leak across the reset).

**Verification:**

- `pnpm --filter @forge/admin test src/mastra/scorers/chat-thumb-rating.test.ts` passes.
- `pnpm --filter @forge/admin typecheck` passes — confirms the chosen Mastra surface exists at 1.33.1.

---

### U2. Add `producedBy` to `ExperienceChatMessage` and populate from both writers

**Goal:** Every assistant message in `experience_chat_message` carries a `producedBy` string identifying the agent or workflow that produced it. The multi-step draft workflow output, which today only lives in client state, now persists as a chat message too.

**Requirements:** R1, R6.

**Dependencies:** None (independent of U1).

**Files:**

- Modify: `apps/admin/prisma/schema.prisma` (add `producedBy String?` on `ExperienceChatMessage`)
- Create: `apps/admin/prisma/migrations/0017_chat_message_produced_by/migration.sql`
- Modify: `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts` (set `producedBy` on assistant-message persistence to the agent id picked for the turn — `experience-default-chat` for free chat, `draft-experience` / `add-section` / `rewrite-copy` for specialized routes)
- Modify: `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts` (after a successful workflow run, persist a minimal `ExperienceChatMessage` row with `producedBy: "multi-step-draft"` linked to the active threadId; return its `messageId` and `runId` in the action result)
- Modify: `apps/admin/src/services/experience-ai/experience-ai-chat.service.test.ts` (assert producedBy is stamped)
- Modify: `apps/admin/src/app/dashboard/experiences/generate-draft-action.test.ts` (assert workflow output persists a chat message and surfaces messageId+runId)

**Approach:**

- Column is a free-form `String?` (nullable for historic rows; non-null going forward) — encoding the closed set as a Prisma enum hardens the contract but couples it to every new agent we register, which is friction we don't need yet. A `producedBy` test in U2 enforces the ratable set against `RATABLE_PRODUCERS` (a TS constant in `apps/admin/src/services/chat-rating.constants.ts` — see U4).
- Migration: forward-only `ALTER TABLE experience_chat_message ADD COLUMN produced_by TEXT;`. Historic rows stay NULL → not ratable (origin O5: no backfill).
- Workflow-output message body: store the workflow's `reason` (the prompt envelope's `reason` field) or first-line of the draft title in `content`. The full draft is already in the canvas + `ContentRevision`; the chat message is a thin marker.
- The workflow's `runId` flows from Mastra's workflow run API; capture it once at workflow start so U4 can stamp it in score metadata.

**Patterns to follow:**

- `apps/admin/prisma/migrations/0014_experience_chat/` — the original chat tables migration; mirror its naming and structure.
- Forward-only migration discipline (`apps/admin/CLAUDE.md` Migrations section): never edit prior migrations; `prisma migrate deploy` only against deployed envs.

**Test scenarios:**

- Happy path: chat service persists an assistant message with `producedBy = "experience-default-chat"` for a default-channel turn.
- Happy path: specialized routes (draft-experience / add-section / rewrite-copy) stamp the matching producer id on the assistant message.
- Happy path: multi-step workflow action persists a row with `producedBy = "multi-step-draft"`, returns `{ ok: true, draft, messageId, runId }`.
- Edge case: workflow failure path (`ok: false`) does NOT persist a chat message — failure must not synthesise a rateable artifact.
- Edge case: historic rows with `produced_by IS NULL` survive the migration and remain readable.

**Verification:**

- `prisma migrate dev` applies cleanly against a fresh DB; `prisma migrate status` shows the new migration as applied.
- `pnpm --filter @forge/admin test src/services/experience-ai/experience-ai-chat.service.test.ts` and `src/app/dashboard/experiences/generate-draft-action.test.ts` pass.
- Manual smoke via the chat panel (`pnpm run:admin-web-mastra`): a chat turn and a "Generate full page" run both produce `experience_chat_message` rows with non-null `produced_by`.

---

### U3. Surface `producedBy` through the chat stream `done` event

**Goal:** The chat panel receives `producedBy` on the `done` event for each assistant turn and on the workflow-action result, so the rating control can be rendered conditionally without an extra fetch per message.

**Requirements:** R1, R6.

**Dependencies:** U2 (column must exist and be populated).

**Files:**

- Modify: `apps/admin/src/mastra/chat-stream-event.ts` (extend `done` to `{ type: "done"; messageId: string; producedBy: string }`)
- Modify: `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts` (mirror type — see the file's rebase note around line 10–18 — and emit `producedBy` on the `done` yield around line ~701)
- Modify: `apps/admin/src/mastra/streaming-bridge.ts` if the bridge re-shapes events
- Modify: `apps/admin/src/app/api/experience-chat/stream/route.ts` only if it strips fields (it shouldn't; the route serialises the full event minus `type`)
- Modify: `apps/admin/src/services/experience-ai/experience-ai-chat-envelope.test.ts` and `apps/admin/src/mastra/streaming-bridge.test.ts` to assert the new field

**Approach:**

- Single additive field on `done`. No new event type; no new SSE frame discriminator.
- The mirror type in `experience-ai-chat.service.ts` already exists for compatibility with the parallel feature branch — keep them in lockstep (the rebase note at the top of `chat-stream-event.ts` covers this exact situation).
- For workflow outputs that don't flow through the chat stream, `generate-draft-action.ts` already returns `producedBy` on its `ok: true` result (added in U2). The panel uses that path.

**Patterns to follow:**

- The existing `done` event shape — extend rather than replace.
- The SSE encoder in `route.ts` (`encodeSseFrame`) — additive, no change needed.

**Test scenarios:**

- Happy path: a default-channel chat turn yields a `done` event with `producedBy: "experience-default-chat"`.
- Happy path: a specialized-route turn yields a `done` event with the matching producer.
- Integration: the SSE wire format (`event: done\ndata: {"messageId":..., "producedBy":...}\n\n`) parses correctly client-side using the existing SSE consumer.

**Verification:**

- `pnpm --filter @forge/admin test src/services/experience-ai src/mastra` passes.
- `pnpm --filter @forge/admin typecheck` passes — confirms the panel-side consumer compiles against the new `done` shape.

---

### U4. `chat-rating.service` — write through Mastra `saveScore`, read latest-per-user

**Goal:** A single service the rating routes call. Owns the ratable-set check, the ABAC check, and the Mastra storage I/O. Implements append-and-latest-wins per origin R3/R10.

**Requirements:** R3, R4, R6, R8, R9, R10.

**Dependencies:** U1 (scorer must be registered), U2 (`producedBy` column).

**Files:**

- Create: `apps/admin/src/services/chat-rating.constants.ts` — exports `RATABLE_PRODUCERS = new Set([...])` and `CHAT_RATING_ENTITY_TYPE = "experience_chat_message"`
- Create: `apps/admin/src/services/chat-rating.service.ts`
- Create: `apps/admin/src/services/chat-rating.service.test.ts`

**Approach:**

- Public API:
  - `submitRating({ messageId, score, comment, principal, prisma, mastra }) → Promise<{ score: 1 | 0 | null; comment: string | null; updatedAt: string }>`
  - `clearRating({ messageId, principal, prisma, mastra })` — implemented as `submitRating` with `score: null` (a "cleared" record in the append history).
  - `listRatingsForThread({ threadId, principal, prisma, mastra }) → Promise<Record<messageId, RatingState | null>>`
- Validation:
  - Load the `ExperienceChatMessage` by id (with its locale/thread). 404 if not found.
  - Verify `producedBy` ∈ `RATABLE_PRODUCERS`. 422 (`not_ratable`) otherwise.
  - Verify the principal can read the message — for v1 this is the existing `canEditExperienceLocale(principal, locale)` check (any editor of the locale can rate). 403 otherwise.
- Write:
  - `mastra.getStorage().getStore('scores').saveScore({ scorerId: CHAT_THUMB_RATING_SCORER_ID, score, entityId: messageId, entityType: CHAT_RATING_ENTITY_TYPE, runId: producerRunId ?? undefined, metadata: { comment, raterUserId: principal.id, producedBy } })`.
- Read (single message): `listScoresByEntityId({ entityId, entityType })`, filter `metadata.raterUserId === principal.id`, sort by `createdAt` desc, take first. `score === null` means cleared.
- Read (thread): fetch all `experience_chat_message` rows for the thread where `producedBy` is in the ratable set; for each, run the single-message read above (in parallel via `Promise.all` — thread sizes are bounded and Mastra storage I/O is cheap).
- Inputs: pass `mastra: ReturnType<typeof getMastra>` and `prisma: PrismaClient` as deps for testability. Service-level tests use an in-memory Mastra storage (Mastra ships one at `storage/domains/scores/inmemory.d.ts`).

**Patterns to follow:**

- `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts` — service-level shape with `(input, deps)` signature and ABAC at the top.
- `apps/admin/CLAUDE.md` "Service-layer rule" — ABAC helper before any mutation; never `process.env` reads in the service.

**Test scenarios:**

- Happy path: `submitRating({ score: 1, comment: "great draft" })` returns the new state; subsequent `listRatingsForThread` includes it.
- Happy path: toggling 👍 → 👎 → cleared yields the cleared state on read (latest wins, score: null).
- Happy path: two different raters on the same message each see only their own latest score.
- Edge case: rating a message with `producedBy = "experience-default-chat"` throws `NotRatableError`.
- Edge case: rating a message with `producedBy IS NULL` (historic row) throws `NotRatableError`.
- Edge case: unknown `messageId` throws `MessageNotFoundError`.
- Edge case: comment of empty string is normalised to `null` so the read shape stays consistent.
- Edge case: comment longer than the cap is rejected with `CommentTooLongError`.
- Error path: principal without `canEditExperienceLocale(...)` on the message's locale throws `ForbiddenError`.
- Integration: a save followed by `listScoresByEntityId(...)` returns the persisted record with the expected metadata (`raterUserId`, `producedBy`, `comment`).
- Integration: `listScoresByScorerId('chat-thumb-rating')` returns every record across many messages — sanity-checks the scorer-level read U7 depends on.

**Verification:**

- `pnpm --filter @forge/admin test src/services/chat-rating.service.test.ts` passes.

---

### U5. REST routes — POST + DELETE rating, GET thread ratings

**Goal:** Two endpoints under the existing `apps/admin/src/app/api/experience-chat/...` namespace that the panel uses to read and write ratings. Match the rate-limit + Better Auth + permission shape used by the chat stream route.

**Requirements:** R1–R5, R10.

**Dependencies:** U4.

**Files:**

- Create: `apps/admin/src/app/api/experience-chat/messages/[messageId]/rating/route.ts` (POST + DELETE)
- Create: `apps/admin/src/app/api/experience-chat/messages/[messageId]/rating/route.test.ts`
- Create: `apps/admin/src/app/api/experience-chat/threads/[threadId]/ratings/route.ts` (GET)
- Create: `apps/admin/src/app/api/experience-chat/threads/[threadId]/ratings/route.test.ts`

**Approach:**

- POST body: `{ score: 0 | 1, comment?: string | null }`. Zod-validated. `score === null` is reserved for the DELETE path.
- DELETE: no body; calls `clearRating(...)`. Returns 200 with the cleared state (so the client doesn't need a second read).
- GET (thread): returns `{ ratings: Record<messageId, RatingState | null> }`. Single round-trip on panel mount.
- Auth: same shape as `apps/admin/src/app/api/experience-chat/stream/route.ts` — rate limit (a small per-route bucket, e.g. `experience-chat-rating` at 60/min for writes, 30/min for reads), `resolvePrincipalFromRequest`, `hasPermission(principal, 'write:experiences')`.
- All service-thrown errors map to clean HTTP: `MessageNotFoundError → 404`, `NotRatableError → 422`, `ForbiddenError → 403`, `CommentTooLongError → 400`, others → 500.

**Patterns to follow:**

- `apps/admin/src/app/api/experience-chat/stream/route.ts` — rate-limit-then-auth-then-permission-then-body order.
- `rateLimitAuthRoute` from `apps/admin/src/auth/rate-limit.ts` — register the new bucket names.

**Test scenarios:**

- Happy path: POST `{ score: 1 }` returns 200 with the new state; GET on the thread reflects it.
- Happy path: POST `{ score: 0, comment: "wrong tone" }` returns 200; GET reflects both score and comment.
- Happy path: DELETE returns 200 with `{ score: null, comment: null }`; GET reflects cleared.
- Edge case: GET for a thread with zero ratable messages returns `{ ratings: {} }`.
- Edge case: GET only includes ratable producers (default-chat turns omitted).
- Error path: POST with invalid body (missing `score`, `score: 2`, comment > cap) returns 400 with Zod issues.
- Error path: POST without auth returns 401.
- Error path: POST without `write:experiences` returns 403.
- Error path: POST against `messageId` not in ratable set returns 422 with `code: "not_ratable"`.
- Error path: POST against unknown `messageId` returns 404.
- Error path: 31st request in the same minute returns 429.

**Verification:**

- `pnpm --filter @forge/admin test src/app/api/experience-chat/messages src/app/api/experience-chat/threads` passes.
- Manual smoke: `curl -X POST .../api/experience-chat/messages/<id>/rating -d '{"score":1}'` against the local stack returns 200 and a Mastra Studio scores view shows the record.

---

### U6. Chat panel UI — rating widget on ratable messages

**Goal:** A `<ChatRating>` component renders 👍/👎 + optional comment field on assistant messages whose `producedBy` is in the ratable set. The control reflects the current user's own rating, is optimistic, and surfaces save failures inline.

**Requirements:** R1–R5.

**Dependencies:** U3 (stream surfaces `producedBy`), U5 (REST endpoints).

**Files:**

- Create: `apps/admin/src/app/dashboard/experiences/experience-editor/chat-rating.tsx`
- Create: `apps/admin/src/app/dashboard/experiences/experience-editor/chat-rating.test.tsx`
- Modify: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx` — wire the component into the assistant-message render branch (around lines 314+ where messages are appended) and fetch the thread's ratings once on mount via GET `/threads/{threadId}/ratings`.

**Approach:**

- Component props: `{ messageId: string; producedBy: string; initial: RatingState | null; onChange?: (state) => void }`.
- Render gate: if `RATABLE_PRODUCERS.has(producedBy)` is false, return null.
- State: local `{ score: 1|0|null; comment: string | null; saving: boolean; error: string | null }`, seeded from `initial`.
- 👍/👎 are toggle buttons; a small "Add a note" affordance opens an inline textarea; submit on blur or explicit "Save".
- Clicking the active thumb again clears the rating (DELETE).
- Save flow: optimistic local update → POST → on failure, revert and show inline error.
- Memory-of-mine semantics: the panel mounts → GET `/ratings` → seeds each `<ChatRating>` via the `initial` prop.

**Patterns to follow:**

- The existing assistant-message rendering branch in `experience-chat-panel.tsx`. Treat the rating widget as a footer rendered after the message body.
- Local optimistic-update + revert pattern already used in the panel's mutation_proposal handling.
- shadcn/ui or whatever the panel already uses for buttons / textareas (verify in the existing component).

**Test scenarios:**

- Happy path: renders 👍 / 👎 buttons for `producedBy = "multi-step-draft"`; both unselected when `initial` is null.
- Happy path: clicking 👍 calls POST with `{ score: 1 }` and shows 👍 active.
- Happy path: clicking 👎 while 👍 is active calls POST with `{ score: 0 }` and flips.
- Happy path: clicking the active thumb calls DELETE.
- Happy path: adding a comment, then submitting, calls POST with both fields.
- Edge case: returns null (no control rendered) for `producedBy = "experience-default-chat"` or `producedBy = null`.
- Edge case: comment longer than the cap shows an inline validation error and is not submitted.
- Error path: POST returns 500 → local state reverts to previous value; inline error visible; panel remains usable.
- Integration: with `producedBy = "multi-step-draft"` and `initial = { score: 1, comment: "great" }`, the widget renders the comment pre-filled and 👍 active.

**Verification:**

- `pnpm --filter @forge/admin test src/app/dashboard/experiences/experience-editor/chat-rating.test.tsx` passes.
- Manual smoke via `pnpm run:admin-web-mastra` against `http://localhost:3003`: rate a "Generate full page" output 👍, refresh the page — control still shows 👍; rate 👎 with a comment, verify Mastra Studio's scores view (or U7's CLI) returns the new record; click 👎 again — control clears.

---

### U7. `chat-ratings:list` CLI — prod-readable scores without Studio

**Goal:** A small admin CLI that queries `listScoresByScorerId('chat-thumb-rating')` and pretty-prints recent ratings. Operates against any `DATABASE_URL` (local or `railway run`). The prod fallback for A2 (Mastra Studio is dev-only).

**Requirements:** R7, R8 (read-side of the same scorer).

**Dependencies:** U1 (scorer registered) + at least one real rating to print, but the CLI works against an empty store too.

**Files:**

- Create: `apps/admin/scripts/list-chat-ratings.ts`
- Modify: `apps/admin/package.json` — add `"chat-ratings:list": "tsx scripts/list-chat-ratings.ts"`
- Optional create: `apps/admin/scripts/list-chat-ratings.test.ts` — only if a focused unit-level test buys us anything beyond the U4 integration test against an in-memory scores store.

**Approach:**

- CLI flags: `--limit <N>` (default 50), `--since <ISO>` (optional), `--user <id>` (optional filter by rater), `--message <id>` (optional filter by message).
- Implementation: `getMastra().getStorage().getStore('scores').listScoresByScorerId({ scorerId: 'chat-thumb-rating', pagination: { offset: 0, limit } })`, then in-memory filter/sort, then print.
- Output: one JSON line per score (so the CLI is pipe-friendly) plus a trailing summary line — same shape as `apps/admin/scripts/run-embeds.ts`.
- Safe to interrupt; idempotent; uses the in-process Prisma singleton like `run-sync` / `run-embeds`.

**Patterns to follow:**

- `apps/admin/scripts/run-embeds.ts` for CLI shape (flag parsing, structured-JSON output, clean shutdown).
- The "Running embeds locally" section in `apps/admin/CLAUDE.md` for the prod-via-`railway run` story.

**Test scenarios:**

- _Optional_ — covered by U4's integration tests. If a CLI-level test is added: print-format snapshot for a fixed in-memory scores list.

**Verification:**

- `pnpm --filter @forge/admin chat-ratings:list --limit 5` against a local stack with at least one rating prints the records and exits 0.
- `railway run pnpm --filter @forge/admin chat-ratings:list --limit 5` against prod (after deploy) prints whatever is there (zero or more) and exits 0.

---

## System-Wide Impact

- **Interaction graph:** The chat panel now reads ratings on mount (one new GET per panel open) and writes ratings on each click (one POST per click). Both endpoints land under the existing `apps/admin/src/app/api/experience-chat/` route tree and share its rate-limit middleware.
- **Error propagation:** Service-level typed errors (`MessageNotFoundError`, `NotRatableError`, `ForbiddenError`, `CommentTooLongError`) → HTTP status codes in U5 → inline panel error in U6. No throw-Error / regex-on-message anywhere; matches `mocked-shape-vs-real-contract-discipline-20260506.md`.
- **State lifecycle risks:** Append-and-latest-wins is race-free for concurrent clicks from the same user (each click is an independent insert; reads always pick MAX(createdAt)). The Mastra storage backend is the same Postgres `mastra` schema the chat memory already uses — no new infrastructure.
- **API surface parity:** The `ChatStreamEvent.done` shape gets one new field. The mirror in `experience-ai-chat.service.ts` (with its rebase note) updates in lockstep. No public GraphQL changes (no `pnpm --filter @forge/graphql generate` needed). No `apps/web` or `apps/mobile` changes.
- **Integration coverage:** U4's tests round-trip a real `saveScore` call against the in-memory scores store, not a mock — closes the gap `mocked-shape-vs-real-contract-discipline-20260506.md` flags.
- **Unchanged invariants:**
  - The existing `done` event still carries `messageId`; no consumer that ignores `producedBy` breaks.
  - `experience-default-chat` turns continue to behave exactly as today; the only difference is `producedBy` is stamped on the row.
  - The `ChatMutationEnvelopeSchema` is untouched — ratings are orthogonal to the mutation envelope.
  - No change to `write:experiences` semantics; no new permission key.

---

## Risks & Dependencies

| Risk                                                                                                                                                      | Mitigation                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mastra/core@1.33.1`'s scores-store surface differs in shape from the docs we read (e.g., `saveScore` payload field names drift between minor versions). | U1 is a verification gate: it round-trips a synthetic `saveScore` + `listScoresByScorerId` against the real instance before any consumer code is written. A surface mismatch surfaces in U1 and stops the rest of the work. |
| Mastra Studio at 1.33.1 doesn't expose the new scorer in its UI.                                                                                          | U7's CLI is the prod read path regardless; Studio is a dev-only convenience. The plan does not block on Studio rendering.                                                                                                   |
| Multi-step workflow output persistence (U2) collides with the panel's existing client-state append (line ~565 in `experience-chat-panel.tsx`).            | U2's action result returns `{ ok: true, draft, messageId, producedBy, runId }`; the panel switches from "synthesise a local assistant message" to "use the persisted messageId". No double-render.                          |
| Append-and-latest-wins creates unbounded growth in the `mastra.scores` table over time.                                                                   | Acceptable for v1 — a single editor's per-click history is small (~10s of rows per active month). A future maintenance job can trim by `(entityId, raterUserId)` keeping the latest N; out of scope here.                   |
| Forward-only Prisma migration (`0017_chat_message_produced_by`) fails to apply at deploy.                                                                 | Standard admin migration recovery runbook in `apps/admin/CLAUDE.md` (P3009/P3018/permission). Migration is purely additive (`ADD COLUMN ... TEXT;` nullable) — lowest-risk shape.                                           |

---

## Documentation / Operational Notes

- `apps/admin/CLAUDE.md` — add a short "Chat thumb-rating (Mastra scorer)" subsection under "Experience AI Chat (Mastra)" pointing at: the `chat-thumb-rating` scorer id, `ExperienceChatMessage.producedBy` column, the REST endpoints, and the `pnpm chat-ratings:list` CLI. Mention that production scores live in Mastra's `mastra.scores` table under the `mastra` schema.
- `docs/roadmap/` — no roadmap ticket exists for this; if the team wants tracking, create one in `docs/roadmap/platform/` after this plan is approved (out of scope of plan execution).
- Operational rollout: no feature flag, no env var change, no Doppler update. Migration applies on the next deploy via the chained `startCommand`; the panel renders the rating control as soon as `producedBy` is populated.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-25-ai-chat-thumb-rating-mastra-scorer-requirements.md`
- Related code: `apps/admin/src/mastra/index.ts`, `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`, `apps/admin/src/mastra/chat-stream-event.ts`, `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`, `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts`, `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts`
- Related migrations: `apps/admin/prisma/migrations/0014_experience_chat/`, `apps/admin/prisma/migrations/0016_mastra_schema/`
- External docs: `@mastra/core@1.33.1` storage scores domain (`node_modules/.pnpm/@mastra+core@1.33.1.../@mastra/core/dist/storage/domains/scores/`); upstream Mastra docs on `listScoresBy*` and `createScorer` cross-checked via Context7.
- Related learnings: `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
