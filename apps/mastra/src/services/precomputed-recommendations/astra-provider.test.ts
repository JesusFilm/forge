import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const mocks = vi.hoisted(() => ({ getOpenRouterApiKey: vi.fn() }))
vi.mock("../../config/env", () => ({
  getOpenRouterApiKey: mocks.getOpenRouterApiKey,
}))

import { AstraAccessError, createAstraModel } from "./astra-provider"

const request = {
  schema: z.object({ answer: z.string() }),
  system: "Return the requested JSON object.",
  prompt: "Answer yes.",
  maxOutputTokens: 100,
}

describe("pinned Astra provider adapter", () => {
  beforeEach(() => {
    mocks.getOpenRouterApiKey
      .mockReset()
      .mockReturnValue("paid-router-test-key")
  })
  afterEach(() => vi.unstubAllGlobals())

  it("uses OpenRouter for exact Astra structured output and preserves token usage", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "response-test",
          object: "response",
          created_at: 1_791_244_800,
          model: "openai/gpt-6-astra",
          status: "completed",
          output: [
            {
              type: "message",
              id: "message-test",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: '{"answer":"yes"}',
                  annotations: [],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 3,
            total_tokens: 15,
            cost: 0.01855,
            input_tokens_details: { cached_tokens: 2 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", transport)
    expect(await createAstraModel().generate(request)).toEqual({
      output: { answer: "yes" },
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        cachedInputTokens: 2,
        costUsd: 0.01855,
      },
    })
    expect(transport).toHaveBeenCalledTimes(1)
    const [url, init] = transport.mock.calls[0]!
    expect(url).toBe("https://openrouter.ai/api/v1/responses")
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer paid-router-test-key",
    )
    expect(init?.redirect).toBe("error")
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "openai/gpt-6-astra",
      max_output_tokens: 100,
      text: { format: { type: "json_schema", strict: true } },
      provider: { require_parameters: true, allow_fallbacks: false },
    })
  })

  it("retains reported charge and tokens when structured output is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "response-malformed",
            object: "response",
            created_at: 1_791_244_800,
            model: "openai/gpt-6-astra",
            status: "completed",
            output: [
              {
                type: "message",
                id: "message-malformed",
                role: "assistant",
                content: [
                  { type: "output_text", text: "not json", annotations: [] },
                ],
              },
            ],
            usage: {
              input_tokens: 25,
              output_tokens: 7,
              total_tokens: 32,
              cost: 0.023,
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    )
    await expect(createAstraModel().generate(request)).rejects.toMatchObject({
      usage: { inputTokens: 25, outputTokens: 7, costUsd: 0.023 },
    })
  })

  it("does not retry or switch providers when the configured route fails", async () => {
    const transport = vi.fn<typeof fetch>()
    transport.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "Temporarily unavailable", code: "server_error" },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", transport)
    await expect(createAstraModel().generate(request)).rejects.toThrow()
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it("reports missing OpenRouter configuration without changing models", () => {
    mocks.getOpenRouterApiKey.mockReturnValue(undefined)
    const transport = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", transport)
    expect(() => createAstraModel()).toThrow(AstraAccessError)
    expect(transport).not.toHaveBeenCalled()
  })
})
