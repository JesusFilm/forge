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

import {
  AI_GATEWAY_USER_AGENT,
  DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
} from "../gateway-constants"
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
// Default model per provider. Gemini 3.5 Flash is the primary today
// (frontier-speed, structured-output reliable, cheap). OpenRouter +
// Ollama remain as fallbacks for environments without a Google key.
const GOOGLE_MODEL = "gemini-3.5-flash"
// Free-tier OpenRouter model with structured-outputs support — proven
// to handle the multi-block JSON envelope for the Experience chat surface.
const OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
const OLLAMA_MODEL = "gemma4:e4b"

/**
 * Build the default chat agent. Factory rather than module-level
 * const because the constructor reads memory (which itself reads
 * env), and tests need to swap env between cases.
 *
 * Provider priority:
 *   1. JesusFilm gateway — ONLY when AI_GATEWAY_CHAT_ENABLED="true"
 *      AND AI_GATEWAY_CHAT_API_KEY is set. OFF BY DEFAULT: the
 *      gateway's coding model (Qwen2.5-Coder-32B) fails the strict
 *      Experience envelope contract — `smoke:draft-workflow` was 0/8
 *      through the gateway — so it must be explicitly opted in.
 *   2. Google Gemini      (GOOGLE_GENERATIVE_AI_API_KEY) — default for
 *      structured chat; reliably satisfies the envelope schema.
 *   3. OpenRouter         (OPENROUTER_API_KEY)
 *   4. Ollama             (always last; assumes local 11434)
 */
export function buildDefaultChatAgent(): Agent {
  let model: LanguageModel
  if (env.AI_GATEWAY_CHAT_API_KEY && env.AI_GATEWAY_CHAT_ENABLED === "true") {
    // JesusFilm AI gateway — OpenAI-compatible wire fronting self-hosted
    // Qwen. OPT-IN ONLY (AI_GATEWAY_CHAT_ENABLED="true"): the default
    // `coding` model (Qwen2.5-Coder-32B) fails the strict Experience
    // envelope contract — `smoke:draft-workflow` was 0/8 through the
    // gateway (array-wrapped envelopes, diff-shaped scalars, truncated
    // JSON), so structured chat defaults to Gemini below. Enable this
    // flag only once a better instruction-following model is available
    // or the smoke gate passes green. The explicit User-Agent dodges
    // Cloudflare's 403 on missing/odd UAs in front of the gateway.
    //
    // The @ai-sdk/openai SDK is loaded via the createRequire shim (not a
    // static import) to keep its `@ai-sdk/*` graph out of the Mastra CLI
    // Rollup bundle and avoid the "Cannot determine intended module
    // format" trap. The gateway base URL + User-Agent literals come from
    // the import-free `../gateway-constants` module (a static import of
    // THAT module is bundle-safe — it pulls no SDK). The registry
    // counterpart is `createJesusFilmProvider()` in ../providers.
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
    // @ai-sdk/openai v3, which crashes the gateway's vLLM backend on
    // multi-turn tool conversations (`KeyError: 'role'` in vLLM's
    // `_parse_chat_message_content` — confirmed in vllm-coder logs
    // 2026-06-05). Chat-completions handles the same tool history fine.
    model = gateway.chat(
      env.AI_GATEWAY_CHAT_MODEL ?? "coding",
    ) as unknown as LanguageModel
  } else if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    // Native Google API — no OpenRouter relay. Gemini 3.5 ignores
    // legacy temperature/top_p/top_k options; do NOT pass them or
    // the API errors out.
    const { createGoogleGenerativeAI } =
      require("@ai-sdk/google") as typeof import("@ai-sdk/google")
    const google = createGoogleGenerativeAI({
      apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    })
    model = google(GOOGLE_MODEL) as unknown as LanguageModel
  } else if (env.OPENROUTER_API_KEY) {
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
    // `.chat()` pins chat-completions; the bare callable defaults to the
    // Responses API in @ai-sdk/openai v3, which OpenRouter does not
    // implement consistently. Same rationale as the gateway branch above.
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
