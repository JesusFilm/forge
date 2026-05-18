---
title: feat: Converge admin AI chat to single Mastra+OpenRouter channel
type: feat
status: completed
date: 2026-05-18
origin: docs/brainstorms/2026-05-18-mastra-orchestrator-chat-convergence-requirements.md
---

# feat: Converge admin AI chat to single Mastra+OpenRouter channel

## Summary

Collapse the experience-editor chat surface from five exploratory channels (`mastra`, `openrouter`, `ollama`, `codex`, `claude-code`) to a single Mastra-orchestrated channel running OpenRouter free models, with Mastra memory isolated in a dedicated `mastra` Postgres schema. The work is mostly deletion: four adapter modules, the channel dropdown UI, the `ChatProvider` discriminator, the route's `provider` field, and the chat-only env gates. The Mastra runtime itself, its agents, workflows, tools, and memory are already in place — this plan removes the surrounding multi-channel scaffolding so Mastra is the only path.

---

## Problem Frame

`feat/admin-chat-multi-channel-providers` shipped U1–U11 as exploratory scaffolding to compare four chat channels (`openrouter`, `ollama`, `codex`, `claude-code`) against each other while Mastra was being prototyped. The Mastra path (already wired as the default and backed by `@mastra/pg` memory) has been validated end-to-end locally, and the user has decided it is the production surface. The remaining four channels are now carrying cost: codex/claude-code are local-CLI-only and never spawn in Railway containers, `ollama` duplicates what Mastra+OpenRouter does as a managed service, and `openrouter`-channel (direct HTTP) duplicates Mastra's internal provider call. Keeping them in code post-Mastra means editors see a dropdown with one real option and three traps, four error-envelope shapes to maintain, and four env-gate code paths whose only purpose is to refuse to run.

---

## Requirements

- R1. Mastra is the only AI chat channel exposed to editors in the experience-editor chat panel.
- R2. Both flows route through Mastra: the quality-draft "create full experience" generation and the live chat-turn streaming reply.
- R3. Mastra uses OpenRouter free models via its existing providers; the `OPENROUTER_EXPERIENCE_CHAT_MODELS` env continues to define eligible models.
- R4. Mastra memory persists in admin's existing Postgres via `@mastra/pg`, isolated in a dedicated `mastra` schema so its tables stay out of Prisma's migration history and can be dropped/reset independently.
- R5. When every OpenRouter free model fails (rate-limit or error), the editor sees a clear error in the chat panel — no silent fallback to another provider.
- R6. The composer's channel dropdown is removed from the chat panel UI; editors have no provider chooser.
- R7. The codex, claude-code, ollama, and openrouter-free chat adapter modules under `apps/admin/src/services/experience-ai/`, plus their tests and the shared cli-gates helper, are deleted.
- R8. The multi-channel routing in `experience-ai-chat.service.ts` collapses to a single Mastra entry point. The `ChatProvider` discriminator and per-channel envelope routing are removed.
- R9. These chat-only env vars are removed from [apps/admin/src/config/env.ts](apps/admin/src/config/env.ts) and [apps/admin/.env.example](apps/admin/.env.example): `EXPERIENCE_AI_ALLOW_CODEX`, `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK`, `EXPERIENCE_AI_ALLOW_CLAUDE_CODE`, `EXPERIENCE_AI_CODEX_MODEL`, `EXPERIENCE_AI_CLAUDE_CODE_MODEL`, `OLLAMA_CHAT_MODEL`. Embedding-pipeline env vars (`OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_MODEL`, `OLLAMA_EMBEDDING_DIMENSIONS`, `OPENROUTER_IMAGE_TEXT_MODEL[S]`) are kept — they belong to unrelated pipelines.
- R10. The stream API route in [apps/admin/src/app/api/experience-chat/stream/route.ts](apps/admin/src/app/api/experience-chat/stream/route.ts) no longer accepts or branches on a `provider` field in the request body.
- R11. The "Experience AI Chat providers" section in [apps/admin/CLAUDE.md](apps/admin/CLAUDE.md) is rewritten to describe the single Mastra channel — no provider table, no per-channel gates, no legacy deprecation notes.

**Origin acceptance examples:** AE1 (covers R1, R6), AE2 (covers R2), AE3 (covers R4), AE4 (covers R5).

---

## Scope Boundaries

