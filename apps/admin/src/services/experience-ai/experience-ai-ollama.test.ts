import { beforeEach, describe, expect, it, vi } from "vitest"

const { envState } = vi.hoisted(() => ({
  envState: {
    OLLAMA_BASE_URL: "http://localhost:11434" as string | undefined,
    OLLAMA_CHAT_MODEL: undefined as string | undefined,
  },
}))

vi.mock("@/config/env", () => ({ env: envState }))

import {
  generateOllamaStructuredOutput,
  OllamaProviderError,
  ollamaChatModel,
  runOllamaChat,
} from "./experience-ai-ollama"

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function ollamaChatOkResponse(
  content: string,
  model = "gemma4:e4b",
): Response {
  return jsonResponse({
    model,
    message: { role: "assistant", content },
    done: true,
  })
}

function ndjsonStream(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  })
}

describe("ollamaChatModel", () => {
  beforeEach(() => {
    envState.OLLAMA_CHAT_MODEL = undefined
  })

  it("defaults to gemma4:e4b when env is unset", () => {
    expect(ollamaChatModel()).toBe("gemma4:e4b")
  })

  it("returns the env override when set", () => {
    envState.OLLAMA_CHAT_MODEL = "llama3:70b"
    expect(ollamaChatModel()).toBe("llama3:70b")
  })
})

describe("generateOllamaStructuredOutput", () => {
  beforeEach(() => {
    envState.OLLAMA_BASE_URL = "http://localhost:11434"
    envState.OLLAMA_CHAT_MODEL = undefined
  })

  it("returns the validated payload on a happy round-trip", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(ollamaChatOkResponse(JSON.stringify({ ok: true })))

    const result = await generateOllamaStructuredOutput({
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
      validate: (payload) => payload as { ok: boolean },
    })

    expect(result.payload).toEqual({ ok: true })
    expect(result.model).toBe("gemma4:e4b")
    expect(result.usedModel).toBe("gemma4:e4b")
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0]!.status).toBe("succeeded")

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("http://localhost:11434/api/chat")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.stream).toBe(false)
    expect(body.format).toBe("json")
    expect(body.model).toBe("gemma4:e4b")
  })

  it("strips markdown fences before parsing", async () => {
    const fenced = "```json\n{\"x\":1}\n```"
    const fetchImpl = vi.fn().mockResolvedValue(ollamaChatOkResponse(fenced))

    const result = await generateOllamaStructuredOutput({
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
      validate: (payload) => payload as { x: number },
    })

    expect(result.payload).toEqual({ x: 1 })
  })

  it("recovers from a doubly JSON-encoded body", async () => {
    const doubled = JSON.stringify(JSON.stringify({ x: 2 }))
    const fetchImpl = vi.fn().mockResolvedValue(ollamaChatOkResponse(doubled))

    const result = await generateOllamaStructuredOutput({
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
      validate: (payload) => payload as { x: number },
    })

    expect(result.payload).toEqual({ x: 2 })
  })

  it("throws OllamaProviderError(timeout) when fetch aborts", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const error = new Error("aborted")
      error.name = "AbortError"
      throw error
    })

    await expect(
      generateOllamaStructuredOutput({
        messages: [{ role: "user", content: "hi" }],
        fetchImpl,
        validate: (payload) => payload,
      }),
    ).rejects.toMatchObject({
      name: "OllamaProviderError",
      code: "timeout",
    })
  })

  it("throws OllamaProviderError(upstream_error) on non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("boom", { status: 500 }))

    await expect(
      generateOllamaStructuredOutput({
        messages: [{ role: "user", content: "hi" }],
        fetchImpl,
        validate: (payload) => payload,
      }),
    ).rejects.toMatchObject({
      name: "OllamaProviderError",
      code: "upstream_error",
    })
  })

  it("throws OllamaProviderError(validation_error) when validate throws", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(ollamaChatOkResponse(JSON.stringify({ x: 1 })))

    await expect(
      generateOllamaStructuredOutput({
        messages: [{ role: "user", content: "hi" }],
        fetchImpl,
        validate: () => {
          throw new Error("nope")
        },
      }),
    ).rejects.toMatchObject({
      name: "OllamaProviderError",
      code: "validation_error",
    })
  })

  it("throws OllamaProviderError(missing_provider) when fetch fails to connect", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      throw new TypeError("fetch failed")
    })

    await expect(
      generateOllamaStructuredOutput({
        messages: [{ role: "user", content: "hi" }],
        fetchImpl,
        validate: (payload) => payload,
      }),
    ).rejects.toMatchObject({
      name: "OllamaProviderError",
      code: "missing_provider",
    })
  })
})

