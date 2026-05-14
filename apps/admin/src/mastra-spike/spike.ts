/**
 * Mastra fitness spike (U1 of the chat-replacement plan).
 *
 * This file is intentionally scratch — it is NOT imported by any
 * production code path and exists only to verify that the four origin
 * assumptions (D1–D4) are workable against the real `apps/admin`
 * codebase + Mastra's current public API.
 *
 * What this file proves
 * ---------------------
 * Each section below constructs the Mastra primitive named by the
 * relevant origin assumption. Successful TypeScript compilation
 * (`pnpm --filter @forge/admin typecheck`) is the verification signal
 * — it means the API exists with the shape the plan assumes, and our
 * intended usage type-checks against it. Runtime verification against
 * a real provider is best-effort here (the devcontainer has no API
 * keys), and is deliberately deferred to U2's first end-to-end run.
 *
 * What this file does NOT prove
 * -----------------------------
 * - Real-network performance against OpenRouter / Ollama at production
 *   call volumes.
 * - Postgres storage adapter behavior under admin's `connection_limit`
 *   posture.
 * - Any panel-side rendering behavior of the streaming bridge (that's
 *   U3's job).
 *
 * If this file ever ships to production by accident
 * -------------------------------------------------
 * The whole `apps/admin/src/mastra-spike/` directory is deleted at the
 * end of U1 once the findings doc is written. Nothing imports it.
 * Its presence in `main` is a sign U1 was not closed out cleanly.
 */

import { Agent } from "@mastra/core/agent"
import { createTool } from "@mastra/core/tools"
import { createStep, createWorkflow } from "@mastra/core/workflows"
import { Memory } from "@mastra/memory"
import { PostgresStore } from "@mastra/pg"
import { LibSQLStore } from "@mastra/libsql"
import { createOpenAI } from "@ai-sdk/openai"
import { createOllama } from "ollama-ai-provider"
import { z } from "zod"

// ---------------------------------------------------------------------------
// D4: AI SDK providers for OpenRouter + Ollama
// ---------------------------------------------------------------------------
//
// OpenRouter speaks the OpenAI-compatible HTTP wire. We use the
// @ai-sdk/openai provider with a `baseURL` override, which is the
// documented pattern. Ollama uses its own provider package.
//
// Both providers return AI-SDK `LanguageModel` instances that Mastra's
// Agent constructor accepts on the `model` field.

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY ?? "missing",
  baseURL: "https://openrouter.ai/api/v1",
  name: "openrouter",
})

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/api",
})

// Spike-only: pick whichever provider env happens to be present at
// invocation time so this file doesn't crash at import in CI.
const spikeModel = openrouter("openai/gpt-5.4")
void ollama // referenced to keep TS from pruning the import in checks

// ---------------------------------------------------------------------------
// D3: ABAC-compatible memory
// ---------------------------------------------------------------------------
//
// Two storage adapters demonstrated:
//   1. PostgresStore  — production-target adapter; uses admin's existing PG.
//   2. LibSQLStore    — file-backed fallback if Postgres adapter has issues
//                       under admin's connection_limit posture.
//
// Either works as the `storage` arg to `new Memory(...)`. The Memory
// instance attaches to an Agent via the `memory` field. Memory is
// keyed by thread / resource (see Mastra docs); we'll key by
// `experienceLocaleId` and `principalId` in U2.
//
// ABAC compatibility: Mastra's RuntimeContext (used per-call via the
// dynamic `instructions: ({ requestContext }) => ...` and tool
// `execute({ context })` shapes) lets us pass an arbitrary principal
// object through to memory loaders, tools, and prompt builders. The
// type signatures below take a function form that accepts
// `{ requestContext }` — that's the seam ABAC threads through.

const pgStorage = new PostgresStore({
  id: "mastra-spike-pg",
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://localhost/forge_admin",
})

const libsqlStorage = new LibSQLStore({
  id: "mastra-spike-libsql",
  url: process.env.MASTRA_LIBSQL_URL ?? "file:./mastra-spike.db",
})

const memory = new Memory({
  storage: pgStorage,
})
void libsqlStorage // demonstrate the LibSQL adapter type-checks too

// ---------------------------------------------------------------------------
// D2: Prompt registry expressiveness
// ---------------------------------------------------------------------------
//
// Three shapes that prove our prompt-management goals are achievable:
//   - Static string  — equivalent to today's TS string builders.
//   - System-message object — structured form for richer prompts.
//   - Dynamic `({ requestContext }) => string` — runtime templating
//     against per-call context (canvas state, candidates, principal).
//
// The dynamic form is the load-bearing one. It replaces today's
// `buildChatPrompt(state, history, candidates, userPrompt)` pattern by
// reading state out of `requestContext` instead of taking explicit
// arguments. This is what U4 (prompt registry migration) will use.

const STATIC_PROMPT_STRING =
  "You draft Experience pages from editor prompts. Return a structured envelope."

const dynamicInstructions = async ({
  requestContext,
}: {
  requestContext?: { get: (key: string) => unknown }
}) => {
  // Demonstrates: at call time, the agent pulls per-request context
  // out of the runtime context and assembles its system prompt.
  const locale = (requestContext?.get("locale") as string | undefined) ?? "en"
  const canvas = (requestContext?.get("canvas") as
    | { blockCount: number }
    | undefined) ?? {
    blockCount: 0,
  }
  return `${STATIC_PROMPT_STRING}\nLocale: ${locale}. Existing blocks: ${canvas.blockCount}.`
}