- Watch revalidation env (`WATCH_REVALIDATION_URL`, `WATCH_REVALIDATION_SECRET`, `NEXT_PUBLIC_WATCH_URL`) — unrelated work shipping on this branch, untouched by this plan.
- feat-119 PR2 manager enrichment trigger env (`MANAGER_API_BASE_URL`, `MANAGER_TRIGGER_API_KEY`) — unrelated, untouched.
- Embedding pipeline env vars (`OPENROUTER_IMAGE_TEXT_MODEL[S]`, `OLLAMA_EMBEDDING_*`, `OLLAMA_BASE_URL`) — used by R1/R2/R3 embed pipelines, not chat. Not pruned.
- Mastra tool-call expansion, agent-picker UX, multi-agent orchestration beyond what already exists — out of scope. The current Mastra setup (default chat agent + specialized agents + multi-step-draft workflow + memory) is the v1 surface.
- Mobile or `apps/web` chat — out of scope. Admin only.
- Legacy `experienceChatThread`/`experienceChatMessage` Prisma tables — already dropped per the Mastra plan's U10. Not re-touched.

---

## Context & Research

### Relevant Code and Patterns

- [apps/admin/src/mastra/index.ts](apps/admin/src/mastra/index.ts) — Mastra singleton with registered agents (`experience-default-chat`, `draft-experience`, `add-section`, `rewrite-copy`, `auto-enrich`) and workflow (`multi-step-draft`). Lazy `getMastra()` construction.
- [apps/admin/src/mastra/memory.ts](apps/admin/src/mastra/memory.ts) — `PostgresStore` from `@mastra/pg` with `MASTRA_STORAGE_URL ?? DATABASE_URL` fallback. Currently does NOT pass `schemaName` to the store — U1 adds that.
- [apps/admin/src/services/experience-ai/experience-ai-chat.service.ts](apps/admin/src/services/experience-ai/experience-ai-chat.service.ts) — current home of `streamChatTurn`, `runChatTurnForProvider`, `generateQualityExperienceDraft`. The provider switch lives here.
- [apps/admin/src/services/experience-ai/experience-ai-chat-provider.ts](apps/admin/src/services/experience-ai/experience-ai-chat-provider.ts) — `ChatProvider` literal union + `normalizeChatProvider` helper. Deleted entirely.
- [apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx](apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx) — composer with the channel dropdown to remove.
- [apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts](apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts) — stream client that carries `provider` in the POST body. Strip the field.
- [apps/admin/src/app/api/experience-chat/stream/route.ts](apps/admin/src/app/api/experience-chat/stream/route.ts) — accepts `provider` in `Body` Zod schema. Strip the field.
- Pattern to follow when refactoring tests after deletion: existing tests under `apps/admin/src/services/experience-ai/*.test.ts` are colocated with sources and follow Vitest conventions.

### Institutional Learnings

- [docs/solutions/platform/admin-chat-mastra-fitness-spike-20260514.md](docs/solutions/platform/admin-chat-mastra-fitness-spike-20260514.md) — original Mastra-vs-LibSQL fitness spike that decided on `@mastra/pg` over LibSQL. Same rationale applies to the schema-isolation decision in U1.
- [docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md](docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md) — keep deletions of env vars _optional → removed_; never flip a required env mid-deploy. All vars pruned here are already `.optional()`, so removal is safe.
- Per root [CLAUDE.md](CLAUDE.md) "Manager backfill pattern" / Mastra-adjacent learnings: Prisma migrations are forward-only on Railway. The schema-create migration in U1 is additive and idempotent.

### External References

- `@mastra/pg` `PostgresStore` accepts a `schemaName` option for table isolation. Confirm at U1 implementation time against the installed version (`1.10.1`) — if the option is named differently in this version, the implementer adjusts and notes the actual API in U1's verification.

---

## Key Technical Decisions