describe("runOllamaChat", () => {
  beforeEach(() => {
    envState.OLLAMA_BASE_URL = "http://localhost:11434"
    envState.OLLAMA_CHAT_MODEL = undefined
  })

  it("yields token deltas and resolves with the parsed envelope on done:true", async () => {
    const envelope = {
      mutations: { title: "Hello" },
    }
    const text = JSON.stringify(envelope)
    const chunks = [
      JSON.stringify({ message: { content: text.slice(0, 4) }, done: false }) +
        "\n",
      JSON.stringify({ message: { content: text.slice(4) }, done: false }) +
        "\n",
      JSON.stringify({ message: { content: "" }, done: true }) + "\n",
    ]
    const fetchImpl = vi.fn().mockResolvedValue(ndjsonStream(chunks))
    const tokens: string[] = []

    const result = await runOllamaChat({
      prompt: "go",
      onToken: (t) => tokens.push(t),
      fetchImpl,
    })

    expect(result.kind).toBe("envelope")
    if (result.kind === "envelope") {
      expect(result.raw).toEqual(envelope)
    }
    expect(tokens.join("")).toBe(text)
  })

  it("parses two NDJSON lines from a single chunk", async () => {
    const envelope = { mutations: { title: "X" } }
    const text = JSON.stringify(envelope)
    const single =
      JSON.stringify({ message: { content: text }, done: false }) +
      "\n" +
      JSON.stringify({ message: { content: "" }, done: true }) +
      "\n"
    const fetchImpl = vi.fn().mockResolvedValue(ndjsonStream([single]))
    const tokens: string[] = []

    const result = await runOllamaChat({
      prompt: "go",
      onToken: (t) => tokens.push(t),
      fetchImpl,
    })

    expect(result.kind).toBe("envelope")
    expect(tokens.join("")).toBe(text)
  })

  it("recovers when a chunk straddles a newline boundary", async () => {
    const envelope = { mutations: { metaDescription: "split" } }
    const text = JSON.stringify(envelope)
    const line1 =
      JSON.stringify({ message: { content: text }, done: false }) + "\n"
    const line2 =
      JSON.stringify({ message: { content: "" }, done: true }) + "\n"
    // Split line1 mid-JSON to force buffer continuation.
    const chunk1 = line1.slice(0, 10)
    const chunk2 = line1.slice(10) + line2
    const fetchImpl = vi.fn().mockResolvedValue(ndjsonStream([chunk1, chunk2]))

    const result = await runOllamaChat({
      prompt: "go",
      onToken: () => {},
      fetchImpl,
    })

    expect(result.kind).toBe("envelope")
    if (result.kind === "envelope") {
      expect(result.raw).toEqual(envelope)
    }
  })

  it("returns provider_unavailable on a 500 response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 }))

    const result = await runOllamaChat({
      prompt: "go",
      onToken: () => {},
      fetchImpl,
    })

    expect(result).toMatchObject({
      kind: "error",
      code: "provider_unavailable",
    })
  })

  it("returns provider_not_configured when fetch fails to connect", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      throw new TypeError("fetch failed")
    })

    const result = await runOllamaChat({
      prompt: "go",
      onToken: () => {},
      fetchImpl,
    })

    expect(result).toMatchObject({
      kind: "error",
      code: "provider_not_configured",
    })
  })

  it("returns cancelled when the upstream abort signal fires before fetch resolves", async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          ;(init.signal as AbortSignal).addEventListener("abort", () => {
            const err = new Error("aborted")
            err.name = "AbortError"
            reject(err)
          })
        }),
    )

    const promise = runOllamaChat({
      prompt: "go",
      abortSignal: controller.signal,
      onToken: () => {},
      fetchImpl,
    })
    controller.abort()
    const result = await promise

    expect(result).toMatchObject({ kind: "error", code: "cancelled" })
  })

  it("returns provider_unavailable when the stream emits a mid-flight error field", async () => {
    const chunks = [
      JSON.stringify({ message: { content: "partial" }, done: false }) + "\n",
      JSON.stringify({ error: "out of memory" }) + "\n",
    ]
    const fetchImpl = vi.fn().mockResolvedValue(ndjsonStream(chunks))

    const result = await runOllamaChat({
      prompt: "go",
      onToken: () => {},
      fetchImpl,
    })

    expect(result).toMatchObject({
      kind: "error",
      code: "provider_unavailable",
    })
  })

  it("returns invalid_json when accumulated content is not parseable", async () => {
    const chunks = [
      JSON.stringify({
        message: { content: "not-json-content" },
        done: false,
      }) + "\n",
      JSON.stringify({ message: { content: "" }, done: true }) + "\n",
    ]
    const fetchImpl = vi.fn().mockResolvedValue(ndjsonStream(chunks))

    const result = await runOllamaChat({
      prompt: "go",
      onToken: () => {},
      fetchImpl,
    })

    expect(result).toMatchObject({ kind: "error", code: "invalid_json" })
  })

  it("returns empty_response when the stream produces no content", async () => {
    const chunks = [
      JSON.stringify({ message: { content: "" }, done: true }) + "\n",
    ]
    const fetchImpl = vi.fn().mockResolvedValue(ndjsonStream(chunks))

    const result = await runOllamaChat({
      prompt: "go",
      onToken: () => {},
      fetchImpl,
    })

    expect(result).toMatchObject({ kind: "error", code: "empty_response" })
  })
})

describe("OllamaProviderError", () => {
  it("carries the discriminated code and attempts list", () => {
    const err = new OllamaProviderError("timeout", "boom", [
      { model: "gemma4:e4b", status: "failed", reason: "timed out" },
    ])
    expect(err.code).toBe("timeout")
    expect(err.attempts).toHaveLength(1)
    expect(err.name).toBe("OllamaProviderError")
  })
})
