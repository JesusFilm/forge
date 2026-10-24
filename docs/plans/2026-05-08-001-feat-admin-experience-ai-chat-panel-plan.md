---
title: "feat: Admin Experience Editor AI Chat Side Panel"
type: feat
status: active
date: 2026-05-08
origin: docs/brainstorms/2026-05-08-admin-experience-ai-chat-panel-requirements.md
---

# feat: Admin Experience Editor AI Chat Side Panel

## Summary

Replace the one-shot AI Draft form in the experience editor with a persistent left-rail chat panel that streams Codex output token-by-token, mutates the experience-locale's editable surface in place under per-turn undo, and persists conversational threads to two new tables. Every chat-driven write funnels through the existing `services.experience.updateLocale` so revision history, ABAC, and Zod block validation kick in automatically. For empty-canvas create/generate prompts, the chat service may route internally through the structured draft-generation path, but AI Chat remains the only visible generation surface.

---

## Problem Frame

The existing `AiDraftPanel` is a one-shot form: type a prompt, get six blocks back, accept or discard the whole draft. Editors cannot iterate ("make the hero punchier"), discover ("what videos do we have for grieving teens?"), or surgically edit ("rewrite block 3"). The 30s Codex latency is also rendered as an empty pending state with no incremental feedback. See origin: [docs/brainstorms/2026-05-08-admin-experience-ai-chat-panel-requirements.md](../brainstorms/2026-05-08-admin-experience-ai-chat-panel-requirements.md).

---

## Requirements

- R1. Chat surface supports iterative refinement, conversational discovery, and surgical edits in a single conversational thread (origin R1.1, R1.2, R1.3).
- R2. AI directly mutates `title`, `metaDescription`, `blocks`, and `ogImage` on the active experience-locale; `slug` is FORBIDDEN; cross-locale changes require explicit user confirmation (origin R2.1, R2.2, R2.3).
- R3. Chat panel is a persistent left rail in a 3-column editor layout (sidebar nav | chat panel | canvas) (origin R3.1, R3.2; layout side revised from origin R3 during synthesis).
- R4. Per-turn undo: each AI turn captures a diff-based snapshot of the editable surface; "Undo this change" on any past message walks the document state back to the end of the prior turn (origin R4.1–R4.4).
- R5. Persistence via two new Postgres tables (`experience_chat_thread` + `experience_chat_message`) FK-cascading from `ExperienceLocale`; multiple threads per experience-locale; no retention TTL in v1 (origin R5.1–R5.4).
- R6. Codex stdout token streaming via SSE; "Stop generating" cancels the in-flight subprocess; outbound timeout strictly under route handler ceiling (origin R6.1–R6.4).
- R7. Suggested prompts rendered in empty/idle state, computed from current canvas state and locale (origin R7.1–R7.4).
- R8. Empty-canvas first-draft generation happens inside AI Chat, not a separate AI Draft panel. Draft-generation responses show a full editable preview and apply only after explicit user confirmation. Published watch preview must render chat-generated `videoId` media blocks by resolving referenced-video streams on the web side.

**Origin actors:** A1 (editor — uses the chat panel)
**Origin flows:** F1 (compose draft → iterate → save), F2 (refine existing draft → save), F3 (cross-locale translate with confirmation)
**Origin acceptance examples:** AE1 (multi-turn refinement preserves earlier blocks), AE2 (slug-change request is rejected), AE3 (cross-locale request shows confirmation modal), AE4 (Undo restores prior-turn state), AE5 (closing+reopening preserves thread)

---

## Scope Boundaries

- Mobile / narrow-viewport chat layout — desktop only.
- Multi-user concurrent editing of the same chat thread; thread sharing across users.
- Voice input.
- Cross-experience operations — chat scope is the current experience-locale only.
- AI-driven publishing — drafts only; only humans click Publish.
- 60-day retention TTL on chat threads.
- Removing the existing one-shot `AiDraftPanel` from the visible editor UI is in scope. The old structured generation backend may remain as an internal quality path for empty-canvas first drafts, but users should not see a second AI generation panel.

### Deferred to Follow-Up Work

