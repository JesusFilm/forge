import type { Agent } from "@mastra/core/agent"

import {
  createDevotionalLlm,
  DevotionalLlmError,
  type DevotionalLlm,
} from "../../../services/devotional/llm"
import { resolveStoredInstructions } from "./instruction-resolver"

/**
 * Adapter: run the tuned devotional services on a Mastra Agent's INSTRUCTIONS
 * while keeping the exact pre-migration wire call.
 *
 * Why hybrid (instructions from the agent, transport = the original llm.ts
 * call): a field-by-field diff of the OpenRouter request bodies showed the old
 * path and Mastra's structured output are identical EXCEPT `response_format` —
 * the old path sends `json_schema` with `strict: true`, Mastra 1.36 sends it
 * without `strict` (and a zod-derived schema). That one flag measurably changes
 * behavior on judgment tasks (the Spurgeon ranker's "none fits" −1 became a
 * forced pick ×3/×3). Parity is a hard requirement, so the transport stays
 * byte-identical; the system prompt is resolved from the Agent per call, so
 * Studio-published instruction edits flow into production requests.
 *
 * When Mastra's structured output supports strict mode, flip the transport to
 * native `agent.generate` and re-run the parity scripts.
 *
 * Failures keep the services' typed error handling working unchanged
 * (DevotionalLlmError pass-through).
 */
export function createAgentLlm(agent: Agent, modelId: string): DevotionalLlm {
  // Client construction validates provider credentials synchronously. Keep it
  // behind the request boundary so importing/registering Mastra workflows does
  // not make an otherwise valid gateway-only service fail at startup.
  let inner: DevotionalLlm | undefined
  return {
    model: `mastra-agent:${agent.id}:${modelId}`,
    async complete(input) {
      let system: string
      try {
        // Studio-published edits (stored agent config) win; the coded
        // instructions are the fallback. See instruction-resolver.ts.
        const stored = await resolveStoredInstructions(agent.id)
        system = stored ?? coerceInstructions(await agent.getInstructions())
      } catch (error) {
        throw new DevotionalLlmError(
          "request_failed",
          `agent ${agent.id} instruction resolution failed: ${error instanceof Error ? error.message : String(error)}`,
          error,
        )
      }
      if (!system.trim()) {
        throw new DevotionalLlmError(
          "validation",
          `agent ${agent.id} resolved empty instructions`,
        )
      }
      inner ??= createDevotionalLlm({ model: modelId })
      return inner.complete({ ...input, system })
    },
  }
}

/** AgentInstructions can be a string, an array, or message-shaped objects. */
function coerceInstructions(instructions: unknown): string {
  if (typeof instructions === "string") return instructions
  if (Array.isArray(instructions)) {
    return instructions.map((i) => coerceInstructions(i)).join("\n")
  }
  if (
    instructions != null &&
    typeof instructions === "object" &&
    "content" in instructions
  ) {
    return coerceInstructions((instructions as { content: unknown }).content)
  }
  return String(instructions ?? "")
}
