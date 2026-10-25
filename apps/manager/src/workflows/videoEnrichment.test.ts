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
  analyzeAllScenesMock,
  persistedJobArtifacts,
  mastraSubtitleEnrichmentMock,
  mastraTranscriptCorrectionMock,
  syncTranslatedSubtitlesToMuxMock,
  transcribeMock,
  updateJobMock,
  updateStepStatusMock,
  writeArtifactMock,
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
  analyzeAllScenesMock: vi.fn(),
  persistedJobArtifacts: {} as Record<string, unknown>,
  mastraSubtitleEnrichmentMock: vi.fn(),
  mastraTranscriptCorrectionMock: vi.fn(),
  syncTranslatedSubtitlesToMuxMock: vi.fn(),
  transcribeMock: vi.fn(),
  updateJobMock: vi.fn(),
  updateStepStatusMock: vi.fn(),
  writeArtifactMock: vi.fn(),
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

vi.mock("@/services/mastra-subtitle-enrichment", () => ({
  launchMastraSubtitleEnrichment: mastraSubtitleEnrichmentMock,
}))

vi.mock("@/services/mastra-transcript-scripture-correction", () => ({
  launchMastraTranscriptScriptureCorrection: mastraTranscriptCorrectionMock,
}))

vi.mock("@/services/mastra-transcript-embeddings", () => ({
  launchMastraTranscriptEmbeddings: mastraTranscriptEmbeddingsMock,
}))

