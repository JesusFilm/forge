import { describe, expect, it, vi } from "vitest"

import { _internals, requestOpenRouterChat } from "./openrouter"

describe("OpenRouter subtitle adapter", () => {
  it("accepts a JSON response exactly at the streamed byte ceiling", async () => {
    const body = '{"ok":true}'

    await expect(
      _internals.readBoundedResponseJson(
        new Response(body),
        new TextEncoder().encode(body).byteLength,
      ),
    ).resolves.toEqual({ ok: true })
  })

  it("cancels a streamed response before parsing when its byte ceiling is exceeded", async () => {
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":'))
          controller.enqueue(new TextEncoder().encode("true}"))
        },
        cancel,
      }),
    )

    await expect(
      _internals.readBoundedResponseJson(response, 6),
    ).rejects.toMatchObject({
      reason: "provider_invalid_output",
      retryable: true,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("pins deterministic temperature and gives the documented generation header precedence over a mismatched body id", async () => {
    const onUsage = vi.fn()
    const onProviderCall = vi.fn()
    const fetchImpl = vi.fn(async (_url, _init) =>
      Response.json(
        {
          id: "generation-response-1",
          model: "provider/resolved-model-1",
          choices: [{ message: { content: "translated" } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        },
        { headers: { "X-Generation-Id": "generation-header-1" } },
      ),
    )

    await expect(
      requestOpenRouterChat({
        apiKey: "secret",
        model: "fixture/model",
        messages: [{ role: "user", content: "hello" }],
        timeoutMs: 60_000,
        fetchImpl,
        onUsage,
        onProviderCall,
      }),
    ).resolves.toMatchObject({ value: "translated" })

    const requestBody = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>
    expect(requestBody.temperature).toBe(0)
    expect(requestBody.max_tokens).toBe(4_096)
    expect(onUsage).toHaveBeenCalledWith({
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
    })
    expect(onProviderCall).toHaveBeenCalledWith({
      status: "SUCCEEDED",
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      providerRequestId: null,
      providerResponseId: "generation-header-1",
      requestedModel: "fixture/model",
      resolvedModel: "provider/resolved-model-1",
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    })
  })

  it("does not start a provider request after the shared cell deadline", async () => {
    const fetchImpl = vi.fn()
    const onProviderCall = vi.fn()
    await expect(
      requestOpenRouterChat({
        apiKey: "secret",
        model: "fixture/model",
        messages: [{ role: "user", content: "hello" }],
        timeoutMs: 60_000,
        deadlineAtMs: Date.now() - 1,
        fetchImpl,
        onProviderCall,
      }),
    ).rejects.toThrow(/deadline expired/i)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(onProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
    )
  })

  it("records a failed provider generation id without inventing a request id", async () => {
    const onProviderCall = vi.fn()

    await expect(
      requestOpenRouterChat({
        apiKey: "secret",
        model: "fixture/model",
        messages: [{ role: "user", content: "hello" }],
        timeoutMs: 60_000,
        fetchImpl: async () =>
          new Response("slow down", {
            status: 429,
            headers: { "X-Generation-Id": "generation-response-429" },
          }),
        onProviderCall,
      }),
    ).rejects.toMatchObject({ reason: "provider_failed" })

    expect(onProviderCall).toHaveBeenCalledWith({
      status: "FAILED",
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      providerRequestId: null,
      providerResponseId: "generation-response-429",
      requestedModel: "fixture/model",
      resolvedModel: null,
      usage: null,
    })
  })

  it("falls back to the response body generation id when the documented header is absent", async () => {
    const onProviderCall = vi.fn()

    await requestOpenRouterChat({
      apiKey: "secret",
      model: "fixture/model",
      messages: [{ role: "user", content: "hello" }],
      timeoutMs: 60_000,
      fetchImpl: async () =>
        Response.json({
          id: "generation-body-only",
          model: "provider/resolved-model",
          choices: [{ message: { content: "translated" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      onProviderCall,
    })

    expect(onProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRequestId: null,
        providerResponseId: "generation-body-only",
      }),
    )
  })

  it("drops oversized or control-character provider identities", async () => {
    const onProviderCall = vi.fn()

    await requestOpenRouterChat({
      apiKey: "secret",
      model: "fixture/model",
      messages: [{ role: "user", content: "hello" }],
      timeoutMs: 60_000,
      fetchImpl: async () =>
        Response.json(
          {
            id: "x".repeat(192),
            model: "provider/model\u0000unsafe",
            choices: [{ message: { content: "translated" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
          { headers: { "X-Generation-Id": "response-safe" } },
        ),
      onProviderCall,
    })

    expect(onProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRequestId: null,
        providerResponseId: "response-safe",
        resolvedModel: null,
      }),
    )
  })

  it("reports accounting coverage when a successful provider body omits usage", async () => {
    const onUsage = vi.fn()
    const onUsageUnavailable = vi.fn()

    await requestOpenRouterChat({
      apiKey: "secret",
      model: "fixture/model",
      messages: [{ role: "user", content: "hello" }],
      timeoutMs: 60_000,
      fetchImpl: async () =>
        Response.json({
          choices: [{ message: { content: "translated" } }],
        }),
      onUsage,
      onUsageUnavailable,
    })

    expect(onUsage).not.toHaveBeenCalled()
    expect(onUsageUnavailable).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      "transport failure",
      async () => {
        throw new Error("network down")
      },
      "provider_failed",
    ],
    [
      "authorization failure",
      async () => new Response("unauthorized", { status: 401 }),
      "provider_auth_failed",
    ],
    [
      "rate limit",
      async () => new Response("slow down", { status: 429 }),
      "provider_failed",
    ],
    [
      "upstream failure",
      async () => new Response("unavailable", { status: 503 }),
      "provider_failed",
    ],
  ])(
    "reports exactly one unavailable-usage attempt for %s",
    async (_label, fetchImpl, reason) => {
      const onUsage = vi.fn()
      const onUsageUnavailable = vi.fn()

      await expect(
        requestOpenRouterChat({
          apiKey: "secret",
          model: "fixture/model",
          messages: [{ role: "user", content: "hello" }],
          timeoutMs: 60_000,
          fetchImpl,
          onUsage,
          onUsageUnavailable,
        }),
      ).rejects.toMatchObject({ reason })

      expect(onUsage).not.toHaveBeenCalled()
      expect(onUsageUnavailable).toHaveBeenCalledTimes(1)
    },
  )
})
