import {
  AI_GATEWAY_USER_AGENT,
  DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
} from "../gateway-constants"

export const SEEKER_PRODUCTION_PROMPT = {
  provider: "langfuse",
  name: "seeker-system",
  revision: "2",
  contentHash:
    "bdc09456d558f2853604adff70655ee850730ccc8f2b18881780590c657b76ee",
} as const

export const SEEKER_PRODUCTION_GATEWAY_TIMEOUT_MS = 55_000

export type SeekerProductionModelRoute = {
  provider: "jesusfilm" | "openrouter"
  model: string
  endpoint: "chat-completions" | "model-router"
  maxRetries: number
  decoding: "provider-default"
  baseUrl?: string
  userAgent?: string
  timeoutMs?: number
}

export type SeekerProductionIdentity = {
  prompt: typeof SEEKER_PRODUCTION_PROMPT
  models: {
    routing: "ordered-fallback"
    gatewayEnabled: boolean
    routes: SeekerProductionModelRoute[]
  }
}

export type SeekerProductionIdentityOptions = {
  gatewayEnabled: boolean
  gatewayModel?: string
  gatewayBaseUrl?: string
}

/** Repository-reviewed identity shared by runtime, eval, and promotion seams. */
export function buildSeekerProductionIdentity({
  gatewayEnabled,
  gatewayModel = "coding",
  gatewayBaseUrl = DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
}: SeekerProductionIdentityOptions): SeekerProductionIdentity {
  const routes: SeekerProductionModelRoute[] = [
    {
      provider: "openrouter",
      model: "google/gemma-4-31b-it:free",
      endpoint: "model-router",
      maxRetries: 1,
      decoding: "provider-default",
    },
    {
      provider: "openrouter",
      model: "google/gemma-4-26b-a4b-it:free",
      endpoint: "model-router",
      maxRetries: 1,
      decoding: "provider-default",
    },
  ]

  if (gatewayEnabled) {
    routes.unshift({
      provider: "jesusfilm",
      model: gatewayModel,
      endpoint: "chat-completions",
      baseUrl: gatewayBaseUrl,
      userAgent: AI_GATEWAY_USER_AGENT,
      timeoutMs: SEEKER_PRODUCTION_GATEWAY_TIMEOUT_MS,
      maxRetries: 0,
      decoding: "provider-default",
    })
  }

  return {
    prompt: SEEKER_PRODUCTION_PROMPT,
    models: { routing: "ordered-fallback", gatewayEnabled, routes },
  }
}

export function serializeSeekerProductionIdentity(
  identity: SeekerProductionIdentity,
): string {
  return JSON.stringify(identity)
}
