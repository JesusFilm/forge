/**
 * Default tool-calling agent (U6) — the editor-facing default.
 *
 * Used when the editor doesn't pick a specialized agent. Has the full
 * tool catalog and the draft-experience system prompt. Suitable for
 * both "draft a whole experience" and "add a section" requests; U8
 * adds explicitly specialized agents for finer task routing.
 *
 * Integration note (rebase): the chat service's `streamChatTurn`
 * entrypoint dispatches to this agent when no `agentId` is provided
 * in the request. That dispatch lives on the parallel branch in
 * `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
 * and gets re-wired during the post-parallel-branch rebase.
 */

import { Agent } from "@mastra/core/agent"

import { getMastraMemory } from "../memory"
import { getProvider, DEFAULT_PROVIDER_ID } from "../providers"
import { DRAFT_EXPERIENCE_PROMPT } from "../prompts"
import {
  searchVideosTool,
  lookupBibleVerseTool,
  fetchVideoImageTool,
} from "../tools"

/**
 * Default model id used when the agent's model isn't dynamically
 * overridden via requestContext. Production deployments may set this
 * via env (MASTRA_DEFAULT_PROVIDER decides the provider; the model
 * name itself is hardcoded here until U11 adds env overrides per
 * agent).
 *
 * `openai/gpt-5.4` is the OpenRouter-style identifier — the provider
 * resolves it. For the Ollama provider this constant is unused;
 * Ollama agents instantiate with a different model id.
 */
const DEFAULT_MODEL_ID = "openai/gpt-5.4"

/**
 * Build the default chat agent. Factory rather than module-level
 * const because the provider construction reads env, which test
 * suites need to swap between cases.
 */
export function buildDefaultChatAgent(): Agent {
  const provider = getProvider(DEFAULT_PROVIDER_ID)
  return new Agent({
    id: "experience-default-chat",
    name: "Experience Editor Chat",
    description:
      "Default tool-calling agent for the Experience editor. Drafts and edits Experience pages.",
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
