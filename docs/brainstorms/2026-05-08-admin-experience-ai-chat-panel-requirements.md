---
date: 2026-05-08
topic: admin-experience-ai-chat-panel
status: ready-for-planning
owner: ekkasit
predecessor: docs/brainstorms/2026-04-13-admin-ai-experience-editorial-quality-requirements.md
---

# Admin Experience Editor — AI Chat Side Panel

## Problem Frame

The current `AI Draft` panel in `apps/admin/src/app/dashboard/experiences/experience-editor/ai-draft-panel.tsx` is a one-shot form: type a prompt, get six blocks back, accept-or-discard the whole draft. This forces editors to regenerate the entire experience to make any change — there is no way to say "make the hero punchier", "swap that video", or "add a section between blocks 2 and 4". It also leaves the canvas empty until generation completes, and offers no scaffolding for editors who don't yet know what they want to build.

This brainstorm captures the requirements for replacing that panel with a **persistent, conversational side panel** that supports iterative refinement, conversational discovery, and surgical edits — with the AI directly mutating the experience under per-turn undo.

## What We're Building

A right-rail chat panel inside the experience editor that:

1. Persists across sessions (chat history is durable per `(experience, locale, thread)` triple).
2. Lets the AI **directly mutate** the experience's editable surface — title, meta description, blocks JSON, og image — under per-turn undo.
3. Supports **multiple threads** per experience-locale (a "Start new conversation" affordance). One thread is the active conversation at any time.
4. Streams the AI's response **token-by-token** so the user sees progress instead of a 30-second silence.
5. Surfaces **context-aware suggested prompts** for the empty state and intermediate states so editors can ride existing rails when they're stuck.
6. Replaces the visible `AI Draft` panel as the only AI generation surface in the editor. On an empty canvas, create/build/generate prompts produce a full draft proposal inside AI Chat, with an editable preview that the user applies explicitly.

## Requirements

### Functional Capabilities (R1)

The chat must support all three jobs-to-be-done:

- **R1.1 — Iterative refinement.** "Make the hero punchier", "shorten the CTA", "rewrite block 3 in a younger voice".
- **R1.2 — Conversational discovery.** "What videos do we have for grieving teens?" — AI uses the Qwen-indexed `video_candidate_embedding` table (1,088 rows) to surface candidates without committing to a draft.
- **R1.3 — Surgical edits.** "Add a section between blocks 2 and 4", "swap the video in block 1 for one about forgiveness".

### Authority Model (R2)

The AI directly mutates the experience-locale state on each accepted turn — no propose/confirm step in normal flow. Concretely:

- **R2.1 — Editable by AI.** `title`, `metaDescription`, `blocks` (JSON), `ogImage`. These get mutated in place.
- **R2.2 — FORBIDDEN.** `slug` (URL identity) is never touched by the AI. The panel must reject any AI tool call that targets it; the prompt must be primed to never propose slug changes.
- **R2.3 — Cross-locale changes require explicit confirmation.** If the AI proposes "I'll also update the Spanish version of this experience", the panel surfaces a **modal** ("Apply to es as well? Yes / No / This conversation only") before any other-locale write goes through. Default is No — locale switches are a deliberate user action.

### Layout (R3)

- **R3.1 — Side panel, persistent.** Right rail of the experience editor. Always visible while editing the canvas. Fills the empty space currently shown to the right of the block list.
- **R3.2 — Width.** Comfortable for paragraph-length AI responses without horizontal scroll. Likely ~360–420px; final number to be set during design pass.
- **R3.3 — Mobile/narrow viewport behavior.** Out of v1 scope. Editor is desktop-first.

### Per-Turn Undo (R4)

- **R4.1 — Each AI turn creates a snapshot.** Before the AI's mutations land, capture the editable state (title, metaDescription, blocks, ogImage).
- **R4.2 — Snapshots are diff-based.** Each turn stores only the fields that _changed_ relative to the previous turn's outcome — not a full copy of the whole editable surface. Reduces row size on long conversations.
- **R4.3 — Restore semantics.** Undoing turn N restores the editor to the state at the _end_ of turn N-1. Subsequent turns remain visible in the chat transcript but the document state is rolled back. Undoing turn N+M (M > 1) walks back through the diffs to reconstruct that earlier state.
- **R4.4 — Where undo lives.** Each AI message in the transcript has an "Undo this change" affordance (e.g., a small button in the message footer). No global "rewind to" UI in v1.

