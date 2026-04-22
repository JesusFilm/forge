import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const { createCompletionMock } = vi.hoisted(() => ({
  createCompletionMock: vi.fn(),
}))

vi.mock("@/config/env", () => ({
  env: {
    OPENROUTER_API_KEY: "test-key",
  },
}))

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: createCompletionMock,
      },
    }
  },
}))

import {
  DEFAULT_MODEL,
  createStructuredOpenrouterOutput,
} from "@/services/openrouter"

const schema = z.object({
  ok: z.string(),
  count: z.number(),
})

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "string" },
    count: { type: "number" },
  },
  required: ["ok", "count"],
} satisfies Record<string, unknown>

describe("createStructuredOpenrouterOutput", () => {
  beforeEach(() => {
    createCompletionMock.mockReset()
  })

  it("requests strict schema output with response healing and parses the object", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '{"ok":"yes","count":2}' } }],
    })

    await expect(
      createStructuredOpenrouterOutput({
        context: "test-context",
        name: "test_payload",
        schema,
        jsonSchema,
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "hello world" }],
      }),
    ).resolves.toEqual({
      ok: "yes",
      count: 2,
    })

    expect(createCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_MODEL,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "test_payload",
            strict: true,
            schema: jsonSchema,
          },
        },
        plugins: [{ id: "response-healing" }],
      }),
    )
  })

  it("handles a stringified json payload after the first parse", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        { message: { content: '"{\\"ok\\":\\"yes\\",\\"count\\":2}"' } },
      ],
    })

    await expect(
      createStructuredOpenrouterOutput({
        context: "test-context",
        name: "test_payload",
        schema,
        jsonSchema,
        messages: [{ role: "user", content: "hello world" }],
      }),
    ).resolves.toEqual({
      ok: "yes",
      count: 2,
    })
  })

  it("throws when the structured payload fails schema validation", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '{"ok":"yes"}' } }],
    })

    await expect(
      createStructuredOpenrouterOutput({
        context: "test-context",
        name: "test_payload",
        schema,
        jsonSchema,
        messages: [{ role: "user", content: "hello world" }],
      }),
    ).rejects.toThrow("Structured output validation failed for test-context")
  })

  it("throws when the provider refuses the structured output request", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { refusal: "safety refusal", content: "" } }],
    })

    await expect(
      createStructuredOpenrouterOutput({
        context: "test-context",
        name: "test_payload",
        schema,
        jsonSchema,
        messages: [{ role: "user", content: "hello world" }],
      }),
    ).rejects.toThrow("Structured output request refused for test-context")
  })

  it("throws when the provider returns blank structured output content", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: "   " } }],
    })

    await expect(
      createStructuredOpenrouterOutput({
        context: "test-context",
        name: "test_payload",
        schema,
        jsonSchema,
        messages: [{ role: "user", content: "hello world" }],
      }),
    ).rejects.toThrow("Structured output missing content for test-context")
  })

  it("supports multimodal user content parts without breaking the request shape", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '{"ok":"yes","count":2}' } }],
    })

    await expect(
      createStructuredOpenrouterOutput({
        context: "test-context",
        name: "test_payload",
        schema,
        jsonSchema,
        messages: [
          { role: "system", content: "system prompt" },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://image.mux.com/test.webp" },
              },
              { type: "text", text: "describe this frame" },
            ],
          },
        ],
      }),
    ).resolves.toEqual({
      ok: "yes",
      count: 2,
    })

    expect(createCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "system prompt" },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://image.mux.com/test.webp" },
              },
              { type: "text", text: "describe this frame" },
            ],
          },
        ],
      }),
    )
  })

  it("reports token usage through an additive callback", async () => {
    const onUsage = vi.fn()
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '{"ok":"yes","count":2}' } }],
      usage: {
        prompt_tokens: 123,
        completion_tokens: 45,
        total_tokens: 168,
      },
    })

    await expect(
      createStructuredOpenrouterOutput({
        context: "test-context",
        name: "test_payload",
        schema,
        jsonSchema,
        messages: [{ role: "user", content: "hello world" }],
        onUsage,
      }),
    ).resolves.toEqual({
      ok: "yes",
      count: 2,
    })

    expect(onUsage).toHaveBeenCalledWith({
      promptTokens: 123,
      completionTokens: 45,
      totalTokens: 168,
    })
  })
})