- Recent-activity-aware suggested prompts (origin R7.4 stretch goal): static-by-state prompts ship in v1; recency-aware suggestions land later.
- Manual rename of chat thread title: auto-summarize first prompt for v1; manual rename is a follow-up.
- Chat for `apps/manager`, `apps/web`, `apps/mobile`: scope is `apps/admin` only.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/app/dashboard/experiences/experience-editor/ai-draft-panel.tsx` — the one-shot panel; visual idiom (border tokens, `Sparkles` icon, mono uppercase 11px labels) carries over to the chat shell.
- `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts` — server action shape with discriminated union return; chat needs a streaming variant that emits multiple events instead of one fulfillment.
- `apps/admin/src/services/experience-ai/experience-ai.service.ts` — `createStructuredDraftWithCodex` + `parseProviderDraftContent` + `buildCodexPrompt`. The chat-streaming variant forks the spawn pattern with a line-buffered stdout reader.
- `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — ~10,400-line client component. Editor canvas state lives here; chat panel must NOT add to that file's `useState` block — separate child component receives a small mutation API as props.
- `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` — server component that wraps `<ExperienceEditor>`; the 3-column flex/grid split lands here.
- `apps/admin/src/auth/permissions.ts::canEditExperienceLocale` — already gates `runGenerateDraftAction`; chat mutation handler must call this on every turn.
- `apps/admin/prisma/schema.prisma::ExperienceLocale` (lines 1218–1280) — FK target for both new tables.
- `apps/admin/prisma/schema.prisma::ContentRevision` (lines 389–409) — `RevisedByKind.AI` enum value already exists; chat writes funnel through `services.experience.updateLocale`, which auto-creates revisions.
- `apps/admin/prisma/migrations/0011_media_image_enrichment/migration.sql` — best parent/child template (ENUM + FK CASCADE + indexes).
- `apps/admin/prisma/migrations/0009_workflow_run_ledger/migration.sql` — two-table parent/child cascade template.
- `apps/admin/src/auth/rate-limit.ts::rateLimitAuthRoute` — Redis-backed limiter; chat route adds a new `chat` bucket.
- `apps/admin/src/services/errors.ts::{ForbiddenError, NotFoundError}` — typed error classes.

### Institutional Learnings

- Outbound timeout shorter than caller budget — `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`. Codex spawn already does `setTimeout` + `SIGTERM`; the streaming variant must keep this and add an idle-token timeout to detect mid-stream hangs.
- Mocked-vs-real testing discipline — `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`. Every typed-discriminator branch in the SSE event union must be exercised by a test where ONLY that branch can match; mocks alone are insufficient for the streaming layer.
- ENUM storage form — admin's Prisma enums map TS upper-case → snake_case lowercase ('user' | 'assistant' | 'system'). Raw SQL uses lowercase literals.
- ContentRevision contract (`apps/admin/CLAUDE.md`) — every service-driven UPDATE on covered entities creates/updates a revision in the same `$transaction`, with `embedding` stripped from snapshot data. Chat mutations inherit this for free if they go through the service.

### External References

- Next.js 16 streaming response shape via `ReadableStream` + `text/event-stream` content type — admin currently has no internal SSE precedent; route handler implementation follows standard Next.js App Router conventions.
- RFC 6902 (JSON Patch) — used for the `blocks` array diff portion of the hybrid snapshot format. Scalars use a simpler `{before, after}` shape because pure 6902 is fragile for top-level scalar replacement.

---

## Key Technical Decisions

- **Funnel chat mutations through `services.experience.updateLocale`**: rationale — gets ABAC, Zod block validation, and ContentRevision DRAFT writes for free. The `chat_message.snapshot_diff` column is a redundant in-thread undo log layered ON TOP, not a replacement for ContentRevision. Avoids dual audit-log paths.
- **Streaming via Route Handler + `ReadableStream` SSE**: rationale — admin's first streaming surface; route handlers fit the existing `route.ts` convention (`/api/search`, `/api/scene-embedding`). Server Actions are awkward for incremental token rendering on the client; SSE + `EventSource` (or `fetch` + reader) is the conventional shape.
- **Fork experience-ai service for streaming** (new `experience-ai-chat.service.ts`): rationale — preserves the existing one-shot path's regression surface at zero. Legacy panel stays bit-identical.
- **Hybrid diff format**: RFC 6902 patches for `blocks` (array), `{before, after}` per-field for `title`/`metaDescription`/`ogImage` (scalars). Rationale — pure 6902 is awkward for whole-scalar replacement; hybrid is concise and maps cleanly to the editable surface.
- **Single shared draft state across threads on the same locale**: rationale — `ContentRevision` enforces a partial unique "one DRAFT per `(entity_type, entity_id)`" via `content_revision_one_draft_per_entity`. Threads as conversational scoping (not isolated drafts) sidesteps that collision. All threads contribute to the same canonical DRAFT revision; per-thread snapshot diffs let users walk back across threads if needed.
- **Auto-summarize first prompt for thread title**: rationale — minimal friction to start a conversation; manual rename is a follow-up.
- **Cross-locale confirmation modal lives client-side**: server applies the cross-locale change only when the request payload includes an explicit `confirmedAcrossLocales: true`. Rationale — simpler to back-pressure the user than to gate via a multi-step server flow.
- **Per-day chat rate limit via existing Redis bucket**: separate `chat` bucket from `auth`/`search`/`recommendations` so chat traffic does not starve other quotas.
- **Audit trail = existing ContentRevision rows** with `revisedByKind: AI` and `reason: <chat turn intent>`. No parallel AI-write audit log.
- **Side-panel layout: 3-column flex** (sidebar nav | chat panel | canvas). Wider canvas remains the focus; chat width is fixed (~360–420px) and cannot be resized in v1.
- **Hybrid first-draft routing stays behind AI Chat**: empty-canvas create/build/generate prompts can use the legacy structured draft-generation path internally for quality, but the user receives the result as an AI Chat draft proposal. This keeps one user-facing generation surface while preserving the stronger first-draft backend.
- **Public watch preview compatibility is part of chat-generated draft acceptance**: generated media blocks may store only `videoId`; `apps/web` must hydrate referenced-video dubs/streams and the `Video`/`VideoHero` renderers must fall back to `videoMap[videoId].streamingUrl`.