### Persistence (R5)

- **R5.1 — Two new tables.**
  - `experience_chat_thread` — one row per `(experienceLocaleId, createdBy, threadId)`. Carries title (auto-generated from first prompt), createdAt, lastMessageAt, lastSnapshotId.
  - `experience_chat_message` — one row per turn. Carries threadId, role (`user`/`assistant`/`system`), content (text), createdAt, providerKind (`codex`/`ollama`/etc.), tokenCounts, snapshotDiff (the per-turn diff payload R4.2 needs), mutationsApplied (which fields touched).
- **R5.2 — Foreign keys.** Both tables FK to `ExperienceLocale.id` with `ON DELETE CASCADE`. Deleting a locale wipes its threads.
- **R5.3 — No retention cap in v1.** Different from `ContentRevision`'s 60-day TTL — chat threads accumulate as long as the experience-locale exists. Revisit if storage becomes a problem.
- **R5.4 — Indexes.** `(experienceLocaleId, lastMessageAt DESC)` on threads; `(threadId, createdAt ASC)` on messages.

### Streaming UX (R6)

- **R6.1 — Codex token streaming via stdout.** The `codex exec` CLI streams output to stdout as it generates. The server-side AI service captures the stream and forwards it to the client via Server-Sent Events (or Next.js streaming response) — token-by-token.
- **R6.2 — Final structured payload.** Codex emits human text first, then the structured mutation payload at the end (a JSON envelope describing which fields to set / which blocks to insert/update). The streaming layer must distinguish "text for the chat bubble" from "the final mutation envelope". Likely: text ends at a sentinel token, JSON follows.
- **R6.3 — Provider stays Codex (logged in via ChatGPT) for v1.** Switching to a different provider (Ollama chat, OpenRouter at higher tier) is a separate decision orthogonal to this feature.
- **R6.4 — User can interrupt.** "Stop generating" button cancels the in-flight Codex process server-side (`SIGTERM` to the spawned subprocess).

### Suggested Prompts — Context-Aware (R7)

The empty state and idle-state of the chat shows 4–6 suggested prompts the user can click to insert. The list is computed at render time from current canvas state:

