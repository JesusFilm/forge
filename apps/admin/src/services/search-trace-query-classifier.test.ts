import { beforeEach, describe, expect, it, vi } from "vitest"

const envMock = vi.hoisted(() => ({
  env: {
    OPENROUTER_API_PAID_KEY: undefined as string | undefined,
    OPENROUTER_API_KEY: undefined as string | undefined,
    OPENROUTER_QUERY_CLASSIFIER_MODEL: undefined as string | undefined,
  },
}))

vi.mock("@/config/env", () => envMock)

import {
  SearchTraceQueryClassifierError,
  buildRequestBody,
  classifyAndStoreSearchTraceLlmLabel,
  createSearchTraceQueryClassifier,
  isLlmClassificationCandidate,
  sanitizeSearchTraceQueryForLlm,
} from "./search-trace-query-classifier"

function buildOpenRouterResponse(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(body) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status, headers: { "content-type": "application/json" } },
  )
}

function buildRawOpenRouterResponse(content: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status, headers: { "content-type": "application/json" } },
  )
}

function buildArrayContentOpenRouterResponse(body: unknown): Response {
  return buildRawOpenRouterResponse([
    { type: "text", text: JSON.stringify(body) },
  ])
}

const ambiguousInput = {
  queryText: "how do I find meaning when everything is hard",
  locale: "en",
  resultCount: 0,
  outcome: "success" as const,
  traceClass: "none",
  queryQualityLabel: "unknown_ambiguous" as const,
  sensitiveQueryLabel: "none" as const,
  abuseLabel: "none" as const,
}

