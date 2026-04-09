import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  chaptersMock,
  embeddingsMock,
  mergeJobArtifactsMock,
  metadataMock,
  subtitleTranslationMock,
  transcribeMock,
  updateJobMock,
  updateStepStatusMock,
} = vi.hoisted(() => ({
  chaptersMock: vi.fn(),
  embeddingsMock: vi.fn(),
  mergeJobArtifactsMock: vi.fn(),
  metadataMock: vi.fn(),
  subtitleTranslationMock: vi.fn(),
  transcribeMock: vi.fn(),
  updateJobMock: vi.fn(),
  updateStepStatusMock: vi.fn(),
}))

vi.mock("@/services/transcription", () => ({
  transcribe: transcribeMock,
}))

vi.mock("@/services/chapters", () => ({
  generateChapters: chaptersMock,
}))

vi.mock("@/services/metadata", () => ({
  extractMetadata: metadataMock,
}))

vi.mock("@/services/embeddings", () => ({
  generateEmbeddings: embeddingsMock,
}))

vi.mock("@/services/subtitleTranslation", () => ({
  translateSubtitles: subtitleTranslationMock,
}))

vi.mock("@/lib/state", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/state")>("@/lib/state")

  return {
    ...actual,
    mergeJobArtifacts: mergeJobArtifactsMock,
    updateJob: updateJobMock,
    updateStepStatus: updateStepStatusMock,
  }
})

import { runVideoEnrichment } from "@/workflows/videoEnrichment"

