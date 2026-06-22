/**
 * Specialized agents — draft-experience, add-section, rewrite-copy — plus the
 * multi-step / two-phase draft workflow agents (planner / critic / reviser /
 * skeleton / fill). Ported (consolidation U4) from
 * `apps/admin/src/mastra/agents/specialized-agents.ts`.
 *
 * Routing decision: direct dispatch by `agentId` rather than Mastra's
 * `Agent.network()`. The caller (chat service / route) picks the agent and
 * invokes it. No routing-agent middle layer.
 *
 * Tools (U8): the chat-facing agents (draft-experience, add-section) carry the
 * HTTP-backed tool callbacks to admin; the workflow-only agents
 * (planner/critic/reviser/skeleton/fill) stay TOOL-LESS — the draft/quick-draft
 * workflows do not tool-call (candidates arrive pre-loaded in the workflow
 * input), so the generation path is unaffected.
 */

import { createRequire } from "node:module"

import { Agent } from "@mastra/core/agent"

import { env } from "../../config/env"

import {
  AI_GATEWAY_USER_AGENT,
  DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
} from "../gateway-constants"
import { getExperienceChatMemory } from "../memory"
import {
  DRAFT_EXPERIENCE_PROMPT,
  ADD_SECTION_PROMPT,
  REWRITE_COPY_PROMPT,
  PLAN_EXPERIENCE_PROMPT,
  CRITIQUE_EXPERIENCE_PROMPT,
  REVISE_EXPERIENCE_PROMPT,
  SKELETON_EXPERIENCE_PROMPT,
  FILL_EXPERIENCE_PROMPT,
} from "../prompts"
import { searchVideosTool } from "../tools/search-videos"
import { lookupBibleVerseTool } from "../tools/lookup-bible-verse"
import { fetchVideoImageTool } from "../tools/fetch-video-image"

// ESM-compatible `require` for the @ai-sdk/* provider loads below. A static
// `import` here gets transformed into a bare `require()` by Mastra's CLI Rollup
// bundle, which then errors with "Cannot determine intended module format". The
// createRequire shim sidesteps the transform — same trick the other agent files
// use; see `../gateway-constants` for the rationale.
const require = createRequire(import.meta.url)

// String model ids are resolved by Mastra's ModelRouter at call time. Keep the
// explicit `openrouter/` provider prefix so the free model routes through
// OpenRouter instead of OpenAI/GPT.
const DEFAULT_MODEL_ID = "openrouter/nvidia/nemotron-3-super-120b-a12b:free"

/**
 * Resolve the model the specialized agents should use. Priority:
 *   1. JesusFilm gateway — ONLY when AI_GATEWAY_CHAT_ENABLED="true" AND
 *      AI_GATEWAY_CHAT_API_KEY is set. OFF by default (see NOTE).
 *   2. Google Gemini 3.5 Flash (GOOGLE_GENERATIVE_AI_API_KEY) — the default;
 *      native API, frontier-speed, reliable structured output.
 *   3. OpenRouter string id (Mastra's ModelRouter resolves it).
 *
 * NOTE: this resolver also feeds the multi-step draft workflow agents
 * (planner / skeleton / fill / critic / reviser), which emit strict-JSON
 * envelopes. The gateway's `coding` model (Qwen2.5-Coder-32B) FAILED that
 * contract, so the gateway is opt-in via AI_GATEWAY_CHAT_ENABLED; default
 * routing is Gemini.
 *
 * Returns a value that Mastra's `Agent.model` accepts — either a resolved
 * `LanguageModel` instance OR a string id. The cast to `any` absorbs Mastra's
 * MastraModelConfig peer-version churn.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveAgentModel(): any {
  if (env.AI_GATEWAY_CHAT_API_KEY && env.AI_GATEWAY_CHAT_ENABLED === "true") {
    // JesusFilm AI gateway (OpenAI-compatible). The @ai-sdk/openai SDK is
    // loaded via the createRequire shim (not imported from ../providers) to
    // keep that module's static `@ai-sdk/*` imports out of the Mastra CLI Rollup
    // bundle. The gateway base URL + User-Agent come from the import-free
    // `../gateway-constants` module. The User-Agent dodges Cloudflare's 403 on
    // missing/odd UAs.
    const { createOpenAI } =
      require("@ai-sdk/openai") as typeof import("@ai-sdk/openai")
    const gateway = createOpenAI({
      apiKey: env.AI_GATEWAY_CHAT_API_KEY,
      baseURL: env.AI_GATEWAY_CHAT_BASE_URL ?? DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
      name: "jesusfilm",
      headers: {
        "User-Agent": AI_GATEWAY_USER_AGENT,
      },
    })
    // `.chat()` pins the OpenAI chat-completions endpoint. The bare callable
    // `gateway(id)` defaults to the Responses API in @ai-sdk/openai v3, and the
    // gateway's vLLM backend crashes converting multi-turn tool conversations on
    // that endpoint (`KeyError: 'role'`). Chat-completions handles the same tool
    // history fine.
    return gateway.chat(env.AI_GATEWAY_CHAT_MODEL ?? "coding")
  }
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const { createGoogleGenerativeAI } =
      require("@ai-sdk/google") as typeof import("@ai-sdk/google")
    const google = createGoogleGenerativeAI({
      apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    })
    return google("gemini-3.5-flash")
  }
  return DEFAULT_MODEL_ID
}

/**
 * Specialized id space — the values the composer agent-picker surfaces and the
 * values the chat path accepts in its `agentId` argument.
 */
