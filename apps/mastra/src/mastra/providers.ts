/**
 * AI SDK provider registry for Mastra-powered chat agents (U2).
 *
 * Centralises construction of the AI SDK provider instances that
 * Mastra's `Agent.model` field consumes. Adding a new provider here
 * keeps env validation, typed error reporting, and provider-ID
 * normalisation in one place.
 *
 * Why this module exists separately from `apps/mastra/src/mastra/index.ts`:
 * - Agents constructed in U6+ pull providers via `getProvider("openrouter")`.
 *   That call site needs typed error reporting when a provider's env is
 *   missing, distinct from agent-level errors.
 * - U11 may layer per-provider budgets (max-tokens, time caps) onto the
 *   provider construction step. Keeping it isolated avoids tangling
 *   budget concerns with the Mastra runtime.
 *
 * Provider coverage at U2:
 * - `openrouter` (HTTP, via @ai-sdk/openai + baseURL override) — primary cloud provider.
 * - `ollama` (HTTP, via ollama-ai-provider) — primary local provider.
 * - `openai` and `anthropic` IDs are reserved but throw
 *   `ProviderNotConfiguredError` until U6+ wires them in with the agent
 *   that actually needs them. Anthropic is not yet installed; the
 *   typed error keeps the surface forward-compatible.
 */

import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai"
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from "@ai-sdk/google"
import { createOllama, type OllamaProvider } from "ollama-ai-provider-v2"
import type { EmbeddingModel, LanguageModel } from "ai"

import { env } from "../config/env"

import {
  AI_GATEWAY_USER_AGENT,
  DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
} from "./gateway-constants"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderId =
  | "openrouter"
  | "ollama"
  | "openai"
  | "anthropic"
  | "google"
  | "jesusfilm"

/**
 * Function that, given a provider-specific model identifier, returns
 * an AI SDK `LanguageModel`. Every provider in this module exposes
 * this shape so agent construction is provider-agnostic.
 */
export type ModelFactory = (modelId: string) => LanguageModel

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class ProviderNotConfiguredError extends Error {
  readonly providerId: ProviderId
  readonly missingEnv: string

  constructor(providerId: ProviderId, missingEnv: string) {
    super(
      `Mastra provider "${providerId}" is not configured for this environment. ` +
        `Missing env var: ${missingEnv}. ` +
        `See apps/mastra/src/config/env.ts for the full list of optional Mastra env vars.`,
    )
    this.name = "ProviderNotConfiguredError"
    this.providerId = providerId
    this.missingEnv = missingEnv
  }
}

export class UnknownProviderError extends Error {
  readonly attempted: string

  constructor(attempted: string) {
    super(
      `Unknown Mastra provider id "${attempted}". ` +
        `Supported: "openrouter", "ollama", "openai", "anthropic", "google", "jesusfilm".`,
    )
    this.name = "UnknownProviderError"
    this.attempted = attempted
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/api"
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

// JesusFilm AI gateway — OpenAI-compatible wire fronting self-hosted
// Qwen models. The base URL + User-Agent literals live in the import-free
// `./gateway-constants` module (shared with memory.ts + the agent files);
// the base URL is overridable per call site via the `AI_GATEWAY_*_BASE_URL`
// env vars.
//
// Chat model default (`coding` = Qwen2.5-Coder-32B) is NOT needed here:
// getProvider() returns a ModelFactory and the agent call sites pass the
// model id (env.AI_GATEWAY_CHAT_MODEL ?? "coding"). Only the
// embedding default is consumed in this module.
/** Gateway embedding model id (Qwen3-Embedding-8B, native 4096d). */
const DEFAULT_JESUSFILM_EMBEDDING_MODEL = "embeddings"

/** The provider id chosen when the editor or caller doesn't specify one. */
export const DEFAULT_PROVIDER_ID: ProviderId =
  env.MASTRA_DEFAULT_PROVIDER ?? "openrouter"

// ---------------------------------------------------------------------------
// Provider constructors
// ---------------------------------------------------------------------------

/**
 * Construct the OpenRouter provider. OpenRouter exposes an
 * OpenAI-compatible HTTP wire, so `@ai-sdk/openai` with a `baseURL`
 * override is the canonical pattern.
 *
 * @throws ProviderNotConfiguredError when OPENROUTER_API_KEY is unset.
 */
export function createOpenRouterProvider(): OpenAIProvider {
  if (!env.OPENROUTER_API_KEY) {
    throw new ProviderNotConfiguredError("openrouter", "OPENROUTER_API_KEY")
  }
  return createOpenAI({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    name: "openrouter",
  })
}

/**
 * Construct the Ollama provider. Defaults to the standard local port
 * when OLLAMA_BASE_URL is unset; no other env is required.
 */
export function createOllamaProvider(): OllamaProvider {
  return createOllama({
    baseURL: env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL,
  })
}

/**
 * Construct the OpenAI provider directly (distinct from OpenRouter,
 * which uses OpenAI-compatible wire).
 *
 * @throws ProviderNotConfiguredError when OPENAI_API_KEY is unset.
 */
export function createOpenAIProvider(): OpenAIProvider {
  if (!env.OPENAI_API_KEY) {
    throw new ProviderNotConfiguredError("openai", "OPENAI_API_KEY")
  }
  return createOpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
    name: "openai",
  })
}

