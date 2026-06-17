import { describe, expect, it, vi } from "vitest"

import { launchMastraSubtitleEnrichment } from "@/services/mastra-subtitle-enrichment"

const successResult = {
  ok: true,
  mastraRunId: "subtitle-run-1",
  languages: [
    {
      lang: "en",
      status: "completed",
      artifactKeys: {
        vtt: "asset-1/subtitles-en.vtt",
        json: "asset-1/translation-en.json",
      },
    },
  ],
  succeeded: 1,
  failed: 0,
}

describe("launchMastraSubtitleEnrichment", () => {
  it("returns config_missing when service configuration is absent", async () => {
    await expect(
      launchMastraSubtitleEnrichment({
        assetId: "asset-1",
        sourceLanguage: "ru",
        targetLanguages: ["en"],
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("posts artifact identity and target languages to Mastra", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: successResult }),
    )

    await expect(
      launchMastraSubtitleEnrichment(
        {
          assetId: "asset-1",
          sourceLanguage: "ru",
          targetLanguages: ["en", "fr"],
          translationContext: {
            videoTitle: "Jesus Film",
            videoLabel: "JESUS_FILM",
            bibleReferences: ["Luke 2"],
          },
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          fetchImpl,
        },
      ),
    ).resolves.toEqual(successResult)

    const body = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://mastra.internal/forge-subtitle-enrichment"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    )
    expect(body).toEqual({
      assetId: "asset-1",
      sourceLanguage: "ru",
      targetLanguages: ["en", "fr"],
      translationContext: {
        videoTitle: "Jesus Film",
        videoLabel: "JESUS_FILM",
        bibleReferences: ["Luke 2"],
      },
    })
    expect(JSON.stringify(body)).not.toContain("segments")
    expect(JSON.stringify(body)).not.toContain("transcript")
  })

  it("returns Mastra product failures and auth failures safely", async () => {
    const productFailure = {
      ok: false,
      reason: "all_languages_failed",
      retryable: true,
      mastraRunId: "subtitle-run-2",
      message: "Subtitle enrichment failed for all target languages.",
      languages: [{ lang: "en", status: "failed", error: "llm offline" }],
    }
    const rejected = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: productFailure }, { status: 502 }),
    )

    await expect(
      launchMastraSubtitleEnrichment(
        {
          assetId: "asset-1",
          sourceLanguage: "ru",
          targetLanguages: ["en"],
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          fetchImpl: rejected,
        },
      ),
    ).resolves.toEqual(productFailure)

    const authFailure = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("no", { status: 401 }),
    )
    await expect(
      launchMastraSubtitleEnrichment(
        {
          assetId: "asset-1",
          sourceLanguage: "ru",
          targetLanguages: ["en"],
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "bad",
          fetchImpl: authFailure,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
    })
  })

  it("parses optional subtitle validation artifacts and summaries", async () => {
    const withValidation = {
      ...successResult,
      languages: [
        {
          lang: "es",
          status: "completed",
          artifactKeys: {
            vtt: "asset-1/subtitles-es.vtt",
            json: "asset-1/translation-es.json",
            validation: "asset-1/subtitle-validation-es.json",
          },
          validationSummary: {
            verdict: "needs_review",
            basis: "model_knowledge",
            confidence: 0.72,
            checkedReferenceCount: 1,
            warningCount: 0,
            needsReviewCount: 1,
            fallbackReason: "provider_config_missing",
          },
        },
      ],
    }
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: withValidation }),
    )

    await expect(
      launchMastraSubtitleEnrichment(
        {
          assetId: "asset-1",
          sourceLanguage: "en",
          targetLanguages: ["es"],
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          fetchImpl,
        },
      ),
    ).resolves.toEqual(withValidation)
  })

  it("treats unknown workflow enum values as parse errors", async () => {
    const malformedStatus = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          result: {
            ...successResult,
            languages: [{ lang: "en", status: "surprising-status" }],
          },
        }),
    )

    await expect(
      launchMastraSubtitleEnrichment(
        {
          assetId: "asset-1",
          sourceLanguage: "ru",
          targetLanguages: ["en"],
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          fetchImpl: malformedStatus,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })

    const malformedReason = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          result: {
            ok: false,
            reason: "surprising-reason",
            retryable: false,
          },
        }),
    )

    await expect(
      launchMastraSubtitleEnrichment(
        {
          assetId: "asset-1",
          sourceLanguage: "ru",
          targetLanguages: ["en"],
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          fetchImpl: malformedReason,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })
})
