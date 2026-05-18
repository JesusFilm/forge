/**
 * AI SDK provider registry for Mastra-powered chat agents (U2).
 *
 * Centralises construction of the AI SDK provider instances that
 * Mastra's `Agent.model` field consumes. Adding a new provider here
 * keeps env validation, typed error reporting, and provider-ID
 * normalisation in one place.
 *
 * Why this module exists separately from `apps/admin/src/mastra/index.ts`:
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
import { createOllama, type OllamaProvider } from "ollama-ai-provider-v2"
import type { LanguageModel } from "ai"

import { env } from "@/config/env"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderId = "openrouter" | "ollama" | "openai" | "anthropic"

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
        `See apps/admin/src/config/env.ts for the full list of optional Mastra env vars.`,
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
        `Supported: "openrouter", "ollama", "openai", "anthropic".`,
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
