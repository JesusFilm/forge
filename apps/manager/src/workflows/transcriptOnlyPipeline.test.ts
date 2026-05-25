import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  transcribeMock,
  transcribeSubtitleUrlMock,
  launchMastraTranscriptEmbeddingsMock,
} = vi.hoisted(() => ({
  transcribeMock: vi.fn(),
  transcribeSubtitleUrlMock: vi.fn(),
  launchMastraTranscriptEmbeddingsMock: vi.fn(),
}))

vi.mock("@/services/transcription", () => ({
  transcribe: transcribeMock,
  transcribeSubtitleUrl: transcribeSubtitleUrlMock,
}))

vi.mock("@/services/mastra-transcript-embeddings", () => ({
  launchMastraTranscriptEmbeddings: launchMastraTranscriptEmbeddingsMock,
}))

const { runTranscriptOnlyPipeline } =
  await import("@/workflows/transcriptOnlyPipeline")

beforeEach(() => {
  transcribeMock.mockReset()
  transcribeSubtitleUrlMock.mockReset()
  launchMastraTranscriptEmbeddingsMock.mockReset()
})

function transcriptionFixture(overrides?: {
  text?: string
  language?: string
}) {
  return {
    text: overrides?.text ?? "this is a long enough transcript text fixture",
    segments: [{ start: 0, end: 1, text: "hello" }],
    language: overrides?.language ?? "en",
    artifactKeys: ["transcript", "subtitles"],
    resolvedProvider: "mux" as const,
    routingReport: { attempts: [], requestedProvider: "auto" as const },
  }
}

function mastraResultFixture() {
  return {
    ok: true,
    status: "created",
    chunks: 1,
    totalTokens: 1,
    model: "openai/text-embedding-3-small",
    provider: "openai",
    dimensions: 1536,
    mastraRunId: "run-1",
    sourceContentHash: "sha256:test",
    chunking: {
      type: "segment-aware" as const,
      maxChunkTokens: 500,
      overlapTokens: 100,
      version: "manager-transcript-v1",
    },
  }
}

describe("runTranscriptOnlyPipeline", () => {
  it("composes transcribe → Mastra transcript embeddings and forwards source fields", async () => {
    transcribeMock.mockResolvedValueOnce(transcriptionFixture())
    launchMastraTranscriptEmbeddingsMock.mockResolvedValueOnce(
      mastraResultFixture(),
    )

    const result = await runTranscriptOnlyPipeline({
      assetId: "42",
      muxAssetId: "mux-A",
      languageCode: "en",
    })

    expect(transcribeMock).toHaveBeenCalledWith("42", "mux-A", "en")
    expect(transcribeSubtitleUrlMock).not.toHaveBeenCalled()
    expect(launchMastraTranscriptEmbeddingsMock).toHaveBeenCalledWith({
      assetId: "42",
      muxAssetId: "mux-A",
      language: "en",
      transcript: {
        text: "this is a long enough transcript text fixture",
        segments: expect.any(Array),
        artifactKey: "42/transcript.json",
        provider: "mux",
      },
    })
    expect(result).toEqual({
      assetId: "42",
      language: "en",
      totalChunks: 1,
      totalTokens: 1,
      embeddingDimensions: 1536,
      embeddingStatus: "created",
      mastraRunId: "run-1",
      sourceContentHash: "sha256:test",
    })
  })

  it("falls back to language='auto' when caller omits languageCode", async () => {
    transcribeMock.mockResolvedValueOnce(transcriptionFixture())
    launchMastraTranscriptEmbeddingsMock.mockResolvedValueOnce(
      mastraResultFixture(),
    )

    await runTranscriptOnlyPipeline({
      assetId: "7",
      muxAssetId: "mux-B",
    })

    expect(transcribeMock).toHaveBeenCalledWith("7", "mux-B", "auto")
  })

  it("uses the supplied subtitle URL instead of polling Mux when available", async () => {
    transcribeSubtitleUrlMock.mockResolvedValueOnce(transcriptionFixture())
    launchMastraTranscriptEmbeddingsMock.mockResolvedValueOnce(
      mastraResultFixture(),
    )

    await runTranscriptOnlyPipeline({
      assetId: "42",
      muxAssetId: "mux-A",
      adminVideoId: "admin-video-1",
      subtitleUrl: "https://cdn.example.com/subtitles.vtt",
      languageCode: "en",
    })

    expect(transcribeSubtitleUrlMock).toHaveBeenCalledWith(
      "42",
      "https://cdn.example.com/subtitles.vtt",
      "en",
    )
    expect(transcribeMock).not.toHaveBeenCalled()
    expect(launchMastraTranscriptEmbeddingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        adminVideoId: "admin-video-1",
      }),
    )
  })

  it("throws when the transcript is empty", async () => {
    transcribeMock.mockResolvedValueOnce(transcriptionFixture({ text: "" }))

    await expect(
      runTranscriptOnlyPipeline({ assetId: "9", muxAssetId: "mux-C" }),
    ).rejects.toThrow(/transcript too short or empty/i)
    expect(launchMastraTranscriptEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("throws when the transcript is too short", async () => {
    transcribeMock.mockResolvedValueOnce(transcriptionFixture({ text: "hi" }))

    await expect(
      runTranscriptOnlyPipeline({ assetId: "9", muxAssetId: "mux-C" }),
    ).rejects.toThrow(/transcript too short or empty/i)
    expect(launchMastraTranscriptEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("propagates errors from transcribe", async () => {
    const err = Object.assign(new Error("mux not ready"), {
      name: "TranscriptionExecutionError",
    })
    transcribeMock.mockRejectedValueOnce(err)
    await expect(
      runTranscriptOnlyPipeline({ assetId: "1", muxAssetId: "mux-X" }),
    ).rejects.toThrow(/mux not ready/)
    expect(launchMastraTranscriptEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("propagates product failures from Mastra", async () => {
    transcribeMock.mockResolvedValueOnce(transcriptionFixture())
    launchMastraTranscriptEmbeddingsMock.mockResolvedValueOnce({
      ok: false,
      reason: "provider_failed",
      retryable: true,
    })
    await expect(
      runTranscriptOnlyPipeline({ assetId: "1", muxAssetId: "mux-X" }),
    ).rejects.toThrow(/Mastra transcript embedding failed.*provider_failed/)
  })
})
