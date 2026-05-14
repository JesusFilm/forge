# Mastra fitness spike — admin Experience-AI chat replacement (U1)

**Date:** 2026-05-14
**Plan:** `docs/plans/2026-05-14-001-feat-admin-chat-mastra-replacement-plan.md`
**Origin:** `docs/brainstorms/2026-05-13-admin-chat-mastra-replacement-requirements.md`
**Branch:** `feat/admin-chat-mastra-replacement` (worktree at `.worktrees/admin-chat-mastra/`)

## Verdict: **GO**

The four origin assumptions are workable against Mastra's current public API. The plan continues to U2.

| Assumption                                                                                                   | Verdict | Evidence                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 — All four agent shapes (tool-calling, multi-step, specialized, background) supported at production grade | **GO**  | Each primitive constructed and type-checked in `apps/admin/src/mastra-spike/spike.ts`. See §D1 below.                                                              |
| D2 — Prompt registry is at least as expressive as our current TS string builders                             | **GO**  | Static, structured, and dynamic-function forms all supported. Dynamic form reads per-call `requestContext`. See §D2.                                               |
| D3 — Memory primitive compatible with our ABAC posture                                                       | **GO**  | `requestContext` threads arbitrary objects (principal) through agent → tool → workflow → memory. See §D3.                                                          |
| D4 — AI SDK providers cover OpenRouter + Ollama                                                              | **GO**  | `@ai-sdk/openai` + `baseURL` override for OpenRouter; `ollama-ai-provider` for Ollama. Both type-check as `LanguageModel` against Mastra's `Agent.model`. See §D4. |

---

## Method

This spike verifies **API availability and shape**, not runtime behavior. The deliverable was a single TypeScript file in `apps/admin/src/mastra-spike/spike.ts` that constructs one instance of each primitive the plan depends on, exercising the type system end-to-end against Mastra's current published types.

Successful `pnpm --filter @forge/admin typecheck` was the verification signal: it means each Mastra primitive exists with the shape the plan assumes, and our intended usage compiles against it. The spike file is scratch — nothing in production imports it; the whole directory is deleted at the end of U1 (this commit creates it; U2 or a follow-up cleanup deletes it).

Runtime verification against live OpenRouter / Ollama / Postgres is deferred to U2's first end-to-end run, because the devcontainer for this session does not have provider API keys configured. The risk this defers is small — provider HTTP behavior is well-trodden in Mastra's docs and downstream consumers; the architectural assumptions in scope of U1 are the type/shape claims, which this spike pins down decisively.

---

## Packages installed (versions pinned at spike time)

Added to `apps/admin/package.json`:

| Package              | Version | Purpose                                                      |
| -------------------- | ------- | ------------------------------------------------------------ |
| `@mastra/core`       | 1.33.1  | Agent, Tool, Workflow primitives                             |
| `@mastra/memory`     | 1.18.0  | Memory primitive (threads + messages)                        |
| `@mastra/pg`         | 1.10.1  | Postgres storage adapter for Memory                          |
| `@mastra/libsql`     | 1.10.1  | LibSQL storage adapter (fallback)                            |
| `@mastra/ai-sdk`     | 1.4.2   | `handleChatStream` / `toAISdkStream` for Next.js routes      |
| `ai`                 | 5.x     | AI SDK base (peer of `@mastra/ai-sdk`)                       |
| `@ai-sdk/openai`     | 3.0.63  | OpenAI provider — used for OpenRouter via `baseURL` override |
| `ollama-ai-provider` | 1.2.0   | Ollama provider                                              |

Peer-dependency warnings during install were inspected — all unrelated to admin (zod 3.x complaints came from sibling apps that don't share the new dependency tree; admin uses zod ^4.3.6, which satisfies the AI SDK's `^3.25.76 || ^4.1.8` peer requirement).

---

## D1 — Four agent shapes

### D1a — Tool-calling agent

Primitive: `@mastra/core/agent` `Agent` + `@mastra/core/tools` `createTool`. Tools carry Zod `inputSchema` and `outputSchema`; the `execute(inputData, context)` signature receives the input fields as the first parameter and runtime context (including `requestContext`) as the second.

Spike constructs `searchVideosTool` and a `spike-tool-calling-agent` Agent with `tools: { searchVideosTool }`. Typechecks.

**API notes for U5 / U6:**

- **createTool execute signature is `(inputData, context)`** — two params, not the destructured single-object form. This is the Mastra v1 shape (renamed from `runtimeContext` to `requestContext`). The plan's prose in U5 should describe this signature; per-tool tests need to construct calls accordingly.
- ABAC threading: `context.requestContext.get("principal")` reads whatever the route handler put on the context at call time.