describe("runVideoEnrichment", () => {
  beforeEach(() => {
    chaptersMock.mockReset()
    embeddingsMock.mockReset()
    mergeJobArtifactsMock.mockReset()
    metadataMock.mockReset()
    subtitleTranslationMock.mockReset()
    transcribeMock.mockReset()
    updateJobMock.mockReset()
    updateStepStatusMock.mockReset()

    updateJobMock.mockImplementation(async (_id, updates) => ({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["en"],
      options: {},
      status: updates.status ?? "running",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: updates.artifacts ?? {},
      steps: [],
      errors: [],
      currentStep: updates.currentStep,
      startedAt: updates.startedAt,
      completedAt: updates.completedAt,
    }))
    mergeJobArtifactsMock.mockImplementation(async (_id, artifacts) => ({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["en"],
      options: {},
      status: "running",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts,
      steps: [],
      errors: [],
    }))
    updateStepStatusMock.mockResolvedValue(null)
  })

  it("persists artifact manifest entries in two workflow phases without dropping prior metadata", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [
        { start: 0, end: 12, text: "Welcome to the episode." },
        { start: 12, end: 24, text: "We move into the main discussion." },
      ],
      language: "ru",
      artifactKeys: ["transcript", "subtitles"],
    })
    subtitleTranslationMock.mockResolvedValue([
      { lang: "en", status: "completed" },
      { lang: "fr", status: "failed", error: "bad glossary" },
    ])
    chaptersMock.mockResolvedValue({
      chapters: [
        { title: "Intro", startSeconds: 0, endSeconds: 30, summary: "" },
      ],
      artifactKeys: ["chapters"],
    })
    metadataMock.mockResolvedValue({
      title: "Title",
      description: "Description",
      topics: [],
      speakers: [],
      tags: ["tag-1"],
      language: "ru",
      artifactKeys: ["metadata"],
    })
    embeddingsMock.mockResolvedValue({
      model: "openai/text-embedding-3-small",
      dimensions: 3,
      chunks: [],
      artifactKeys: ["embeddings"],
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "ru",
        translateTo: ["en", "fr"],
        initialArtifacts: {
          materialization: {
            kind: "metadata",
            data: { sourceVideoCoreId: "video-1" },
          },
        },
      }),
    ).resolves.toMatchObject({
      assetId: "asset-1",
      language: "ru",
      tags: ["tag-1"],
    })

    expect(metadataMock).toHaveBeenCalledWith("asset-1", "hello world", "ru")

    expect(updateJobMock.mock.calls).toEqual([
      [
        "job-1",
        expect.objectContaining({
          status: "running",
          startedAt: expect.any(String),
        }),
      ],
      [
        "job-1",
        {
          status: "running",
          currentStep: "transcription",
        },
      ],
      [
        "job-1",
        {
          artifacts: {
            materialization: {
              kind: "metadata",
              data: { sourceVideoCoreId: "video-1" },
            },
            transcript: { kind: "downloadable" },
            subtitles: { kind: "downloadable" },
          },
        },
      ],
      [
        "job-1",
        {
          status: "running",
          currentStep: "translation",
        },
      ],
      [
        "job-1",
        {
          status: "running",
          currentStep: "chapters",
        },
      ],
      [
        "job-1",
        {
          status: "running",
          currentStep: "metadata",
        },
      ],
      [
        "job-1",
        {
          status: "running",
          currentStep: "embeddings",
        },
      ],
      [
        "job-1",
        {
          status: "completed",
          currentStep: undefined,
          completedAt: expect.any(String),
        },
      ],
    ])

    expect(mergeJobArtifactsMock.mock.calls).toEqual([
      [
        "job-1",
        {
          "subtitles-en": { kind: "downloadable" },
          "translation-en": { kind: "downloadable" },
        },
      ],
      [
        "job-1",
        {
          chapters: { kind: "downloadable" },
        },
      ],
      [
        "job-1",
        {
          metadata: { kind: "downloadable" },
        },
      ],
      [
        "job-1",
        {
          embeddings: { kind: "downloadable" },
        },
      ],
    ])

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "translation",
      "completed",
      undefined,
      {
        languageResults: [
          { lang: "en", status: "completed", error: undefined },
          { lang: "fr", status: "failed", error: "bad glossary" },
        ],
      },
    ])
    expect(embeddingsMock).toHaveBeenCalledWith(
      "asset-1",
      expect.objectContaining({
        text: "hello world",
        segments: [
          { start: 0, end: 12, text: "Welcome to the episode." },
          { start: 12, end: 24, text: "We move into the main discussion." },
        ],
        language: "ru",
      }),
      {
        metadata: expect.objectContaining({
          title: "Title",
          description: "Description",
          tags: ["tag-1"],
          language: "ru",
        }),
      },
    )
    expect(chaptersMock).toHaveBeenCalledWith("asset-1", {
      transcriptText: "hello world",
      segments: [
        { start: 0, end: 12, text: "Welcome to the episode." },
        { start: 12, end: 24, text: "We move into the main discussion." },
      ],
      language: "ru",
    })
  })

  it("still runs embeddings with transcript-only fallback when metadata fails", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    subtitleTranslationMock.mockResolvedValue([
      { lang: "en", status: "completed" },
    ])
    chaptersMock.mockResolvedValue({
      chapters: [
        { title: "Intro", startSeconds: 0, endSeconds: 30, summary: "" },
      ],
      artifactKeys: ["chapters"],
    })
    metadataMock.mockRejectedValue(
      new Error("Metadata extraction produced no usable fields"),
    )
    embeddingsMock.mockResolvedValue({
      model: "openai/text-embedding-3-small",
      dimensions: 3,
      chunks: [],
      artifactKeys: ["embeddings"],
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        translateTo: ["en"],
      }),
    ).rejects.toThrow("Metadata extraction produced no usable fields")

    expect(embeddingsMock).toHaveBeenCalledWith(
      "asset-1",
      expect.objectContaining({
        text: "hello world",
        segments: [],
        language: "en",
      }),
      {
        metadata: null,
      },
    )
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "metadata",
      "failed",
      "Metadata extraction produced no usable fields",
    ])
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "embeddings",
      "completed",
    ])
  })

  it("passes the resolved transcription language to metadata generation instead of the raw request language", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "fr",
      artifactKeys: ["transcript", "subtitles"],
    })
    subtitleTranslationMock.mockResolvedValue([
      { lang: "en", status: "completed" },
    ])
    chaptersMock.mockResolvedValue({
      chapters: [
        { title: "Intro", startSeconds: 0, endSeconds: 30, summary: "" },
      ],
      artifactKeys: ["chapters"],
    })
    metadataMock.mockResolvedValue({
      title: "Title",
      description: "Description",
      topics: [],
      speakers: [],
      tags: ["tag-1"],
      language: "fr",
      artifactKeys: ["metadata"],
    })
    embeddingsMock.mockResolvedValue({
      model: "openai/text-embedding-3-small",
      dimensions: 3,
      chunks: [],
      artifactKeys: ["embeddings"],
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "auto",
        translateTo: ["en"],
      }),
    ).resolves.toMatchObject({
      assetId: "asset-1",
      language: "fr",
      tags: ["tag-1"],
    })

    expect(metadataMock).toHaveBeenCalledWith("asset-1", "hello world", "fr")
  })

  it("marks transcription as failed and clears currentStep when transcription throws", async () => {
    transcribeMock.mockRejectedValue(new Error("subtitle fetch failed"))

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "ru",
        translateTo: ["en"],
      }),
    ).rejects.toThrow("subtitle fetch failed")

    expect(updateStepStatusMock.mock.calls).toEqual([
      ["job-1", "transcription", "running"],
      ["job-1", "transcription", "failed", "subtitle fetch failed"],
    ])

    expect(updateJobMock.mock.calls).toEqual([
      [
        "job-1",
        expect.objectContaining({
          status: "running",
          startedAt: expect.any(String),
        }),
      ],
      [
        "job-1",
        {
          status: "running",
          currentStep: "transcription",
        },
      ],
      [
        "job-1",
        {
          status: "failed",
          currentStep: undefined,
        },
      ],
    ])
  })

  it("fails the translation step and job when all target languages fail", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "ru",
      artifactKeys: ["transcript", "subtitles"],
    })
    subtitleTranslationMock.mockRejectedValue(
      new Error(
        "Subtitle translation failed for all target languages (en: llm offline)",
      ),
    )
    chaptersMock.mockResolvedValue({
      chapters: [
        { title: "Intro", startSeconds: 0, endSeconds: 30, summary: "" },
      ],
      artifactKeys: ["chapters"],
    })
    metadataMock.mockResolvedValue({
      title: "Title",
      description: "Description",
      topics: [],
      speakers: [],
      tags: ["tag-1"],
      language: "ru",
      artifactKeys: ["metadata"],
    })
    embeddingsMock.mockResolvedValue({
      model: "openai/text-embedding-3-small",
      dimensions: 3,
      chunks: [],
      artifactKeys: ["embeddings"],
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "ru",
        translateTo: ["en"],
      }),
    ).rejects.toThrow(
      "Subtitle translation failed for all target languages (en: llm offline)",
    )

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "translation",
      "failed",
      "Subtitle translation failed for all target languages (en: llm offline)",
    ])
    expect(updateJobMock.mock.calls).toContainEqual([
      "job-1",
      {
        status: "failed",
        currentStep: undefined,
      },
    ])
  })

  it("fails the chapters step and job when chapter extraction returns no usable output", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    subtitleTranslationMock.mockResolvedValue([
      { lang: "en", status: "completed" },
    ])
    chaptersMock.mockRejectedValue(
      new Error("Chapter extraction produced no chapters"),
    )
    metadataMock.mockResolvedValue({
      title: "Title",
      description: "Description",
      topics: [],
      speakers: [],
      tags: ["tag-1"],
      language: "en",
      artifactKeys: ["metadata"],
    })
    embeddingsMock.mockResolvedValue({
      model: "openai/text-embedding-3-small",
      dimensions: 3,
      chunks: [],
      artifactKeys: ["embeddings"],
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        translateTo: ["en"],
      }),
    ).rejects.toThrow("Chapter extraction produced no chapters")

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "chapters",
      "failed",
      "Chapter extraction produced no chapters",
    ])
    expect(updateJobMock.mock.calls).toContainEqual([
      "job-1",
      {
        status: "failed",
        currentStep: undefined,
      },
    ])
  })

  it("fails the workflow when artifact persistence fails", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "ru",
      artifactKeys: ["transcript", "subtitles"],
    })
    updateJobMock
      .mockResolvedValueOnce({
        id: "job-1",
        muxAssetId: "mux-1",
        muxPlaybackId: "play-1",
        languages: [],
        options: {},
        status: "running",
        retries: 0,
        createdAt: "",
        updatedAt: "",
        artifacts: {},
        steps: [],
        errors: [],
      })
      .mockResolvedValueOnce({
        id: "job-1",
        muxAssetId: "mux-1",
        muxPlaybackId: "play-1",
        languages: [],
        options: {},
        status: "running",
        retries: 0,
        createdAt: "",
        updatedAt: "",
        artifacts: {},
        steps: [],
        errors: [],
      })
      .mockResolvedValueOnce(null)

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "ru",
      }),
    ).rejects.toThrow("Failed to persist artifact manifest for job job-1")

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "transcription",
      "failed",
      "Failed to persist artifact manifest for job job-1",
    ])
  })

  it("fails a parallel step instead of marking it completed when artifact persistence fails", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "ru",
      artifactKeys: ["transcript", "subtitles"],
    })
    subtitleTranslationMock.mockResolvedValue([
      { lang: "en", status: "completed" },
    ])
    chaptersMock.mockResolvedValue({
      chapters: [
        { title: "Intro", startSeconds: 0, endSeconds: 30, summary: "" },
      ],
      artifactKeys: ["chapters"],
    })
    metadataMock.mockResolvedValue({
      title: "Title",
      description: "Description",
      topics: [],
      speakers: [],
      tags: ["tag-1"],
      language: "ru",
      artifactKeys: ["metadata"],
    })
    embeddingsMock.mockResolvedValue({
      model: "openai/text-embedding-3-small",
      dimensions: 3,
      chunks: [],
      artifactKeys: ["embeddings"],
    })
    mergeJobArtifactsMock
      .mockResolvedValueOnce({
        id: "job-1",
        muxAssetId: "mux-1",
        muxPlaybackId: "play-1",
        languages: ["en"],
        options: {},
        status: "running",
        retries: 0,
        createdAt: "",
        updatedAt: "",
        artifacts: { "subtitles-en": { kind: "downloadable" } },
        steps: [],
        errors: [],
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: "job-1",
        muxAssetId: "mux-1",
        muxPlaybackId: "play-1",
        languages: ["en"],
        options: {},
        status: "running",
        retries: 0,
        createdAt: "",
        updatedAt: "",
        artifacts: {},
        steps: [],
        errors: [],
      })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "ru",
        translateTo: ["en"],
      }),
    ).rejects.toThrow("Failed to persist artifact manifest for job job-1")

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "chapters",
      "failed",
      "Failed to persist artifact manifest for job job-1",
    ])
    expect(updateStepStatusMock.mock.calls).not.toContainEqual([
      "job-1",
      "chapters",
      "completed",
    ])
  })
})