export type SpecializedAgentId =
  | "draft-experience"
  | "add-section"
  | "rewrite-copy"
  | "experience-planner"
  | "experience-critic"
  | "experience-reviser"
  | "experience-skeleton"
  | "experience-fill"

/**
 * Draft-experience agent — full first-draft generation, used as a chat-facing
 * specialized agent (the candidate-preloaded workflow path uses the separate
 * planner/skeleton/fill/critic/reviser agents). Full HTTP-backed tool catalog
 * (U8).
 */
export function buildDraftExperienceAgent(): Agent {
  return new Agent({
    id: "draft-experience",
    name: "Draft Experience Agent",
    description:
      "Produces a full Experience draft (title + meta + blocks) from a prompt.",
    instructions: DRAFT_EXPERIENCE_PROMPT,
    model: resolveAgentModel(),
    tools: {
      searchVideosTool,
      lookupBibleVerseTool,
      fetchVideoImageTool,
    },
    memory: getExperienceChatMemory(),
  })
}

/**
 * Add-section agent — inserts exactly one new top-level block while preserving
 * every existing block. Limited to searchVideos (U8) — the narrow job doesn't
 * need bible lookup or image fetch.
 */
export function buildAddSectionAgent(): Agent {
  return new Agent({
    id: "add-section",
    name: "Add Section Agent",
    description:
      "Adds exactly one new top-level block to an existing Experience canvas, preserving all other blocks.",
    instructions: ADD_SECTION_PROMPT,
    model: resolveAgentModel(),
    tools: {
      searchVideosTool,
    },
    memory: getExperienceChatMemory(),
  })
}

/**
 * Rewrite-copy agent — narrow text-only edits. NO tools — copy rewrites need no
 * retrieval and exposing tool affordances would encourage drift out of the
 * bounded edit scope.
 */
export function buildRewriteCopyAgent(): Agent {
  return new Agent({
    id: "rewrite-copy",
    name: "Rewrite Copy Agent",
    description: "Rewrites text fields on one specified block.",
    instructions: REWRITE_COPY_PROMPT,
    model: resolveAgentModel(),
    // Intentionally no tools — see prompt rule "NO TOOLS".
    memory: getExperienceChatMemory(),
  })
}

/**
 * Multi-step draft workflow agents — planner, critic, reviser, skeleton, fill.
 *
 * Workflow-only by construction. The multi-step draft workflow runs as one
 * logical generation with no Mastra memory writes between steps. These
 * factories intentionally DO NOT bind memory so the agents have no memory at
 * all — defense in depth alongside the workflow's `agent.generate({ ... })`
 * call sites which also omit `memory:` / `threadId:` options. Editing these to
 * bind memory would silently leak workflow runs into chat history.
 */

/**
 * Planner agent — produces a short structured outline before drafting.
 * Plain-text output, no tools.
 */
