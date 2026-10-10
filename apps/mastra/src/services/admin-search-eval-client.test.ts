import { describe, expect, it, vi } from "vitest"

import {
  callAdminCandidateArchive,
  callAdminCandidateDetail,
  callAdminCandidateStore,
  callAdminCandidateList,
  callAdminCandidatePromote,
  callAdminCandidateReject,
  callAdminCandidateReviewPatch,
  callAdminCatalogContext,
  callAdminEvalSearch,
  callAdminTraceSample,
  type AdminSearchEvalCandidatePayload,
} from "./admin-search-eval-client"

const traceResponse = {
  traces: [
    {
      id: "trace-1",
      queryText: "jesus movie",
      locale: "en",
      routeSource: "rest",
      requestedMode: "hybrid",
      searchMode: "hybrid",
      resultCount: 3,
      latencyBucket: "lt_250ms",
      outcome: "success",
      traceClass: "none",
      queryQualityLabel: "valid_viewer_intent",
      sensitiveQueryLabel: "none",
      abuseLabel: "none",
      queryLabelSource: "rules",
      queryLabelVersion: "search-query-labels/v1",
      queryLabeledAt: "2026-05-26T00:00:00.000Z",
      llmQueryQualityLabel: null,
      llmAbuseLabel: null,
      llmLabelSource: null,
      llmLabelVersion: null,
      llmLabelReason: null,
      llmLabeledAt: null,
      rawExpiresAt: "2026-06-20T00:00:00.000Z",
      createdAt: "2026-05-26T00:00:00.000Z",
    },
  ],
  generatedAt: "2026-05-26T00:00:00.000Z",
}

const catalogResponse = {
  localeProfiles: [{ locale: "en", tier: 1, source: "harness" }],
  anchors: [
    {
      source: "video",
      id: "video-locale-1",
      locale: "en",
      title: "JESUS",
      slug: "jesus",
      label: "FEATURE_FILM",
      snippet: "The story of Jesus.",
      description: null,
      keywords: ["Jesus"],
      expectedResultHints: [
        {
          type: "video",
          id: "video-1",
          slug: "jesus",
          title: "JESUS",
        },
      ],
    },
  ],
  generatedAt: "2026-05-26T00:00:00.000Z",
}

const searchResponse = {
  results: [
    {
      type: "video",
      id: "video-1",
      slug: "jesus",
      title: "JESUS",
      imageUrl: null,
      snippet: "x".repeat(250),
      startSeconds: null,
      playbackId: null,
      score: 1,
      label: "FEATURE_FILM",
      durationSeconds: 120,
      childCount: null,
    },
  ],
  hasMore: false,
  query: "Jesus",
  searchMode: "hybrid",
}

const candidateListResponse = {
  candidates: [
    {
      id: "candidate-1",
      source: "catalog",
      promotionStatus: "generated",
      locale: "en",
      queryText: "Jesus",
      expectedResultHints: [],
      sourceAnchors: [],
      labelProvenance: {},
      generationModel: "seed:v1",
      generationProvider: "mastra",
      judgeSummary: null,
      sanitizedQueryText: null,
      sanitizedExpectedResultNotes: null,
      sanitizedSourceAnchors: [],
      sanitizationStatus: "pending",
      reviewerIdentity: null,
      reviewedAt: null,
      reviewNotes: null,
      promotedAt: null,
      promotionRunContext: {},
      mastraRunId: "run-1",
      retentionExpiresAt: null,
      generatedAt: "2026-05-26T00:00:00.000Z",
      createdAt: "2026-05-26T00:00:00.000Z",
    },
  ],
  generatedAt: "2026-05-26T00:00:00.000Z",
}

