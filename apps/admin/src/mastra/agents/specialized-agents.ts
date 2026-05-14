/**
 * Specialized agents (U8) — draft-experience, add-section, rewrite-copy.
 *
 * Three distinct `Agent` instances, each with its own system prompt
 * and tool subset. The composer agent-picker (UI, deferred to the
 * post-rebase commit on the parallel branch) chooses which agent the
 * editor's turn routes to.
 *
 * Routing decision documented in the plan (U8 Approach): direct
 * dispatch by `agentId` rather than Mastra's `Agent.network()`. The
 * caller (chat service) picks the agent and invokes it. No routing
 * agent middle layer.
 */

import { Agent } from "@mastra/core/agent"

import { getMastraMemory } from "../memory"
import { getProvider, DEFAULT_PROVIDER_ID } from "../providers"
import {
  DRAFT_EXPERIENCE_PROMPT,
  ADD_SECTION_PROMPT,
  REWRITE_COPY_PROMPT,
} from "../prompts"
import {
  searchVideosTool,
  lookupBibleVerseTool,
  fetchVideoImageTool,
} from "../tools"

const DEFAULT_MODEL_ID = "openai/gpt-5.4"

/**
 * Specialized id space — these are the values the composer
 * agent-picker dropdown surfaces, and the values `streamChatTurn`
 * accepts in its `agentId` argument post-rebase.
 */
export type SpecializedAgentId =
  | "draft-experience"
  | "add-section"
  | "rewrite-copy"

/**
 * Draft-experience agent — full first-draft generation with the
 * complete tool catalog. Multi-step workflow (U7) is opt-in via a
 * separate parameter, not baked into this agent's definition.
 */
export function buildDraftExperienceAgent(): Agent {
  const provider = getProvider(DEFAULT_PROVIDER_ID)
  return new Agent({
    id: "draft-experience",
    name: "Draft Experience Agent",
    description:
      "Produces a full Experience draft (title + meta + blocks) from a prompt.",
    instructions: DRAFT_EXPERIENCE_PROMPT,
    model: provider(DEFAULT_MODEL_ID),
    tools: {
      searchVideosTool,
      lookupBibleVerseTool,
      fetchVideoImageTool,
    },
    memory: getMastraMemory(),
  })
}

/**
 * Add-section agent — inserts exactly one new top-level block while
 * preserving every existing block. Limited to searchVideos in its
 * tool catalog; the agent's narrow job doesn't need Bible lookup or
 * image fetch.
 */
export function buildAddSectionAgent(): Agent {
  const provider = getProvider(DEFAULT_PROVIDER_ID)
  return new Agent({
    id: "add-section",
    name: "Add Section Agent",
    description:
      "Adds exactly one new top-level block to an existing Experience canvas, preserving all other blocks.",
    instructions: ADD_SECTION_PROMPT,
    model: provider(DEFAULT_MODEL_ID),
    tools: {
      searchVideosTool,
    },
    memory: getMastraMemory(),
  })
}

/**
 * Rewrite-copy agent — narrow text-only edits. NO tools — copy
 * rewrites need no retrieval and exposing tool affordances would
 * encourage drift out of the bounded edit scope.
 */
export function buildRewriteCopyAgent(): Agent {
  const provider = getProvider(DEFAULT_PROVIDER_ID)
  return new Agent({
    id: "rewrite-copy",
    name: "Rewrite Copy Agent",
    description: "Rewrites text fields on one specified block.",
    instructions: REWRITE_COPY_PROMPT,
    model: provider(DEFAULT_MODEL_ID),
    // Intentionally no tools — see prompt rule "NO TOOLS".
    memory: getMastraMemory(),
  })
}

/**
 * Build all three specialized agents at once. Used by the Mastra
 * runtime singleton wiring (post-rebase) to register agents by id.
 */
export function buildSpecializedAgents(): Record<SpecializedAgentId, Agent> {
  return {
    "draft-experience": buildDraftExperienceAgent(),
    "add-section": buildAddSectionAgent(),
    "rewrite-copy": buildRewriteCopyAgent(),
  }
}
