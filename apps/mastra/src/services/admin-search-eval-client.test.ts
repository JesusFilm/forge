import { describe, expect, it, vi } from "vitest"

import {
  callAdminCandidateStore,
  callAdminCatalogContext,
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

  it("returns typed failures for missing config, auth, rejection, transport, and parse errors", async () => {
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
  })
})
