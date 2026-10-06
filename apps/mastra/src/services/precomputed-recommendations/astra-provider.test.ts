import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const mocks = vi.hoisted(() => ({ getOpenRouterApiKey: vi.fn() }))
vi.mock("../../config/env", () => ({
  getOpenRouterApiKey: mocks.getOpenRouterApiKey,
}))

import { AstraAccessError, createAstraModel } from "./astra-provider"
import { judgmentSchema } from "./source-generation"

const request = {
  schema: z.object({ answer: z.string() }),
  system: "Return the requested JSON object.",
  prompt: "Answer yes.",
  maxOutputTokens: 100,
}

function expectStrictObjectProperties(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectStrictObjectProperties)
    return
  }
  if (!value || typeof value !== "object") return
  const schema = value as Record<string, unknown>
  expect(schema).not.toHaveProperty("oneOf")
  if (schema.properties && typeof schema.properties === "object") {
    expect(schema.additionalProperties).toBe(false)
    expect(Array.isArray(schema.required)).toBe(true)
    expect([...(schema.required as string[])].sort()).toEqual(
      Object.keys(schema.properties).sort(),
    )
  }
  Object.values(schema).forEach(expectStrictObjectProperties)
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

  it("sends the judgment evidence alternatives as a supported nested anyOf", async () => {
    const judgment = {
      connections: [
        {
          kind: "direct",
          relationship: "shared story",
          reasonEnglish: "Both videos cover the same biblical account.",
          addedViewingValueEnglish: null,
          evidence: { basis: "metadata", fields: ["title"] },
          strength: 80,
        },
      ],
    }
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "response-judgment",
          object: "response",
          created_at: 1_791_244_800,
          model: "openai/gpt-6-astra",
          status: "completed",
          output: [
            {
              type: "message",
              id: "message-judgment",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(judgment),
                  annotations: [],
                },
              ],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 30, total_tokens: 42 },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", transport)
    expect(
      (
        await createAstraModel().generate({
          schema: judgmentSchema,
          system: "Return the requested JSON object.",
          prompt: "Compare the supplied videos.",
          maxOutputTokens: 500,
        })
      ).output,
    ).toEqual(judgment)

    const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body))
    const evidence =
      body.text.format.schema.properties.connections.items.properties.evidence
    expectStrictObjectProperties(body.text.format.schema)
    expect(
      body.text.format.schema.properties.connections.items.required,
    ).toContain("addedViewingValueEnglish")
    expect(evidence).toHaveProperty("anyOf")
    expect(evidence).not.toHaveProperty("oneOf")
    expect(evidence.anyOf).toHaveLength(2)
    expect(
      judgmentSchema.safeParse({
        connections: [
          {
            ...judgment.connections[0],
            evidence: { basis: "transcript", passages: [] },
          },
        ],
      }).success,
    ).toBe(false)
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
