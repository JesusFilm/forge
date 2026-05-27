import { describe, expect, it, vi } from "vitest"

import {
  handleEvalQueryGenerationRouteRequest,
  runEvalQueryGenerationWorkflow,
} from "./eval-query-generation"

function traceResponse(locale = "en") {
  return {
    traces: [
      {
        id: `trace-${locale}`,
        queryText: "jesus movie",
        locale,
        routeSource: "rest" as const,
        requestedMode: "hybrid",
        searchMode: "hybrid",
        resultCount: 3,
        latencyBucket: "lt_250ms",
        outcome: "success" as const,
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
}

function catalogResponse() {
  return {
    localeProfiles: [
      { locale: "fr", tier: 1 as const, source: "harness" as const },
    ],
    anchors: [
      {
        source: "video" as const,
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
            type: "video" as const,
            id: "video-1",
            slug: "jesus",
            title: "JESUS",
          },
        ],
      },
    ],
    generatedAt: "2026-05-26T00:00:00.000Z",
  }
}

describe("runEvalQueryGenerationWorkflow", () => {
  it("reads Admin context, generates all three source families, and stores candidates", async () => {
    const traceSampleClient = vi.fn(async (input) => ({
      ok: true as const,
      result: traceResponse(
        (input.payload as { locale?: string }).locale ?? "en",
      ),
    }))
    const catalogContextClient = vi.fn(async () => ({
      ok: true as const,
      result: catalogResponse(),
    }))
    const candidateStoreClient = vi.fn(async (_input) => ({
      ok: true as const,
      result: {
        storedCount: 4,
        skippedCount: 0,
        candidates: [],
        skipped: [],
      },
    }))
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

    await expect(
      runEvalQueryGenerationWorkflow(
        {
          locales: ["en", "fr"],
          traceLimit: 5,
          catalogLimit: 5,
          localeQueryCount: 1,
        },
        {
          runId: "run-1",
          generatedAt: "2026-05-26T00:00:00.000Z",
          adminBearer: "eval-key",
          traceSampleUrl:
            "https://admin.internal/api/internal/search-traces/sample",
          catalogContextUrl:
            "https://admin.internal/api/internal/search-eval/catalog-context",
          candidateStoreUrl:
            "https://admin.internal/api/internal/search-eval/candidates",
          traceSampleClient,
          catalogContextClient,
          candidateStoreClient,
          generator,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      mastraRunId: "run-1",
      storedCount: 4,
      skippedCount: 0,
      generatedCount: 4,
      sourceCounts: { catalog: 1, locale_quality: 1, trace: 2 },
    })

    expect(traceSampleClient).toHaveBeenCalledTimes(2)
    expect(traceSampleClient).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { limit: 5, locale: "en" },
      }),
    )
    expect(catalogContextClient).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { limit: 5, locales: ["en", "fr"] },
      }),
    )
    const storedPayload = candidateStoreClient.mock.calls[0]?.[0]?.payload
    expect(storedPayload.candidates).toHaveLength(4)
    expect(storedPayload.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "catalog",
          expectedResultHints: [
            {
              type: "video",
              id: "video-1",
              slug: "jesus",
              title: "JESUS",
            },
          ],
        }),
        expect.objectContaining({
          source: "trace",
          retentionExpiresAt: "2026-06-20T00:00:00.000Z",
          labelProvenance: expect.objectContaining({
            queryQualityLabel: "valid_viewer_intent",
            abuseLabel: "none",
          }),
        }),
        expect.objectContaining({
          source: "locale_quality",
          generationModel: "test-model",
        }),
      ]),
    )
  })

  it("supports trace-only generation without an LLM generator", async () => {
    const result = await runEvalQueryGenerationWorkflow(
      { sources: ["trace"] },
      {
        runId: "run-1",
        adminBearer: "eval-key",
        traceSampleClient: vi.fn(async () => ({
          ok: true as const,
          result: traceResponse(),
        })),
        candidateStoreClient: vi.fn(async () => ({
          ok: true as const,
          result: {
            storedCount: 1,
            skippedCount: 0,
            candidates: [],
            skipped: [],
          },
        })),
      },
    )

    expect(result).toMatchObject({
      ok: true,
      generatedCount: 1,
      sourceCounts: { catalog: 0, locale_quality: 0, trace: 1 },
    })
  })

  it("chunks candidate storage at Admin's batch contract limit", async () => {
    const generatedCandidates = Array.from({ length: 101 }, (_, index) => ({
      source: "locale_quality" as const,
      locale: "fr",
      queryText: `espoir ${index}`,
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
    }))
    const candidateStoreClient = vi.fn(async (input) => ({
      ok: true as const,
      result: {
        storedCount: input.payload.candidates.length,
        skippedCount: 0,
        candidates: [],
        skipped: [],
      },
    }))

    await expect(
      runEvalQueryGenerationWorkflow(
        { sources: ["locale_quality"] },
        {
          runId: "run-1",
          adminBearer: "eval-key",
          catalogContextClient: vi.fn(async () => ({
            ok: true as const,
            result: { ...catalogResponse(), anchors: [] },
          })),
          candidateStoreClient,
          generator: {
            model: "test-model",
            generateLocaleQualityCandidates: vi.fn(
              async () => generatedCandidates,
            ),
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      storedCount: 101,
      generatedCount: 101,
      sourceCounts: { catalog: 0, locale_quality: 101, trace: 0 },
    })

    expect(candidateStoreClient).toHaveBeenCalledTimes(2)
    expect(
      candidateStoreClient.mock.calls[0]?.[0].payload.candidates,
    ).toHaveLength(100)
    expect(
      candidateStoreClient.mock.calls[1]?.[0].payload.candidates,
    ).toHaveLength(1)
  })

  it("returns typed failures for invalid input, Admin config, and generation config", async () => {
    await expect(
      runEvalQueryGenerationWorkflow({ sources: [] }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "invalid_input",
    })

    await expect(
      runEvalQueryGenerationWorkflow(
        { sources: ["trace"] },
        {
          traceSampleClient: vi.fn(async () => ({
            ok: false as const,
            reason: "config_missing" as const,
            retryable: false,
          })),
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "admin_config_missing",
    })

    await expect(
      runEvalQueryGenerationWorkflow(
        { sources: ["locale_quality"] },
        {
          catalogContextClient: vi.fn(async () => ({
            ok: true as const,
            result: catalogResponse(),
          })),
          generatorFactory: () => {
            throw new Error("missing key")
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "generation_failed",
    })
  })
})

describe("handleEvalQueryGenerationRouteRequest", () => {
  it("requires service bearer before launching", async () => {
    const launch = vi.fn()
    const response = await handleEvalQueryGenerationRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["service-key"],
      readJson: async () => ({}),
      launch,
    })

    expect(response).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it("launches with parsed JSON for a valid service bearer", async () => {
    const launch = vi.fn(async () => ({
      ok: true as const,
      mastraRunId: "run-1",
      storedCount: 0,
      skippedCount: 0,
      generatedCount: 0,
      sourceCounts: { catalog: 0, locale_quality: 0, trace: 0 },
    }))

    const response = await handleEvalQueryGenerationRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ sources: ["trace"] }),
      launch,
    })

    expect(response.status).toBe(200)
    expect(response.body.result).toMatchObject({ ok: true })
    expect(launch).toHaveBeenCalledWith(
      { sources: ["trace"] },
      { runId: expect.any(String) },
    )
  })

  it("returns invalid_input when JSON parsing fails", async () => {
    const response = await handleEvalQueryGenerationRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => {
        throw new Error("bad json")
      },
    })

    expect(response.status).toBe(400)
    expect(response.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
    })
  })
})

describe("Mastra eval query generation import boundary", () => {
  it("does not import Admin, Manager, or Auth app code", async () => {
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const files = [
      new URL("./eval-query-generation.ts", import.meta.url),
      new URL("../../services/admin-search-eval-client.ts", import.meta.url),
      new URL("../../services/eval-query-generator.ts", import.meta.url),
    ]
    const source = (
      await Promise.all(
        files.map((file) => readFile(fileURLToPath(file), "utf8")),
      )
    ).join("\n")

    expect(source).not.toMatch(/from ["'](?:apps\/)?(?:admin|manager|auth)\b/)
    expect(source).not.toMatch(/from ["']@forge\/(?:admin|manager|auth)\b/)
  })
})
