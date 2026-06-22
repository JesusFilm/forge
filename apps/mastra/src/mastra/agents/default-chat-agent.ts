/**
 * Default tool-calling agent — the editor-facing default for the
 * Experience-AI chat surface. Ported (consolidation U4) from
 * `apps/admin/src/mastra/agents/default-chat-agent.ts` into the standalone
 * service.
 *
 * Used when the editor doesn't pick a specialized agent. Has the
 * draft-experience system prompt and (from U8) the HTTP-backed tool catalog.
 * Suitable for both "draft a whole experience" and "add a section" requests.
 *
 * Tools note (U4): the three chat tools (searchVideos / lookupBibleVerse /
 * fetchVideoImage) are re-homed as HTTP callbacks to admin in U8; this agent
 * registers WITHOUT tools until then. The draft/quick-draft workflows do not
 * tool-call (candidates arrive pre-loaded in the workflow input), so the
 * generation path is unaffected.
 */

import { createRequire } from "node:module"

import { Agent } from "@mastra/core/agent"
import type { LanguageModel } from "ai"

import { env } from "../../config/env"

import {
  AI_GATEWAY_USER_AGENT,
  DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
} from "../gateway-constants"
import { getExperienceChatMemory } from "../memory"
import { DRAFT_EXPERIENCE_PROMPT } from "../prompts"

// ESM-compatible `require` for the provider SDK loads below. The provider SDK
// requires survive the Mastra CLI Rollup bundle because they target real
// package names; a static `import` of an `@ai-sdk/*` module trips the "Cannot
// determine intended module format" trap. Same trick the seeker/memory files
// use; see `../gateway-constants` for the bundle-safety rationale.
const require = createRequire(import.meta.url)

// Default model per provider. Gemini 3.5 Flash is the primary today
// (frontier-speed, structured-output reliable, cheap). OpenRouter + Ollama
// remain as fallbacks for environments without a Google key.
const GOOGLE_MODEL = "gemini-3.5-flash"
// Free-tier OpenRouter model with structured-outputs support — proven to handle
// the multi-block JSON envelope for the Experience chat surface.
const OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
const OLLAMA_MODEL = "gemma4:e4b"

/**
 * Build the default chat agent. Factory rather than module-level const because
 * the constructor reads memory (which itself reads env), and tests need to swap
 * env between cases.
 *
 * Provider priority:
 *   1. JesusFilm gateway — ONLY when AI_GATEWAY_CHAT_ENABLED="true" AND
 *      AI_GATEWAY_CHAT_API_KEY is set. OFF BY DEFAULT: the gateway's coding
 *      model (Qwen2.5-Coder-32B) fails the strict Experience envelope contract,
 *      so it must be explicitly opted in.
 *   2. Google Gemini      (GOOGLE_GENERATIVE_AI_API_KEY) — default for
 *      structured chat; reliably satisfies the envelope schema.
 *   3. OpenRouter         (OPENROUTER_API_KEY)
 *   4. Ollama             (always last; assumes local 11434)
 */
export function buildDefaultChatAgent(): Agent {
  let model: LanguageModel
  if (env.AI_GATEWAY_CHAT_API_KEY && env.AI_GATEWAY_CHAT_ENABLED === "true") {
    // JesusFilm AI gateway — OpenAI-compatible wire fronting self-hosted Qwen.
    // OPT-IN ONLY (AI_GATEWAY_CHAT_ENABLED="true"): the default `coding` model
    // (Qwen2.5-Coder-32B) fails the strict Experience envelope contract, so
    // structured chat defaults to Gemini below. The explicit User-Agent dodges
    // Cloudflare's 403 on missing/odd UAs in front of the gateway.
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
    // `.chat()` pins the chat-completions endpoint. The bare callable
    // `gateway(id)` defaults to the Responses API (`/v1/responses`) in
    // @ai-sdk/openai v3, which crashes the gateway's vLLM backend on multi-turn
    // tool conversations (`KeyError: 'role'`). Chat-completions handles the same
    // tool history fine.
    model = gateway.chat(
      env.AI_GATEWAY_CHAT_MODEL ?? "coding",
    ) as unknown as LanguageModel
  } else if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    // Native Google API — no OpenRouter relay. Gemini 3.5 ignores legacy
    // temperature/top_p/top_k options; do NOT pass them or the API errors out.
    const { createGoogleGenerativeAI } =
      require("@ai-sdk/google") as typeof import("@ai-sdk/google")
    const google = createGoogleGenerativeAI({
      apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    })
    model = google(GOOGLE_MODEL) as unknown as LanguageModel
  } else if (env.OPENROUTER_API_KEY) {
    // OpenRouter speaks the OpenAI-compatible wire — use @ai-sdk/openai with the
    // OpenRouter baseURL. Capable enough to produce strict-JSON multi-block
    // envelopes reliably.
    const { createOpenAI } =
      require("@ai-sdk/openai") as typeof import("@ai-sdk/openai")
    const openrouter = createOpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      name: "openrouter",
    })
    // `.chat()` pins chat-completions; the bare callable defaults to the
    // Responses API in @ai-sdk/openai v3, which OpenRouter does not implement
    // consistently. Same rationale as the gateway branch above.
    model = openrouter.chat(OPENROUTER_MODEL) as unknown as LanguageModel
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
    // sometimes mismatches Mastra's MastraModelConfig across peer version
    // ranges. Runtime contract is fine.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: model as any,
    // Tools land in U8 (HTTP-backed callbacks to admin). Until then the chat
    // agent has no tool catalog; no live route invokes it before U9.
    memory: getExperienceChatMemory(),
  })
}
