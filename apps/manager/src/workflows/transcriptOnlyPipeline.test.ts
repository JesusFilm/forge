import { beforeEach, describe, expect, it, vi } from "vitest"

const { transcribeMock, generateEmbeddingsMock } = vi.hoisted(() => ({
  transcribeMock: vi.fn(),
  generateEmbeddingsMock: vi.fn(),
}))

vi.mock("@/services/transcription", () => ({
  transcribe: transcribeMock,
}))

vi.mock("@/services/embeddings", () => ({
  generateEmbeddings: generateEmbeddingsMock,
}))

const { runTranscriptOnlyPipeline } =
  await import("@/workflows/transcriptOnlyPipeline")

beforeEach(() => {
  transcribeMock.mockReset()
  generateEmbeddingsMock.mockReset()
})

function transcriptionFixture(overrides?: {
  text?: string
  language?: string
}) {
  return {
    text: overrides?.text ?? "this is a long enough transcript text fixture",
    segments: [{ startTime: 0, endTime: 1, text: "hello", speaker: undefined }],
    language: overrides?.language ?? "en",
    artifactKeys: ["transcript", "subtitles"],
    resolvedProvider: "mux" as const,
    routingReport: { attempts: [], requestedProvider: "auto" as const },
  }
}

function embeddingsFixture() {
  return {
    model: "openai/text-embedding-3-small",
    dimensions: 1536,
    chunks: [
      {
        chunkId: "c-0",
        text: "hello",
        embedding: new Array(1536).fill(0.001),
        metadata: { tokenCount: 1 },
      },
    ],
    averagedEmbedding: new Array(1536).fill(0.001),
    metadata: {
      totalChunks: 1,
      totalTokens: 1,
      chunkingStrategy: {
        type: "segment-aware" as const,
        maxChunkTokens: 500,
        overlapTokens: 100,
      },
      embeddingDimensions: 1536,
      generatedAt: "2026-05-06T00:00:00.000Z",
    },
    artifactKeys: ["embeddings"],
  }
}

describe("runTranscriptOnlyPipeline", () => {
  it("composes transcribe → generateEmbeddings and forwards artifact-relevant fields", async () => {
    transcribeMock.mockResolvedValueOnce(transcriptionFixture())
    generateEmbeddingsMock.mockResolvedValueOnce(embeddingsFixture())

    const result = await runTranscriptOnlyPipeline({
      assetId: "42",
      muxAssetId: "mux-A",
      languageCode: "en",
    })

    expect(transcribeMock).toHaveBeenCalledWith("42", "mux-A", "en")
    expect(generateEmbeddingsMock).toHaveBeenCalledWith("42", {
      text: "this is a long enough transcript text fixture",
      segments: expect.any(Array),
      language: "en",
    })
    expect(result).toEqual({
      assetId: "42",
      language: "en",
      totalChunks: 1,
      totalTokens: 1,
      embeddingDimensions: 1536,
    })
  })

  it("falls back to language='auto' when caller omits languageCode", async () => {
    transcribeMock.mockResolvedValueOnce(transcriptionFixture())
    generateEmbeddingsMock.mockResolvedValueOnce(embeddingsFixture())

    await runTranscriptOnlyPipeline({
      assetId: "7",
      muxAssetId: "mux-B",
    })

    expect(transcribeMock).toHaveBeenCalledWith("7", "mux-B", "auto")
  })

  it("throws when the transcript is empty", async () => {
    transcribeMock.mockResolvedValueOnce(transcriptionFixture({ text: "" }))

    await expect(
      runTranscriptOnlyPipeline({ assetId: "9", muxAssetId: "mux-C" }),
    ).rejects.toThrow(/transcript too short or empty/i)
    expect(generateEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("throws when the transcript is too short", async () => {
    transcribeMock.mockResolvedValueOnce(transcriptionFixture({ text: "hi" }))

    await expect(
      runTranscriptOnlyPipeline({ assetId: "9", muxAssetId: "mux-C" }),
    ).rejects.toThrow(/transcript too short or empty/i)
    expect(generateEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("propagates errors from transcribe", async () => {
    const err = Object.assign(new Error("mux not ready"), {
      name: "TranscriptionExecutionError",
    })
    transcribeMock.mockRejectedValueOnce(err)
    await expect(
      runTranscriptOnlyPipeline({ assetId: "1", muxAssetId: "mux-X" }),
    ).rejects.toThrow(/mux not ready/)
    expect(generateEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("propagates errors from generateEmbeddings", async () => {
    transcribeMock.mockResolvedValueOnce(transcriptionFixture())
    generateEmbeddingsMock.mockRejectedValueOnce(
      new Error("openrouter rate-limited"),
    )
    await expect(
      runTranscriptOnlyPipeline({ assetId: "1", muxAssetId: "mux-X" }),
    ).rejects.toThrow(/openrouter rate-limited/)
  })
})