---

## Open Questions

### Resolved During Planning

- OQ1 (wire format): SSE via Route Handler + `ReadableStream` (resolved per Key Technical Decisions).
- OQ2 (service reuse): fork `experience-ai-chat.service.ts`; preserve the structured draft-generation path as an internal empty-canvas quality route.
- OQ3 (diff format): hybrid RFC 6902 (blocks) + `{before, after}` (scalars).
- OQ6 (audit trail): reuse `ContentRevision` with `revisedByKind: AI`; no double-write.
- OQ8 (ABAC gate): every chat mutation calls `canEditExperienceLocale` server-side via the service layer.

### Deferred to Implementation

- OQ4 (thread title generation): auto-summarize approach (truncate to N words from first prompt vs. dedicated LLM summarization call vs. first sentence) — pick the cheapest acceptable shape during U1/U4 implementation.
- OQ5 (token budget per session): exact context window cap (last 20 turns? cumulative-char ceiling? both?) — measure during U2 implementation against real Codex token usage; pick a number that keeps p95 prompts under Codex's effective input cap.
- OQ7 (failure-mode UX details): exact terminal-state copy and recovery affordances — refine during U8 once SSE error events are exercised end-to-end.
- Side panel exact width — finalize during U4 design pass; constrained to 360–420px range.

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

### Streaming flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as ChatPanel (client)
    participant Route as /api/experience-chat/stream (route handler)
    participant Service as experience-ai-chat.service
    participant Codex as codex exec subprocess
    participant ServiceLocale as services.experience.updateLocale
    participant DB as Postgres (forge_admin)

    Client->>Route: POST { threadId, prompt, confirmedAcrossLocales? }
    Route->>Route: rateLimitAuthRoute("chat") + canEditExperienceLocale
    Route->>Service: streamChatTurn({ thread, prompt, candidates })
    Service->>DB: insert chat_message(role=user)
    Service->>Codex: spawn + write prompt to stdin
    Codex-->>Service: stdout line ("token text...")
    Service-->>Route: emit { type: "token_delta", text }
    Route-->>Client: SSE: data: { type: "token_delta", ... }
    Note over Codex: continues streaming until terminal JSON envelope
    Codex-->>Service: terminal envelope { mutations: { ... } }
    Service->>Service: validate + compute diff vs current locale
    Service->>ServiceLocale: updateLocale({ ...mutations })
    ServiceLocale->>DB: $transaction { update locale; insert ContentRevision (AI) }
    Service->>DB: insert chat_message(role=assistant, snapshot_diff)
    Service-->>Route: emit { type: "mutation_applied", diff }
    Route-->>Client: SSE: data: { type: "mutation_applied", ... }
    Service-->>Route: emit { type: "done", messageId }
    Route-->>Client: SSE: data: { type: "done", ... }
