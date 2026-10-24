/**
 * Auto-enrich background agent (U9).
 *
 * Runs outside an editor session — triggered by a GraphQL mutation
 * that enqueues a useworkflow job. The job invokes this agent to
 * fill missing `imageUrl` and `videoId` references on a target
 * experience locale's blocks, then writes the enriched blocks as a
 * `ContentRevision` DRAFT (NOT canonical) with `revisedByKind: "AI"`.
 *
 * Tool catalog: searchVideos + fetchVideoImage. No copy editing —
 * the auto-enrich prompt explicitly forbids it.
 *
 * Integration deferred: the surrounding useworkflow job, the
 * GraphQL trigger mutation, and the ContentRevision write seam land
 * in a post-rebase commit. This file ships the Agent definition so
 * the production wiring has something to import.
 */

import { createRequire } from "node:module"

import { Agent } from "@mastra/core/agent"

import { env } from "@/config/env"

// ESM-compatible `require` shim — see ./default-chat-agent.ts header
// comment for the underlying Mastra CLI Rollup-bundle constraint
// that forces this pattern over a static `import`.
const require = createRequire(import.meta.url)

import { getMastraMemory } from "../memory"
import { AUTO_ENRICH_PROMPT } from "../prompts"
import { searchVideosTool, fetchVideoImageTool } from "../tools"

// Default model — Google Gemini 3.5 Flash when GOOGLE_GENERATIVE_AI_API_KEY
// is configured (native API, no relay). Falls back to the OpenRouter
// free-tier string id via Mastra's ModelRouter when Google is unset.
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
    tools: {
      searchVideosTool,
      fetchVideoImageTool,
    },
    memory: getMastraMemory(),
  })
}