export function buildPlannerAgent(): Agent {
  return new Agent({
    id: "experience-planner",
    name: "Experience Planner Agent",
    description:
      "Drafts a short planning outline (target audience, hook, narrative arc, suggested video themes) for the multi-step draft workflow.",
    instructions: PLAN_EXPERIENCE_PROMPT,
    model: resolveAgentModel(),
    // No tools — planning is text-only reasoning.
    // No memory — workflow-only, see factory-group JSDoc above.
  })
}

/**
 * Critic agent — reviews a structured draft envelope and emits actionable
 * revision notes. Plain-text bullets, no tools.
 */
export function buildCriticAgent(): Agent {
  return new Agent({
    id: "experience-critic",
    name: "Experience Critic Agent",
    description:
      "Reviews a draft Experience envelope and emits 3-6 actionable revision notes for the multi-step draft workflow.",
    instructions: CRITIQUE_EXPERIENCE_PROMPT,
    model: resolveAgentModel(),
    // No tools — critic reads what draft produced.
    // No memory — workflow-only, see factory-group JSDoc above.
  })
}

/**
 * Reviser agent — applies critique notes to a draft and re-emits the same
 * Experience envelope JSON shape. Also the repair agent (REPAIR_AGENT_ID).
 * Stays TOOL-LESS in the standalone service: the workflow path does not
 * tool-call (candidates arrive pre-loaded in the prompt, and repair re-prompts
 * carry the offending draft + candidate refs), so no HTTP tool round-trip is
 * needed per step.
 */
export function buildReviserAgent(): Agent {
  return new Agent({
    id: "experience-reviser",
    name: "Experience Reviser Agent",
    description:
      "Applies critique notes to a draft Experience and re-emits the same envelope JSON for the multi-step draft workflow.",
    instructions: REVISE_EXPERIENCE_PROMPT,
    model: resolveAgentModel(),
    // No memory — workflow-only, see factory-group JSDoc above.
  })
}

/**
 * Skeleton agent — emits the page STRUCTURE only (an ordered tree of block
 * types/nesting, no content) for the two-phase draft workflow. NO tools —
 * structure planning needs no retrieval. No memory — workflow-only.
 */
export function buildSkeletonAgent(): Agent {
  return new Agent({
    id: "experience-skeleton",
    name: "Experience Skeleton Agent",
    description:
      "Emits the ordered block-type tree (structure only, no content) for the two-phase draft workflow's skeleton step.",
    instructions: SKELETON_EXPERIENCE_PROMPT,
    model: resolveAgentModel(),
    // No tools — structure-only planning.
    // No memory — workflow-only, see factory-group JSDoc above.
  })
}

/**
 * Fill agent — fills ONE block's content at a time for the two-phase draft
 * workflow's sequential fill step. Stays TOOL-LESS (candidates arrive
 * pre-loaded in the fill prompt). No memory — workflow-only.
 */
export function buildFillAgent(): Agent {
  return new Agent({
    id: "experience-fill",
    name: "Experience Fill Agent",
    description:
      "Fills a single block's content (one block per call) for the two-phase draft workflow's fill step.",
    instructions: FILL_EXPERIENCE_PROMPT,
    model: resolveAgentModel(),
    // No memory — workflow-only, see factory-group JSDoc above.
  })
}

/**
 * Build all specialized agents at once. Used by the Mastra runtime wiring to
 * register agents by id. Includes the three editor-facing agents (draft /
 * add-section / rewrite-copy) plus the multi-step draft workflow agents
 * (planner / critic / reviser) and the two-phase draft workflow agents
 * (skeleton / fill).
 */
export function buildSpecializedAgents(): Record<SpecializedAgentId, Agent> {
  return {
    "draft-experience": buildDraftExperienceAgent(),
    "add-section": buildAddSectionAgent(),
    "rewrite-copy": buildRewriteCopyAgent(),
    "experience-planner": buildPlannerAgent(),
    "experience-critic": buildCriticAgent(),
    "experience-reviser": buildReviserAgent(),
    "experience-skeleton": buildSkeletonAgent(),
    "experience-fill": buildFillAgent(),
  }
}
