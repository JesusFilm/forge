/**
 * Auto-enrich background agent. Ported (consolidation U4) from
 * `apps/admin/src/mastra/agents/auto-enrich-agent.ts`.
 *
 * Runs outside an editor session — fills missing `imageUrl` and `videoId`
 * references on a target experience locale's blocks. It has no live dispatch on
 * the consolidation base (registered + Studio-invocable only); it comes along
 * as config so the standalone runtime owns the full draft/chat agent set.
 *
 * Tools (U8): searchVideos + fetchVideoImage as HTTP callbacks to admin's
 * bearer-gated /api/internal/agent-tools/* (no scripture lookup).
 */

import { createRequire } from "node:module"

import { Agent } from "@mastra/core/agent"

import { env } from "../../config/env"

import { getExperienceChatMemory } from "../memory"
import { AUTO_ENRICH_PROMPT } from "../prompts"
import { searchVideosTool } from "../tools/search-videos"
import { fetchVideoImageTool } from "../tools/fetch-video-image"

// ESM-compatible `require` shim — see ./default-chat-agent.ts header comment for
// the underlying Mastra CLI Rollup-bundle constraint that forces this pattern
// over a static `import`.
const require = createRequire(import.meta.url)

// Default model — Google Gemini 3.5 Flash when GOOGLE_GENERATIVE_AI_API_KEY is
// configured (native API, no relay). Falls back to the OpenRouter free-tier
// string id via Mastra's ModelRouter when Google is unset.
const DEFAULT_MODEL_ID = "openrouter/nvidia/nemotron-3-super-120b-a12b:free"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveAgentModel(): any {
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

export function buildAutoEnrichAgent(): Agent {
  return new Agent({
    id: "auto-enrich",
    name: "Auto-Enrich Agent",
    description:
      "Background agent that fills missing imageUrl/videoId references on Experience blocks. Output written as a ContentRevision DRAFT.",
    instructions: AUTO_ENRICH_PROMPT,
    model: resolveAgentModel(),
    // searchVideos + fetchVideoImage only (U8) — auto-enrich fills missing
    // videoId/imageUrl references; it does not cite scripture.
    tools: {
      searchVideosTool,
      fetchVideoImageTool,
    },
    memory: getExperienceChatMemory(),
  })
}
