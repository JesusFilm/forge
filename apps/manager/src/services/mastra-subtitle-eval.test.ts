import { describe, expect, it, vi } from "vitest"

import {
  launchMastraSubtitleEvalCell,
  mastraSubtitleEvalResultSchema,
  readBoundedJson,
} from "./mastra-subtitle-eval"

const request = {
  schemaVersion: "subtitle-translation-eval-cell-request/v1" as const,
  cellId: "cell-1",
  caseId: "case-1",
  manifestDigest: "a".repeat(64),
  lockDigest: "b".repeat(64),
  targetLanguage: "es",
  provider: "openrouter" as const,
  model: "google/gemini-2.5-flash",
  promptPolicyId: "subtitle-enrichment-production-v1",
  workflowPolicyDigest: "c".repeat(64),
  codeRevision: "revision-1",
  executionAttempt: 1,
  timeoutMs: 60_000,
  concurrency: 1 as const,
  source: snapshot("source" as const, "en", "source-id", "d"),
  reference: snapshot("reference" as const, "es", "reference-id", "e"),
}

describe("Mastra subtitle evaluation client", () => {
  it("never sends Admin language identity to Mastra", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(JSON.stringify(body)).not.toContain("admin-language")
      return new Response(
        JSON.stringify({
          result: {
            ok: false,
            cellId: "cell-1",
            reason: "provider_failed",
            failureClass: "retryable",
            retryable: true,
            message: "Provider temporarily unavailable.",
            providerCalls: [],
          },
        }),
        { status: 502 },
      )
    }) as typeof fetch
    await expect(
      launchMastraSubtitleEvalCell(request, {
        baseUrl: "https://mastra.example",
        bearer: "service-secret",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "provider_failed" })
  })

  it("classifies transport and invalid provider envelopes safely", async () => {
    await expect(
      launchMastraSubtitleEvalCell(request, {
        baseUrl: "https://mastra.example",
        bearer: "service-secret",
        fetchImpl: vi.fn(async () => {
          throw new Error("offline")
        }) as typeof fetch,
      }),
    ).resolves.toMatchObject({ reason: "execution_failed", retryable: true })
    await expect(
      launchMastraSubtitleEvalCell(request, {
        baseUrl: "https://mastra.example",
        bearer: "service-secret",
        fetchImpl: vi.fn(async () => new Response("{}")) as typeof fetch,
      }),
    ).resolves.toMatchObject({ reason: "execution_failed", retryable: true })
  })

  it("classifies Mastra service authentication failures as permanent", async () => {
    await expect(
      launchMastraSubtitleEvalCell(request, {
        baseUrl: "https://mastra.example",
        bearer: "service-secret",
        fetchImpl: vi.fn(
          async () => new Response(null, { status: 401 }),
        ) as typeof fetch,
      }),
    ).resolves.toMatchObject({
      ok: false,
      cellId: "cell-1",
      reason: "provider_auth_failed",
      failureClass: "permanent",
      retryable: false,
    })
  })

  it("rejects a provider envelope that omits the required call ledger", async () => {
    const success = completeSuccess()
    const { providerCalls: _providerCalls, ...withoutProviderCalls } = success
    void _providerCalls
    await expect(
      launchMastraSubtitleEvalCell(request, {
        baseUrl: "https://mastra.example",
        bearer: "service-secret",
        fetchImpl: vi.fn(async () =>
          Response.json({ result: withoutProviderCalls }, { status: 200 }),
        ) as typeof fetch,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "execution_failed" })
  })

  it("rejects a failure ledger attributed to another cell", async () => {
    const providerCalls = [
      {
        callSequence: 1,
        operation: "TRANSLATION",
        chunkIndex: 0,
        operationAttempt: 0,
        status: "FAILED",
        requestDigest: "d".repeat(64),
        providerRequestId: "request-1",
        providerResponseId: null,
        requestedModel: "google/gemini-2.5-flash",
        resolvedModel: null,
        usage: null,
      },
    ]
    await expect(
      launchMastraSubtitleEvalCell(request, {
        baseUrl: "https://mastra.example",
        bearer: "service-secret",
        fetchImpl: vi.fn(async () =>
          Response.json(
            {
              result: {
                ok: false,
                cellId: "another-cell",
                reason: "provider_failed",
                failureClass: "retryable",
                retryable: true,
                message: "Provider temporarily unavailable.",
                providerCalls,
              },
            },
            { status: 502 },
          ),
        ) as typeof fetch,
      }),
    ).resolves.toEqual({
      ok: false,
      cellId: "cell-1",
      reason: "execution_failed",
      failureClass: "retryable",
      retryable: true,
      message: "Subtitle evaluation execution is unavailable.",
      providerCalls: [],
    })
  })

  it("rejects a 65th provider call in both success and failure envelopes", () => {
    const providerCalls = Array.from({ length: 65 }, (_, index) => ({
      callSequence: index + 1,
      operation: "TRANSLATION",
      chunkIndex: index,
      operationAttempt: 0,
      status: "SUCCEEDED",
      requestDigest: "d".repeat(64),
      providerRequestId: null,
      providerResponseId: `generation-${index + 1}`,
      requestedModel: "google/gemini-2.5-flash",
      resolvedModel: "google/gemini-2.5-flash",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }))
    expect(
      mastraSubtitleEvalResultSchema.safeParse({
        ...completeSuccess(),
        providerCalls,
      }).success,
    ).toBe(false)
    expect(
      mastraSubtitleEvalResultSchema.safeParse({
        ok: false,
        cellId: "cell-1",
        reason: "provider_failed",
        failureClass: "retryable",
        retryable: true,
        message: "Provider temporarily unavailable.",
        providerCalls,
      }).success,
    ).toBe(false)
  })

  it("bounds response streaming at the exact ceiling", async () => {
    await expect(readBoundedJson(new Response("{}"), 2)).resolves.toEqual({})
    await expect(readBoundedJson(new Response("{}\n"), 2)).rejects.toThrow(
      /byte ceiling/i,
    )
    await expect(
      readBoundedJson(
        new Response("{}", { headers: { "content-length": "3" } }),
        2,
      ),
    ).rejects.toThrow(/byte ceiling/i)
  })

  it("does not accept a success envelope from a non-success status", async () => {
    const success = completeSuccess()
    await expect(
      launchMastraSubtitleEvalCell(request, {
        baseUrl: "https://mastra.example",
        bearer: "service-secret",
        fetchImpl: vi.fn(
          async () =>
            new Response(JSON.stringify({ result: success }), { status: 502 }),
        ) as typeof fetch,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "execution_failed",
      retryable: false,
    })
  })
})