describe("Admin search eval client", () => {
  it("posts trace sample requests with bearer auth and parses the response", async () => {
    const fetchImpl = vi.fn(async () => Response.json(traceResponse))

    const result = await callAdminTraceSample({
      url: "https://admin.internal/api/internal/search-traces/sample",
      bearer: "eval-key",
      payload: { limit: 10 },
      fetchImpl,
    })

    expect(result).toEqual({ ok: true, result: traceResponse })
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://admin.internal/api/internal/search-traces/sample"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer eval-key",
        }),
        body: JSON.stringify({ limit: 10 }),
      }),
    )
  })

  it("posts catalog context requests and parses compact anchors", async () => {
    const result = await callAdminCatalogContext({
      url: "https://admin.internal/api/internal/search-eval/catalog-context",
      bearer: "eval-key",
      payload: { locales: ["en"] },
      fetchImpl: vi.fn(async () => Response.json(catalogResponse)),
    })

    expect(result).toEqual({ ok: true, result: catalogResponse })
  })

  it("posts candidate batches and parses store counts", async () => {
    const payload: AdminSearchEvalCandidatePayload[] = [
      {
        source: "catalog",
        locale: "en",
        queryText: "jesus",
        generationModel: "model",
      },
    ]
    const result = await callAdminCandidateStore({
      url: "https://admin.internal/api/internal/search-eval/candidates",
      bearer: "eval-key",
      payload: { candidates: payload },
      fetchImpl: vi.fn(async () =>
        Response.json({
          storedCount: 1,
          skippedCount: 0,
          candidates: [
            { id: "candidate-1", dedupeKey: "abc", status: "created" },
          ],
          skipped: [],
        }),
      ),
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        storedCount: 1,
        skippedCount: 0,
      },
    })
  })

  it("posts eval search requests with bearer auth, retries 429, and truncates snippets", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: "Too many requests" },
          { status: 429, headers: { "retry-after": "60" } },
        ),
      )
      .mockResolvedValueOnce(Response.json(searchResponse))

    const result = await callAdminEvalSearch({
      url: "https://admin.internal/api/internal/search-eval/search",
      bearer: "eval-key",
      payload: {
        query: "Jesus",
        locale: "en",
        limit: 20,
        mode: "keyword-first",
        contentType: "video",
      },
      fetchImpl,
      sleep,
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        results: [expect.objectContaining({ snippet: expect.any(String) })],
      },
    })
    if (result.ok) {
      expect(Array.from(result.result.results[0]!.snippet)).toHaveLength(200)
    }
    expect(sleep).toHaveBeenCalledWith(60_000)
    expect(fetchImpl).toHaveBeenLastCalledWith(
      new URL("https://admin.internal/api/internal/search-eval/search"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer eval-key",
        }),
        body: JSON.stringify({
          query: "Jesus",
          locale: "en",
          limit: 20,
          mode: "keyword-first",
          contentType: "video",
        }),
      }),
    )
  })

  it("retries transient eval search transport and 5xx failures", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce(
        Response.json({ error: "unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json(searchResponse))

    const result = await callAdminEvalSearch({
      url: "https://admin.internal/api/internal/search-eval/search",
      bearer: "eval-key",
      payload: { query: "Jesus", locale: "en" },
      fetchImpl,
      sleep,
    })

    expect(result).toMatchObject({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it("returns direct typed failures for eval search auth, rejection, transport, 5xx, and parse errors", async () => {
    const url = "https://admin.internal/api/internal/search-eval/search"
    const payload = { query: "Jesus", locale: "en" }

    await expect(
      callAdminEvalSearch({
        url,
        bearer: "eval-key",
        payload,
        fetchImpl: vi.fn(async () => new Response(null, { status: 401 })),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: 401,
    })

    await expect(
      callAdminEvalSearch({
        url,
        bearer: "eval-key",
        payload,
        fetchImpl: vi.fn(async () =>
          Response.json({ error: "bad locale" }, { status: 400 }),
        ),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 400,
      adminReason: "bad locale",
    })

    await expect(
      callAdminEvalSearch({
        url,
        bearer: "eval-key",
        payload,
        fetchImpl: vi.fn(async () => {
          throw new Error("socket reset")
        }),
        maxAttempts: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
    })

    await expect(
      callAdminEvalSearch({
        url,
        bearer: "eval-key",
        payload,
        fetchImpl: vi.fn(async () =>
          Response.json({ error: "unavailable" }, { status: 503 }),
        ),
        maxAttempts: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
      status: 503,
      adminReason: "unavailable",
    })

    await expect(
      callAdminEvalSearch({
        url,
        bearer: "eval-key",
        payload,
        fetchImpl: vi.fn(async () => Response.json({ bad: true })),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "parse_error",
      retryable: true,
      status: 200,
    })
  })

  it("gets generated candidates with bounded filters", async () => {
    const fetchImpl = vi.fn(async () => Response.json(candidateListResponse))

    const result = await callAdminCandidateList({
      url: "https://admin.internal/api/internal/search-eval/candidates",
      bearer: "eval-key",
      filters: {
        sources: ["catalog", "trace"],
        locales: ["en"],
        mastraRunId: "run-1",
        limit: 10,
      },
      fetchImpl,
    })

    expect(result).toEqual({ ok: true, result: candidateListResponse })
    const firstCall = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(firstCall[0])).toBe(
      "https://admin.internal/api/internal/search-eval/candidates?source=catalog%2Ctrace&locale=en&mastraRunId=run-1&limit=10",
    )
  })

  it("accepts trace candidates without raw query text", async () => {
    const response = {
      ...candidateListResponse,
      candidates: [
        {
          ...candidateListResponse.candidates[0],
          id: "candidate-trace",
          source: "trace",
          queryText: null,
          retentionExpiresAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    }

    await expect(
      callAdminCandidateList({
        url: "https://admin.internal/api/internal/search-eval/candidates",
        bearer: "eval-key",
        fetchImpl: vi.fn(async () => Response.json(response)),
      }),
    ).resolves.toEqual({ ok: true, result: response })
  })

  it("calls candidate detail and review action endpoints", async () => {
    const detailResponse = { candidate: candidateListResponse.candidates[0] }
    const fetchImpl = vi.fn(async () => Response.json(detailResponse))

    await expect(
      callAdminCandidateDetail({
        url: "https://admin.internal/api/internal/search-eval/candidates",
        bearer: "eval-key",
        candidateId: "candidate-1",
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true, result: detailResponse })
    const firstCall = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(firstCall[0])).toBe(
      "https://admin.internal/api/internal/search-eval/candidates/candidate-1",
    )
    expect(firstCall[1]).toMatchObject({ method: "GET" })

    await callAdminCandidateReviewPatch({
      url: "https://admin.internal/api/internal/search-eval/candidates",
      bearer: "eval-key",
      candidateId: "candidate-1",
      payload: {
        reviewerIdentity: "nisal",
        sanitizedQueryText: "Who is Jesus?",
        sanitizationStatus: "sanitized",
      },
      fetchImpl,
    })
    await callAdminCandidatePromote({
      url: "https://admin.internal/api/internal/search-eval/candidates",
      bearer: "eval-key",
      candidateId: "candidate-1",
      payload: {
        reviewerIdentity: "nisal",
        sanitizedQueryText: "Who is Jesus?",
        sanitizationStatus: "sanitized",
      },
      fetchImpl,
    })
    await callAdminCandidateReject({
      url: "https://admin.internal/api/internal/search-eval/candidates",
      bearer: "eval-key",
      candidateId: "candidate-1",
      payload: { reviewerIdentity: "nisal" },
      fetchImpl,
    })
    await callAdminCandidateArchive({
      url: "https://admin.internal/api/internal/search-eval/candidates",
      bearer: "eval-key",
      candidateId: "candidate-1",
      payload: { reviewerIdentity: "nisal" },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      new URL(
        "https://admin.internal/api/internal/search-eval/candidates/candidate-1",
      ),
      expect.objectContaining({ method: "PATCH" }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      new URL(
        "https://admin.internal/api/internal/search-eval/candidates/candidate-1/promote",
      ),
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      new URL(
        "https://admin.internal/api/internal/search-eval/candidates/candidate-1/reject",
      ),
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      new URL(
        "https://admin.internal/api/internal/search-eval/candidates/candidate-1/archive",
      ),
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("retries generated candidate reads on rate limits and transient failures", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: "Too many requests" },
          { status: 429, headers: { "retry-after": "60" } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json(candidateListResponse))

    const result = await callAdminCandidateList({
      url: "https://admin.internal/api/internal/search-eval/candidates",
      bearer: "eval-key",
      fetchImpl,
      sleep,
    })

    expect(result).toEqual({ ok: true, result: candidateListResponse })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 60_000)
    expect(sleep).toHaveBeenNthCalledWith(2, 1_000)
  })

  it("returns typed failures for missing config, auth, rejection, rate limits, transport, and parse errors", async () => {
    await expect(callAdminTraceSample({ payload: {} })).resolves.toMatchObject({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })

    await expect(
      callAdminTraceSample({
        url: "https://admin.internal/api/internal/search-traces/sample",
        bearer: "eval-key",
        payload: {},
        fetchImpl: vi.fn(async () => new Response(null, { status: 401 })),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "auth_failed",
      retryable: false,
    })

    await expect(
      callAdminTraceSample({
        url: "https://admin.internal/api/internal/search-traces/sample",
        bearer: "eval-key",
        payload: {},
        fetchImpl: vi.fn(async () =>
          Response.json({ error: "bad input" }, { status: 400 }),
        ),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "rejected",
      retryable: false,
      adminReason: "bad input",
    })

    await expect(
      callAdminTraceSample({
        url: "https://admin.internal/api/internal/search-traces/sample",
        bearer: "eval-key",
        payload: {},
        fetchImpl: vi.fn(async () =>
          Response.json({ error: "Too many requests" }, { status: 429 }),
        ),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "rate_limited",
      retryable: true,
      status: 429,
      adminReason: "Too many requests",
    })

    await expect(
      callAdminTraceSample({
        url: "https://admin.internal/api/internal/search-traces/sample",
        bearer: "eval-key",
        payload: {},
        fetchImpl: vi.fn(async () => {
          throw new Error("network down")
        }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
    })

    await expect(
      callAdminTraceSample({
        url: "https://admin.internal/api/internal/search-traces/sample",
        bearer: "eval-key",
        payload: {},
        fetchImpl: vi.fn(async () => Response.json({ bad: true })),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })

    await expect(
      callAdminEvalSearch({
        url: "https://admin.internal/api/internal/search-eval/search",
        bearer: "eval-key",
        payload: { query: "Jesus", locale: "en" },
        fetchImpl: vi.fn(async () =>
          Response.json({ error: "Too many requests" }, { status: 429 }),
        ),
        maxAttempts: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "rate_limited",
      retryable: true,
      status: 429,
    })
  })

  it("returns typed candidate-list failures", async () => {
    const url = "https://admin.internal/api/internal/search-eval/candidates"

    await expect(callAdminCandidateList({ url })).resolves.toMatchObject({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })

    await expect(
      callAdminCandidateList({
        url,
        bearer: "eval-key",
        fetchImpl: vi.fn(async () => new Response(null, { status: 401 })),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "auth_failed",
      retryable: false,
    })

    await expect(
      callAdminCandidateList({
        url,
        bearer: "eval-key",
        fetchImpl: vi.fn(async () =>
          Response.json({ error: "bad filter" }, { status: 400 }),
        ),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "rejected",
      retryable: false,
      adminReason: "bad filter",
    })

    await expect(
      callAdminCandidateList({
        url,
        bearer: "eval-key",
        fetchImpl: vi.fn(async () =>
          Response.json({ error: "Too many requests" }, { status: 429 }),
        ),
        maxAttempts: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "rate_limited",
      retryable: true,
      status: 429,
    })

    await expect(
      callAdminCandidateList({
        url,
        bearer: "eval-key",
        fetchImpl: vi.fn(async () => {
          throw new Error("network down")
        }),
        maxAttempts: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
    })

    await expect(
      callAdminCandidateList({
        url,
        bearer: "eval-key",
        fetchImpl: vi.fn(async () => Response.json({ bad: true })),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })
})
