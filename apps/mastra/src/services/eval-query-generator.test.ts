import { describe, expect, it, vi } from "vitest"

import {
  EvalQueryGeneratorError,
  buildEvalQueryCandidates,
  createEvalQueryGenerator,
} from "./eval-query-generator"
import type {
  AdminCatalogAnchor,
  AdminTraceSample,
} from "./admin-search-eval-client"

const catalogAnchor: AdminCatalogAnchor = {
  source: "video",
  id: "video-locale-1",
  locale: "en",
  title: "JESUS",
  slug: "jesus",
  label: "FEATURE_FILM",
  snippet: "The story of Jesus.",
  description: null,
  keywords: ["Gospel"],
  expectedResultHints: [
    {
      type: "video",
      id: "video-1",
      slug: "jesus",
      title: "JESUS",
    },
  ],
}

const traceSample: AdminTraceSample = {
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
}

describe("buildEvalQueryCandidates", () => {
  it("builds catalog, trace, and locale-quality candidates with separate provenance", async () => {
    const generator = {
      model: "test-model",
      generateLocaleQualityCandidates: vi.fn(async () => [
        {
          source: "locale_quality" as const,
          locale: "fr",
          queryText: "espoir en Jesus",
          sourceAnchors: [{ type: "locale", locale: "fr" }],
          labelProvenance: {
            source: "locale_quality_generation",
            localeTier: 1,
          },
          generationModel: "test-model",
          generationProvider: "openrouter",
          judgeSummary: {
            source: "generation_model",
            score: 0.8,
            rationale: "plausible",
          },
        },
      ]),
    }

    const candidates = await buildEvalQueryCandidates({
      catalogAnchors: [catalogAnchor],
      traceSamples: [traceSample],
      localeProfiles: [{ locale: "fr", tier: 1, source: "harness" }],
      mastraRunId: "run-1",
      generatedAt: "2026-05-26T00:00:00.000Z",
      generator,
      localeQueryCount: 1,
    })

    expect(candidates).toEqual([
      expect.objectContaining({
        source: "catalog",
        locale: "en",
        queryText: "JESUS Gospel",
        expectedResultHints: catalogAnchor.expectedResultHints,
        generationModel: "mastra-catalog-anchor:v1",
        judgeSummary: expect.objectContaining({
          source: "source_anchor_heuristic",
        }),
        mastraRunId: "run-1",
      }),
      expect.objectContaining({
        source: "trace",
        locale: "en",
        queryText: "jesus movie",
        retentionExpiresAt: "2026-06-20T00:00:00.000Z",
        labelProvenance: expect.objectContaining({
          queryQualityLabel: "valid_viewer_intent",
          abuseLabel: "none",
        }),
        judgeSummary: expect.objectContaining({
          source: "admin_trace_labels",
        }),
      }),
      expect.objectContaining({
        source: "locale_quality",
        locale: "fr",
        queryText: "espoir en Jesus",
        generationModel: "test-model",
        judgeSummary: expect.objectContaining({
          source: "generation_model",
        }),
        mastraRunId: "run-1",
      }),
    ])
    expect(generator.generateLocaleQualityCandidates).toHaveBeenCalledWith(
      [{ locale: "fr", tier: 1, source: "harness" }],
      1,
    )
  })

  it("can build only trace candidates without an LLM generator", async () => {
    const candidates = await buildEvalQueryCandidates({
      catalogAnchors: [catalogAnchor],
      traceSamples: [traceSample],
      localeProfiles: [{ locale: "fr", tier: 1, source: "harness" }],
      mastraRunId: "run-1",
      generatedAt: "2026-05-26T00:00:00.000Z",
      includeSources: new Set(["trace"]),
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.source).toBe("trace")
  })

  it("requires a generator when locale-quality source is requested", async () => {
    await expect(
      buildEvalQueryCandidates({
        catalogAnchors: [],
        traceSamples: [],
        localeProfiles: [{ locale: "fr", tier: 1, source: "harness" }],
        mastraRunId: "run-1",
        generatedAt: "2026-05-26T00:00:00.000Z",
        includeSources: new Set(["locale_quality"]),
      }),
    ).rejects.toMatchObject({
      name: "EvalQueryGeneratorError",
      code: "missing_credentials",
    })
  })
})

describe("createEvalQueryGenerator", () => {
  it("calls OpenRouter and maps locale-quality candidates", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                candidates: [
                  {
                    locale: "fr",
                    query: "espoir dans la souffrance",
                    score: 0.85,
                    rationale: "clear viewer need",
                  },
                ],
              }),
            },
          },
        ],
      }),
    )
    const generator = createEvalQueryGenerator({
      apiKey: "openrouter-key",
      model: "test-model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const candidates = await generator.generateLocaleQualityCandidates(
      [{ locale: "fr", tier: 1, source: "harness" }],
      1,
    )

    expect(candidates).toEqual([
      expect.objectContaining({
        source: "locale_quality",
        locale: "fr",
        queryText: "espoir dans la souffrance",
        generationModel: "test-model",
        generationProvider: "openrouter",
        judgeSummary: {
          source: "generation_model",
          score: 0.85,
          rationale: "clear viewer need",
        },
      }),
    ])
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer openrouter-key",
        }),
      }),
    )
  })

  it("requires an API key and rejects malformed model output", async () => {
    expect(() => createEvalQueryGenerator({ apiKey: undefined })).toThrow(
      EvalQueryGeneratorError,
    )

    const generator = createEvalQueryGenerator({
      apiKey: "openrouter-key",
      fetchImpl: vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ bad: true }) } }],
        }),
      ) as unknown as typeof fetch,
    })

    await expect(
      generator.generateLocaleQualityCandidates([
        { locale: "fr", tier: 1, source: "harness" },
      ]),
    ).rejects.toMatchObject({ code: "validation" })
  })
})