```

### Layout shape

```
┌────────────┬──────────────────┬───────────────────────────┐
│ Sidebar    │ Chat panel       │ Experience canvas         │
│ nav        │ (left rail, new) │ (existing block list)     │
│ Dashboard  │ ┌──────────────┐ │  ┌──────────────────────┐ │
│ Experiences│ │ Thread list  │ │  │ Title / meta / blocks│ │
│ Videos     │ │ + new thread │ │  │ ...                  │ │
│ ...        │ ├──────────────┤ │  └──────────────────────┘ │
│            │ │ Messages     │ │                            │
│            │ │ + Undo btns  │ │                            │
│            │ ├──────────────┤ │                            │
│            │ │ Suggested    │ │                            │
│            │ │ Prompts      │ │                            │
│            │ ├──────────────┤ │                            │
│            │ │ Input + Send │ │                            │
│            │ └──────────────┘ │                            │
└────────────┴──────────────────┴───────────────────────────┘
```

### Hybrid diff envelope (per chat_message)

```
{
  scalars: {
    title?:           { before: "Old", after: "New" },
    metaDescription?: { before: "...", after: "..." },
    ogImageUrl?:      { before: null,  after: "https://..." }
  },
  blocks: [ /* RFC 6902 patch operations */ ]
}
```

---

## Implementation Units

### U1. Schema + migration for chat tables

**Goal:** Land `experience_chat_thread` + `experience_chat_message` tables with FK-cascade to `experience_locale`, the role enum, and Prisma model wiring so subsequent units can write to them.

**Requirements:** R5

**Dependencies:** None

**Files:**

- Create: `apps/admin/prisma/migrations/0014_experience_chat/migration.sql`
- Modify: `apps/admin/prisma/schema.prisma` (add `ExperienceChatThread`, `ExperienceChatMessage`, `ExperienceChatMessageRole` enum)

**Approach:**

- Migration follows `0011_media_image_enrichment` shape: `CREATE TYPE` for the role enum first, then parent table (`experience_chat_thread`), then child table (`experience_chat_message`), then indexes, then FK constraints as separate `ALTER TABLE` statements.
- `experience_chat_thread` columns: `id` text PK, `experience_locale_id` text NOT NULL, `title` text NOT NULL, `created_by_user_id` text NOT NULL, `created_at` / `updated_at` / `last_message_at` timestamptz, `archived_at` timestamptz NULL.
- `experience_chat_message` columns: `id` text PK, `thread_id` text NOT NULL, `role` ExperienceChatMessageRole, `content` text, `provider_kind` text NULL, `prompt_tokens` int4 NULL, `completion_tokens` int4 NULL, `snapshot_diff` jsonb NULL, `mutations_applied` jsonb NULL, `created_at` timestamptz.
- Indexes: `(experience_locale_id, last_message_at DESC)` on threads; `(thread_id, created_at ASC)` on messages.
- Both FKs: `ON DELETE CASCADE ON UPDATE CASCADE`.
- Prisma models use `@map` for snake_case mapping; `snapshot_diff` and `mutations_applied` typed as `Json?`.

**Patterns to follow:**

- `apps/admin/prisma/migrations/0011_media_image_enrichment/migration.sql` (ENUM + parent/child CASCADE)
- `apps/admin/prisma/migrations/0009_workflow_run_ledger/migration.sql` (two-table cascade)

**Test scenarios:**

- Happy path: `prisma migrate deploy` against a fresh `forge_admin` DB applies cleanly; subsequent `\d experience_chat_thread` and `\d experience_chat_message` show the expected columns + FKs.
- Edge case: deleting an `experience_locale` row cascades — both `experience_chat_thread` and `experience_chat_message` rows for that locale are removed.
- Edge case: orphan-prevention — inserting an `experience_chat_message` with a non-existent `thread_id` is rejected by the FK.

**Verification:**

- Migration committed, `pnpm --filter @forge/admin db:migrate:dev` succeeds, `prisma generate` produces the new model types.

---

### U2. Chat-streaming service + SSE route handler

**Goal:** Server-side streaming pipeline. Spawn Codex with the chat-style prompt + retrieved candidates, line-buffer stdout, emit typed SSE events, and persist the assistant message + apply mutations on the terminal envelope.

**Requirements:** R1, R2 (server enforcement), R6

**Dependencies:** U1

**Files:**

- Create: `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
- Create: `apps/admin/src/services/experience-ai/experience-ai-chat.service.test.ts`
- Create: `apps/admin/src/app/api/experience-chat/stream/route.ts`
- Create: `apps/admin/src/app/api/experience-chat/stream/route.test.ts`
- Modify: `apps/admin/src/services/experience-ai/experience-ai-prompts.ts` (add chat-mode system prompt variant — or new sibling `experience-ai-chat-prompts.ts`)

**Approach:**

