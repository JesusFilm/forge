import { describe, expect, it, vi } from "vitest"

import { launchMastraTranscriptScriptureCorrection } from "@/services/mastra-transcript-scripture-correction"

const successResult = {
  ok: true,
  mastraRunId: "transcript-correction-run-1",
  correction: {
    status: "reviewed",
    basis: "model_knowledge",
    contentDomain: "bible_story",
    confidence: 0.96,
    checkedReferenceCount: 1,
    candidateCount: 1,
    flaggedCount: 0,
    likelyBibleReferences: ["Luke 18:38"],
    findings: [
      {
        action: "apply_candidate",
        category: "proper_name",
        segmentIndex: 0,
        start: 56,
        end: 60,
        originalText: "Son, the demon",
        correctedText: "Son of David",
        reference: "Luke 18:38",
        confidence: 0.97,
        basis: "model_knowledge",
        rationale: "Blind man healing stories use this title for Jesus.",
      },
    ],
  },
}

describe("launchMastraTranscriptScriptureCorrection", () => {
  it("returns config_missing when service configuration is absent", async () => {
    await expect(
      launchMastraTranscriptScriptureCorrection({
        assetId: "asset-1",
        sourceLanguage: "en",
        segments: [{ start: 56, end: 60, text: "Son, the demon!" }],
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("posts source segments and context to Mastra", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: successResult }),
    )

    await expect(
      launchMastraTranscriptScriptureCorrection(
        {
          assetId: "asset-1",
          sourceLanguage: "en",
          segments: [{ start: 56, end: 60, text: "Son, the demon!" }],
          translationContext: {
            videoTitle: "Blind Man",
            bibleReferences: ["Luke 18:38"],
          },
          provider: { name: "mux" },
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
      new URL("https://mastra.internal/forge-transcript-scripture-correction"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    )
    expect(body).toEqual({
      assetId: "asset-1",
      sourceLanguage: "en",
      segments: [{ start: 56, end: 60, text: "Son, the demon!" }],
      translationContext: {
        videoTitle: "Blind Man",
        bibleReferences: ["Luke 18:38"],
      },
      provider: { name: "mux" },
    })
  })

  it("returns product failures and auth failures safely", async () => {
    const productFailure = {
      ok: false,
      reason: "workflow_failed",
      retryable: true,
      mastraRunId: "transcript-correction-run-2",
      message: "Workflow failed.",
    }
    const rejected = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: productFailure }, { status: 502 }),
    )

    await expect(
      launchMastraTranscriptScriptureCorrection(
        {
          assetId: "asset-1",
          sourceLanguage: "en",
          segments: [{ start: 56, end: 60, text: "Son, the demon!" }],
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
      launchMastraTranscriptScriptureCorrection(
        {
          assetId: "asset-1",
          sourceLanguage: "en",
          segments: [{ start: 56, end: 60, text: "Son, the demon!" }],
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

  it("treats unknown workflow values as parse errors", async () => {
    const malformed = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          result: {
            ...successResult,
            correction: { ...successResult.correction, status: "surprise" },
          },
        }),
    )

    await expect(
      launchMastraTranscriptScriptureCorrection(
        {
          assetId: "asset-1",
          sourceLanguage: "en",
          segments: [{ start: 56, end: 60, text: "Son, the demon!" }],
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          fetchImpl: malformed,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })
})
