import { describe, expect, it, vi } from "vitest"

import {
  handleSubtitleEnrichmentRouteRequest,
  runSubtitleEnrichmentWorkflow,
  subtitleEnrichmentWorkflow,
  _internals,
} from "./subtitle-enrichment"

const input = {
  assetId: "asset-1",
  sourceLanguage: "ru",
  targetLanguages: ["en"],
}

describe("subtitle enrichment workflow", () => {
  it("preserves real source artifact evidence when every target translation fails", async () => {
    const result = await runSubtitleEnrichmentWorkflow(
      {
        assetId: "asset-1",
        sourceLanguage: "en",
        targetLanguages: ["es"],
        source: { kind: "mux", muxAssetId: "mux-1" },
      },
      {
        runId: "source-before-translation",
        apiKey: "test-key",
        sourceDeps: {
          readMuxSource: async () => ({
            language: "en",
            segments: [{ start: 0, end: 2, text: "Hello" }],
          }),
          writeArtifact: async ({ assetId, artifactType, ext }) =>
            `${assetId}/${artifactType}.${ext}`,
        },
        run: async () => [
          { lang: "es", status: "failed", error: "Provider unavailable" },
        ],
      },
    )
    expect(result).toMatchObject({
      ok: false,
      reason: "all_languages_failed",
      source: {
        kind: "mux",
        language: "en",
        segmentCount: 1,
        artifactKeys: {
          transcript: "asset-1/transcript.json",
          subtitles: "asset-1/subtitles.vtt",
        },
      },
    })
  })

  it("never starts translation when approved source content is invalid", async () => {
    const run = vi.fn()
    const result = await runSubtitleEnrichmentWorkflow(
      {
        assetId: "asset-1",
        sourceLanguage: "en",
        targetLanguages: ["es"],
        source: { kind: "transcript_artifact" },
      },
      {
        apiKey: "test-key",
        run,
        deps: {
          readArtifact: async () => new TextEncoder().encode('{"segments":[]}'),
        },
      },
    )
    expect(result).toMatchObject({
      ok: false,
      reason: "source_invalid",
      retryable: false,
    })
    expect(run).not.toHaveBeenCalled()
  })

  it("executes an explicit source-only subtitle request before reporting success", async () => {
    const readArtifact = vi.fn(async () =>
      new TextEncoder().encode(
        JSON.stringify({
          language: "en",
          segments: [{ start: 0, end: 1, text: "Hello" }],
        }),
      ),
    )
    const writeArtifact = vi.fn(
      async ({ artifactType, ext }: { artifactType: string; ext: string }) =>
        `asset-1/${artifactType}.${ext}`,
    )
    const result = await runSubtitleEnrichmentWorkflow(
      {
        assetId: "asset-1",
        sourceLanguage: "en",
        targetLanguages: [],
        source: { kind: "transcript_artifact" },
      },
      {
        runId: "source-only",
        apiKey: "",
        deps: { readArtifact, writeArtifact },
      },
    )
    expect(result).toMatchObject({
      ok: true,
      source: {
        language: "en",
        segmentCount: 1,
        artifactKeys: {
          transcript: "asset-1/transcript.json",
          subtitles: "asset-1/subtitles.vtt",
        },
      },
    })
    expect(writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ artifactType: "subtitles" }),
    )
  })

  it("does not report successful subtitles for an empty stored transcript", async () => {
    const writeArtifact = vi.fn(async () => "unexpected")
    const result = await runSubtitleEnrichmentWorkflow(
      {
        assetId: "asset-1",
        sourceLanguage: "en",
        targetLanguages: ["en"],
      },
      {
        runId: "empty-source",
        apiKey: "",
        deps: {
          readArtifact: async () => new TextEncoder().encode('{"segments":[]}'),
          writeArtifact,
        },
      },
    )
    expect(result.ok).toBe(false)
    expect(writeArtifact).not.toHaveBeenCalled()
  })

  it("rejects invalid input before provider or storage work", async () => {
    const run = vi.fn()

    await expect(
      runSubtitleEnrichmentWorkflow(
        { assetId: "", sourceLanguage: "ru", targetLanguages: ["en"] },
        { runId: "run-invalid", run },
      ),
    ).resolves.toEqual({
      ok: false,
      mastraRunId: "run-invalid",
      reason: "invalid_input",
      retryable: false,
      message: "Subtitle enrichment input failed validation.",
    })
    expect(run).not.toHaveBeenCalled()
  })

  it("requires a provider key only when target languages need translation", async () => {
    const run = vi.fn()

    await expect(
      runSubtitleEnrichmentWorkflow(input, {
        runId: "run-provider-config",
        apiKey: "",
        run,
      }),
    ).resolves.toEqual({
      ok: false,
      mastraRunId: "run-provider-config",
      reason: "provider_config_missing",
      retryable: false,
      message:
        "OPENROUTER_API_PAID_KEY or OPENROUTER_API_KEY is required for subtitle enrichment.",
    })
    expect(run).not.toHaveBeenCalled()

    run.mockResolvedValue([
      {
        lang: "en",
        status: "completed",
        artifactKeys: {
          vtt: "asset-1/subtitles-en.vtt",
          json: "asset-1/translation-en.json",
        },
      },
    ])

    await expect(
      runSubtitleEnrichmentWorkflow(
        {
          assetId: "asset-1",
          sourceLanguage: "en",
          targetLanguages: ["en"],
        },
        { runId: "run-no-op", apiKey: "", run },
      ),
    ).resolves.toMatchObject({
      ok: true,
      mastraRunId: "run-no-op",
      succeeded: 1,
      failed: 0,
    })
  })

  it("maps all-language execution failures to a typed workflow failure", async () => {
    await expect(
      runSubtitleEnrichmentWorkflow(input, {
        runId: "run-all-failed",
        apiKey: "openrouter-key",
        run: async () => [
          { lang: "en", status: "failed", error: "llm offline" },
        ],
      }),
    ).resolves.toEqual({
      ok: false,
      mastraRunId: "run-all-failed",
      reason: "all_languages_failed",
      retryable: true,
      message: "Subtitle enrichment failed for all target languages.",
      languages: [{ lang: "en", status: "failed", error: "llm offline" }],
    })
  })

  it("passes optional translation context into subtitle enrichment execution", async () => {
    const run = vi.fn(async () => [
      {
        lang: "en",
        status: "completed" as const,
        artifactKeys: {
          vtt: "asset-1/subtitles-en.vtt",
          json: "asset-1/translation-en.json",
        },
      },
    ])

    await expect(
      runSubtitleEnrichmentWorkflow(
        {
          ...input,
          translationContext: {
            videoTitle: "Birth of Jesus",
            videoLabel: "JESUS_FILM",
            bibleReferences: ["Luke 2"],
          },
        },
        { runId: "run-context", apiKey: "openrouter-key", run },
      ),
    ).resolves.toMatchObject({
      ok: true,
      mastraRunId: "run-context",
    })

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        translationContext: {
          videoTitle: "Birth of Jesus",
          videoLabel: "JESUS_FILM",
          bibleReferences: ["Luke 2"],
        },
      }),
      undefined,
    )
  })

  it("keeps route auth scoped and returns typed results", async () => {
    const readJson = vi.fn(async () => input)

    const unauthorized = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["secret"],
      readJson,
    })

    expect(unauthorized).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
    expect(readJson).not.toHaveBeenCalled()

    const authorized = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson,
      launch: async () => ({
        ok: true,
        mastraRunId: "run-route",
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
      }),
    })

    expect(authorized.status).toBe(200)
    expect(authorized.body.result).toMatchObject({
      ok: true,
      mastraRunId: "run-route",
      succeeded: 1,
      failed: 0,
    })
  })

  it("returns a 400 result for malformed route JSON", async () => {
    const result = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () => {
        throw new Error("bad json")
      },
    })

    expect(result.status).toBe(400)
    expect(result.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      message: "Subtitle enrichment request body must be JSON.",
    })
  })

  it("parses workflow failure payloads defensively", () => {
    const parsed = _internals.workflowFailureFromUnknown(
      new Error(
        `${_internals.WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify({
          ok: false,
          mastraRunId: "run-1",
          reason: "storage_failed",
          retryable: true,
        })}`,
      ),
    )

    expect(parsed).toEqual({
      ok: false,
      mastraRunId: "run-1",
      reason: "storage_failed",
      retryable: true,
    })
    expect(
      _internals.workflowFailureFromUnknown(
        new Error(`${_internals.WORKFLOW_FAILURE_ERROR_PREFIX}{not json`),
      ),
    ).toBeNull()
  })

  it("registers the committed Mastra workflow", () => {
    expect(subtitleEnrichmentWorkflow.id).toBe("subtitle-enrichment")
    expect(subtitleEnrichmentWorkflow.committed).toBe(true)
  })
})