- **R7.1 — When canvas is empty (no blocks):** prompts focus on creation. Examples: _"Create an experience for grieving teens"_, _"Build something about forgiveness with a video hero"_.
- **R7.2 — When canvas has blocks:** prompts focus on refinement. Examples: _"Make the hero punchier"_, _"Soften the CTA tone"_, _"Add a reflection section after the video"_.
- **R7.3 — Locale-aware.** If `locale = es`, surface Spanish prompts. If `locale = en`, English. (The AI itself responds in the locale's language regardless.)
- **R7.4 — Recent-activity-aware (stretch).** If the user just inserted a video, suggest _"Add another video like that one"_. Stretch goal — fall back to R7.1/R7.2 if not implemented in v1.

### First-Draft Generation Through Chat (R8)

- **R8.1 — Chat is the only visible AI generation entry point.** The legacy `AI Draft` panel is not kept as a parallel fallback in the editor UI.
- **R8.2 — Empty-canvas creation prompts use the higher-quality draft path internally.** If the canvas is empty and the user's prompt clearly asks to create, generate, or build an experience, the backend may route the turn through the existing structured draft-generation path while keeping the interaction inside AI Chat.
- **R8.3 — First drafts do not apply immediately.** The assistant returns a proposal and the user confirms before the draft changes the editable canvas.
- **R8.4 — Confirmation is a full editable preview.** The preview must expose the generated title, metadata, image, and blocks enough for the editor to inspect and adjust before applying, not just a summary.
- **R8.5 — Public watch preview compatibility is part of acceptance.** AI-generated blocks that reference videos by `videoId` must render on the public watch route after publish; the web resolver must hydrate referenced video streams rather than requiring inline `streamingUrl` fields in every generated block.

## Out of Scope (V1)

- **Mobile / narrow-viewport chat layout.** Editor is desktop-only.
- **Multi-user concurrent editing of the same chat thread.** Single editor per session.
- **Voice input.** Text-only.
- **Cross-experience operations.** AI cannot "look at experience X and copy its structure here" — scope is the current experience-locale (with cross-locale via R2.3).
- **Chat thread sharing across users.** Threads are private to their creator. Other admins on the same experience start their own threads.
- **AI-driven publishing.** AI can mutate drafts; only the human clicks Publish.
- **Retention/archival policy.** No 60-day TTL in v1 (R5.3).

## Open Questions for Planning

These are intentionally deferred to `/ce-plan`:

- **OQ1.** Exact wire format for the streamed response — Server-Sent Events vs Next.js streaming response vs WebSocket. SSE is the simplest fit but Next.js App Router has constraints.
- **OQ2.** How much of the existing `experience-ai.service.ts` (one-shot draft generation) gets reused vs. forked. The chat path needs streaming output and conversational context; the one-shot path doesn't.
- **OQ3.** Snapshot diff format — JSON Patch (RFC 6902) vs custom shape. JSON Patch is well-known and gives free undo libraries; custom is lighter but means writing the apply/revert logic ourselves.
- **OQ4.** How threads' titles are generated. Auto-summarize first prompt? First N words? Manual rename? V1 default is auto, with manual rename as a stretch.
- **OQ5.** Token budget per session — Codex calls are not free at scale. Do we cap message count or context window? Likely yes, but specifics deferred.
- **OQ6.** Audit trail — does each AI mutation also create a `ContentRevision` row with `revisedByKind: AI`? Pro: existing revision history surface picks them up. Con: doubles the write volume. Deferred to planner.
- **OQ7.** Failure modes — what does the user see if Codex returns invalid JSON, exceeds the 60-second timeout, or the spawned process crashes mid-stream? Define error states clearly during planning.
- **OQ8.** Permission gate — same `canEditExperienceLocale` ABAC check as the existing editor, applied to every mutation the AI tries? Confirm during planning.

## Verification (How We Know It's Done)

- A logged-in editor opens an experience-locale, sees the chat panel on the right, and can hold a multi-turn conversation that progressively builds and refines the experience.
- Each AI turn streams token-by-token (no 30-second silence).
- The "Undo this change" button on any past AI message restores the document to the state at the end of the previous turn.
- Switching locale and asking the AI to "translate this experience" surfaces the cross-locale confirmation modal (R2.3).
- Asking the AI to change the slug is refused (R2.2).
- Closing and reopening the experience preserves the conversation history (R5).
- Suggested prompts on an empty canvas differ from those on a populated canvas (R7.1 vs R7.2).
- On an empty canvas, typing "Generate an experience about forgiveness" in AI Chat returns a full editable draft preview and does not mutate the canvas until the editor applies it.
- After applying and publishing a chat-generated draft with `videoId`-only media blocks, the published `Preview` button opens `/watch/<slug>/<locale>` and renders the media sections without missing-stream warnings.
- Two threads on the same experience-locale are independently navigable.

## Patterns / Files to Mirror

Reuse, don't reinvent:

- **`apps/admin/src/app/dashboard/experiences/experience-editor/ai-draft-panel.tsx`** — the one-shot panel becomes the chat panel. Its state-management approach for "ephemeral preview before save" is the right starting point for diff/undo.
- **`apps/admin/src/services/experience-ai/experience-ai.service.ts`** — the chat path likely forks `createStructuredDraftWithCodex` for streaming. Keep the structured-JSON draft path available internally for empty-canvas first drafts, but do not expose it as a separate editor panel.
- **`apps/admin/src/app/dashboard/experiences/generate-draft-action.ts`** — server action shape; chat needs a streaming variant.
- **`apps/admin/prisma/schema.prisma`** — `ExperienceLocale` model is the FK target. Add the two new tables (R5.1) as a new migration in `apps/admin/prisma/migrations/`.
- **`apps/admin/src/auth/permissions.ts`** — ABAC helper for locale edits already exists; the chat mutation handler must call it (OQ8).

## Hand-off

This document is ready for `/ce-plan` to break into Implementation Units. Suggested unit boundaries:

- **U1.** Schema + migration for `experience_chat_thread` + `experience_chat_message`.
- **U2.** Server-side streaming pipeline (Codex stdout → SSE → client).
- **U3.** Snapshot diff/undo machinery (R4 + OQ3).
- **U4.** Side-panel UI shell (R3) — empty state, message list, input, "Stop generating", thread switcher.
- **U5.** Suggested prompts (R7) — initial static-by-state version, stretch to recent-activity-aware.
- **U6.** Authority guards (R2.2 forbidden slug, R2.3 cross-locale confirmation modal).
- **U7.** ABAC gate on every mutation (OQ8).
- **U8.** Failure modes / error UI (OQ7).