/**
 * Construct the Google Gemini provider. Hits Google's native API
 * directly (not via OpenRouter) — separate billing, fewer hops,
 * direct access to Gemini-specific features (thinking levels,
 * function calling, native multimodal).
 *
 * Model 3.5 quirks worth knowing at the call site:
 * - Do NOT pass `temperature`, `top_p`, or `top_k` — Google removed
 *   them for Gemini 3.5+ models. Setting them returns an API error.
 * - Use `thinking_level` (not the legacy `thinking_budget`) for
 *   reasoning effort control.
 *
 * @throws ProviderNotConfiguredError when GOOGLE_GENERATIVE_AI_API_KEY is unset.
 */
export function createGoogleProvider(): GoogleGenerativeAIProvider {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new ProviderNotConfiguredError(
      "google",
      "GOOGLE_GENERATIVE_AI_API_KEY",
    )
  }
  return createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
  })
}

/**
 * Construct the JesusFilm gateway provider for chat/agent models. The
 * gateway speaks the OpenAI-compatible wire, so `@ai-sdk/openai` with a
 * `baseURL` override is the canonical pattern — identical to OpenRouter.
 *
 * Keyed on `AI_GATEWAY_CHAT_API_KEY` (the chat/`coding`-scoped key)
 * specifically, NOT the embedding key, so setting only the embedding
 * key (to enable Memory semantic recall) never silently reroutes chat
 * through the gateway.
 *
 * Capability note for the call site: the default `coding` model is
 * Qwen2.5-Coder-32B — coding-specialised with ~32K context. It can
 * usually produce the strict JSON envelopes the Experience chat surface
 * needs, but that is not guaranteed; validate with the draft-workflow
 * smoke gate before relying on it for structured output.
 *
 * @throws ProviderNotConfiguredError when AI_GATEWAY_CHAT_API_KEY is unset.
 */
export function createJesusFilmProvider(): OpenAIProvider {
  if (!env.AI_GATEWAY_CHAT_API_KEY) {
    throw new ProviderNotConfiguredError("jesusfilm", "AI_GATEWAY_CHAT_API_KEY")
  }
  return createOpenAI({
    apiKey: env.AI_GATEWAY_CHAT_API_KEY,
    baseURL: env.AI_GATEWAY_CHAT_BASE_URL ?? DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
    name: "jesusfilm",
    headers: { "User-Agent": AI_GATEWAY_USER_AGENT },
  })
}

// ---------------------------------------------------------------------------
// Public registry — `getProvider(id)` returns a ModelFactory
// ---------------------------------------------------------------------------