### D1b — Multi-step planning workflow

Primitive: `@mastra/core/workflows` `createStep` + `createWorkflow` + `.then()` chaining. Steps carry their own `inputSchema` / `outputSchema`. Workflows are committed with `.commit()` before use.

Spike constructs a 2-step `plan → draft` workflow demonstrating the chain shape. U7's "plan → draft → critique → revise" workflow extends this pattern to 4 steps with a hard step ceiling enforced by the fixed chain length.

**Step budget note:** the step cap is implicit in the workflow's `.then()` chain length — no recursion is possible because steps are statically declared. This matches origin C7 (runaway-loop prevention) without needing an explicit per-call cap; the time budget (`AbortSignal.timeout(60_000)`) covers the wall-clock dimension separately.

### D1c — Specialized agents per task

Multiple distinct `Agent` instances, each with its own `instructions`, `tools`, and (optionally) `memory`. The spike constructs `addSectionAgent` (tools: `searchVideosTool`) and `rewriteCopyAgent` (no tools) alongside the default `toolCallingAgent`. Each is type-checked independently.

**Routing decision for U8:** the plan currently calls for direct invocation by `agentId` from the streaming bridge, not Mastra's `Agent.network()` routing. The spike does NOT exercise `Agent.network()` — that primitive is an optional escalation only if U8 implementation reveals direct dispatch falls short. Default direct-dispatch stands.

### D1d — Background / async agent

A background agent is simply an `Agent` instance invoked outside an HTTP request lifecycle. The spike constructs `autoEnrichAgent` and a `backgroundShape(experienceLocaleId)` function demonstrating the invocation surface compiles. In U9 the surrounding orchestrator is `useworkflow`; Mastra's Agent doesn't know or care.

**No new infrastructure required** for D1d — this is the lowest-risk shape architecturally. It reuses admin's existing useworkflow + Railway runtime.

---

## D2 — Prompt registry expressiveness

Mastra's `Agent.instructions` accepts:

- **Static string** (today's most common shape; equivalent to current TS string builders).
- **System-message object** (`{ role: "system", content: ... }`) for structured prompts.
- **Array of system-message objects** for layered system prompts.
- **Dynamic function** `({ requestContext }) => string | Promise<string>` for per-call templating.

The dynamic function form is the load-bearing one for U4 (prompt registry migration). It replaces today's `buildChatPrompt(state, history, candidates, userPrompt)` pattern — instead of taking explicit positional arguments, the prompt function pulls per-call state out of `requestContext` (locale, canvas, candidate videos, principal). The spike's `dynamicInstructions(({ requestContext })` function compiles against the Agent's `instructions` field type.

**U4 plan implication:** prompts move into per-file modules under `apps/admin/src/mastra/prompts/`. Each file exports either a static string OR a dynamic function — the choice is per-prompt. The current Q&A brief prompts (already disabled on the parallel branch) don't carry forward; full-draft prompts and add-section/rewrite-copy prompts do.

**Mastra prompt versioning / evaluation:** the framework does NOT ship an opinionated prompt-registry abstraction beyond "instructions can be a function". Versioning, evaluation, A/B testing of prompts are not Mastra primitives in the current release; if we want them, we add them on top. Origin's G3 is satisfied by "prompts as first-class registered modules" + future eval tooling as follow-up.

---

## D3 — ABAC-compatible memory

Mastra's `Memory` primitive accepts a `storage` adapter — verified shapes:

- `PostgresStore({ id, connectionString })` — production target.
- `LibSQLStore({ id, url })` — fallback if Postgres-adapter behavior under admin's Prisma `connection_limit=10` posture surfaces issues.

Memory keys threads by `threadId` and `resourceId`. The plan's design (U2) is:

- `threadId` = `experienceLocaleId`
- `resourceId` = `principalId`

This naturally aligns memory scoping to ABAC — one editor's threads are scoped under their principal, and the Memory adapter's read APIs accept the `resourceId` filter. The same `requestContext` that threads through tools and agents reaches memory via the Agent's `memory: ({ requestContext }) => Memory` dynamic form (verified in the Agent constructor type signature documented at `mastra-ai/mastra`).

**Storage backend decision for U2:** **Postgres** is the v1 target. Reasoning:

1. Admin already operates a Postgres instance; adding a Mastra-owned schema or table prefix avoids a parallel storage tier.
2. Backups, monitoring, and operational tooling already cover admin's Postgres.
3. LibSQL adds an unfamiliar storage system without clear benefit at admin's scale.

LibSQL stays as the documented fallback in case U2 surfaces a concrete blocker (e.g., connection-pool contention with admin's Prisma client). The fallback is one line of config change; the spike confirms both adapter types compile.

**ABAC bypass concern (raised in plan R12, risk #4):** Memory itself is data — the ABAC check that matters is on _writes_, not memory storage. Every agent-driven mutation still routes through `experience.service.ts` (the service-layer ABAC seam). Memory's `resourceId` scoping is a defense-in-depth layer, not the primary control. This matches origin C3.

---

## D4 — AI SDK providers for OpenRouter + Ollama

Verified imports and constructor shapes:

```ts
import { createOpenAI } from "@ai-sdk/openai"
import { createOllama } from "ollama-ai-provider"

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  name: "openrouter",
})
const ollama = createOllama({ baseURL: "http://localhost:11434/api" })
```

The provider instances are callable with a model id (e.g., `openrouter("openai/gpt-5.4")`) returning a `LanguageModel` that Mastra's `Agent.model` accepts.

**OpenRouter shape:** OpenRouter exposes an OpenAI-compatible HTTP wire, so the `@ai-sdk/openai` provider with a `baseURL` override is the canonical pattern. This is documented in the OpenAI SDK README and in OpenRouter's own integration guide. No custom provider needed.

**Model selection:** Mastra's `Agent.model` accepts either a `LanguageModel` instance (constructed at module load) or a dynamic `({ requestContext }) => LanguageModel` function (for per-call model routing — useful if the editor's chosen provider/model arrives in `requestContext`). U2 picks the static form as default; U8 may switch to dynamic if the agent-picker UI conflates provider + agent into one selection.

**OpenAI direct (`@ai-sdk/openai`) and Anthropic (`@ai-sdk/anthropic`) providers:** also supported with no extra spike work — same constructor pattern. Enabled by setting their respective env vars; otherwise unused.

**Provider env vars for U2 (all `.optional()` per institutional learning):**

- `OPENROUTER_API_KEY` — primary cloud provider.
- `OLLAMA_BASE_URL` — defaults to `http://localhost:11434/api` in dev.
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — optional direct-provider routes.

---

## What this spike did NOT verify

- **Real-network latency / cost** against OpenRouter or Ollama at production call volumes. Cost guardrails (U11) and budget caps assume reasonable per-call costs; if real numbers diverge wildly from assumption, U11 budgets need re-tuning. Not a blocker for U2.
- **`@mastra/pg`'s pool behavior** alongside admin's existing Prisma pool. Admin's `connection_limit` is 10. Mastra's `PostgresStore` opens its own pool. U2's first happy-path test should observe connection counts during memory I/O; if contention shows up, switch to LibSQL or share the Prisma pool via the `pool: existingPool` option Mastra exposes.
- **`@mastra/ai-sdk`'s `handleChatStream` against the existing SSE route**. U3's job — the streaming bridge is the contract that this U1 spike deliberately did not test, because the bridge is its own architectural challenge worth a dedicated unit.
- **Agent.network() routing for specialized agents**. Direct-dispatch wins by default per the plan; `Agent.network()` is the escalation if direct-dispatch reveals limits.
- **Prompt evaluation / versioning tooling**. Out of scope per origin (deferred to follow-up work).

---

## Cleanup at end of U1

The `apps/admin/src/mastra-spike/` directory and the spike file are committed alongside this findings doc so the verification trail is preserved in git. U2 will either:

1. Delete `apps/admin/src/mastra-spike/` outright in its first commit (clean approach), OR
2. Move `spike.ts` to a test-tagged location and adapt parts into the new `apps/admin/src/mastra/` runtime (if any patterns are reusable).

The plan's U2 description treats the spike directory as scratch; default to (1) unless implementation reveals reuse value.

---

## Plan continuation

U1 closed with GO verdict. U2 (Mastra foundation — install, providers, native memory) is unblocked. The plan's Phase 1 (U1–U4) proceeds.

The deferred runtime verifications above feed into U2's exit criteria — U2 is not "done" until at least one Mastra agent has been invoked end-to-end against either OpenRouter or Ollama, confirming the API-keys and provider config path works in development.

## Related learnings

- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` — informs the `.optional()` posture for all new Mastra env vars in U2.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — informs the spike's "type-check proves shape; runtime verification proves contract" framing.
- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md` — sibling example of a solutions doc that captures architectural verification findings before downstream units commit.
