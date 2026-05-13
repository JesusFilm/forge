---
date: 2026-05-13
topic: admin-chat-mastra-replacement
---

# Admin Experience-AI Chat — Big-Bang Mastra Replacement

## Problem Frame

The Experience-AI chat in `apps/admin` is the surface editors use to ask the AI to draft, modify, or extend an Experience (the editorial unit that becomes `/watch/<slug>` on `apps/web`). Today the chat lives in `apps/admin/src/services/experience-ai/` as a custom 4-channel service: OpenRouter (HTTP), Ollama (HTTP), Codex CLI (subprocess), Claude Code CLI (subprocess). Each channel has its own quality-draft and chat-turn adapter. The chat produces a structured envelope, validated against a Zod schema, which becomes a diff applied to the editor canvas through an imperative `canvasController`.

The current service works, but is intentionally narrow. Specifically, it cannot:

- Call functions during a turn (the AI receives candidate videos pre-fetched into the prompt; it can't _decide_ to search for more)
- Plan-then-act (each turn is a single prompt with a single structured response)
- Differ in behavior by task (one prompt scaffold per turn, regardless of what the editor wants)
- Run outside an editor session (no background or scheduled agent work)
- Manage prompts as first-class assets (prompts are TypeScript string builders; no versioning, evaluation, or registry)

The bet is that Mastra (`mastra.ai`) — a TypeScript agent framework with first-class memory, tool-calling, workflows, model routing, and a prompt registry — gives all of these capabilities under one foundation. The cost is a full rewrite of the chat service and the loss of the two CLI channels (Mastra cannot route subprocess providers without a custom adapter we have chosen not to build).

This brainstorm captures the WHAT of that rewrite. Detailed implementation (file layout, schema migration steps, exact tool definitions, API surfaces) is for `/ce-plan` to resolve.

### Adoption strategy

This is **Approach A — big-bang replacement**, not side-by-side adoption. The current `experience-ai-chat.service.ts` and its provider adapters are removed by the time this branch merges. The current `feat/admin-chat-multi-channel-providers` branch stays mergeable independently (image-URL fixes, brief-flow disable, video-library hydration) and can ship to production without waiting for this rewrite.

### Done definition

The branch merges only when **all four agent shapes** are working — tool-calling, multi-step planning, specialized-per-task, and background/async. This is a deliberately wide scope. The user explicitly chose "full all-four before merge" over the lower-risk options (parity-only, parity + one new agent, parity + memory + prompts). The trade-off is long branch life and a large merge, exchanged for shipping a meaningfully different AI surface in one cut.

## Goals

- G1. Replace the custom 4-channel chat service with a Mastra-powered chat service.
- G2. Ship all four agent shapes in the same merge:
  - **Tool-calling agent** — AI calls functions during a turn (video search, image lookup, content recall) instead of receiving pre-fetched context only.
  - **Multi-step planning agent** — AI plans → drafts → critiques → revises in a loop within one request before returning a final result.
  - **Specialized agents per task** — distinct agent definitions for distinct editor jobs (e.g. "draft a whole experience" vs "add a section" vs "rewrite copy"), picked at chat send time.
  - **Background / async agent** — agent work that runs outside an editor session and surfaces results back to the editor when the editor next visits the experience.
- G3. Move prompt management from TypeScript string builders into Mastra's prompt registry, so prompts become versionable and evaluable assets rather than inline code.
- G4. Move chat memory (threads + messages) into Mastra's memory primitive, so the same memory layer serves all four agent shapes uniformly.
- G5. Preserve the editor-side canvas contract (`canvasController.applyDiff` / `revertDiff`) so the canvas, diff renderer, and approval/rollback UX do not require a parallel rewrite.
- G6. Preserve hybrid-search and existing services as first-class tool targets — the new agents call them instead of duplicating retrieval logic.

## Non-Goals

- NG1. **CLI subscription channels (Codex CLI, Claude Code CLI) are not preserved.** The model-routing layer is AI SDK providers only (OpenRouter, Ollama, OpenAI, Anthropic, and equivalents Mastra ships natively). The cost model shifts from "operator's local CLI subscription" to "per-API-call billing on the surviving providers".
- NG2. **No changes to the chat panel UI** (`experience-chat-panel.tsx`). Streaming events, composer, message rendering, and approval surfaces stay as-is. The agent-picker UI is a small additive change inside the same component, not a redesign.
- NG3. **No changes to the canvas / diff / mutation system** (`experience-editor.tsx`, `experience-editor-with-chat.tsx`, the canvas controller bridge). The new agents output diffs adapted to the existing `ChatStreamEvent.mutation_applied` shape; the canvas layer sees no difference.
- NG4. **No changes to `apps/web`, `apps/mobile`, or other consumers.** This rewrite is admin-only.
- NG5. **No retrieval-system rewrite.** Hybrid search, scene recommendations, and embedding pipelines stay as they are — agents call them as tools.
- NG6. **No mobile chat surface.** Mobile does not have an AI chat today and is not getting one in this rewrite.
- NG7. **No re-introduction of CLI providers via a custom Mastra AI SDK provider adapter.** Considered and dropped — operator-subscription billing is not worth the maintenance.

## Scope of Replacement

In scope of the rewrite:

- `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts` — entire chat orchestrator.
- All per-channel adapters (`experience-ai-openrouter-free.ts`, `experience-ai-ollama.ts`, `experience-ai-codex.ts`, `experience-ai-claude-code.ts`) — removed or rewritten as Mastra agents/tools.
- Provider type and routing (`experience-ai-chat-provider.ts`) — replaced by Mastra's model-routing layer plus an agent-picker concept.
- Prompt builders (`experience-ai-chat-prompts.ts`, `experience-ai-quality-draft*.ts`) — relocate prompts into Mastra's prompt registry.
- Brief flow (`experience-ai-chat-brief.ts`) — already disabled on `feat/admin-chat-multi-channel-providers`; not revived.
- Mutation envelope schema and diff plumbing (`experience-ai-chat-envelope.ts`, `experience-chat-diff.ts`) — preserved at the canvas boundary; internally adapted to whatever Mastra agents produce.
- Memory model — `experienceChatThread` + `experienceChatMessage` Prisma tables transition to Mastra-owned memory (see Open Questions for migration shape).

Out of scope of the rewrite:

- The route handler at `/api/experience-chat/stream` — surface stays but internally hands off to Mastra's stream primitives. (Note: a separate Mastra-recommended route at `/api/chat/[agentId]` may be added; the existing route is preserved for editor-side compatibility.)
- All editor / canvas / panel UI code.
- All non-chat admin features.

## Agent Shapes — Behavior Requirements

### G2a. Tool-calling agent

- An editor turn that requires editor-known references (video, image, verse, related content) invokes tools instead of relying on pre-fetched candidates.
- Minimum tool catalog at merge: `searchVideos` (calls existing hybrid search), `lookupBibleVerse` (existing reference data), `fetchVideoImage` (existing video-image service). Additional tools surface in planning.
- Tool calls are visible to the editor in the streaming UI — at least as a "thinking / searching" indicator; ideally with the tool name and a result summary.
- Tool failures degrade gracefully: the agent reports the failure in the assistant message rather than crashing the turn.

### G2b. Multi-step planning agent

- A multi-step agent runs plan → draft → self-critique → revise within a single editor turn.
- The editor sees either (a) the final result only, or (b) intermediate step events streamed for transparency — the exact UX is for planning to resolve, but both must be supportable from the agent definition.
- Step bounds: a per-turn cap exists (probably 3–5 internal steps) to prevent runaway agent loops.

### G2c. Specialized agents per task

- At least three distinct specialized agents are defined at merge:
  - **Draft-experience agent** — full first-draft Experience from a prompt + optional Bible/topic cues.
  - **Add-section agent** — adds exactly one new top-level block to an existing draft, preserving everything else.
  - **Rewrite-copy agent** — narrow text-only edits to a specified block.
- The editor selects the specialized agent at send time. The picker UI is a chip / dropdown on the composer. Default selection is the draft-experience agent for empty canvas, add-section for populated canvas (auto-pick can be refined later).
- Each specialized agent has its own prompt template (in the registry) and its own tool subset where useful.

### G2d. Background / async agent

- At least one background agent is wired and demonstrably runs outside an editor session.
- Initial trigger: a manual GraphQL/REST mutation an operator invokes (mirroring how existing useworkflow workflows are triggered). Cron and event-driven triggers come in follow-up work.
- The background agent writes its output back into a place editors can review — either as a chat-thread message attributed to the agent, or as a draft `ContentRevision` on the experience locale. The exact channel is for planning to choose, but the editor MUST be able to see what the background agent did the next time they open the experience.
- Initial use case suggestion (for planning to confirm or replace): "auto-enrich blocks" — fills missing image URLs, Bible-verse refs, or video metadata on a draft experience.

## Memory and Prompt Foundations

### G3. Prompt management

- All system prompts and template fragments currently in `experience-ai-chat-prompts.ts` (and the quality-draft prompt builder) move into Mastra's prompt registry.
- Prompts are addressable by name and (where Mastra supports it) version.
- Tests that previously asserted prompt content (e.g. `experience-ai-chat-prompts.test.ts`) re-target to registry-level assertions.

### G4. Memory persistence

- Mastra owns chat memory for the new system. Threads, messages, and any per-agent state Mastra needs live in Mastra-managed storage.
- The existing `experienceChatThread` / `experienceChatMessage` Prisma tables either (a) become a compatibility mirror Mastra writes through, (b) are dropped entirely with old chat history archived elsewhere, or (c) stay read-only for old threads while new threads live entirely in Mastra. The choice is an Open Question — see below — but the editor-visible behavior must remain: editors can resume past threads on existing experiences.
- ABAC remains enforced. Service-layer `canEditExperienceLocale` checks still wrap any mutation an agent applies; agents themselves run inside an ABAC-aware service context.

## Canvas / Diff Contract Preservation

### G5. Editor-side contract

- The `ChatStreamEvent` union exported by the chat service stays shape-compatible at the `mutation_applied`, `mutation_proposal`, `token_delta`, `error`, and `done` event types. Internal shape of the diff payload may change only if `applyDiff` / `revertDiff` on the canvas controller are updated in lockstep.
- The canvas controller and the panel-side `applyDiff` adapter (`experience-chat-panel.tsx` line ~330) remain untouched in terms of inputs and outputs.
- Streaming continues to flow through the same SSE-style route handler.

## Provider Surface

### Surviving providers

- OpenRouter (HTTP), Ollama (HTTP), OpenAI (direct), Anthropic (direct) — whichever AI SDK providers Mastra supports natively that we have or want keys for.
- Per-channel model overrides remain via env var (e.g. `OLLAMA_CHAT_MODEL`, `EXPERIENCE_AI_OPENAI_MODEL` etc.) — exact env-var naming for planning.
- Provider selection in the UI: simplified to a model dropdown rather than a "channel" dropdown, since channels and providers collapse to one concept under Mastra. The agent-picker is the orthogonal dimension.

### Removed providers

- Codex CLI subprocess channel — removed entirely.
- Claude Code CLI subprocess channel — removed entirely.
- The env gates `EXPERIENCE_AI_ALLOW_CODEX`, `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK`, `EXPERIENCE_AI_ALLOW_CLAUDE_CODE` and the CLI-binary-availability checks all go away.

## Success Criteria

- S1. An editor can complete the existing chat workflows (draft an experience, add a section, rewrite copy) on the new system without noticing the underlying change, on at least one of the surviving providers (OpenRouter or Ollama as a minimum).
- S2. A tool-calling agent demonstrably calls `searchVideos` from inside a chat turn and uses the result. The editor sees the tool activity (at minimum: a "searching videos…" indicator).
- S3. A multi-step planning agent demonstrably runs plan → draft → critique → revise inside a single editor turn for at least one specialized agent.
- S4. The agent picker UI offers at least three specialized agents and routing works end-to-end for each.
- S5. The background agent runs from a manual operator trigger and the editor can see its output on the next page visit.
- S6. The CI test suite (`pnpm --filter @forge/admin test`) passes including agent unit tests and chat-stream integration tests. Lint and typecheck clean.
- S7. The chat panel UI renders identically — no visual regression on the editor-facing components.
- S8. Old chat history is either readable, archived clearly, or migrated. No "your past chats disappeared" experience for editors.

## Constraints

- C1. Mastra version is whatever is current on npm at start of implementation. Pin and document.
- C2. `apps/admin` strict TypeScript mode applies. No `any` without justification.
- C3. ABAC enforcement is non-negotiable. Every agent-driven mutation flows through service-layer `canEditExperienceLocale` (or sibling) checks. Mastra runs _inside_ that service context, not around it.
- C4. The existing `revisedByKind: "AI"` stamp continues to be applied to ContentRevision rows created by agent-driven writes.
- C5. The chat service must run inside Railway's standard Node.js runtime. No special infrastructure (no separate Mastra server, no detached worker process unless `apps/admin` already supports it via useworkflow).
- C6. Background agents reuse `useworkflow` for durable execution where the agent runs longer than a request lifetime — they do not introduce a parallel job-runner.
- C7. Cost: agents that loop (multi-step planning, background) must have explicit step / time / token budgets so a runaway loop cannot bill unbounded API calls.

## Dependencies / Assumptions

- D1. Mastra supports the four agent shapes we need at production-grade. Assumption based on Mastra's marketing surface and Next.js getting-started guide; planning must verify each shape works end-to-end in a small spike before committing to the full rewrite.
- D2. Mastra's prompt registry is at least as expressive as our current TS prompt builders, including dynamic interpolation of state and history. Assumption; verify in spike.
- D3. Mastra's memory primitive is compatible with our ABAC posture — i.e., memory keyed by `experienceLocaleId` plus principal can be scoped so one editor doesn't see another's threads. Assumption; verify in spike.
- D4. The AI SDK providers Mastra ships are sufficient for both OpenRouter and Ollama with the model overrides we use today. Assumption; verify in spike.
- D5. Hybrid search and reference services in `apps/admin` can be invoked as tools without significant refactor — i.e., their service-layer entry points are callable from a Mastra tool function with appropriate ABAC context. Assumption; the services already have clean service-layer entry points, so likely fine.
- D6. Branch life will exceed a sprint. Main may move underneath; we accept the rebase cost.
- D7. The current `feat/admin-chat-multi-channel-providers` branch ships independently to production before or during this rewrite, so editors aren't waiting on the rewrite for the canvas-hydration / image / brief-flow fixes already done.

## Open Questions

- Q1. **Memory migration strategy.** Drop `experienceChatThread` / `experienceChatMessage`? Keep as read-only archive? Mirror through? Decision affects whether old chat history is preserved and how Mastra stores new threads.
- Q2. **Full tool catalog at merge.** Beyond `searchVideos`, `lookupBibleVerse`, `fetchVideoImage`, what else is in the v1 tool set? Image-search, scene-recommendations, related-experience-lookup, embedding-query-by-locale — all candidates.
- Q3. **Background agent first use case.** "Auto-enrich blocks" is the suggestion; planning may pick something else (e.g. "weekly stale-content reviewer", "publish-readiness check"). The chosen use case shapes the trigger mechanism.
- Q4. **Specialized-agent auto-pick logic.** When the editor types without explicitly picking an agent, which one runs? Empty-canvas → draft, populated-canvas → add-section is a starting heuristic; needs validation.
- Q5. **Streaming format under Mastra.** Mastra's `handleChatStream` produces AI SDK UI message stream. Our existing SSE has a custom `ChatStreamEvent` shape. The adapter between them needs design.
- Q6. **Provider dropdown vs agent dropdown** in the composer — one combined picker or two? UX call for planning.
- Q7. **Cost budget per agent shape.** What's the per-turn token / call ceiling for each shape? Needs explicit numbers in the plan.
- Q8. **Rollback plan if the rewrite stalls.** Do we keep the current branch shippable in parallel? (Currently yes — that branch is independent.) Is there a feature-flag escape hatch on `apps/admin` to fall back to the old service if Mastra misbehaves in prod?

## Risks

- R1. **Branch life.** Months of work in one branch increases merge conflict surface and means no editor sees value until the cut lands.
- R2. **Spec gap on agent shapes.** "All four agent shapes" doesn't have crisp acceptance criteria for every shape (especially multi-step planning and background). S2–S5 above lock minimum demos but leave depth ambiguous.
- R3. **Mastra fitness.** If any of D1–D4 turns out wrong in the spike, we're stuck adding adapter layers or dropping a shape. Mitigation: run the spike before committing to the full rewrite.
- R4. **Cost surprise.** Multi-step agents and background agents can consume API calls faster than single-turn chats. C7 budgets cap this, but real usage might still exceed assumptions.
- R5. **Editor confusion at cutover.** The provider dropdown changes shape, agent picker appears, behavior subtly differs. Internal release-notes and a short editor walkthrough at cutover.
- R6. **Lost history experience.** If Q1 resolves toward "drop old threads", editors lose past conversations on existing experiences. Mitigate with an export or a read-only archive.

## Out-of-Scope (Restated)

- Apps/web AI features.
- Mobile AI chat.
- Chat panel UI rewrite.
- Canvas / editor / diff system rewrite.
- Migration of existing chat history to a new schema (assumption: kept readable; new threads on the new path).
- Custom Mastra AI SDK providers for Codex CLI / Claude Code CLI.
- Re-introduction of operator-subscription cost model.

## Next Step

`/ce-plan` on this requirements document, starting with a spike that resolves D1–D4 against a real Mastra install in the `feat/admin-chat-mastra-replacement` worktree before sizing the full rewrite.
