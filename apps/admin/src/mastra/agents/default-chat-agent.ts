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

import { createRequire } from "node:module"

import { Agent } from "@mastra/core/agent"
import type { LanguageModel } from "ai"

import { env } from "@/config/env"

import { getMastraMemory } from "../memory"
import { DRAFT_EXPERIENCE_PROMPT } from "../prompts"
import {
  searchVideosTool,
  lookupBibleVerseTool,
  fetchVideoImageTool,
} from "../tools"

// ESM-compatible `require` for the provider SDK loads below. Env is
// imported statically (top of file) because the Mastra CLI's Rollup
// bundle cannot resolve the `@/` path alias inside `require()` — only
// inside `import`. The provider SDK requires DO survive bundling
// because they target real package names, not aliased source paths.
const require = createRequire(import.meta.url)

/**
 * Demo wiring: route through OpenRouter (api key is set in this dev
 * env, gemma4:e4b on Ollama can't produce strictly-valid JSON for
 * complex multi-block envelopes consistently). The cheap-but-capable
 * OpenRouter model handles multi-block structured output reliably.
 *
 * Falls back to Ollama if OPENROUTER_API_KEY isn't set.
 */
// Match the model the existing OpenRouter quality-draft path uses
// (`experience-ai-openrouter-free.ts` DEFAULT_OPENROUTER_EXPERIENCE_CHAT_MODELS[0]).
// Free tier + structured-outputs support — proven to handle the
// multi-block JSON envelope for this surface.
const OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
const OLLAMA_MODEL = "gemma4:e4b"

/**
 * Build the default chat agent. Factory rather than module-level
 * const because the constructor reads memory (which itself reads
 * env), and tests need to swap env between cases.
 */
export function buildDefaultChatAgent(): Agent {
  let model: LanguageModel
  if (env.OPENROUTER_API_KEY) {
    // OpenRouter speaks the OpenAI-compatible wire — use @ai-sdk/openai
    // with the OpenRouter baseURL. Capable enough to produce strict-JSON
    // multi-block envelopes reliably.
    const { createOpenAI } =
      require("@ai-sdk/openai") as typeof import("@ai-sdk/openai")
    const openrouter = createOpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      name: "openrouter",
    })
    model = openrouter(OPENROUTER_MODEL) as unknown as LanguageModel
  } else {
    const { createOllama } =
      require("ollama-ai-provider-v2") as typeof import("ollama-ai-provider-v2")
    const rawBaseUrl = env.OLLAMA_BASE_URL ?? "http://localhost:11434"
    const baseURL = rawBaseUrl.endsWith("/api")
      ? rawBaseUrl + "/"
      : rawBaseUrl.endsWith("/api/")
        ? rawBaseUrl
        : rawBaseUrl.replace(/\/$/, "") + "/api/"
    const ollamaProvider = createOllama({ baseURL })
    const ollamaSettings = {
      options: {
        num_predict: 4096,
        num_ctx: 8192,
        temperature: 0.4,
      },
    } as const
    model = ollamaProvider.chat(
      OLLAMA_MODEL,
      ollamaSettings,
    ) as unknown as LanguageModel
  }

  return new Agent({
    id: "experience-default-chat",
    name: "Experience Editor Chat",
    description:
      "Default tool-calling agent for the Experience editor. Drafts and edits Experience pages.",
    instructions: DRAFT_EXPERIENCE_PROMPT,
    // Cast through `any` — provider-returned LanguageModel union shape
    // sometimes mismatches Mastra's MastraModelConfig across peer
    // version ranges. Runtime contract is fine.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: model as any,
    tools: {
      searchVideosTool,
      lookupBibleVerseTool,
      fetchVideoImageTool,
    },
    memory: getMastraMemory(),
  })
}
