import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import {
  createDevotionalLlm,
  DEVOTIONAL_LLM_MAX_RESPONSE_BYTES,
  DevotionalLlmError,
} from "./llm"

const SCHEMA = z.object({ x: z.number() }).strict()
const JSON_SCHEMA = {
  name: "test",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { x: { type: "number" } },
    required: ["x"],
  },
}

function chatResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function makeLlm(
  fetchImpl: typeof fetch,
  opts: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {},
) {
  return createDevotionalLlm({
    model: "test-model",
    apiKey: "test-key",
    fetchImpl,
    maxAttempts: opts.maxAttempts ?? 3,
    sleep: opts.sleep ?? (async () => {}),
  })
}

const complete = {
  system: "s",
  user: "u",
  jsonSchema: JSON_SCHEMA,
  schema: SCHEMA,
}

describe("createDevotionalLlm", () => {
  it("throws missing_credentials when no API key is available", () => {
    expect(() => createDevotionalLlm({ model: "m", apiKey: "" })).toThrow(
      DevotionalLlmError,
    )
    try {
      createDevotionalLlm({ model: "m", apiKey: "" })
    } catch (error) {
      expect((error as DevotionalLlmError).code).toBe("missing_credentials")
    }
  })

  it("returns the parsed, schema-validated JSON on success", async () => {
    const llm = makeLlm(async () => chatResponse(JSON.stringify({ x: 42 })))
    await expect(llm.complete(complete)).resolves.toEqual({ x: 42 })
  })

  it("retries on 5xx then succeeds", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(chatResponse("", 500))
      .mockResolvedValueOnce(chatResponse(JSON.stringify({ x: 1 })))
    const llm = makeLlm(fetchImpl as unknown as typeof fetch, { sleep })

    await expect(llm.complete(complete)).resolves.toEqual({ x: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it("retries on a transport throw then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(chatResponse(JSON.stringify({ x: 7 })))
    const llm = makeLlm(fetchImpl as unknown as typeof fetch)

    await expect(llm.complete(complete)).resolves.toEqual({ x: 7 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("honors the retry-after header on 429", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "retry-after": "2" } }),
      )
      .mockResolvedValueOnce(chatResponse(JSON.stringify({ x: 1 })))
    const llm = makeLlm(fetchImpl as unknown as typeof fetch, { sleep })

    await expect(llm.complete(complete)).resolves.toEqual({ x: 1 })
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it("throws transport after exhausting retries on repeated throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"))
    const llm = makeLlm(fetchImpl as unknown as typeof fetch, {
      maxAttempts: 2,
    })

    await expect(llm.complete(complete)).rejects.toMatchObject({
      name: "DevotionalLlmError",
      code: "transport",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("throws request_failed on a non-retryable 4xx", async () => {
    const llm = makeLlm(async () => chatResponse("", 400))
    await expect(llm.complete(complete)).rejects.toMatchObject({
      code: "request_failed",
    })
  })

  it("throws validation when the response has no text content", async () => {
    const llm = makeLlm(
      async () =>
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    )
    await expect(llm.complete(complete)).rejects.toMatchObject({
      code: "validation",
    })
  })

  it("throws validation when the content is not valid JSON", async () => {
    const llm = makeLlm(async () => chatResponse("not json"))
    try {
      await llm.complete(complete)
      throw new Error("expected validation failure")
    } catch (error) {
      expect(error).toMatchObject({ code: "validation" })
      expect((error as DevotionalLlmError).cause).toBeUndefined()
    }
  })

  it("throws validation when the JSON fails schema validation", async () => {
    const llm = makeLlm(async () => chatResponse(JSON.stringify({ x: "nope" })))
    await expect(llm.complete(complete)).rejects.toMatchObject({
      code: "validation",
    })
  })

  it("accepts a near-cap success body containing three-byte script", async () => {
    const schema = z.object({ text: z.string() }).strict()
    const jsonSchema = {
      name: "large-text",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    }
    let repeat = Math.floor((DEVOTIONAL_LLM_MAX_RESPONSE_BYTES - 256) / 3)
    let content = JSON.stringify({ text: "あ".repeat(repeat) })
    let responseBody = JSON.stringify({ choices: [{ message: { content } }] })
    while (
      new TextEncoder().encode(responseBody).byteLength >
      DEVOTIONAL_LLM_MAX_RESPONSE_BYTES
    ) {
      repeat -= 1
      content = JSON.stringify({ text: "あ".repeat(repeat) })
      responseBody = JSON.stringify({ choices: [{ message: { content } }] })
    }
    expect(new TextEncoder().encode(responseBody).byteLength).toBeGreaterThan(
      DEVOTIONAL_LLM_MAX_RESPONSE_BYTES - 512,
    )
    const llm = makeLlm(
      async () =>
        new Response(responseBody, {
          headers: { "content-type": "application/json" },
        }),
    )

    await expect(
      llm.complete({ ...complete, schema, jsonSchema }),
    ).resolves.toEqual({ text: "あ".repeat(repeat) })
  })

  it("cancels an over-cap success body and maps it to validation", async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array(DEVOTIONAL_LLM_MAX_RESPONSE_BYTES + 1),
        )
      },
      cancel() {
        cancelled = true
      },
    })
    const llm = makeLlm(async () => new Response(stream))

    await expect(llm.complete(complete)).rejects.toMatchObject({
      code: "validation",
    })
    expect(cancelled).toBe(true)
  })

  it("cancels an over-cap error body without exposing it", async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array(DEVOTIONAL_LLM_MAX_RESPONSE_BYTES + 1),
        )
      },
      cancel() {
        cancelled = true
      },
    })
    const llm = makeLlm(async () => new Response(stream, { status: 400 }))

    await expect(llm.complete(complete)).rejects.toMatchObject({
      code: "request_failed",
      message: "devotional model request failed with 400: ",
    })
    expect(cancelled).toBe(true)
  })
})
