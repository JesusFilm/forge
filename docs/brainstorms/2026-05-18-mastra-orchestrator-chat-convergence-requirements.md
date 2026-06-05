---
date: 2026-05-18
topic: mastra-orchestrator-chat-convergence
---

# Mastra Orchestrator Chat — Converge from 4 Channels to a Single Mastra+OpenRouter Path

## Summary

Converge the experience editor's AI chat from four exploratory channels (`openrouter`, `ollama`, `codex`, `claude-code`) down to a single Mastra-orchestrated channel running OpenRouter free models. Mastra-as-orchestrator over OpenRouter is the final product shape; multi-channel was scaffolding that served its purpose during exploration.

---

## Problem Frame

The current branch `feat/admin-chat-multi-channel-providers` shipped U1–U11: a composer dropdown that lets editors pick between four chat channels, each with its own quality-draft adapter, chat-turn adapter, env gate, and failure modes. Four channels means four code paths to keep alive in dev, four ways production can break, and four sections of documentation to keep accurate.

Local exploration has now resolved the question those four channels were posed against: Mastra running OpenRouter free models is the channel we want in production. The other three are either local-dev only (`codex`, `claude-code` — CLI binaries that don't ship in Railway containers) or duplicate what Mastra+OpenRouter already gives us as a managed surface (`ollama`).

Leaving them in place after Mastra ships means editors see a dropdown with one real option and three traps, and the team carries adapter code that exists only because we were not yet sure which channel would win.

---

## Requirements

**Mastra chat (the keeper)**

- R1. The Mastra runtime is the only AI chat channel exposed to editors in the experience editor's chat panel.
- R2. Both flows route through Mastra: the quality-draft "create full experience" generation and the live chat-turn streaming reply.
- R3. Mastra uses OpenRouter free models as its model provider. The existing `OPENROUTER_EXPERIENCE_CHAT_MODELS` env var continues to define which free models are eligible.
- R4. Mastra's memory and storage use admin's existing Postgres (via `@mastra/pg`), not LibSQL. Memory persists across editor sessions on Railway.
- R5. When every OpenRouter free model fails (rate-limit or error), the user sees a clear error message in the chat. No fallback to other providers — OpenRouter is the only provider.

**Prune the scaffolding**

- R6. The composer's channel dropdown is removed from the chat panel UI. Editors no longer pick a channel.
- R7. The codex, claude-code, and ollama adapter modules in `apps/admin/src/services/experience-ai/` are deleted along with their tests.
- R8. The multi-channel routing in `experience-ai-chat.service.ts` collapses to a single Mastra entry point. The `ChatProvider` type and per-channel envelope routing are removed.
- R9. The chat-only env vars are removed from `apps/admin/src/config/env.ts` and `apps/admin/.env.example`: `EXPERIENCE_AI_ALLOW_CODEX`, `EXPERIENCE_AI_ALLOW_CLAUDE_CODE`, `EXPERIENCE_AI_CODEX_MODEL`, `EXPERIENCE_AI_CLAUDE_CODE_MODEL`, `OLLAMA_CHAT_MODEL`. Embedding-pipeline env vars (`OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_MODEL`, `OLLAMA_EMBEDDING_DIMENSIONS`) are kept — they belong to embedding services, not chat. `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` is also kept until the legacy `experience-ai.service.ts` draft-generation flow is removed in a follow-up.
- R10. The stream API route in `apps/admin/src/app/api/experience-chat/stream/route.ts` no longer accepts or branches on a `provider` field in the request body.
- R11. The "Experience AI Chat providers" section in `apps/admin/CLAUDE.md` is rewritten to describe the single Mastra channel — no provider table, no per-channel gates, no legacy deprecation notes.

---

## Acceptance Examples

- AE1. **Covers R1, R6.** Given an editor opens the chat panel, when they look at the composer, then no channel dropdown is visible. The composer shows only a message input and send affordance.
- AE2. **Covers R2.** Given an editor clicks "create full experience draft", when the request runs, then the structured draft is produced by Mastra calling OpenRouter, and no codex/claude-code/ollama code paths execute.
- AE3. **Covers R4.** Given an editor has a chat conversation on an experience, closes the browser, and returns later, when they re-open the same experience, then prior chat memory is available because Mastra persisted it to admin's Postgres.
- AE4. **Covers R5.** Given OpenRouter returns errors for every model in the `OPENROUTER_EXPERIENCE_CHAT_MODELS` ladder, when an editor sends a chat message, then they see a clear error in the chat panel and the request does not silently fall back to another provider.

---

## Success Criteria

- An editor using the experience editor's chat panel sees one message input, no channel chooser, and gets responses from Mastra+OpenRouter that persist across browser sessions.
- A new developer reading `apps/admin/CLAUDE.md` sees one chat path described, not five.
- `grep -r "ChatProvider\|EXPERIENCE_AI_ALLOW\|OLLAMA_CHAT\|experience-ai-claude-code\|experience-ai-codex" apps/admin/src` returns zero results after merge.
- Production deploy on Railway: chat works against OpenRouter free models, memory persists across page reloads via Postgres, and no env var beyond `OPENROUTER_API_KEY`, the existing model env vars, and the Postgres connection is required for chat to function.

---

## Scope Boundaries

- Watch revalidation env (`WATCH_REVALIDATION_URL`, `WATCH_REVALIDATION_SECRET`, `NEXT_PUBLIC_WATCH_URL`) is unrelated to chat and stays as-is on this branch.
- feat-119 PR2 (admin → manager enrichment trigger: `MANAGER_API_BASE_URL`, `MANAGER_TRIGGER_API_KEY`) is unrelated and stays.
- Embedding generation env vars (`OPENROUTER_IMAGE_TEXT_MODEL[S]`, `OLLAMA_EMBEDDING_*`) are tied to other pipelines, not chat. The embedding side keeps its OpenRouter usage; the chat-side Ollama env vars get pruned (R9).
- Mastra tool calls, richer-than-conversation-history agent memory, or multi-agent flows — out of scope. Conversation memory in Postgres is the v1 surface.
- Mobile or apps/web chat surface — out of scope. This converges admin's chat only.

---

## Key Decisions

- **Mastra-only, no provider fallback.** Adding a second provider channel reintroduces the multi-channel branching we are deleting. OpenRouter is the single provider; if it is down the chat is down and the editor sees an error.
- **Postgres over LibSQL for Mastra memory.** Railway containers are ephemeral — LibSQL files vanish on redeploy. `@mastra/pg` reuses admin's existing Postgres connection and keeps memory durable across deploys.
- **Drop the channel dropdown UI.** One channel means no choice to present. Removing the dropdown removes a class of bugs (loading states, cost labels, recommended-channel hints, error envelopes that differ per channel) and copy.
- **Mastra memory lives in a dedicated `mastra` Postgres schema.** Schema isolation keeps Mastra's tables out of Prisma's migration history and makes any future schema drop/reset a single `DROP SCHEMA mastra CASCADE` instead of table-by-table cleanup.

---

## Dependencies / Assumptions

- Admin's existing Postgres instance has capacity for Mastra memory tables. Assumed small — conversation history per experience, not vector blobs.
- `@mastra/pg` `1.10.1` (already in `apps/admin/package.json`) is compatible with admin's Postgres version and Prisma migrations. Verify no schema conflicts before merge.
- Mastra's OpenRouter resolver honors the model-ladder shape we use in `OPENROUTER_EXPERIENCE_CHAT_MODELS`. If it does not, a small adapter layer reads the env and picks the first model — but this stays inside the chat service, not as a new channel.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] Does Mastra's OpenRouter integration accept a model-ladder env directly, or does the chat service need to resolve a single model before calling Mastra?
- [Affects R6][UX] What does the chat panel composer look like with no dropdown? Send button position, focus state, and any retained per-message hints (e.g., "powered by OpenRouter free model X") need quick visual decisions.
- [Affects R7–R10][Technical] Verify nothing outside the chat surface imports the codex/claude-code/ollama adapter modules — scripts, tests, or unrelated services. Delete blast radius needs a grep pass during planning.
