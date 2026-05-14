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
import { DRAFT_EXPERIENCE_PROMPT } from "../prompts"
import {
  searchVideosTool,
  lookupBibleVerseTool,
  fetchVideoImageTool,
} from "../tools"

/**
 * Default model id — passed as a `ModelRouterModelId` string to
 * Mastra's `Agent.model`. Mastra's built-in ModelRouter resolves
 * provider + model from the slash-prefix shape (e.g. `openai/gpt-5.4`,
 * `anthropic/sonnet`, `ollama/gemma4:e4b`).
 *
 * Why string ids over pre-constructed LanguageModel instances:
 * - Mastra's MastraModelConfig union rejects @ai-sdk's `LanguageModel`
 *   wrapper type (it predates V3 alignment). String ids are the
 *   stable, Mastra-native path.
 * - String ids defer provider construction to call time, so an env
 *   change at boot doesn't require an agent rebuild.
 * - The `providers.ts` module retains its place as the testable env-
 *   validation surface and the override path for cases where a
 *   pre-built LanguageModel IS needed (none today; kept available).
 */
const DEFAULT_MODEL_ID = "openai/gpt-5.4"

/**
 * Build the default chat agent. Factory rather than module-level
 * const because the constructor reads memory (which itself reads
 * env), and tests need to swap env between cases.
 */
export function buildDefaultChatAgent(): Agent {
  return new Agent({
    id: "experience-default-chat",
    name: "Experience Editor Chat",
    description:
      "Default tool-calling agent for the Experience editor. Drafts and edits Experience pages.",
    instructions: DRAFT_EXPERIENCE_PROMPT,
    model: DEFAULT_MODEL_ID,
    tools: {
      searchVideosTool,
      lookupBibleVerseTool,
      fetchVideoImageTool,
    },
    memory: getMastraMemory(),
  })
}
