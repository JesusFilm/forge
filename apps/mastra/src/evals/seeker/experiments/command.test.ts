import { describe, expect, it } from "vitest"

import { serializeSupportedModelRoutes } from "./command"
import { parseOrderedModelRoutes } from "../run-loop"

describe("official experiment command model routing", () => {
  it("preserves the complete ordered OpenRouter fallback identity", () => {
    const routes = [
      {
        provider: "openrouter",
        model: "anthropic/claude-sonnet-5",
        endpoint: "model-router",
        maxRetries: 0,
      },
      {
        provider: "openrouter",
        model: "google/gemma-4-31b-it:free",
        endpoint: "model-router",
        maxRetries: 2,
      },
    ]
    expect(JSON.parse(serializeSupportedModelRoutes(routes))).toEqual(routes)
    expect(
      parseOrderedModelRoutes(serializeSupportedModelRoutes(routes)),
    ).toEqual([
      { model: "openrouter/anthropic/claude-sonnet-5", maxRetries: 0 },
      { model: "openrouter/google/gemma-4-31b-it:free", maxRetries: 2 },
    ])
  })

  it("fails closed for route fields the production runner cannot honor", () => {
    expect(() =>
      serializeSupportedModelRoutes([
        {
          provider: "jesusfilm",
          model: "coding",
          endpoint: "chat-completions",
          maxRetries: 0,
          timeoutMs: 55_000,
        },
      ]),
    ).toThrow(/unsupported model route identity/)
  })
})