/**
 * Get a `ModelFactory` for the requested provider. The returned
 * function takes a provider-specific model identifier (e.g.,
 * `"openai/gpt-5.4"` for OpenRouter, `"gemma4:e4b"` for Ollama) and
 * returns an AI SDK `LanguageModel` ready for `Agent.model`.
 *
 * Throws synchronously when the provider's env is missing — agents
 * shouldn't crash mid-stream because of a misconfigured Doppler
 * entry; surface the configuration gap at startup or first call.
 *
 * @throws ProviderNotConfiguredError when the provider's required env is missing.
 * @throws UnknownProviderError when the provider id is not recognised.
 */
export function getProvider(id: ProviderId): ModelFactory {
  switch (id) {
    case "openrouter": {
      const provider = createOpenRouterProvider()
      return (modelId) => provider(modelId)
    }
    case "ollama": {
      const provider = createOllamaProvider()
      return (modelId) => provider(modelId)
    }
    case "openai": {
      const provider = createOpenAIProvider()
      return (modelId) => provider(modelId)
    }
    case "google": {
      const provider = createGoogleProvider()
      return (modelId) => provider(modelId)
    }
    case "jesusfilm": {
      const provider = createJesusFilmProvider()
      return (modelId) => provider(modelId)
    }
    case "anthropic": {
      throw new ProviderNotConfiguredError("anthropic", "ANTHROPIC_API_KEY")
    }
    default: {
      // Exhaustiveness — catches a new ProviderId added without a case.
      const exhaustive: never = id
      throw new UnknownProviderError(String(exhaustive))
    }
  }
}

// ---------------------------------------------------------------------------
// Embeddings — JesusFilm gateway (Qwen3-Embedding-8B)
// ---------------------------------------------------------------------------

/**
 * Resolve the API key used for gateway embedding calls. The gateway's
 * keys are MODEL-SCOPED — the chat (`coding`) key is rejected by the
 * `embeddings` model (`AI_APICallError: key can only access
 * models=['coding']`). So embeddings require the embeddings-scoped key
 * explicitly; there is deliberately NO fallback to the chat key. If a
 * single combined key is ever minted, set it as
 * `AI_GATEWAY_EMBEDDINGS_API_KEY`.
 */
function resolveJesusFilmEmbeddingApiKey(): string | undefined {
  return env.AI_GATEWAY_EMBEDDINGS_API_KEY
}

/**
 * Whether the gateway embedding model is configured. The Memory wiring
 * gates semantic recall on this (see `src/mastra/memory.ts`) so the
 * default deploy — no gateway embedding key — keeps memory storage-only
 * and unchanged.
 */
export function isJesusFilmEmbeddingConfigured(): boolean {
  return resolveJesusFilmEmbeddingApiKey() !== undefined
}

/**
 * Build the gateway embedding model as an AI SDK `EmbeddingModel`.
 *
 * Qwen3-Embedding-8B returns 4096-dim vectors natively and IGNORES the
 * `dimensions` request param — a caller that needs another dimension
 * must truncate + renormalise client-side (Matryoshka). This vector
 * space is distinct from admin's existing pgvector columns
 * (scene/transcript = 1536d, experience = 2048d) and MUST live in its
 * own index; never mix vectors across these spaces. Mastra Memory
 * satisfies this by auto-creating its own index at the detected
 * dimension on first semantic write.
 *
 * @throws ProviderNotConfiguredError when neither the embedding key nor
 *   the chat key is set.
 */
export function getJesusFilmEmbeddingModel(): EmbeddingModel {
  const apiKey = resolveJesusFilmEmbeddingApiKey()
  if (!apiKey) {
    throw new ProviderNotConfiguredError(
      "jesusfilm",
      "AI_GATEWAY_EMBEDDINGS_API_KEY",
    )
  }
  const provider = createOpenAI({
    apiKey,
    baseURL:
      env.AI_GATEWAY_EMBEDDINGS_BASE_URL ??
      env.AI_GATEWAY_CHAT_BASE_URL ??
      DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
    name: "jesusfilm-embeddings",
    headers: { "User-Agent": AI_GATEWAY_USER_AGENT },
  })
  return provider.textEmbeddingModel(
    env.AI_GATEWAY_EMBEDDINGS_MODEL ?? DEFAULT_JESUSFILM_EMBEDDING_MODEL,
  )
}