- **Mastra-only, no provider fallback.** Adding a second provider channel reintroduces the multi-channel branching this plan deletes. OpenRouter is the single provider; if all free models fail the editor sees an error envelope. (origin: requirements doc Key Decisions)
- **Dedicated `mastra` Postgres schema.** Schema isolation keeps Mastra's tables out of `_prisma_migrations` history and makes any future reset a single `DROP SCHEMA mastra CASCADE`. The Prisma client is not aware of these tables — they are owned and migrated by `@mastra/pg`'s internal lifecycle. (origin: requirements doc Key Decisions)
- **Delete `experience-ai-openrouter-free.ts`, not repurpose it.** The Mastra path calls OpenRouter via `apps/admin/src/mastra/providers.ts`, which is separate from the direct-HTTP adapter that backed the `openrouter` channel. The embedding pipeline reads its OpenRouter helper from `src/services/embeddings.service.ts`, not from this file. Verify no other importers before deleting (U5 verification).
- **Cold cutover, no compatibility shim for `ChatProvider`.** The discriminator is removed without an alias type or a deprecation export. Callers that referenced it (route, panel, stream client, service) are updated in the same plan.
- **Schema migration before service collapse.** U1 lands first because a Mastra connection failure after schema-rename would only surface at runtime; landing the schema change as its own commit isolates it for rollback.

---

## Open Questions

### Resolved During Planning

- **Should Mastra memory live in a dedicated schema?** Yes — user decision after brainstorm synthesis. U1 implements it.
- **R9 vs Scope Boundaries inconsistency on `OLLAMA_EMBEDDING_*`.** R9 in the origin doc lists `OLLAMA_EMBEDDING_MODEL` and `OLLAMA_EMBEDDING_DIMENSIONS` for removal, but Scope Boundaries says embedding-pipeline env vars stay. Resolution: trust Scope Boundaries — pruning is chat-only. These env vars remain. Flagged as a one-liner in the brainstorm doc that should be cleaned up post-merge (see Documentation / Operational Notes).

### Deferred to Implementation

- **`@mastra/pg` `schemaName` option name in version `1.10.1`** — confirm the actual constructor option name at U1. If different from `schemaName`, adapt and document in U1's verification.
- **Are there importers of `experience-ai-openrouter-free.ts` outside `experience-ai-chat.service.ts`?** Grep before deletion in U5. Embedding services should not import it; if they do, leave the file in place with only the chat-exports pruned.
- **Does `OPENROUTER_EXPERIENCE_CHAT_MODELS` (multi-model ladder) get used by Mastra's provider config, or does the chat service need to resolve a single model and pass it through?** Inspect `apps/admin/src/mastra/providers.ts` at U4 implementation. If Mastra reads the ladder env directly, no adapter needed. If not, add a thin model-resolution helper in the chat service that picks the first eligible model — without reintroducing a "channel".
- **Visual treatment of the chat composer post-dropdown removal** — focus state, send-button position, any retained "powered by OpenRouter free model" hint copy. Decided during U2.

---

## Implementation Units

### U1. Isolate Mastra memory in a dedicated `mastra` Postgres schema

**Goal:** Add a Prisma migration that creates the `mastra` schema, and wire `PostgresStore` in [apps/admin/src/mastra/memory.ts](apps/admin/src/mastra/memory.ts) to use it. Mastra's tables land in `mastra.*` instead of the default schema.

**Requirements:** R4

**Dependencies:** None — lands first as an isolated DB change.

**Files:**