describe("search trace query classifier", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envMock.env.OPENROUTER_API_PAID_KEY = undefined
    envMock.env.OPENROUTER_API_KEY = undefined
    envMock.env.OPENROUTER_QUERY_CLASSIFIER_MODEL = undefined
  })

  it("classifies ambiguous traces through a bounded schema response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      buildOpenRouterResponse({
        queryQualityLabel: "valid_viewer_intent",
        abuseLabel: "none",
        confidence: "high",
        reasonCode: "felt_need",
      }),
    )
    const classifier = createSearchTraceQueryClassifier({
      apiKey: "test",
      model: "test-model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(classifier.classify(ambiguousInput)).resolves.toEqual({
      queryQualityLabel: "valid_viewer_intent",
      abuseLabel: "none",
      confidence: "high",
      reasonCode: "felt_need",
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    expect(body.max_tokens).toBe(300)
    expect(body.temperature).toBe(0)
    expect(JSON.stringify(body)).not.toContain("prompt_tokens")
  })

  it("uses the pinned classifier default model when no model override is provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      buildOpenRouterResponse({
        queryQualityLabel: "valid_viewer_intent",
        abuseLabel: "none",
        confidence: "high",
        reasonCode: "felt_need",
      }),
    )
    const classifier = createSearchTraceQueryClassifier({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await classifier.classify(ambiguousInput)

    expect(classifier.model).toBe("anthropic/claude-haiku-4-5")
    expect(classifier.source).toBe("openrouter:anthropic/claude-haiku-4-5")
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    expect(body.model).toBe("anthropic/claude-haiku-4-5")
  })

  it("uses OPENROUTER_QUERY_CLASSIFIER_MODEL as the classifier model override", async () => {
    envMock.env.OPENROUTER_QUERY_CLASSIFIER_MODEL = "openrouter/test-classifier"
    const fetchImpl = vi.fn().mockResolvedValue(
      buildOpenRouterResponse({
        queryQualityLabel: "valid_viewer_intent",
        abuseLabel: "none",
        confidence: "high",
        reasonCode: "felt_need",
      }),
    )
    const classifier = createSearchTraceQueryClassifier({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await classifier.classify(ambiguousInput)

    expect(classifier.model).toBe("openrouter/test-classifier")
    expect(classifier.source).toBe("openrouter:openrouter/test-classifier")
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    expect(body.model).toBe("openrouter/test-classifier")
  })

  it("prefers OPENROUTER_API_PAID_KEY from env when no explicit key is passed", async () => {
    envMock.env.OPENROUTER_API_PAID_KEY = "paid-openrouter-key"
    envMock.env.OPENROUTER_API_KEY = "legacy-openrouter-key"
    const fetchImpl = vi.fn().mockResolvedValue(
      buildOpenRouterResponse({
        queryQualityLabel: "valid_viewer_intent",
        abuseLabel: "none",
        confidence: "high",
        reasonCode: "felt_need",
      }),
    )
    const classifier = createSearchTraceQueryClassifier({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await classifier.classify(ambiguousInput)

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer paid-openrouter-key",
        }),
      }),
    )
  })

  it("parses OpenRouter text content returned as array parts", async () => {
    const classifier = createSearchTraceQueryClassifier({
      apiKey: "test",
      model: "test-model",
      fetchImpl: vi.fn().mockResolvedValue(
        buildArrayContentOpenRouterResponse({
          queryQualityLabel: "valid_viewer_intent",
          abuseLabel: "none",
          confidence: "medium",
          reasonCode: "array_content",
        }),
      ) as unknown as typeof fetch,
    })

    await expect(classifier.classify(ambiguousInput)).resolves.toEqual({
      queryQualityLabel: "valid_viewer_intent",
      abuseLabel: "none",
      confidence: "medium",
      reasonCode: "array_content",
    })
  })

  it("sanitizes prompt input before building the request", () => {
    const body = buildRequestBody("test-model", {
      ...ambiguousInput,
      queryText:
        "viewer@example.com bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature123",
    })
    const serialized = JSON.stringify(body)

    expect(serialized).toContain("[redacted-email]")
    expect(serialized).toContain("[redacted-token]")
    expect(serialized).not.toContain("viewer@example.com")
    expect(serialized).not.toContain("eyJhbGci")
  })

  it("rejects construction without credentials", () => {
    expect(() => createSearchTraceQueryClassifier()).toThrowError(
      SearchTraceQueryClassifierError,
    )
  })

  it("refuses traces that are neither ambiguous nor high-impact", async () => {
    const classifier = createSearchTraceQueryClassifier({
      apiKey: "test",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })

    await expect(
      classifier.classify({
        ...ambiguousInput,
        queryQualityLabel: "valid_viewer_intent",
        resultCount: 3,
      }),
    ).rejects.toMatchObject({ code: "not_allowed" })
  })

  it("does not allow sensitive or abusive traces by default", () => {
    expect(
      isLlmClassificationCandidate({
        ...ambiguousInput,
        sensitiveQueryLabel: "email",
      }),
    ).toBe(false)
    expect(
      isLlmClassificationCandidate({
        ...ambiguousInput,
        abuseLabel: "prompt_injection_like",
      }),
    ).toBe(false)
  })

  it("supports high-impact valid traces as candidates", () => {
    expect(
      isLlmClassificationCandidate({
        ...ambiguousInput,
        queryQualityLabel: "valid_viewer_intent",
        resultCount: 20,
      }),
    ).toBe(true)
  })

  it("throws validation when the model output is outside the schema", async () => {
    const classifier = createSearchTraceQueryClassifier({
      apiKey: "test",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          buildOpenRouterResponse({ queryQualityLabel: "normal" }),
        ) as unknown as typeof fetch,
    })

    await expect(classifier.classify(ambiguousInput)).rejects.toMatchObject({
      code: "validation",
    })
  })

  it("redacts diagnostics from non-2xx responses", async () => {
    const body =
      "viewer@example.com bearer secretsecretsecret cookie sessionid=abcdef123456 ip 2001:db8::1 user_id usr_123456789"
    const classifier = createSearchTraceQueryClassifier({
      apiKey: "test",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(body, {
          status: 502,
        }),
      ) as unknown as typeof fetch,
    })

    try {
      await classifier.classify(ambiguousInput)
      throw new Error("expected classifier to throw")
    } catch (error) {
      expect(error).toMatchObject({ code: "request_failed" })
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain("viewer@example.com")
      expect(message).not.toContain("secretsecretsecret")
      expect(message).not.toContain("sessionid=abcdef123456")
      expect(message).not.toContain("2001:db8::1")
      expect(message).not.toContain("usr_123456789")
    }
  })

  it("throws typed errors for transport, timeout, and malformed responses", async () => {
    const timeoutError = new DOMException("timed out", "TimeoutError")
    const cases: Array<{
      name: string
      fetchImpl: typeof fetch
      code: SearchTraceQueryClassifierError["code"]
    }> = [
      {
        name: "transport",
        fetchImpl: vi
          .fn()
          .mockRejectedValue(
            new Error("network down"),
          ) as unknown as typeof fetch,
        code: "transport",
      },
      {
        name: "timeout",
        fetchImpl: vi
          .fn()
          .mockRejectedValue(timeoutError) as unknown as typeof fetch,
        code: "timeout",
      },
      {
        name: "invalid response json",
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockRejectedValue(new Error("bad json")),
        }) as unknown as typeof fetch,
        code: "validation",
      },
      {
        name: "missing message content",
        fetchImpl: vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ choices: [] })),
          ) as unknown as typeof fetch,
        code: "validation",
      },
      {
        name: "non-json message content",
        fetchImpl: vi
          .fn()
          .mockResolvedValue(
            buildRawOpenRouterResponse("not json"),
          ) as unknown as typeof fetch,
        code: "validation",
      },
    ]

    for (const testCase of cases) {
      const classifier = createSearchTraceQueryClassifier({
        apiKey: "test",
        fetchImpl: testCase.fetchImpl,
      })
      await expect(
        classifier.classify(ambiguousInput),
        testCase.name,
      ).rejects.toMatchObject({ code: testCase.code })
    }
  })

  it("persists only LLM-specific fields for eligible traces", async () => {
    const prisma = {
      searchTrace: {
        findUnique: vi.fn().mockResolvedValue({
          queryText: "what does forgiveness mean",
          locale: "en",
          resultCount: 24,
          outcome: "SUCCESS",
          traceClass: "none",
          queryQualityLabel: "valid_viewer_intent",
          sensitiveQueryLabel: "none",
          abuseLabel: "none",
          sampleEligible: true,
          rawExpiresAt: new Date("2026-05-27T00:00:00.000Z"),
          llmLabelSource: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const classifier = {
      model: "test-model",
      source: "openrouter:test-model",
      version: "search-query-llm/v1" as const,
      classify: vi.fn().mockResolvedValue({
        queryQualityLabel: "valid_viewer_intent",
        abuseLabel: "none",
        confidence: "medium",
        reasonCode: "high_impact",
      }),
    }
    const now = new Date("2026-05-26T00:00:00.000Z")

    await expect(
      classifyAndStoreSearchTraceLlmLabel(
        prisma as unknown as Parameters<
          typeof classifyAndStoreSearchTraceLlmLabel
        >[0],
        "trace-1",
        classifier,
        now,
      ),
    ).resolves.toMatchObject({ status: "classified" })

    expect(prisma.searchTrace.updateMany).toHaveBeenCalledWith({
      where: {
        id: "trace-1",
        llmLabelSource: null,
        rawExpiresAt: { gt: now },
      },
      data: {
        llmQueryQualityLabel: "valid_viewer_intent",
        llmAbuseLabel: "none",
        llmLabelSource: "openrouter:test-model",
        llmLabelVersion: "search-query-llm/v1",
        llmLabelReason: "medium:high_impact",
        llmLabeledAt: now,
      },
    })
  })

  it("skips missing, already classified, expired, and non-candidate traces", async () => {
    const classifier = {
      model: "test-model",
      source: "openrouter:test-model",
      version: "search-query-llm/v1" as const,
      classify: vi.fn(),
    }
    const now = new Date("2026-05-26T00:00:00.000Z")
    const baseTrace = {
      queryText: "hope",
      locale: "en",
      resultCount: 3,
      outcome: "SUCCESS",
      traceClass: "none",
      queryQualityLabel: "valid_viewer_intent",
      sensitiveQueryLabel: "none",
      abuseLabel: "none",
      sampleEligible: true,
      rawExpiresAt: new Date("2026-05-27T00:00:00.000Z"),
      llmLabelSource: null,
    }

    for (const [trace, reason] of [
      [null, "not_found"],
      [
        { ...baseTrace, llmLabelSource: "openrouter:test" },
        "already_classified",
      ],
      [
        { ...baseTrace, rawExpiresAt: new Date("2026-05-25T00:00:00.000Z") },
        "expired",
      ],
      [{ ...baseTrace, sampleEligible: false }, "not_candidate"],
      [{ ...baseTrace, sensitiveQueryLabel: "email" }, "not_candidate"],
    ] as const) {
      const prisma = {
        searchTrace: {
          findUnique: vi.fn().mockResolvedValue(trace),
          updateMany: vi.fn(),
        },
      }
      await expect(
        classifyAndStoreSearchTraceLlmLabel(
          prisma as unknown as Parameters<
            typeof classifyAndStoreSearchTraceLlmLabel
          >[0],
          "trace-1",
          classifier,
          now,
        ),
      ).resolves.toEqual({ status: "skipped", reason })
      expect(classifier.classify).not.toHaveBeenCalled()
      expect(prisma.searchTrace.updateMany).not.toHaveBeenCalled()
    }
  })

  it("skips when an eligible trace is classified by another worker before update", async () => {
    const prisma = {
      searchTrace: {
        findUnique: vi.fn().mockResolvedValue({
          queryText: "what does forgiveness mean",
          locale: "en",
          resultCount: 24,
          outcome: "SUCCESS",
          traceClass: "none",
          queryQualityLabel: "valid_viewer_intent",
          sensitiveQueryLabel: "none",
          abuseLabel: "none",
          sampleEligible: true,
          rawExpiresAt: new Date("2026-05-27T00:00:00.000Z"),
          llmLabelSource: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const classifier = {
      model: "test-model",
      source: "openrouter:test-model",
      version: "search-query-llm/v1" as const,
      classify: vi.fn().mockResolvedValue({
        queryQualityLabel: "valid_viewer_intent",
        abuseLabel: "none",
        confidence: "medium",
        reasonCode: "high_impact",
      }),
    }

    await expect(
      classifyAndStoreSearchTraceLlmLabel(
        prisma as unknown as Parameters<
          typeof classifyAndStoreSearchTraceLlmLabel
        >[0],
        "trace-1",
        classifier,
        new Date("2026-05-26T00:00:00.000Z"),
      ),
    ).resolves.toEqual({ status: "skipped", reason: "already_classified" })
  })

  it("exposes a prompt sanitizer for tests and future callers", () => {
    expect(
      sanitizeSearchTraceQueryForLlm("token abcdef1234567890abcdef1234567890"),
    ).toContain("[redacted-credential]")
  })
})
