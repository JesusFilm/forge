import {
  getDevotionalModel,
  getDevotionalSafetyModel,
  getOpenRouterApiKey,
} from "../../../config/env"

/**
 * Shared model config for the devotional agents.
 *
 * Pinned to the SAME model + SAME routing as the pre-Mastra services: Mastra's
 * own model router is pointed at the OpenRouter endpoint via `url` + `apiKey`,
 * with `DEVOTIONAL_MODEL` (anthropic/claude-haiku-4-5 by default). A bare
 * "anthropic/…" string would route straight to Anthropic and change routing;
 * the `@openrouter/ai-sdk-provider` model instance ships an incompatible
 * AI-SDK spec version — this config object avoids both.
 */
const OPENROUTER_URL = "https://openrouter.ai/api/v1"

// The { providerId, modelId, url } form is the unambiguous OpenAI-compatible
// config — Mastra hits `url` (OpenRouter) with `modelId`. The `{ id }` form
// collides with Mastra's router-id pattern and would route straight to Anthropic.
function openRouter(modelId: string) {
  return {
    providerId: "openrouter",
    modelId,
    url: OPENROUTER_URL,
    apiKey: getOpenRouterApiKey() ?? "",
  }
}

export const devotionalModel = openRouter(getDevotionalModel())
export const devotionalSafetyModel = openRouter(getDevotionalSafetyModel())