- Create: `apps/admin/prisma/migrations/<next-seq>_mastra_schema/migration.sql` (single `CREATE SCHEMA IF NOT EXISTS mastra;` plus the `GRANT` statements admin's prod role needs)
- Modify: [apps/admin/src/mastra/memory.ts](apps/admin/src/mastra/memory.ts) — pass `schemaName: "mastra"` (or the version-correct option) to `new PostgresStore({...})`
- Test: [apps/admin/src/mastra/memory.test.ts](apps/admin/src/mastra/memory.test.ts) — assert the constructed `PostgresStore` carries the schema option; assert `resolveMastraStorageUrl` still falls back to `DATABASE_URL`

**Approach:**

- The migration is additive (`CREATE SCHEMA IF NOT EXISTS`). Safe to apply forward on Railway via the chained `startCommand` `prisma migrate deploy`.
- `PostgresStore` from `@mastra/pg` `1.10.1` is expected to accept a `schemaName` option. If the option name differs in this version (research deferred to implementation), adapt and note the actual API in this unit's verification.
- The store creates its own tables on first write — no Prisma-managed Mastra tables, no schema.prisma drift.
- DB role: Railway's `forge-admin` Postgres user owns the public schema and has `CREATE` on database; confirm at migration time. If a separate role is needed, document it in the runbook (per [apps/admin/CLAUDE.md](apps/admin/CLAUDE.md) Migrations section).

**Patterns to follow:**

- Migration naming: zero-padded sequential prefix from `apps/admin/prisma/migrations/` (next after the latest existing migration). Tag with snake_cased description.
- Lazy singleton pattern in `memory.ts` stays unchanged — only the `PostgresStore` constructor args change.

**Test scenarios:**

- Happy path: `buildMastraMemory()` constructs a `PostgresStore` whose configured schema is `mastra` (assert via the store's exposed config or a wrapper test double). Covers AE3.
- Happy path: `resolveMastraStorageUrl()` returns `MASTRA_STORAGE_URL` when set, falls back to `DATABASE_URL` when not.
- Edge case: `__resetMastraMemoryForTesting()` discards the cached instance so a second `getMastraMemory()` rebuilds with refreshed env.

**Verification:**

- Migration applies cleanly via `pnpm --filter @forge/admin db:migrate:deploy` against a local `forge_admin` DB. `\dn` in psql shows `mastra` in the schema list.
- A fresh chat turn against the local app stores rows under `mastra.*` (verify with `\dt mastra.*` after one chat exchange).
- `pnpm --filter @forge/admin typecheck` and `pnpm --filter @forge/admin test` pass.

---

### U2. Remove the channel dropdown from the chat composer UI

**Goal:** The composer in [experience-chat-panel.tsx](apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx) shows only a message input. The channel selector, cost labels, and any "recommended channel" hint copy are removed.

**Requirements:** R1, R6

**Dependencies:** None — the route still accepts an optional `provider`, so the UI can stop sending it any time.

**Files:**

- Modify: [apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx](apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx) — remove dropdown JSX, its state, its handlers, and any related copy
- Modify: [apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts](apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts) — remove `provider` from the request body shape
- Test: [apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx](apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx) — drop dropdown-related assertions; add an assertion that no `combobox` / `select` role is present in the composer

**Approach:**

- Visual treatment is a small judgment call to make during implementation: send-button alignment with the now-larger input area, focus ring, any retained "powered by OpenRouter" hint. Keep changes proportional — this is not a redesign.
- Verify no other component imports the dropdown subcomponent (if extracted to its own file in the U10 unit of the multi-channel plan, that file gets deleted too).

**Patterns to follow:**

- Tailwind utility usage already present in the panel; do not introduce a new styling primitive for a deletion.

**Test scenarios:**

- Happy path: rendering the panel produces no element with role `combobox` or `listbox`. The message textarea is present and focusable. Covers AE1.
- Happy path: submitting the composer fires a request without a `provider` field in the body.
- Edge case: existing chat history rendering still works (deletion of the dropdown does not regress message list rendering).

**Verification:**

- Manual: open `/dashboard/experiences/<id>` in dev (`pnpm --filter @forge/admin dev`), confirm only the message input is visible, send a chat, see a response from Mastra.
- `pnpm --filter @forge/admin test` for the panel test file passes.

---

### U3. Strip `provider` from the chat stream API route

**Goal:** [stream/route.ts](apps/admin/src/app/api/experience-chat/stream/route.ts) no longer reads, validates, or forwards a `provider` field. The Zod body schema reflects the new shape.

**Requirements:** R1, R10

**Dependencies:** U2 (UI stops sending the field first, so the route can drop it without a transitional window — but in practice the route accepts an absent field already, so U2 and U3 can land in either order).

**Files:**

- Modify: [apps/admin/src/app/api/experience-chat/stream/route.ts](apps/admin/src/app/api/experience-chat/stream/route.ts) — remove `provider` from `Body` Zod schema; remove the `provider: parsedBody.provider` argument to `streamChatTurn`
- Test: existing route test (path under `apps/admin/src/app/api/experience-chat/stream/`) — drop scenarios that branch on provider value; keep the happy-path test, the auth-rejection test, the rate-limit test, the malformed-body test

**Approach:**

- The route already calls `streamChatTurn` with a `provider` argument that is `string | undefined`. After this unit, the call site drops the arg and the service signature in U4 follows suit.

**Patterns to follow:**

- Route handler structure (rate limit → auth → ABAC → Zod parse → SSE stream) stays unchanged. This is a single-field deletion.

**Test scenarios:**

- Happy path: a body with `{ threadId, prompt }` parses successfully and streams events.
- Happy path: a body that legacy-includes `provider: "openrouter"` parses successfully (Zod's default behavior is to ignore unknown keys unless `.strict()`), so old clients during deploy window do not see 400s. Confirm Zod is not in `.strict()` mode on this schema.
- Error path: a body missing `threadId` returns 400 with `issues` field populated. Unchanged from current.
- Error path: an unauthenticated request returns 401 before any body parse.

**Verification:**

- `pnpm --filter @forge/admin test` for the route test file passes.
- `pnpm --filter @forge/admin typecheck` confirms `streamChatTurn` no longer expects `provider`.

---

### U4. Collapse multi-channel routing in the chat service to a single Mastra path

**Goal:** [experience-ai-chat.service.ts](apps/admin/src/services/experience-ai/experience-ai-chat.service.ts) calls Mastra directly for both quality-draft and chat-turn flows. The `runChatTurnForProvider` switch and `generateQualityExperienceDraft`'s per-channel routing are removed. The service's exported surface no longer accepts a `provider` parameter.

**Requirements:** R2, R3, R5, R8

**Dependencies:** None functionally (the file can be edited in isolation), but lands AFTER U2/U3 so the public-facing surfaces aren't pointing at a deleted parameter mid-deploy. Lands BEFORE U5 so the adapter imports can be removed cleanly.

**Files:**

- Modify: [apps/admin/src/services/experience-ai/experience-ai-chat.service.ts](apps/admin/src/services/experience-ai/experience-ai-chat.service.ts) — strip provider switch, route both flows through `getMastra().getAgent("experience-default-chat").stream(...)` (chat-turn) and the `multi-step-draft` workflow / `draft-experience` agent (quality-draft, depending on existing wiring)
- Modify: [apps/admin/src/services/experience-ai/experience-ai-chat.service.test.ts](apps/admin/src/services/experience-ai/experience-ai-chat.service.test.ts) — drop per-channel routing test cases; keep Mastra-path tests; add or expand error-envelope test for the all-OpenRouter-models-fail case
- Modify: [apps/admin/src/services/experience-ai/experience-ai-quality-draft.ts](apps/admin/src/services/experience-ai/experience-ai-quality-draft.ts) and its test — if this module still carries a provider switch, collapse it to Mastra only

**Approach:**

- Inspect `apps/admin/src/mastra/providers.ts` to confirm whether Mastra's OpenRouter provider config consumes the `OPENROUTER_EXPERIENCE_CHAT_MODELS` ladder directly. If yes, no extra work. If not, add a small helper in the chat service that resolves the first eligible model from the ladder env and passes it through Mastra's `stream()` call — without reintroducing a "channel" concept.
- Failure path: when Mastra returns an error (rate-limit, all models exhausted), the service yields a `ChatStreamEvent { type: "error", code: "<canonical>", message: "<sanitized>" }` matching the existing envelope. The route's SSE wrapper already does the right thing on that envelope.
- The `streamChatTurn` async generator signature loses its `provider` argument.

**Patterns to follow:**

- Existing Mastra-path code in `streamChatTurn` (already wired in the +314-line uncommitted diff). Keep its shape; remove the surrounding `switch (provider)` envelope.
- Error envelope shape: keep parity with the four-channel-era code so the client renderer doesn't need a change.

**Test scenarios:**

- Happy path: `streamChatTurn({ threadId, prompt })` yields a sequence ending in `done`, with `token_delta` events in between. Covers AE2.
- Happy path: `generateQualityExperienceDraft({ ... })` returns a structured draft built by Mastra. No legacy provider switch is hit.
- Error path: when Mastra's stream throws (simulated provider rejection), the service yields an `error` event with a canonical code and stops cleanly. Covers AE4.
- Edge case: an aborted `AbortSignal` mid-stream halts iteration without unhandled rejection (existing test, keep it).
- Integration: the service constructs a Mastra agent via `getMastra().getAgent("experience-default-chat")`; assert the agent id matches the registry in [apps/admin/src/mastra/index.ts](apps/admin/src/mastra/index.ts).

**Verification:**

- `pnpm --filter @forge/admin test` for the chat service test file passes.
- `pnpm --filter @forge/admin typecheck` confirms the new signature.
- Manual local chat exchange yields a response from Mastra (smoke test).

---

### U5. Delete the adapter modules, the `ChatProvider` discriminator, and the cli-gates helper

**Goal:** The four per-channel adapter files and their tests, the `ChatProvider` type module and its test, and the cli-gates helper and its test are removed from `apps/admin/src/services/experience-ai/`. No lingering references remain.

**Requirements:** R7, R8

**Dependencies:** U4 (the chat service must no longer import any of these modules first).

**Files:**

- Delete: [apps/admin/src/services/experience-ai/experience-ai-claude-code.ts](apps/admin/src/services/experience-ai/experience-ai-claude-code.ts) and its `.test.ts`
- Delete: [apps/admin/src/services/experience-ai/experience-ai-codex.ts](apps/admin/src/services/experience-ai/experience-ai-codex.ts) and its `.test.ts`
- Delete: [apps/admin/src/services/experience-ai/experience-ai-ollama.ts](apps/admin/src/services/experience-ai/experience-ai-ollama.ts) and its `.test.ts`
- Delete: [apps/admin/src/services/experience-ai/experience-ai-openrouter-free.ts](apps/admin/src/services/experience-ai/experience-ai-openrouter-free.ts) and its `.test.ts` — **AFTER verifying no embedding-pipeline imports**
- Delete: [apps/admin/src/services/experience-ai/experience-ai-cli-gates.ts](apps/admin/src/services/experience-ai/experience-ai-cli-gates.ts) and its `.test.ts`
- Delete: [apps/admin/src/services/experience-ai/experience-ai-chat-provider.ts](apps/admin/src/services/experience-ai/experience-ai-chat-provider.ts) and its `.test.ts`

**Approach:**

- Before each deletion, grep for importers: `grep -rn "experience-ai-openrouter-free\|experience-ai-codex\|experience-ai-claude-code\|experience-ai-ollama\|experience-ai-cli-gates\|experience-ai-chat-provider\|ChatProvider\|normalizeChatProvider" apps/admin/src --include="*.ts" --include="*.tsx"`.
- For `experience-ai-openrouter-free.ts` specifically: confirm `apps/admin/src/services/embeddings.service.ts` and the R1/R2/R3 indexer/workflow files do NOT import it. If any do, leave that single file in place with only the chat-related exports removed (highly unlikely given the CLAUDE.md trail, but worth verifying).
- The cli-gates helper is shared between codex + claude-code; once both are gone, it has no callers.

**Patterns to follow:**

- Bulk-delete via `rm` then run `pnpm --filter @forge/admin typecheck` until clean; each TypeScript error is a remaining importer to update or delete.

**Test scenarios:**

- Test expectation: none for the deletions themselves — deleted code has no tests. The verification step below is the assertion.

**Verification:**

- `grep -r "ChatProvider\|EXPERIENCE_AI_ALLOW\|OLLAMA_CHAT\|experience-ai-claude-code\|experience-ai-codex\|experience-ai-ollama\|experience-ai-openrouter-free\|experience-ai-cli-gates\|experience-ai-chat-provider\|normalizeChatProvider" apps/admin/src` returns zero results.
- `pnpm --filter @forge/admin typecheck`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin test` all pass.

---

### U6. Prune chat-only env vars from `env.ts` and `.env.example`

**Goal:** The chat-only CLI-gate and per-channel-model env vars are removed from [apps/admin/src/config/env.ts](apps/admin/src/config/env.ts) and [apps/admin/.env.example](apps/admin/.env.example). Embedding-pipeline env vars (`OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_*`, `OPENROUTER_IMAGE_TEXT_MODEL[S]`) are kept.

**Requirements:** R9

**Dependencies:** U5 (the adapter modules that read these env vars must already be deleted, so removing the vars cannot break a live import).

**Files:**

- Modify: [apps/admin/src/config/env.ts](apps/admin/src/config/env.ts) — remove from both the `server: { ... }` Zod schema and the `runtimeEnv: { ... }` mapping these keys: `EXPERIENCE_AI_ALLOW_CODEX`, `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK`, `EXPERIENCE_AI_ALLOW_CLAUDE_CODE`, `EXPERIENCE_AI_CODEX_MODEL`, `EXPERIENCE_AI_CLAUDE_CODE_MODEL`, `OLLAMA_CHAT_MODEL`
- Modify: [apps/admin/.env.example](apps/admin/.env.example) — remove the "Experience AI Chat CLI channels" block and the `OLLAMA_CHAT_MODEL` line; keep the surrounding embedding-pipeline section (`OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_MODEL`) intact
- Test: if an env-shape test exists (e.g., `apps/admin/src/config/env.test.ts`), update its expected key list

**Approach:**

- All vars being removed are `.optional()` per the current env.ts, so removal is safe at deploy time — no teammate's existing `.env.local` will trigger a validation error after pull.
- Keep `OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_MODEL`, `OLLAMA_EMBEDDING_DIMENSIONS` — these belong to the embedding pipeline per Scope Boundaries, even though the origin doc's R9 listed them. The brainstorm doc carried an inconsistency between R9 and Scope Boundaries; this plan resolves it by keeping them.
- After removal, no consumer should reference these env keys. The lint/typecheck pass at U5 already established this.

**Patterns to follow:**

- t3-oss/env-nextjs pattern already in use — schema entry + runtimeEnv entry both present for every key. Remove both halves for each pruned key.

**Test scenarios:**

- Happy path: `env` parses successfully with none of the pruned keys present in `process.env` (default state).
- Happy path: `env` parses successfully when only the kept keys (`OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_MODEL`, etc.) are present — confirms embedding env is unaffected.
- Negative assertion: `(env as any).EXPERIENCE_AI_ALLOW_CODEX` is `undefined` — type-level absence confirmed by `pnpm typecheck`.

**Verification:**

- `pnpm --filter @forge/admin typecheck` passes.
- `grep -rn "EXPERIENCE_AI_ALLOW\|EXPERIENCE_AI_CODEX_MODEL\|EXPERIENCE_AI_CLAUDE_CODE_MODEL\|OLLAMA_CHAT_MODEL" apps/admin/src` returns zero results.
- The dev server boots successfully with a default `.env.local` (no pruned vars set).

---

### U7. Update `apps/admin/CLAUDE.md` to describe the single Mastra channel

**Goal:** The "Experience AI Chat providers" section in [apps/admin/CLAUDE.md](apps/admin/CLAUDE.md) is rewritten to describe one channel (Mastra + OpenRouter free model + Postgres `mastra` schema memory). The provider table, the env-gate documentation, the per-channel model overrides, and the legacy deprecation notes are all removed. A short subsection on the dedicated `mastra` schema is added.

**Requirements:** R11

**Dependencies:** U1–U6 — documentation matches the shipped reality.

**Files:**

- Modify: [apps/admin/CLAUDE.md](apps/admin/CLAUDE.md) — rewrite the "Experience AI Chat providers" section
- Modify: brainstorm doc at [docs/brainstorms/2026-05-18-mastra-orchestrator-chat-convergence-requirements.md](docs/brainstorms/2026-05-18-mastra-orchestrator-chat-convergence-requirements.md) — one-line follow-up note resolving the R9 vs Scope Boundaries inconsistency on `OLLAMA_EMBEDDING_*` (so the doc stays internally consistent)

**Approach:**

- Replace the existing table with a short paragraph: "The chat surface runs through Mastra's `experience-default-chat` agent, which calls OpenRouter free models via Mastra's provider config. Memory persists in admin's Postgres under a dedicated `mastra` schema."
- Add a short bullet list noting: relevant Mastra agent ids, the `multi-step-draft` workflow for quality-draft, the `OPENROUTER_EXPERIENCE_CHAT_MODELS` env that drives model selection.
- Remove the "Per-channel model overrides" bullets and the "Adapter modules" bullets entirely.

**Patterns to follow:**

- Existing voice and structure of [apps/admin/CLAUDE.md](apps/admin/CLAUDE.md): short paragraphs, bullet lists for "things to remember", links to relevant solutions docs.

**Test scenarios:**

- Test expectation: none — documentation change. Verification is reviewer reading.

**Verification:**

- Reviewer reads the section and confirms: no mention of `openrouter`, `ollama`, `codex`, or `claude-code` as channels; no mention of `EXPERIENCE_AI_ALLOW_*` env vars; the `mastra` schema and `OPENROUTER_EXPERIENCE_CHAT_MODELS` are documented.
- `grep -n "EXPERIENCE_AI_ALLOW\|OLLAMA_CHAT_MODEL\|experience-ai-codex\|experience-ai-claude-code" apps/admin/CLAUDE.md` returns zero results.

---

## System-Wide Impact

- **Interaction graph:** the chat panel → stream route → chat service → Mastra agent chain is the only chat-turn path post-merge. No callbacks, observers, or middleware are altered outside that chain.
- **Error propagation:** Mastra errors yield the existing `ChatStreamEvent { type: "error" }` envelope; SSE wrapper unchanged; client renderer unchanged.
- **State lifecycle risks:** Mastra memory tables move from default schema to `mastra` schema in U1. If the legacy `experienceChatThread`/`Message` Prisma tables were already dropped (per Mastra plan U10), no migration interaction here. Verify before merge that no Prisma `schema.prisma` references those tables.
- **API surface parity:** the public chat API (`POST /api/experience-chat/stream`) loses an optional field. Zod's default non-strict behavior tolerates legacy clients during the deploy window — old clients sending `provider: "openrouter"` parse cleanly, the value is just ignored.
- **Integration coverage:** the chat-service → Mastra-agent boundary is the load-bearing integration; existing tests at [apps/admin/src/services/experience-ai/experience-ai-chat.service.test.ts](apps/admin/src/services/experience-ai/experience-ai-chat.service.test.ts) cover it. No new integration test surfaces are required.
- **Unchanged invariants:** the SSE wire format (`event:` + `data:` frames), the request body shape minus the `provider` field, and the chat-event discriminator union (`token_delta` / `mutation_proposal` / `error` / `done`) are unchanged. The Mastra agent/workflow/tool registry in [apps/admin/src/mastra/index.ts](apps/admin/src/mastra/index.ts) is unchanged. The embedding pipelines (R1, R2, R3) and search pipelines (R4, R5) are unchanged.

---

## Risks & Dependencies

| Risk                                                                                                                      | Mitigation                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mastra/pg` `1.10.1` does not accept a `schemaName` option (or names it differently).                                    | U1 verifies the API at implementation time; if absent, fall back to the default schema and document the decision in this plan's "Resolved During Planning" section. The schema-creation migration is harmless even if the store does not honor it.                                                                   |
| Deleting `experience-ai-openrouter-free.ts` accidentally removes a function used by the embedding pipeline.               | U5 grep step verifies no embedding service imports before deletion. If any does, leave the file in place and remove only the chat-related exports.                                                                                                                                                                   |
| Legacy clients (a stale browser tab) send `provider` in the body after the route is updated.                              | The route's Zod schema is non-strict, so the extra field parses cleanly and is ignored. No client-side error.                                                                                                                                                                                                        |
| Mastra streams an error envelope shape that differs from the legacy multi-channel envelope, breaking the client renderer. | U4 test scenario asserts envelope parity. Adjust Mastra's error mapping in the chat service rather than the client renderer.                                                                                                                                                                                         |
| Schema-create migration runs on a Railway environment where the role lacks `CREATE` on the database.                      | Railway's `forge-admin` role already creates schemas (Prisma migrations exercise this). If a fresh environment is provisioned without that grant, the migration fails fast with a recognizable Postgres error and the operator's runbook in [apps/admin/CLAUDE.md](apps/admin/CLAUDE.md) Migrations section applies. |

---

## Documentation / Operational Notes

- After merge, update the brainstorm doc one-liner: clarify in R9 that `OLLAMA_EMBEDDING_*` and `OLLAMA_BASE_URL` are NOT pruned (they belong to embeddings). U7 handles this.
- No production rollout coordination needed: all pruned env vars are `.optional()`. Doppler entries for the pruned keys may be removed from `forge-admin` Doppler post-merge as cleanup; leaving them set is harmless after this PR ships.
- Verify after Railway deploy that `mastra.*` tables are populated by a first chat exchange. Schema check: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'mastra'` should return non-empty.
- Update [apps/admin/CLAUDE.md](apps/admin/CLAUDE.md) "Build status" if a relevant Unit needs marking complete (the U7 of this plan is the doc update itself; no other status entries are affected).

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-18-mastra-orchestrator-chat-convergence-requirements.md](docs/brainstorms/2026-05-18-mastra-orchestrator-chat-convergence-requirements.md)
- Related learnings: [docs/solutions/platform/admin-chat-mastra-fitness-spike-20260514.md](docs/solutions/platform/admin-chat-mastra-fitness-spike-20260514.md), [docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md](docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md)
- Related code surfaces: [apps/admin/src/mastra/index.ts](apps/admin/src/mastra/index.ts), [apps/admin/src/mastra/memory.ts](apps/admin/src/mastra/memory.ts), [apps/admin/src/services/experience-ai/experience-ai-chat.service.ts](apps/admin/src/services/experience-ai/experience-ai-chat.service.ts), [apps/admin/CLAUDE.md](apps/admin/CLAUDE.md)
- Related prior plan (Mastra fitness spike + initial wiring): the unit referenced in [apps/admin/src/mastra/index.ts](apps/admin/src/mastra/index.ts) as "U2" of the Mastra rollout plan