function snapshot(
  role: "source" | "reference",
  language: string,
  subtitleId: string,
  digestChar: string,
) {
  return {
    body: "WEBVTT\n",
    sha256: digestChar.repeat(64),
    rawSha256: digestChar.repeat(64),
    clippedSha256: digestChar.repeat(64),
    byteLength: 7,
    mediaType: "text/vtt" as const,
    track: {
      role,
      language,
      coreLanguageId: language,
      subtitleId,
      videoId: "video-1",
      edition: "base",
      coreVideoEditionId: "edition-1",
      cueCount: 1,
    },
  }
}

function completeSuccess() {
  const operation = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    providerResponseCount: 0,
    unaccountedResponseCount: 0,
    accounting: "not_invoked",
  }
  return {
    ok: true,
    schemaVersion: "subtitle-translation-eval-cell-result/v1",
    identityAttestation: {
      cellId: "cell-1",
      caseId: "case-1",
      manifestDigest: "a".repeat(64),
      lockDigest: "b".repeat(64),
      targetLanguage: "es",
      sourceSha256: "d".repeat(64),
      referenceSha256: "e".repeat(64),
      sourceSubtitleId: "source-id",
      referenceSubtitleId: "reference-id",
    },
    provider: {
      name: "openrouter",
      requestedModel: "google/gemini-2.5-flash",
      resolvedModel: null,
    },
    providerCalls: [],
    policy: {
      promptPolicyId: "subtitle-enrichment-production-v1",
      workflowPolicyDigest: "c".repeat(64),
      workflowPolicyFiles: ["file.ts"],
    },
    build: { codeRevision: "revision", buildId: "build" },
    determinism: { temperature: 0, providerSeed: null, concurrency: 1 },
    runtime: { timeoutMs: 60_000, concurrency: 1 },
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      retimeFallbackCount: 0,
      operations: {
        scriptureDetection: operation,
        translation: operation,
        retiming: operation,
        scriptureValidation: operation,
      },
      coverage: { status: "complete", missingOperations: [] },
    },
    metrics: {
      structural: {
        passed: true,
        failures: [],
        warnings: [],
        sourceSpeechCoverage: 1,
      },
      text: {
        characterNgramFScore: 1,
        windowedCharacterNgramFScore: 1,
        generatedCharacterCount: 1,
        referenceCharacterCount: 1,
        lengthRatio: 1,
      },
      timing: {
        referenceOverlapPrecision: 1,
        referenceOverlapRecall: 1,
        boundaryMeanAbsoluteErrorSeconds: 0,
      },
      readability: {
        cueCount: 1,
        charactersPerSecondP50: 1,
        charactersPerSecondP95: 1,
        charactersPerSecondMax: 1,
        maximumLineLength: 1,
      },
    },
    reviewEvidence: {
      schemaVersion: "subtitle-translation-review-evidence/v1",
      alignment: "connected-time-overlap/v1",
      diff: "intl-word-grapheme-safe/v1",
      locale: "es",
      segments: [],
    },
    artifacts: {
      candidateVtt: {
        sha256: "f".repeat(64),
        byteLength: 7,
        mediaType: "text/vtt",
        body: "WEBVTT\n",
      },
      reviewEvidence: {
        sha256: "1".repeat(64),
        byteLength: 2,
        mediaType: "application/json",
        body: "{}",
      },
    },
    reproducibilityLimits: [],
  }
}
