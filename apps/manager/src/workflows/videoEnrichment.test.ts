import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  audioCleanupMock,
  runAudioCleanupMock,
  chaptersMock,
  embeddingsMock,
  mastraTranscriptEmbeddingsMock,
  extractAndStoreSceneBoundariesMock,
  getMuxAssetMock,
  getJobMock,
  mergeJobArtifactsMock,
  metadataMock,
  sceneEmbeddingSyncMock,
  analyzeAllScenesMock,
  persistedJobArtifacts,
  subtitleTranslationMock,
  syncTranslatedSubtitlesToMuxMock,
  transcribeMock,
  updateJobMock,
  updateStepStatusMock,
} = vi.hoisted(() => ({
  audioCleanupMock: vi.fn(),
  runAudioCleanupMock: vi.fn(),
  chaptersMock: vi.fn(),
  embeddingsMock: vi.fn(),
  mastraTranscriptEmbeddingsMock: vi.fn(),
  extractAndStoreSceneBoundariesMock: vi.fn(),
  getMuxAssetMock: vi.fn(),
  getJobMock: vi.fn(),
  mergeJobArtifactsMock: vi.fn(),
  metadataMock: vi.fn(),
  sceneEmbeddingSyncMock: vi.fn(),
  analyzeAllScenesMock: vi.fn(),
  persistedJobArtifacts: {} as Record<string, unknown>,
  subtitleTranslationMock: vi.fn(),
  syncTranslatedSubtitlesToMuxMock: vi.fn(),
  transcribeMock: vi.fn(),
  updateJobMock: vi.fn(),
  updateStepStatusMock: vi.fn(),
}))

