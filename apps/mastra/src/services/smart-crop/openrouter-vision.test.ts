import { describe, expect, it, vi } from "vitest"

import {
  requestRenderQaReview,
  type RequestRenderQaReviewOptions,
  SmartCropProviderError,
} from "./openrouter-vision"

const frames = [
  {
    atSeconds: 12,
    url: "https://image.mux.com/playback/thumbnail.jpg?time=12",
    shotId: "shot-1",
  },
]

function response(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

function successResponse() {
  return response({
    choices: [
      {
        message: {
          content: JSON.stringify({ verdict: "pass", issues: [] }),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  })
}

function requestOptions(
  overrides: Partial<RequestRenderQaReviewOptions> = {},
): RequestRenderQaReviewOptions {
  return {
    frames,
    planSummary: { segmentCount: 1, modes: { speaker: 1 } },
    renderMode: "preview" as const,
    model: "google/gemini-2.5-flash",
    apiKey: "test-key",
    ...overrides,
  }
}

describe("smart crop OpenRouter recovery", () => {
  it("honors Retry-After and recovers from one 429", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          { error: { code: 429, message: "secret provider detail" } },
          429,
          { "retry-after": "2" },
        ),
      )
      .mockResolvedValueOnce(successResponse())
    const sleep = vi.fn(async (_ms: number) => undefined)

    const result = await requestRenderQaReview(
      requestOptions({
        fetchImpl,
        recovery: { sleep, now: () => 1_000 },
      }),
    )

    expect(result).toEqual({
      verdict: "pass",
      issues: [],
      usage: { inputTokens: 10, outputTokens: 2 },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
    expect(sleep.mock.calls[0]![0]).toBeGreaterThanOrEqual(2_000)
  })

  it("exhausts persistent 429 after exactly three sanitized attempts", async () => {
    const hostileDetail =
      "Bearer sk-secret prompt=Jesus frame=https://image.mux.com/private"
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ error: { code: 429, message: hostileDetail } }, 429),
      )
    const sleep = vi.fn(async (_ms: number) => undefined)

    const promise = requestRenderQaReview(
      requestOptions({
        fetchImpl,
        recovery: { sleep, now: () => 1_000, random: () => 0 },
      }),
    )

    const error = await promise.catch((cause: unknown) => cause)
    expect(error).toMatchObject({
      name: "SmartCropProviderError",
      reason: "provider_rate_limited",
      retryable: false,
    } satisfies Partial<SmartCropProviderError>)
    expect(String(error)).toContain("after 3 attempts")
    expect(String(error)).not.toContain(hostileDetail)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it.each([
    ["HTTP 503", () => response({ error: { code: 503 } }, 503)],
    [
      "an embedded provider-unavailable error",
      () =>
        response({
          error: {
            metadata: { error_type: "provider_unavailable" },
            message: "private provider detail",
          },
        }),
    ],
  ])(
    "exhausts persistent %s after exactly three attempts",
    async (_label, makeResponse) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => makeResponse())
      const sleep = vi.fn(async (_ms: number) => undefined)

      const error = await requestRenderQaReview(
        requestOptions({
          fetchImpl,
          recovery: { sleep, now: () => 1_000, random: () => 0 },
        }),
      ).catch((cause: unknown) => cause)

      expect(error).toMatchObject({
        reason: "provider_failed",
        retryable: false,
      })
      expect(String(error)).toContain("after 3 attempts")
      expect(String(error)).not.toContain("private provider detail")
      expect(fetchImpl).toHaveBeenCalledTimes(3)
      expect(sleep).toHaveBeenCalledTimes(2)
    },
  )

  it("preserves the last explicit failure when sleep overruns the deadline", async () => {
    let currentTime = 10_000
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ error: { code: 429 } }, 429))
    const sleep = vi.fn(async (ms: number) => {
      currentTime += ms + 1_000
    })

    const error = await requestRenderQaReview(
      requestOptions({
        fetchImpl,
        timeoutMs: 1_000,
        recovery: { sleep, now: () => currentTime, random: () => 0 },
      }),
    ).catch((cause: unknown) => cause)

    expect(error).toMatchObject({
      reason: "provider_rate_limited",
      retryable: false,
    })
    expect(String(error)).toContain("after 1 attempt")
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(sleep).toHaveBeenCalledOnce()
  })

  it("uses future HTTP-date Retry-After values", async () => {
    let currentTime = Date.parse("2026-07-14T12:00:00.000Z")
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ error: { code: 429 } }, 429, {
          "retry-after": new Date(currentTime + 5_000).toUTCString(),
        }),
      )
      .mockResolvedValueOnce(successResponse())
    const sleep = vi.fn(async (ms: number) => {
      currentTime += ms
    })

    await requestRenderQaReview(
      requestOptions({
        fetchImpl,
        recovery: { sleep, now: () => currentTime },
      }),
    )

    expect(sleep).toHaveBeenCalledWith(5_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([
    ["the per-delay ceiling", 90_000, 90_000],
    ["the remaining deadline", 2_000, 1_000],
  ])(
    "stops when Retry-After exceeds %s instead of retrying early",
    async (_label, retryAfterMs, timeoutMs) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        response({ error: { code: 429 } }, 429, {
          "retry-after": String(retryAfterMs / 1_000),
        }),
      )
      const sleep = vi.fn(async (_ms: number) => undefined)

      const error = await requestRenderQaReview(
        requestOptions({
          fetchImpl,
          timeoutMs,
          recovery: { sleep, now: () => 10_000 },
        }),
      ).catch((cause: unknown) => cause)

      expect(error).toMatchObject({
        reason: "provider_rate_limited",
        retryable: false,
      })
      expect(String(error)).toContain("after 1 attempt")
      expect(sleep).not.toHaveBeenCalled()
      expect(fetchImpl).toHaveBeenCalledOnce()
    },
  )

  it.each([
    ["HTTP 503", () => response({ error: { code: 503 } }, 503)],
    [
      "an embedded overloaded error",
      () =>
        response({
          error: {
            type: "provider_overloaded",
            message: "provider detail must stay private",
          },
        }),
    ],
    [
      "an embedded choice rate-limit error",
      () =>
        response({
          choices: [
            {
              finish_reason: "error",
              error: {
                metadata: { error_type: "rate_limit_exceeded" },
              },
            },
          ],
        }),
    ],
  ])("recovers from %s", async (_label, firstResponse) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(firstResponse())
      .mockResolvedValueOnce(successResponse())

    await expect(
      requestRenderQaReview(
        requestOptions({
          fetchImpl,
          recovery: {
            sleep: async () => undefined,
            now: () => 10_000,
            random: () => 0,
          },
        }),
      ),
    ).resolves.toMatchObject({ verdict: "pass" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("does not retry an ambiguous transport failure or expose its message", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("sk-secret frame=https://private.example"))

    const error = await requestRenderQaReview(
      requestOptions({ fetchImpl }),
    ).catch((cause: unknown) => cause)

    expect(error).toMatchObject({
      reason: "provider_failed",
      retryable: false,
    })
    expect(String(error)).toContain("after 1 attempt")
    expect(String(error)).not.toContain("sk-secret")
    expect(String(error)).not.toContain("private.example")
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("does not let provider codes override canonical terminal error types", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        error: {
          code: 429,
          metadata: {
            error_type: "invalid_request",
            provider_code: "429",
          },
        },
      }),
    )
    const sleep = vi.fn(async (_ms: number) => undefined)

    const error = await requestRenderQaReview(
      requestOptions({ fetchImpl, recovery: { sleep } }),
    ).catch((cause: unknown) => cause)

    expect(error).toMatchObject({
      reason: "provider_failed",
      retryable: false,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })

  it.each([
    [400, "provider_failed"],
    [401, "provider_auth_failed"],
    [402, "provider_failed"],
    [403, "provider_auth_failed"],
    [500, "provider_failed"],
  ])("does not retry terminal status %i", async (status, reason) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ error: { message: "private" } }, status))

    const error = await requestRenderQaReview(
      requestOptions({ fetchImpl }),
    ).catch((cause: unknown) => cause)

    expect(error).toMatchObject({ reason, retryable: false })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("preserves the same key, model, and body across retries", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ error: { code: 503 } }, 503))
      .mockResolvedValueOnce(successResponse())

    await requestRenderQaReview(
      requestOptions({
        fetchImpl,
        recovery: {
          sleep: async () => undefined,
          now: () => 10_000,
          random: () => 0,
        },
      }),
    )

    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, RequestInit]
    >
    expect(calls[0]![1].body).toBe(calls[1]![1].body)
    expect(calls[0]![1].headers).toEqual(calls[1]![1].headers)
    expect(JSON.parse(String(calls[0]![1].body)).model).toBe(
      "google/gemini-2.5-flash",
    )
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    )
  })

  it("keeps provider bodies out of structured retry logs", async () => {
    const hostile = "Bearer sk-secret prompt fragment private-frame-url"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ error: { code: 429, message: hostile } }, 429),
      )
      .mockResolvedValueOnce(successResponse())

    try {
      await requestRenderQaReview(
        requestOptions({
          fetchImpl,
          recovery: {
            sleep: async () => undefined,
            now: () => 10_000,
            random: () => 0,
          },
        }),
      )
      const logs = JSON.stringify([
        ...warn.mock.calls.flat(),
        ...info.mock.calls.flat(),
      ])
      expect(logs).toContain("smart_crop_provider_retry")
      expect(logs).toContain("smart_crop_provider_recovered")
      expect(logs).not.toContain(hostile)
      expect(logs).not.toContain("sk-secret")
    } finally {
      warn.mockRestore()
      info.mockRestore()
    }
  })
})