- Service exports `streamChatTurn({ threadId, prompt, deps })` returning an async iterable of typed events: `token_delta` | `mutation_proposal` | `mutation_applied` | `error` | `done`.
- Codex spawn shape mirrors the one-shot path; key change: replace string accumulator with `readline.createInterface({ input: proc.stdout })` to emit per-line deltas. Maintain a tail buffer that detects the terminal JSON envelope sentinel.
- On terminal envelope: validate against a Zod schema (extension of the existing `DraftExperienceSchema` shape, restricted to the editable surface — slug fields excluded by construction).
- After validation, call `services.experience.updateLocale` inside a Prisma `$transaction`. The service's existing ContentRevision logic creates the AI-attributed revision row.
- After successful mutation: insert `experience_chat_message` row with `role: 'assistant'`, `snapshot_diff` (computed via U3's `computeDiff`), `mutations_applied` (the validated envelope), `provider_kind: 'codex'`.
- Emit `mutation_applied` and `done` events.
- Route handler returns `new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' } })`.
- Rate limit via `rateLimitAuthRoute({ route: 'chat', limit: 30, windowMs: 60_000 })` (30/min/user).
- Outbound timeout: per-turn `Promise.race` with a typed `ChatTurnTimeoutError` (45s budget, strictly under any reasonable upstream caller). Per-token idle timeout (10s) emits `error` with code `codex_idle_timeout`.
- Stop generating: route handler reads `AbortSignal` from the request; on abort, send `SIGTERM` to the spawned Codex process; emit `error` with code `cancelled`; close the stream.

**Execution note:** Start with a failing integration test that spawns a fake `codex` script (writes deterministic line-by-line output then a final JSON envelope) and asserts the SSE stream contains the expected event sequence.

**Patterns to follow:**

- `apps/admin/src/services/experience-ai/experience-ai.service.ts::createStructuredDraftWithCodex` (spawn pattern, prompt shape).
- `apps/admin/src/services/embeddings.service.ts` (provider-resolver pattern).
- `apps/admin/src/app/api/search/route.ts` (route-handler shape with rate limit).

**Test scenarios:**

- Happy path: deterministic stub Codex script emits "Hello" "world" tokens then `{...envelope...}`; service emits `token_delta("Hello")`, `token_delta("world")`, `mutation_applied(diff)`, `done(messageId)`. The corresponding chat_message row exists with role='assistant'.
- Happy path: terminal envelope's mutations are applied — running `prisma.experienceLocale.findUnique` after the stream returns shows the `title` / `metaDescription` / `blocks` / `ogImage` fields updated.
- Edge case: empty stdin from Codex (no tokens, immediate close) emits `error(code: 'empty_response')` and no `done`.
- Edge case: terminal envelope is invalid JSON — emits `error(code: 'invalid_json')`; no DB write.
- Edge case: terminal envelope schema mismatch (e.g., includes `slug`) — emits `error(code: 'schema_violation')`; no DB write.
- Error path: Codex exits non-zero before envelope — emits `error(code: 'upstream_failure')`; no DB write.
- Error path: per-turn timeout exceeded — Codex receives `SIGTERM`; emits `error(code: 'codex_timeout')`.
- Error path: per-token idle timeout — emits `error(code: 'codex_idle_timeout')`.
- Error path: client aborts (`AbortSignal`) — Codex receives `SIGTERM`; emits `error(code: 'cancelled')`.
- Error path: `canEditExperienceLocale` returns false — route returns 403 before spawning Codex.
- Error path: rate limit exceeded — returns 429 without spawning Codex.
- Integration: full round trip from route handler `POST` through service through `services.experience.updateLocale` writes both a `ContentRevision` row (`revisedByKind: AI`) AND an `experience_chat_message` row with the matching diff payload.
- Integration: cross-locale envelope without `confirmedAcrossLocales: true` is rejected by the service before the service-locale write.

**Verification:**

- Full route handler test passes; `experience_chat_message` row contains the diff; `ContentRevision` row exists with `revisedByKind: AI`; SSE event sequence is asserted by a real-shape (not regex-only) parser in tests.

---

### U3. Diff/apply/revert utility module

**Goal:** Pure-function module computing hybrid diffs (RFC 6902 for blocks, `{before, after}` for scalars), applying them, and reverting them. No DB dependency. Reused by U2 (compute diff after mutation) and U4 (Undo this turn).

**Requirements:** R4

**Dependencies:** None

**Files:**

- Create: `apps/admin/src/services/experience-ai/experience-chat-diff.ts`
- Create: `apps/admin/src/services/experience-ai/experience-chat-diff.test.ts`

**Approach:**

- Three exports: `computeDiff(before, after)`, `applyDiff(state, diff)`, `revertDiff(state, diff)`. All work on a typed `EditableLocaleState` = `{ title, metaDescription, blocks, ogImageUrl }`.
- `blocks` arm uses an existing JSON Patch library (`fast-json-patch` or `rfc6902` — pick whichever is already a transitive dep, otherwise add the lighter one). Generate compare patches between block arrays; apply / revert is library-built-in.
- Scalars arm produces / consumes `{before, after}` envelopes with strict equality check on `before` during revert — a concurrent edit between turn N and the user's Undo-N click would fail loudly rather than silently overwriting newer state.
- Strip rule: function asserts that the input `EditableLocaleState` does NOT include `embedding` or any other derived/internal field. Throws `InvariantError` if it does (defensive — the service layer is supposed to have already stripped these).

**Execution note:** Test-first — write the property test ("for any sequence of states, applyDiff(s*n, computeDiff(s_n, s*{n+1})) === s\_{n+1}") before implementing.

**Patterns to follow:**

- Pure-utility-module shape used by `apps/admin/src/services/hybrid-search-fusion.ts`, `apps/admin/src/services/video-dedup.ts` — pure functions, comprehensive unit tests, no DB.

**Test scenarios:**

- Happy path (round-trip): `applyDiff(before, computeDiff(before, after))` deep-equals `after` for any pair of states.
- Happy path (revert): `revertDiff(after, computeDiff(before, after))` deep-equals `before`.
- Edge case (block insertion in middle): correct RFC 6902 patch sequence; round-trips.
- Edge case (block deletion at index 0): correct patch sequence; round-trips.
- Edge case (block reorder): correct patch sequence; round-trips.
- Edge case (deeply nested block content change): correct patch sequence; round-trips.
- Edge case (scalar set null → string and string → null): `{before, after}` envelope captures both.
- Edge case (no change): `computeDiff(s, s)` returns an empty diff; `applyDiff(s, emptyDiff) === s`.
- Error path (revert with stale before): scalar arm throws `RevertConflictError` when `state.title !== diff.scalars.title.after` (current state has drifted from where Undo expected to start).
- Error path (`embedding` field present): `computeDiff` throws `InvariantError`.

**Verification:**

- Unit tests pass; the property-test cap covers ≥100 random state pairs without assertion failure.

---

### U4. Chat panel UI shell + integration into the editor

**Goal:** New `ExperienceChatPanel` client component that owns thread state, renders the message list + input + Stop + thread switcher + Undo affordances + cross-locale confirmation modal. Wire into the experience-editor's outer layout as the left rail in a 3-column flex.

**Requirements:** R1, R2.3, R3, R4

**Dependencies:** U2 (consumes the SSE stream), U3 (renders Undo by calling `revertDiff` against the chat_message diff)

**Files:**

- Create: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
- Create: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`
- Create: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-cross-locale-modal.tsx`
- Modify: `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` (export a small mutation API for the chat panel; add a `chatPanelOpen` toggle prop)
- Modify: `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` (3-column flex/grid layout: existing `<AdminShell>` provides sidebar nav; chat panel renders left of `<ExperienceEditor>`; canvas on the right)
- Create: GraphQL queries/mutations for thread list / new thread / fetch messages — added to `apps/admin/src/graphql/queries/` and `apps/admin/src/graphql/mutations/` per the admin's existing per-file convention. Side-effect imports added to `apps/admin/src/graphql/schema.ts`.

**Approach:**

- Panel manages its own state (thread list, active thread, message list, input draft, in-flight stream state, cross-locale modal state). Receives a small mutation API from the parent editor: `applyMutationToCanvas(diff)` and `revertMutationFromCanvas(diff)` — these update the editor's canvas state via U3's `applyDiff` / `revertDiff`.
- Stream consumer: `fetch('/api/experience-chat/stream', { method: 'POST', signal })` returns a `ReadableStream` body; client uses `getReader()` + decoder to parse SSE events.
- Per `mutation_applied` event: panel calls `applyMutationToCanvas(diff)` so the user sees blocks update live.
- Per `done` event: panel persists the assistant message in local state; "Undo this change" button on each message calls `revertMutationFromCanvas(diff)` from U3.
- "Stop generating": calls `controller.abort()` on the request signal.
- Cross-locale modal: client shows it before submitting any prompt that the user has marked as "apply across locales"; on confirm, the request payload includes `confirmedAcrossLocales: true`; default is false.
- Thread switcher: vertical list of threads ordered by `last_message_at DESC`; "Start new conversation" button; auto-summarize first prompt for the new thread title (truncate to 6 words for v1).
- Visual idiom mirrors `AiDraftPanel`: `Sparkles` icon, mono uppercase label `[11px]`, brand-color border tokens.

**Patterns to follow:**

- `apps/admin/src/app/dashboard/experiences/experience-editor/ai-draft-panel.tsx` (visual idiom, prop-only client component shape).
- `apps/admin/src/app/dashboard/embeddings/embeddings-client.tsx` (client-managed state with server actions).

**Test scenarios:**

- Happy path: user types prompt, hits Send, mock SSE stream emits `token_delta` × N then `mutation_applied(diff)` then `done` — panel renders streamed text into the bubble, calls `applyMutationToCanvas(diff)`, then renders the assistant message with an Undo button.
- Happy path: clicking Undo calls `revertMutationFromCanvas(diff)` and visually marks the message as reverted.
- Happy path: thread list shows multiple threads; clicking a thread loads its messages; "Start new conversation" creates a new thread row.
- Edge case: "Stop generating" mid-stream aborts the fetch and renders a "stopped" terminal state on the in-flight bubble.
- Edge case: cross-locale prompt triggers the modal; canceling the modal does NOT submit the request.
- Edge case: page reload preserves thread list and message history (verifies the GraphQL query reads from the new tables).
- Error path: SSE stream emits `error(code: 'codex_timeout')` — panel renders a typed terminal "stream timed out" state on the in-flight bubble.
- Error path: SSE stream emits `error(code: 'forbidden')` — panel renders "you don't have permission to edit this experience" inline.
- Integration: chat-driven mutation flows through `services.experience.updateLocale` → ContentRevision DRAFT row exists after the assistant turn (assert against a real Postgres in the wired-up integration test).
- Integration: closing+reopening the experience editor preserves thread state by re-querying the new tables (Covers AE5).

**Verification:**

- Component renders correctly across the empty, in-flight, error, and populated states. Wired into the editor route. Tests pass.

---

### U5. Context-aware suggested prompts

**Goal:** Empty/idle-state suggested prompts list. 4–6 items per state-locale combination. Static-by-state for v1 (recent-activity-aware deferred per Scope Boundaries).

**Requirements:** R7.1, R7.2, R7.3

**Dependencies:** U4

**Files:**

- Create: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-suggested-prompts.ts`
- Create: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-suggested-prompts.test.ts`
- Modify: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx` (consume the helper)

**Approach:**

- Module exports `getSuggestedPrompts({ canvasState: 'empty' | 'populated', locale }): readonly string[]`.
- Static maps per locale: `en`, `es`, `fr` initial set; fall back to `en` if the locale has no list.
- Empty-state prompts focus on creation; populated-state prompts focus on refinement and surgical edits.
- Panel renders prompts as click-to-insert chips above the input; clicking a chip puts the text in the input box (does not auto-send).

**Patterns to follow:**

- `apps/admin/src/i18n/server.ts` — locale-keyed static config pattern.

**Test scenarios:**

- Happy path (empty): `getSuggestedPrompts({ canvasState: 'empty', locale: 'en' })` returns 4–6 creation-focused prompts.
- Happy path (populated): `getSuggestedPrompts({ canvasState: 'populated', locale: 'en' })` returns 4–6 refinement-focused prompts (different from empty list).
- Edge case (locale fallback): `getSuggestedPrompts({ canvasState: 'empty', locale: 'unknown-bcp47' })` falls back to `en` list.
- Edge case (locale parity): `es` and `fr` lists exist with parity to `en` (same number of items, semantically aligned).

**Verification:**

- Unit tests pass; chips render in the chat panel's empty state in the locale-driven language.

---

### U6+U7. Authority guards + ABAC at every mutation

**Goal:** Server-side rejection of slug changes; cross-locale changes require explicit `confirmedAcrossLocales: true` in the request payload; `canEditExperienceLocale` is called before every chat write (not just session start). Codex prompt is primed to never propose slug changes.

**Requirements:** R2.1, R2.2, R2.3

**Dependencies:** U2

**Files:**

- Modify: `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts` (server-side validation: reject envelopes mentioning `slug`; reject cross-locale mutations without confirmation flag; ABAC call at the top of `streamChatTurn`)
- Modify: `apps/admin/src/services/experience-ai/experience-ai-prompts.ts` (or chat-prompts file from U2) — system prompt instruction: "You MUST NEVER propose changes to slug. The slug is owned by the editor and immutable from chat."

**Approach:**

- Service-side validation runs against the terminal envelope before any DB write. If the envelope includes a `slug` field, emit `error(code: 'slug_change_rejected')` and do not write.
- Cross-locale validation: if envelope includes `localesAffected: string[]` containing any locale other than the active one AND the request did not include `confirmedAcrossLocales: true`, emit `error(code: 'cross_locale_unconfirmed')` and do not write.
- ABAC: every `streamChatTurn` call begins with `canEditExperienceLocale(deps.user, locale)`; throws `ForbiddenError` if false. Surfaces as `error(code: 'forbidden')` to the client.
- System prompt: explicit instruction that slug is immutable; restate in the user-message-prefix on every turn (defensive — system-prompt-only instruction occasionally drifts after long conversations).

**Patterns to follow:**

- `apps/admin/src/auth/permissions.ts::canEditExperienceLocale` and how `runGenerateDraftAction` already calls it.

**Test scenarios:**

- Edge case: terminal envelope contains `slug: "new-slug"` — service emits `error(code: 'slug_change_rejected')`; no DB write; assertion via mocked Codex stub.
- Edge case: terminal envelope contains `localesAffected: ['en', 'es']` with active locale `en` and no `confirmedAcrossLocales` — service emits `error(code: 'cross_locale_unconfirmed')`; no DB write.
- Edge case: same envelope with `confirmedAcrossLocales: true` — service applies the cross-locale change.
- Error path: `canEditExperienceLocale` returns false (e.g., locale's experience is archived) — service emits `error(code: 'forbidden')`; no Codex spawn.
- Integration: a Codex stub script that emits a slug-change envelope is caught at the validation layer and never reaches `services.experience.updateLocale` (Covers AE2).

**Verification:**

- All four guards exercised by tests; service emits typed errors and bypasses any state mutation in each rejection path.

---

### U8. Failure modes + error UI

**Goal:** Typed error code union for SSE error events; client renders typed terminal states per code; final polish on the error path so the user always knows what happened and what to do next.

**Requirements:** R6.4 + general failure-mode coverage

**Dependencies:** U2, U4

**Files:**

- Create: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-errors.ts` (typed error code → user-facing message map)
- Modify: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx` (render typed terminal states per error code)
- Modify: `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts` (every internal failure path maps to one of the typed codes; no untyped `error.message` strings reach the client)

**Approach:**

- Closed union: `'codex_unavailable' | 'codex_timeout' | 'codex_idle_timeout' | 'invalid_json' | 'schema_violation' | 'slug_change_rejected' | 'cross_locale_unconfirmed' | 'rate_limited' | 'forbidden' | 'locale_not_found' | 'cancelled' | 'empty_response' | 'unknown'`.
- Client error map: each code maps to a short user-facing message + optional recovery affordance (e.g., 'rate_limited' → "Slow down — try again in a minute"; 'codex_unavailable' → "AI is unreachable; the operator on call has been notified" — same friendly shape as the existing `runGenerateDraftAction` USER_MESSAGES map).
- Stop generating shows the same terminal-state shape with `cancelled` code.

**Patterns to follow:**

- `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts::USER_MESSAGES` (typed-error-to-user-message pattern).

**Test scenarios:**

- Happy path: every error code in the union has a registered user-facing message.
- Error path: client receiving an unknown code renders the `unknown` fallback message rather than crashing.
- Integration: each error code can be triggered end-to-end by a corresponding stub (e.g., timeout test forces `codex_timeout`; the route handler returns the right SSE event; the panel renders the right typed message).

**Verification:**

- Each code in the union has a test; client error rendering covers all codes; no untyped error message string leaks past the service layer.

---

## System-Wide Impact

- **Interaction graph:** every chat-driven mutation flows through `services.experience.updateLocale` → Prisma `$transaction` → ContentRevision DRAFT row creation (`revisedByKind: AI`) + `experience_locale` update + `experience_chat_message` insert. Subscribers to `ContentRevision` (revision history view, future audit log consumers) start receiving AI-attributed rows.
- **Error propagation:** SSE error events carry typed codes; the route handler does not throw — it always returns a stream that ends with either `done` or `error`. The legacy `runGenerateDraftAction` path is unchanged.
- **State lifecycle risks:** if the service starts a Codex spawn and then crashes before sending any events, the client `EventSource` / fetch reader hangs until the per-token idle timeout. The panel must surface that as a typed terminal state. No DB row leaks — the assistant message row is only written after the terminal envelope is validated.
- **API surface parity:** `apps/mobile` is unaffected. `apps/web` participates only at the published-preview boundary: chat-generated `videoId` media blocks must render after publish by using the normalized referenced-video stream map.
- **Integration coverage:** real-Postgres tests for U2 (verifies ContentRevision creation) and U4 (verifies thread persistence). Mocked-SSE tests for the streaming layer (per CLAUDE.md mocked-vs-real discipline, every typed code branch is exercised by a test where ONLY that branch can match).
- **Unchanged invariants:** existing `services.experience.updateLocale` mutation contract, ContentRevision retention (60-day TTL still applies to AI rows), Better Auth session shape, and the ABAC matrix.

---

## Risks & Dependencies

| Risk                                                                                                                      | Mitigation                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex CLI auth state on Railway differs from local (ChatGPT login here vs. headless API key in prod)                      | OQ during deployment runbook: confirm Codex login state on the prod Railway service before enabling chat in prod; surface `codex_unavailable` cleanly when not logged in.                             |
| Streaming subprocess hang leaves request thread tied up                                                                   | Per-token idle timeout (10s) + per-turn total timeout (45s) both send SIGTERM; route handler observes `AbortSignal` from the client.                                                                  |
| Concurrent chat turns on the same locale race against the `content_revision_one_draft_per_entity` unique constraint       | Service runs each chat turn's mutation inside a `$transaction` and uses Prisma upsert semantics on the DRAFT revision; treat P2002 errors as retry-as-update per existing CLAUDE.md guidance.         |
| Diff library choice (RFC 6902) introduces a new dependency                                                                | Pick an existing transitive dep where possible (`fast-json-patch` is already pulled by other packages); otherwise add `rfc6902` (small, no extra deps). Decision deferred to U3 implementation.       |
| Per-day chat rate budget could be exceeded by a runaway test                                                              | New `chat` Redis bucket separate from auth/search/recommendations; default 30/min per user, overrideable via env var if a test environment needs higher.                                              |
| Slug-change rejection adds friction if Codex repeatedly proposes slugs                                                    | Codex prompt explicitly forbids slug changes; if rejected envelopes become a frequent failure mode in monitoring, follow up with a stronger guardrail (e.g., few-shot examples in the system prompt). |
| Schema migration `0014_experience_chat` adds two tables but does not seed any data — existing experiences have no threads | Empty thread list is the legitimate empty state for any experience that has not been chatted with yet. Panel renders the suggested-prompts empty state.                                               |

---

## Documentation / Operational Notes

- Update `apps/admin/CLAUDE.md` to document the new chat panel surface, the streaming endpoint, the chat tables, and the internal first-draft routing path.
- Operational runbook: how to confirm Codex CLI is logged in on the prod Railway service (`codex login status` from a one-shot exec); how to inspect the `chat` rate-limit bucket counters in Redis.
- Add a cleanup note for the legacy `AiDraftPanel` (`ai-draft-panel.tsx`) and `runGenerateDraftAction`: remove user-facing panel code after the chat-only flow has browser coverage, but keep or replace the structured draft-generation service path deliberately rather than deleting it as incidental dead code.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-08-admin-experience-ai-chat-panel-requirements.md](../brainstorms/2026-05-08-admin-experience-ai-chat-panel-requirements.md)
- Related code: `apps/admin/src/app/dashboard/experiences/experience-editor/ai-draft-panel.tsx`, `apps/admin/src/services/experience-ai/`, `apps/admin/prisma/schema.prisma::ExperienceLocale` and `ContentRevision`
- Related institutional learnings: `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`, `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`, `apps/admin/CLAUDE.md` (ContentRevision contract + ABAC service-layer rule)
- External: RFC 6902 (JSON Patch), Next.js 16 App Router streaming response shape