vi.mock("@/services/storage", () => ({
  writeArtifact: writeArtifactMock,
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

function subtitleSuccess(
  languages: Array<{
    lang: string
    status: "completed" | "failed"
    error?: string
    artifactKeys?: { vtt: string; json: string; validation?: string }
    validationSummary?: {
      verdict: "pass" | "warning" | "needs_review" | "unavailable"
      basis: "model_knowledge" | "target_bible_text" | "unavailable"
      confidence: number
      checkedReferenceCount: number
      warningCount: number
      needsReviewCount: number
      fallbackReason?: string
      unavailableReason?: string
    }
  }>,
) {
  return {
    ok: true,
    mastraRunId: "subtitle-run-1",
    languages,
    succeeded: languages.filter((language) => language.status === "completed")
      .length,
    failed: languages.filter((language) => language.status === "failed").length,
  }
}

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
    analyzeAllScenesMock.mockReset()
    audioCleanupMock.mockReset()
    runAudioCleanupMock.mockReset()
    mastraSubtitleEnrichmentMock.mockReset()
    mastraTranscriptCorrectionMock.mockReset()
    syncTranslatedSubtitlesToMuxMock.mockReset()
    transcribeMock.mockReset()
    updateJobMock.mockReset()
    updateStepStatusMock.mockReset()
    writeArtifactMock.mockReset()
    writeArtifactMock.mockResolvedValue("artifact-key")
    mastraTranscriptCorrectionMock.mockResolvedValue({
      ok: true,
      mastraRunId: "transcript-correction-run-1",
      correction: {
        status: "skipped",
        basis: "model_knowledge",
        contentDomain: "other",
        confidence: 0.1,
        checkedReferenceCount: 0,
        candidateCount: 0,
        flaggedCount: 0,
        skippedReason: "no_scripture_context",
        likelyBibleReferences: [],
        findings: [],
      },
    })
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
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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
    expect(runAudioCleanupMock.mock.invocationCallOrder[0]).toBeLessThan(
      transcribeMock.mock.invocationCallOrder[0],
    )
    expect(transcribeMock).toHaveBeenCalledWith(
      "asset-1",
      "mux-1",
      "en",
      expect.objectContaining({
        cleanedAudioArtifact: {
          assetId: "asset-1",
          artifactType: "cleaned-audio",
          ext: "mp3",
        },
      }),
    )
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

  it("fails before transcription when required audio cleanup fails", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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
    ).rejects.toThrow("ElevenLabs offline")

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
    expect(transcribeMock).not.toHaveBeenCalled()
    expect(updateJobMock.mock.calls).toContainEqual([
      "job-1",
      expect.objectContaining({
        status: "failed",
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
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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

  it("fails before transcription when partial audio artifact persistence fails", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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
    ).rejects.toThrow("ElevenLabs offline")

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "audio_cleanup",
      "failed",
      "ElevenLabs offline",
    ])
    expect(transcribeMock).not.toHaveBeenCalled()
    expect(updateJobMock.mock.calls).toContainEqual([
      "job-1",
      expect.objectContaining({
        status: "failed",
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
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([
        {
          lang: "en",
          status: "completed",
          artifactKeys: {
            vtt: "asset-1/subtitles-en.vtt",
            json: "asset-1/translation-en.json",
            validation: "asset-1/subtitle-validation-en.json",
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
        { lang: "fr", status: "failed", error: "bad glossary" },
      ]),
    )
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
        videoTitle: "Jesus Film",
        videoLabel: "JESUS_FILM",
        bibleVerses: [
          " Luke 2 ",
          "Luke 2",
          ...Array.from({ length: 24 }, (_, index) => `John ${index + 1}`),
          "not a Bible reference",
          "John ".padEnd(120, "1"),
        ],
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
    expect(mastraSubtitleEnrichmentMock).toHaveBeenCalledWith({
      assetId: "asset-1",
      sourceLanguage: "ru",
      targetLanguages: ["en", "fr"],
      translationContext: {
        videoTitle: "Jesus Film",
        videoLabel: "JESUS_FILM",
        bibleReferences: [
          "Luke 2",
          ...Array.from({ length: 19 }, (_, index) => `John ${index + 1}`),
        ],
      },
    })

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
      ["job-1", { status: "running", currentStep: "structured_transcript" }],
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
            "transcript-correction-report": { kind: "downloadable" },
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
            "subtitle-validation-en": { kind: "downloadable" },
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
          "subtitle-validation-en": { kind: "downloadable" },
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
      "structured_transcript",
      "completed",
      undefined,
      expect.objectContaining({
        transcriptCorrection: expect.objectContaining({
          status: "skipped",
          skippedReason: "no_scripture_context",
        }),
        mastra: expect.objectContaining({
          runId: "transcript-correction-run-1",
          status: "skipped",
        }),
      }),
    ])
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "translation",
      "completed",
      undefined,
      expect.objectContaining({
        languageResults: [
          { lang: "en", status: "completed", error: undefined },
          { lang: "fr", status: "failed", error: "bad glossary" },
        ],
        subtitleValidation: {
          highestVerdict: "needs_review",
          languagesChecked: 1,
          modelOnlyLanguages: ["en"],
          unavailableLanguages: [],
          warningCount: 0,
          needsReviewCount: 1,
          results: [
            {
              lang: "en",
              verdict: "needs_review",
              basis: "model_knowledge",
              confidence: 0.72,
              checkedReferenceCount: 1,
              warningCount: 0,
              needsReviewCount: 1,
              fallbackReason: "provider_config_missing",
            },
          ],
        },
        mastra: {
          runId: "subtitle-run-1",
          status: "completed",
          languages: ["en", "fr"],
        },
      }),
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
        translationResults: expect.arrayContaining([
          expect.objectContaining({ lang: "en", status: "completed" }),
          { lang: "fr", status: "failed", error: "bad glossary" },
        ]),
      }),
    )
    expect(writeArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        artifactType: "transcript-correction-report",
        ext: "json",
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
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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
      undefined,
      {
        mastra: {
          runId: "run-1",
          status: "created",
          provider: "openai",
          model: "openai/text-embedding-3-small",
          chunks: 1,
          totalTokens: 7,
          sourceContentHash: "sha256:transcript",
        },
      },
    ])
  })

  it("applies source transcript scripture corrections before downstream fan-out", async () => {
    transcribeMock.mockResolvedValue({
      text: "Son, the demon! Have mercy on me!",
      segments: [
        { start: 56, end: 60, text: "Son, the demon! Have mercy on me!" },
      ],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
      resolvedProvider: "mux",
      routingReport: {
        finalProvider: "mux",
        finalSourceLanguageCode: "en",
        attempts: [],
      },
    })
    mastraTranscriptCorrectionMock.mockResolvedValue({
      ok: true,
      mastraRunId: "transcript-correction-run-2",
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
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "es", status: "completed" }]),
    )
    chaptersMock.mockResolvedValue({
      chapters: [
        { title: "Blind man", startSeconds: 0, endSeconds: 90, summary: "" },
      ],
      artifactKeys: ["chapters"],
    })
    metadataMock.mockResolvedValue({
      title: "Blind man",
      description: "Description",
      topics: [],
      speakers: [],
      tags: ["healing"],
      language: "en",
      artifactKeys: ["metadata"],
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        translateTo: ["es"],
        videoTitle: "Blind Man",
        bibleVerses: ["Luke 18:38"],
      }),
    ).resolves.toMatchObject({
      transcript: "Son of David! Have mercy on me!",
    })

    expect(chaptersMock).toHaveBeenCalledWith("asset-1", {
      transcriptText: "Son of David! Have mercy on me!",
      segments: [
        { start: 56, end: 60, text: "Son of David! Have mercy on me!" },
      ],
      language: "en",
    })
    expect(metadataMock).toHaveBeenCalledWith(
      "asset-1",
      "Son of David! Have mercy on me!",
      "en",
    )
    expect(mastraTranscriptEmbeddingsMock).toHaveBeenCalledWith({
      assetId: "asset-1",
      muxAssetId: "mux-1",
      language: "en",
      transcript: {
        text: "Son of David! Have mercy on me!",
        segments: [
          { start: 56, end: 60, text: "Son of David! Have mercy on me!" },
        ],
        artifactKey: "asset-1/transcript.json",
        provider: "mux",
      },
    })
    expect(writeArtifactMock.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            assetId: "asset-1",
            artifactType: "transcript-raw",
            ext: "json",
            body: expect.stringContaining("Son, the demon"),
          }),
        ],
        [
          expect.objectContaining({
            assetId: "asset-1",
            artifactType: "subtitles-raw",
            ext: "vtt",
            body: expect.stringContaining("Son, the demon"),
          }),
        ],
        [
          expect.objectContaining({
            assetId: "asset-1",
            artifactType: "transcript",
            ext: "json",
            body: expect.stringContaining("Son of David"),
          }),
        ],
        [
          expect.objectContaining({
            assetId: "asset-1",
            artifactType: "subtitles",
            ext: "vtt",
            body: expect.stringContaining("Son of David"),
          }),
        ],
        [
          expect.objectContaining({
            assetId: "asset-1",
            artifactType: "transcript-correction-report",
            ext: "json",
            body: expect.stringContaining("Son of David"),
          }),
        ],
      ]),
    )
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "structured_transcript",
      "completed",
      undefined,
      expect.objectContaining({
        transcriptCorrection: expect.objectContaining({
          status: "applied",
          appliedCount: 1,
          flaggedCount: 0,
        }),
      }),
    ])
  })

  it("marks structured transcript failed when correction artifact persistence fails", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [{ start: 0, end: 2, text: "hello world" }],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
      resolvedProvider: "mux",
    })
    writeArtifactMock.mockImplementation(async (artifact) => {
      if (artifact.artifactType === "transcript-correction-report") {
        throw new Error("correction report write failed")
      }
      return "artifact-key"
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        translateTo: ["es"],
      }),
    ).rejects.toThrow("correction report write failed")

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "structured_transcript",
      "running",
    ])
    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "structured_transcript",
      "failed",
      "correction report write failed",
    ])
    expect(updateStepStatusMock.mock.calls).not.toContainEqual([
      "job-1",
      "translation",
      "running",
    ])
    expect(updateJobMock.mock.calls).toContainEqual([
      "job-1",
      expect.objectContaining({
        status: "failed",
        currentStep: undefined,
      }),
    ])
  })

  it("keeps the embeddings step successful when Mastra ingest succeeds", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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
      undefined,
      expect.objectContaining({
        mastra: expect.objectContaining({
          runId: "run-1",
          model: "openai/text-embedding-3-small",
        }),
      }),
    ])
    expect(updateStepStatusMock.mock.calls).not.toContainEqual([
      "job-1",
      "embeddings",
      "failed",
      "video_not_found",
    ])
  })

  it("runs optional scene analysis without syncing scene embeddings", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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
  })

  it("does not fail the enrichment job when optional scene analysis fails", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    analyzeAllScenesMock.mockRejectedValueOnce(new Error("scene analysis boom"))

    try {
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

      expect(updateJobMock.mock.calls).toContainEqual([
        "job-1",
        expect.objectContaining({
          status: "completed",
          currentStep: undefined,
        }),
      ])
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("scene_analysis_failed_in_enrichment"),
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it("still runs embeddings with transcript-only fallback when metadata fails", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
    )
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
      undefined,
      expect.objectContaining({
        mastra: expect.objectContaining({
          runId: "run-1",
        }),
      }),
    ])
  })

  it("passes the resolved transcription language to metadata generation instead of the raw request language", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "fr",
      artifactKeys: ["transcript", "subtitles"],
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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
      ["job-1", "audio_cleanup", "skipped"],
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
    mastraSubtitleEnrichmentMock.mockResolvedValue({
      ok: false,
      mastraRunId: "subtitle-run-1",
      reason: "all_languages_failed",
      retryable: true,
      message: "Subtitle enrichment failed for all target languages.",
      languages: [{ lang: "en", status: "failed", error: "llm offline" }],
    })
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
      "Mastra subtitle enrichment failed (all_languages_failed): Subtitle enrichment failed for all target languages.",
    )

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "translation",
      "failed",
      "Mastra subtitle enrichment failed (all_languages_failed): Subtitle enrichment failed for all target languages.",
      {
        languageResults: [
          { lang: "en", status: "failed", error: "llm offline" },
        ],
        mastra: {
          runId: "subtitle-run-1",
          status: "failed",
          reason: "all_languages_failed",
          retryable: true,
          languages: ["en"],
        },
      },
    ])
    expect(updateJobMock.mock.calls).toContainEqual([
      "job-1",
      {
        status: "failed",
        currentStep: undefined,
      },
    ])
  })

  it("keeps Mastra translation details when artifact persistence fails after the run", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "ru",
      artifactKeys: ["transcript", "subtitles"],
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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

    mergeJobArtifactsMock
      .mockResolvedValueOnce(null)
      .mockResolvedValue(getJobMock())

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
      "translation",
      "failed",
      "Failed to persist artifact manifest for job job-1",
      expect.objectContaining({
        languageResults: [{ lang: "en", status: "completed" }],
        mastra: {
          runId: "subtitle-run-1",
          status: "completed",
          languages: ["en"],
        },
      }),
    ])
  })

  it("keeps Mastra embeddings failure correlation without persisting transcript text", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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
      language: "en",
      artifactKeys: ["metadata"],
    })
    mastraTranscriptEmbeddingsMock.mockResolvedValueOnce({
      ok: false,
      reason: "provider_failed",
      retryable: true,
      mastraRunId: "embeddings-run-1",
    })

    await expect(
      runVideoEnrichment({
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        translateTo: ["en"],
      }),
    ).rejects.toThrow(
      "Mastra transcript embedding failed for assetId=asset-1: provider_failed",
    )

    expect(updateStepStatusMock.mock.calls).toContainEqual([
      "job-1",
      "embeddings",
      "failed",
      "Mastra transcript embedding failed for assetId=asset-1: provider_failed",
      {
        mastra: {
          runId: "embeddings-run-1",
          status: "failed",
          reason: "provider_failed",
          retryable: true,
        },
      },
    ])
    const embeddingsFailureCall = updateStepStatusMock.mock.calls.find(
      ([, step, status]) => step === "embeddings" && status === "failed",
    )
    expect(JSON.stringify(embeddingsFailureCall)).not.toContain("hello world")
  })

  it("fails the chapters step and job when chapter extraction returns no usable output", async () => {
    transcribeMock.mockResolvedValue({
      text: "hello world",
      segments: [],
      language: "en",
      artifactKeys: ["transcript", "subtitles"],
    })
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
    )
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
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
    )
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
    mastraSubtitleEnrichmentMock.mockResolvedValue(
      subtitleSuccess([{ lang: "en", status: "completed" }]),
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
