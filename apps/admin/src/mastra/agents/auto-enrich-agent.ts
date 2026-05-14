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

import { Agent } from "@mastra/core/agent"

import { getMastraMemory } from "../memory"
import { getProvider, DEFAULT_PROVIDER_ID } from "../providers"
import { AUTO_ENRICH_PROMPT } from "../prompts"
import { searchVideosTool, fetchVideoImageTool } from "../tools"

const DEFAULT_MODEL_ID = "openai/gpt-5.4"

export function buildAutoEnrichAgent(): Agent {
  const provider = getProvider(DEFAULT_PROVIDER_ID)
  return new Agent({
    id: "auto-enrich",
    name: "Auto-Enrich Agent",
    description:
      "Background agent that fills missing imageUrl/videoId references on Experience blocks. Output written as a ContentRevision DRAFT.",
    instructions: AUTO_ENRICH_PROMPT,
    model: provider(DEFAULT_MODEL_ID),
    tools: {
      searchVideosTool,
      fetchVideoImageTool,
    },
    memory: getMastraMemory(),
  })
}
