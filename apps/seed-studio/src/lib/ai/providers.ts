export const AI_PROVIDERS = [
  "openrouter",
  "exo",
  "claude",
  "codex",
  "gemini",
  "ollama",
] as const
export type AIProvider = (typeof AI_PROVIDERS)[number]

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openrouter: "OpenRouter",
  exo: "Exo",
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  ollama: "Ollama",
}

/**
 * Providers with a `true` value here are routed through the strict-JSON-Schema
 * generator (`generator.server.ts`) — a single-shot OpenRouter call that
 * returns a validated `GeneratedExperience`. The `/api/chat` route emits a
 * single `event: patch` SSE event with the parsed object.
 *
 * Providers with `false` stay on the legacy free-form streaming path (chunk
 * SSE events + code-block extraction on the client).
 */
export const SUPPORTS_STRICT_JSON_SCHEMA: Record<AIProvider, boolean> = {
  openrouter: true,
  exo: false,
  claude: false,
  codex: false,
  gemini: false,
  ollama: false,
}

export type ModelOption = {
  id: string
  label: string
}

export const PROVIDER_MODELS: Record<AIProvider, ModelOption[]> = {
  openrouter: [
    { id: "anthropic/claude-opus-4.7", label: "Claude Opus 4.7" },
    { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
    { id: "openai/gpt-5.4", label: "GPT-5.4" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
  exo: [
    { id: "mlx-community/GLM-4.7-Flash-8bit", label: "GLM-4.7 Flash 8bit" },
  ],
  claude: [
    { id: "claude-opus-4-7", label: "Opus 4.7" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  ],
  codex: [
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.4:fast", label: "GPT-5.4 Fast" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", label: "2.5 Flash" },
    { id: "gemini-2.5-pro", label: "2.5 Pro" },
    { id: "gemini-2.0-flash", label: "2.0 Flash" },
    { id: "gemini-2.0-flash-lite", label: "2.0 Flash Lite" },
  ],
  ollama: [],
}

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openrouter: "anthropic/claude-sonnet-4.6",
  exo: "mlx-community/GLM-4.7-Flash-8bit",
  claude: "claude-sonnet-4-6",
  codex: "gpt-5.4:fast",
  gemini: "gemini-2.5-flash",
  ollama: "gemma4:26b",
}

export const DEFAULT_PROVIDER: AIProvider = "codex"
