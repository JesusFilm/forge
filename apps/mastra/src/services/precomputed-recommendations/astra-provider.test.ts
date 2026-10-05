import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const mocks = vi.hoisted(() => ({
  responses: vi.fn().mockReturnValue("pinned-model"),
  generateText: vi.fn(),
}))

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ responses: mocks.responses }),
}))
vi.mock("ai", () => ({
  generateText: mocks.generateText,
  Output: { object: ({ schema }: { schema: unknown }) => ({ schema }) },
}))

import { createAstraModel, PRECOMPUTED_MODEL_ID } from "./astra-provider"

describe("pinned Astra provider adapter", () => {
  beforeEach(() => {
    mocks.responses.mockClear()
    mocks.generateText.mockReset()
  })

  it("uses exactly gpt-6-astra through Responses with no hidden SDK retries", async () => {
    mocks.generateText.mockResolvedValue({
      output: { answer: "yes" },
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        inputTokenDetails: { cacheReadTokens: 2 },
      },
    })
    const output = await createAstraModel("test-only-key").generate({
      schema: z.object({ answer: z.string() }),
      system: "system",
      prompt: "prompt",
      maxOutputTokens: 100,
    })
    expect(mocks.responses).toHaveBeenCalledWith(PRECOMPUTED_MODEL_ID)
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "pinned-model",
        maxRetries: 0,
        maxOutputTokens: 100,
      }),
    )
    expect(output).toEqual({
      output: { answer: "yes" },
      usage: { inputTokens: 12, outputTokens: 3, cachedInputTokens: 2 },
    })
  })
})