// ---------------------------------------------------------------------------
// D1: Four agent shapes
// ---------------------------------------------------------------------------
//
// Each subsection below constructs the primitive Mastra exposes for
// the corresponding agent shape from the origin doc.

// --- D1a: Tool-calling agent ---------------------------------------
//
// `createTool({ id, inputSchema, outputSchema, execute })` produces a
// tool the Agent can invoke. The `execute` callback receives the
// runtime context for ABAC threading.

const searchVideosTool = createTool({
  id: "searchVideos",
  description:
    "Search the video library for videos matching the editor's intent.",
  inputSchema: z.object({
    q: z.string().min(1),
    locale: z.string().default("en"),
  }),
  outputSchema: z.object({
    videos: z.array(
      z.object({
        videoId: z.string(),
        title: z.string(),
      }),
    ),
  }),
  execute: async (inputData, context) => {
    // In U5, this calls hybridSearchService.search(...) with the
    // principal pulled out of `context.requestContext` (the ABAC seam).
    // Mastra v1's createTool execute signature is `(inputData, context)`
    // — distinct from createStep workflows, which keep the
    // destructured-object form.
    void inputData
    void context?.requestContext
    return { videos: [] }
  },
})

const toolCallingAgent = new Agent({
  id: "spike-tool-calling-agent",
  name: "Spike — Tool-Calling Agent",
  instructions: dynamicInstructions,
  model: spikeModel,
  tools: { searchVideosTool },
  memory,
})

// --- D1b: Multi-step planning workflow -----------------------------
//
// `createStep + createWorkflow + .then().then()...` produces a
// fixed-step pipeline. Each step has its own input/output schema and
// can invoke an agent via `mastra.getAgent(...).generate(...)`.
//
// The U7 multi-step "plan → draft → critique → revise" workflow uses
// this primitive; the spike sketches a 2-step demo to prove the API.

const planStep = createStep({
  id: "plan",
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ plan: z.string() }),
  execute: async ({ inputData }) => {
    // In U7, this calls the tool-calling agent under a "planner"
    // system prompt to produce an outline.
    return { plan: `Outline for: ${inputData.prompt}` }
  },
})

const draftStep = createStep({
  id: "draft",
  inputSchema: z.object({ plan: z.string() }),
  outputSchema: z.object({ envelope: z.string() }),
  execute: async ({ inputData }) => {
    // In U7, this calls the tool-calling agent under a "drafter"
    // system prompt with the plan in context.
    return { envelope: `Drafted from: ${inputData.plan}` }
  },
})

const multiStepWorkflow = createWorkflow({
  id: "spike-multi-step-draft",
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ envelope: z.string() }),
})
  .then(planStep)
  .then(draftStep)

multiStepWorkflow.commit()

// --- D1c: Specialized agents per task ------------------------------
//
// Multiple distinct Agent instances, each with its own instructions
// and tool subset. The composer agent picker (U8) addresses them by
// `agentId`. No routing-agent middle layer in v1 — direct dispatch
// from the streaming bridge.

const addSectionAgent = new Agent({
  id: "spike-add-section-agent",
  name: "Spike — Add Section Agent",
  instructions:
    "Add exactly one new top-level block to the existing canvas. Preserve every other block verbatim.",
  model: spikeModel,
  tools: { searchVideosTool },
  memory,
})

const rewriteCopyAgent = new Agent({
  id: "spike-rewrite-copy-agent",
  name: "Spike — Rewrite Copy Agent",
  instructions:
    "Edit only the specified block's text fields. Do not add or remove blocks.",
  model: spikeModel,
  // Intentionally no tools — copy-rewrite needs no retrieval.
  memory,
})

// --- D1d: Background / async agent ---------------------------------
//
// A background-style invocation is simply calling `agent.generate()`
// outside an HTTP request lifecycle. In U9, the surrounding
// orchestrator is `useworkflow` (admin's durable-job system) — the
// Mastra agent itself is unchanged. The spike demonstrates the
// invocation shape; no useworkflow integration here.

const autoEnrichAgent = new Agent({
  id: "spike-auto-enrich-agent",
  name: "Spike — Auto-Enrich Agent",
  instructions:
    "Fill missing imageUrl and videoId references on the provided blocks. Return the enriched blocks array.",
  model: spikeModel,
  tools: { searchVideosTool },
  memory,
})

async function backgroundShape(experienceLocaleId: string): Promise<void> {
  // U9 wraps this inside a useworkflow `start()` body, with the
  // principal injected into requestContext for ABAC. Here, just
  // demonstrate the call shape compiles.
  void experienceLocaleId
  // Note: not actually invoking the model — no API key in this env.
  void autoEnrichAgent
}

// ---------------------------------------------------------------------------
// Surface the constructed primitives so the file is reachable code,
// not just type declarations. (No exports — this file is scratch.)
// ---------------------------------------------------------------------------

void toolCallingAgent
void addSectionAgent
void rewriteCopyAgent
void multiStepWorkflow
void backgroundShape