vi.mock("@/services/audioCleanup", () => ({
  cleanupAudioForReview: audioCleanupMock,
  runAudioCleanup: runAudioCleanupMock,
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

vi.mock("@/services/subtitleTranslation", () => ({
  translateSubtitles: subtitleTranslationMock,
}))

vi.mock("@/services/mastra-transcript-embeddings", () => ({
  launchMastraTranscriptEmbeddings: mastraTranscriptEmbeddingsMock,
}))

vi.mock("@/services/mux-sync", () => ({
  syncTranslatedSubtitlesToMux: syncTranslatedSubtitlesToMuxMock,
}))

vi.mock("@/services/sceneBoundaries", () => ({
  extractAndStoreSceneBoundaries: extractAndStoreSceneBoundariesMock,
}))

vi.mock("@/services/sceneAnalysis", () => ({
  analyzeAllScenes: analyzeAllScenesMock,
}))

vi.mock("@/services/sceneEmbeddingSync", () => ({
  syncSceneAnalysisEmbeddings: sceneEmbeddingSyncMock,
}))

vi.mock("@/services/mux", () => ({
  getMuxAsset: getMuxAssetMock,
  getPlaybackUrl: (playbackId: string) =>
    `https://stream.mux.com/${playbackId}.m3u8`,
}))

vi.mock("@/workflows/jobStateSteps", () => ({
  stepGetJob: getJobMock,
  stepMergeJobArtifacts: mergeJobArtifactsMock,
  stepUpdateJob: updateJobMock,
  stepUpdateStepStatus: updateStepStatusMock,
}))

import { runVideoEnrichment } from "@/workflows/videoEnrichment"

describe("runVideoEnrichment", () => {
  beforeEach(() => {
    chaptersMock.mockReset()
    embeddingsMock.mockReset()
    mastraTranscriptEmbeddingsMock.mockReset()
    extractAndStoreSceneBoundariesMock.mockReset()
    getMuxAssetMock.mockReset()
    getJobMock.mockReset()
    mergeJobArtifactsMock.mockReset()
    metadataMock.mockReset()
    sceneEmbeddingSyncMock.mockReset()
    analyzeAllScenesMock.mockReset()
    audioCleanupMock.mockReset()
    runAudioCleanupMock.mockReset()
    subtitleTranslationMock.mockReset()
    syncTranslatedSubtitlesToMuxMock.mockReset()
    transcribeMock.mockReset()
    updateJobMock.mockReset()
    updateStepStatusMock.mockReset()
    mastraTranscriptEmbeddingsMock.mockResolvedValue({
      ok: true,
      status: "created",
      chunks: 1,
      totalTokens: 7,
      model: "openai/text-embedding-3-small",
      provider: "openai",
      dimensions: 1536,
      mastraRunId: "run-1",
      sourceContentHash: "sha256:transcript",
      chunking: {
        type: "segment-aware",
        maxChunkTokens: 500,
        overlapTokens: 100,
        version: "manager-transcript-v1",
      },
    })
    extractAndStoreSceneBoundariesMock.mockResolvedValue({
      scenes: [
        {
          sceneIndex: 0,
          startSeconds: 0,
          endSeconds: 30,
          chapterTitle: "Intro",
          transcript: "Opening scene transcript",
        },
      ],
    })
    getMuxAssetMock.mockResolvedValue({
      playbackId: "play-1",
    })
    analyzeAllScenesMock.mockResolvedValue({
      scenes: [
        {
          sceneIndex: 0,
          startSeconds: 0,
          endSeconds: 30,
          chapterTitle: "Intro",
          description: "Themes: hope.",
          themes: ["hope"],
          bibleVerses: [],
          demographics: [],
          spiritualContext: [],
        },
      ],
      totalInputTokens: 12,
      totalOutputTokens: 4,
    })
    sceneEmbeddingSyncMock.mockResolvedValue({
      domain: "scene_embeddings",
      status: "source_ready",
      videoDocumentId: "video-doc-1",
      generatedSceneCount: 1,
      indexableSceneCount: 1,
    })

    for (const key of Object.keys(persistedJobArtifacts)) {
      delete persistedJobArtifacts[key]
    }

    const buildJobRecord = (updates: Record<string, unknown> = {}) => ({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["en"],
      options: {},
      status: (updates.status as string | undefined) ?? "running",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: { ...persistedJobArtifacts },
      steps: [],
      errors: [],
      currentStep: updates.currentStep as string | undefined,
      startedAt: updates.startedAt as string | undefined,
      completedAt: updates.completedAt as string | undefined,
    })

    updateJobMock.mockImplementation(async (_id, updates) => {
      if (updates.artifacts && typeof updates.artifacts === "object") {
        Object.assign(persistedJobArtifacts, updates.artifacts)
      }
      return buildJobRecord(updates)
    })
    mergeJobArtifactsMock.mockImplementation(async (_id, artifacts) => {
      Object.assign(persistedJobArtifacts, artifacts)
      return buildJobRecord()
    })
    getJobMock.mockImplementation(async () => buildJobRecord())
    syncTranslatedSubtitlesToMuxMock.mockResolvedValue({
      comparisons: [],
      overrideHistory: [],
      updatedAt: "2026-04-10T12:00:00.000Z",
    })
    audioCleanupMock.mockResolvedValue({
      artifactKeys: ["original-audio", "cleaned-audio"],
    })
    runAudioCleanupMock.mockResolvedValue({
      artifactKeys: ["original-audio", "cleaned-audio"],
    })
    updateStepStatusMock.mockResolvedValue(null)
  })

  it("runs audio cleanup and persists original and cleaned audio artifacts when enabled", async () => {
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
        runAudioCleanup: true,
        playbackId: "play-1",
      }),
    ).resolves.toMatchObject({
      assetId: "asset-1",
      language: "en",
    })

    expect(runAudioCleanupMock).toHaveBeenCalledWith({
      assetId: "asset-1",
      sourceVideoUrl: "https://stream.mux.com/play-1.m3u8",
    })
    expect(audioCleanupMock).not.toHaveBeenCalled()
    expect(mergeJobArtifactsMock.mock.calls).toContainEqual([
      "job-1",
      {
        "original-audio": { kind: "downloadable" },
        "cleaned-audio": { kind: "downloadable" },
      },
    ])
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "audio_cleanup",
      "running",
    ])
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "audio_cleanup",
      "completed",
    ])
  })

  it("records audio cleanup failure without failing the completed core enrichment job", async () => {
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
    runAudioCleanupMock.mockRejectedValue(
      Object.assign(new Error("ElevenLabs offline"), {
        artifactKeys: ["original-audio"],
      }),
    )

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        translateTo: ["en"],
        runAudioCleanup: true,
        playbackId: "play-1",
      }),
    ).resolves.toMatchObject({
      assetId: "asset-1",
      language: "en",
    })

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "audio_cleanup",
      "failed",
      "ElevenLabs offline",
    ])
    expect(mergeJobArtifactsMock.mock.calls).toContainEqual([
      "job-1",
      {
        "original-audio": { kind: "downloadable" },
      },
    ])
    expect(updateJobMock.mock.calls).toContainEqual([
      "job-1",
      expect.objectContaining({
        status: "completed",
        currentStep: undefined,
      }),
    ])
  })

  it("still creates audio review artifacts when mux upload fails later", async () => {
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
    syncTranslatedSubtitlesToMuxMock.mockRejectedValue(new Error("Mux offline"))

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        playbackId: "play-1",
        language: "en",
        translateTo: ["en"],
        runAudioCleanup: true,
      }),
    ).rejects.toThrow("Mux offline")

    expect(runAudioCleanupMock).toHaveBeenCalledWith({
      assetId: "asset-1",
      sourceVideoUrl: "https://stream.mux.com/play-1.m3u8",
    })
    expect(mergeJobArtifactsMock.mock.calls).toContainEqual([
      "job-1",
      {
        "original-audio": { kind: "downloadable" },
        "cleaned-audio": { kind: "downloadable" },
      },
    ])
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "audio_cleanup",
      "completed",
    ])
  })

  it("keeps partial audio artifact persistence failure from failing the core job", async () => {
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
    runAudioCleanupMock.mockRejectedValue(
      Object.assign(new Error("ElevenLabs offline"), {
        artifactKeys: ["original-audio"],
      }),
    )
    mergeJobArtifactsMock.mockImplementation(async (_id, artifacts) => {
      if ("original-audio" in artifacts) {
        throw new Error("artifact manifest write failed")
      }
      Object.assign(persistedJobArtifacts, artifacts)
      return getJobMock()
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        playbackId: "play-1",
        language: "en",
        translateTo: ["en"],
        runAudioCleanup: true,
      }),
    ).resolves.toMatchObject({
      assetId: "asset-1",
      language: "en",
    })

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "audio_cleanup",
      "failed",
      "ElevenLabs offline",
    ])
    expect(updateJobMock.mock.calls).toContainEqual([
      "job-1",
      expect.objectContaining({
        status: "completed",
        currentStep: undefined,
      }),
    ])
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
      resolvedProvider: "mux",
      routingReport: {
        finalProvider: "mux",
        finalSourceLanguageCode: "ru",
        attempts: [
          {
            attemptId: "mux-automatic-1",
            requestedProvider: "automatic",
            resolvedProvider: "mux",
            status: "completed",
            sourceLanguageCode: "ru",
            startedAt: "2026-04-12T12:00:00.000Z",
            finishedAt: "2026-04-12T12:01:00.000Z",
          },
        ],
      },
    })
    subtitleTranslationMock.mockResolvedValue([
      { lang: "en", status: "completed" },
      { lang: "fr", status: "failed", error: "bad glossary" },
    ])
    chaptersMock.mockResolvedValue({
      chapters: [
        { title: "Intro", startSeconds: 0, endSeconds: 30, summary: "" },
      ],
      artifactKeys: ["chapters", "chapters-vtt"],
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
    syncTranslatedSubtitlesToMuxMock.mockResolvedValue({
      comparisons: [
        {
          artifactKey: "subtitles-en",
          targetLanguage: "en",
          muxTargetType: "text_track",
          muxTargetKey: "en",
          status: "synced",
          explanation: "Synced en subtitles to Mux",
          updatedAt: "2026-04-10T12:00:00.000Z",
        },
        {
          artifactKey: "subtitles-fr",
          targetLanguage: "fr",
          muxTargetType: "text_track",
          muxTargetKey: "fr",
          status: "skipped_missing_generated_data",
          explanation:
            "Generated subtitle artifact is unavailable: bad glossary",
          updatedAt: "2026-04-10T12:00:00.000Z",
        },
      ],
      overrideHistory: [],
      updatedAt: "2026-04-10T12:00:00.000Z",
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
      ["job-1", { status: "running", currentStep: "transcription" }],
      [
        "job-1",
        {
          artifacts: {
            materialization: {
              kind: "metadata",
              data: { sourceVideoCoreId: "video-1" },
            },
            transcriptionRouting: {
              kind: "metadata",
              data: {
                finalProvider: "mux",
                finalSourceLanguageCode: "ru",
                attempts: [
                  {
                    attemptId: "mux-automatic-1",
                    requestedProvider: "automatic",
                    resolvedProvider: "mux",
                    status: "completed",
                    sourceLanguageCode: "ru",
                    startedAt: "2026-04-12T12:00:00.000Z",
                    finishedAt: "2026-04-12T12:01:00.000Z",
                  },
                ],
              },
            },
            transcript: { kind: "downloadable" },
            subtitles: { kind: "downloadable" },
          },
        },
      ],
      ["job-1", { status: "running", currentStep: "translation" }],
      ["job-1", { status: "running", currentStep: "chapters" }],
      ["job-1", { status: "running", currentStep: "metadata" }],
      ["job-1", { status: "running", currentStep: "embeddings" }],
      ["job-1", { status: "running", currentStep: "mux_upload" }],
      [
        "job-1",
        {
          artifacts: expect.objectContaining({
            materialization: {
              kind: "metadata",
              data: { sourceVideoCoreId: "video-1" },
            },
            transcript: { kind: "downloadable" },
            subtitles: { kind: "downloadable" },
            "subtitles-en": { kind: "downloadable" },
            chapters: { kind: "downloadable" },
            "chapters-vtt": { kind: "downloadable" },
            metadata: { kind: "downloadable" },
            muxSync: {
              kind: "metadata",
              data: expect.objectContaining({
                comparisons: expect.any(Array),
                updatedAt: "2026-04-10T12:00:00.000Z",
              }),
            },
          }),
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
          "chapters-vtt": { kind: "downloadable" },
        },
      ],
      [
        "job-1",
        {
          metadata: { kind: "downloadable" },
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
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "mux_upload",
      "running",
    ])
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "mux_upload",
      "completed",
    ])
    expect(
      updateStepStatusMock.mock.calls.some(
        ([, step]) =>
          step === "theology_validation_bible_quotes" ||
          step === "seo_improvements",
      ),
    ).toBe(false)
    expect(syncTranslatedSubtitlesToMuxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        translationResults: [
          { lang: "en", status: "completed" },
          { lang: "fr", status: "failed", error: "bad glossary" },
        ],
      }),
    )
    expect(mastraTranscriptEmbeddingsMock).toHaveBeenCalledWith({
      assetId: "asset-1",
      muxAssetId: "mux-1",
      language: "ru",
      transcript: {
        text: "hello world",
        segments: [
          { start: 0, end: 12, text: "Welcome to the episode." },
          { start: 12, end: 24, text: "We move into the main discussion." },
        ],
        artifactKey: "asset-1/transcript.json",
        provider: "mux",
      },
    })
    expect(chaptersMock).toHaveBeenCalledWith("asset-1", {
      transcriptText: "hello world",
      segments: [
        { start: 0, end: 12, text: "Welcome to the episode." },
        { start: 12, end: 24, text: "We move into the main discussion." },
      ],
      language: "ru",
    })
  })

  it("launches Mastra transcript embeddings without requiring legacy document id targeting", async () => {
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
      chunks: [{ text: "chunk 1" }],
      metadata: { generatedAt: "2026-04-10T00:00:00.000Z" },
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
    ).resolves.toMatchObject({
      assetId: "asset-1",
      language: "en",
    })

    expect(mastraTranscriptEmbeddingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        muxAssetId: "mux-1",
      }),
    )
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "embeddings",
      "completed",
    ])
  })

  it("keeps the embeddings step successful when Mastra ingest succeeds", async () => {
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
      chunks: [{ text: "chunk 1" }],
      metadata: { generatedAt: "2026-04-10T00:00:00.000Z" },
      artifactKeys: ["embeddings"],
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        translateTo: ["en"],
        videoDocumentId: "video-doc-1",
      }),
    ).resolves.toMatchObject({
      assetId: "asset-1",
      language: "en",
    })

    expect(mastraTranscriptEmbeddingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        muxAssetId: "mux-1",
      }),
    )
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "embeddings",
      "completed",
    ])
    expect(updateStepStatusMock.mock.calls).not.toContainEqual([
      "job-1",
      "embeddings",
      "failed",
      "video_not_found",
    ])
  })

  it("persists scene embedding sync metadata when optional scene analysis is enabled", async () => {
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
      chunks: [{ text: "chunk 1" }],
      metadata: { generatedAt: "2026-04-10T00:00:00.000Z" },
      artifactKeys: ["embeddings"],
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        translateTo: ["en"],
        runSceneAnalysis: true,
        videoDocumentId: "video-doc-1",
      }),
    ).resolves.toMatchObject({
      assetId: "asset-1",
      language: "en",
    })

    expect(extractAndStoreSceneBoundariesMock).toHaveBeenCalledWith(
      "asset-1",
      [{ title: "Intro", startSeconds: 0, endSeconds: 30, summary: "" }],
      "hello world",
    )
    expect(analyzeAllScenesMock).toHaveBeenCalledWith(
      "asset-1",
      "play-1",
      expect.any(Array),
      expect.objectContaining({
        videoLabel: "unknown",
      }),
    )
    expect(sceneEmbeddingSyncMock).toHaveBeenCalledWith({
      assetId: "asset-1",
      videoDocumentId: "video-doc-1",
      muxAssetId: "mux-1",
      playbackId: "play-1",
      language: "en",
      analysisResult: expect.objectContaining({
        scenes: [expect.objectContaining({ sceneIndex: 0 })],
      }),
    })
    expect(mergeJobArtifactsMock.mock.calls).toContainEqual([
      "job-1",
      {
        sceneEmbeddingSync: {
          kind: "metadata",
          data: expect.objectContaining({
            domain: "scene_embeddings",
            status: "source_ready",
          }),
        },
      },
    ])
  })

  it("records failed scene embedding sync reports without failing the enrichment job", async () => {
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
      chunks: [{ text: "chunk 1" }],
      metadata: { generatedAt: "2026-04-10T00:00:00.000Z" },
      artifactKeys: ["embeddings"],
    })
    sceneEmbeddingSyncMock.mockResolvedValue({
      domain: "scene_embeddings",
      status: "failed",
      reason: "video_not_found",
      generatedSceneCount: 1,
      indexableSceneCount: 1,
      videoDocumentId: "video-doc-1",
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        translateTo: ["en"],
        runSceneAnalysis: true,
        videoDocumentId: "video-doc-1",
      }),
    ).resolves.toMatchObject({
      assetId: "asset-1",
      language: "en",
    })

    expect(mergeJobArtifactsMock.mock.calls).toContainEqual([
      "job-1",
      {
        sceneEmbeddingSync: {
          kind: "metadata",
          data: expect.objectContaining({
            domain: "scene_embeddings",
            status: "failed",
            reason: "video_not_found",
          }),
        },
      },
    ])
    expect(updateJobMock.mock.calls).toContainEqual([
      "job-1",
      expect.objectContaining({
        status: "completed",
        currentStep: undefined,
      }),
    ])
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

    expect(mastraTranscriptEmbeddingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        transcript: expect.objectContaining({
          text: "hello world",
          segments: [],
        }),
      }),
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
    expect(updateStepStatusMock.mock.calls).not.toContainEqual([
      "job-1",
      "seo_improvements",
      "skipped",
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

  it("persists transcription routing metadata before failing when ElevenLabs errors", async () => {
    transcribeMock.mockRejectedValue(
      Object.assign(new Error("audio isolation failed"), {
        routingReport: {
          sourceInputUrl: "https://cdn.example.com/video.mp4",
          attempts: [
            {
              attemptId: "attempt-1",
              requestedProvider: "automatic",
              resolvedProvider: "elevenlabs",
              status: "failed",
              sourceLanguageCode: "en",
              startedAt: "2026-04-11T12:00:00.000Z",
              finishedAt: "2026-04-11T12:00:08.000Z",
              fallbackReason: "audio isolation failed",
            },
          ],
        },
      }),
    )

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
      }),
    ).rejects.toThrow("audio isolation failed")

    expect(updateJobMock.mock.calls).toContainEqual([
      "job-1",
      {
        artifacts: {
          transcriptionRouting: {
            kind: "metadata",
            data: {
              sourceInputUrl: "https://cdn.example.com/video.mp4",
              sourceInputHost: "cdn.example.com",
              attempts: [
                {
                  attemptId: "attempt-1",
                  requestedProvider: "automatic",
                  resolvedProvider: "elevenlabs",
                  status: "failed",
                  sourceLanguageCode: "en",
                  startedAt: "2026-04-11T12:00:00.000Z",
                  finishedAt: "2026-04-11T12:00:08.000Z",
                  fallbackReason: "audio isolation failed",
                },
              ],
            },
          },
        },
      },
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

  it("fails the chapters step and job when chapters-vtt writing fails", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [
        { start: 0, end: 12, text: "Welcome to the episode." },
        { start: 12, end: 24, text: "We move into the main discussion." },
      ],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    subtitleTranslationMock.mockResolvedValue([
      { lang: "en", status: "completed" },
    ])
    chaptersMock.mockRejectedValue(new Error("VTT write failed"))
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
    ).rejects.toThrow("VTT write failed")

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "chapters",
      "failed",
      "VTT write failed",
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
