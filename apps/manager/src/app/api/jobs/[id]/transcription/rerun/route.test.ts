import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateRequestMock,
  afterMock,
  getJobMock,
  markEnrichmentDispatchedMock,
  resolveEnrichmentEngineMock,
  restampEngineMock,
  resetEnrichmentForRerunMock,
  getMuxAssetMock,
  getMuxStaticRenditionSourceUrlMock,
  isAudioCleanupConfiguredMock,
  runVideoEnrichmentMock,
  startMock,
  updateJobMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  afterMock: vi.fn(),
  getJobMock: vi.fn(),
  markEnrichmentDispatchedMock: vi.fn(),
  resolveEnrichmentEngineMock: vi.fn(),
  restampEngineMock: vi.fn(),
  resetEnrichmentForRerunMock: vi.fn(),
  getMuxAssetMock: vi.fn(),
  getMuxStaticRenditionSourceUrlMock: vi.fn(),
  isAudioCleanupConfiguredMock: vi.fn(),
  runVideoEnrichmentMock: vi.fn(),
  startMock: vi.fn(),
  updateJobMock: vi.fn(),
}))

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server")

  return {
    ...actual,
    after: afterMock,
  }
})

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("workflow/api", () => ({
  start: startMock,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
  markEnrichmentDispatched: markEnrichmentDispatchedMock,
  restampEngine: restampEngineMock,
  resetEnrichmentForRerun: resetEnrichmentForRerunMock,
  updateJob: updateJobMock,
}))

vi.mock("@/lib/enrichment-engine", () => ({
  resolveEnrichmentEngine: resolveEnrichmentEngineMock,
}))

vi.mock("@/services/mux", () => ({
  getMuxAsset: getMuxAssetMock,
  getMuxStaticRenditionSourceUrl: getMuxStaticRenditionSourceUrlMock,
}))

vi.mock("@/services/audioCleanup", () => ({
  isAudioCleanupConfigured: isAudioCleanupConfiguredMock,
}))

vi.mock("@/workflows/videoEnrichment", () => ({
  runVideoEnrichment: runVideoEnrichmentMock,
}))

import { POST } from "@/app/api/jobs/[id]/transcription/rerun/route"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"

describe("POST /api/jobs/[id]/transcription/rerun", () => {
  const dispatch = wrapStartSpy(startMock)

  beforeEach(() => {
    vi.clearAllMocks()

    authenticateRequestMock.mockResolvedValue(null)
    afterMock.mockImplementation(async (callback: () => Promise<void>) => {
      await callback()
    })
    runVideoEnrichmentMock.mockResolvedValue(undefined)
    resolveEnrichmentEngineMock.mockResolvedValue("workflow")
    isAudioCleanupConfiguredMock.mockReturnValue(true)
    getMuxAssetMock.mockResolvedValue({
      assetId: "mux-source-1",
      playbackId: "play-source-1",
      publicPlaybackId: "play-source-1",
      status: "ready",
      duration: 123,
      staticRenditions: [
        {
          name: "480p.mp4",
          status: "ready",
          width: 854,
          height: 480,
          type: "advanced",
        },
      ],
    })
    getMuxStaticRenditionSourceUrlMock.mockReturnValue(
      "https://stream.mux.com/play-source-1/480p.mp4",
    )
    dispatch.mockReturnValue({
      assetId: "mux-1",
      transcript: "Transcript",
      language: "en",
      chapters: [],
      tags: [],
    })
    getJobMock.mockResolvedValue({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["fr"],
      options: {},
      status: "completed",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: {
        transcript: { kind: "downloadable" },
        "transcript-raw": { kind: "downloadable" },
        "transcript-correction-report": { kind: "downloadable" },
        subtitles: { kind: "downloadable" },
        "subtitles-raw": { kind: "downloadable" },
        "subtitles-fr": { kind: "downloadable" },
        "translation-fr": { kind: "downloadable" },
        "subtitle-validation-fr": { kind: "downloadable" },
        chapters: { kind: "downloadable" },
        metadata: { kind: "downloadable" },
        embeddings: { kind: "downloadable" },
        muxSync: {
          kind: "metadata",
          data: {
            comparisons: [],
            updatedAt: "2026-04-11T12:00:00.000Z",
          },
        },
        transcriptionRouting: {
          kind: "metadata",
          data: {
            sourceInputUrl: "https://cdn.example.com/video.mp4",
            finalProvider: "mux",
            finalSourceLanguageCode: "en",
            attempts: [],
          },
        },
      },
      steps: [
        { name: "transcription", status: "completed", retries: 0 },
        { name: "structured_transcript", status: "completed", retries: 0 },
        { name: "translation", status: "completed", retries: 0 },
        { name: "chapters", status: "completed", retries: 0 },
        { name: "metadata", status: "completed", retries: 0 },
        { name: "embeddings", status: "completed", retries: 0 },
        { name: "mux_upload", status: "completed", retries: 0 },
        { name: "audio_cleanup", status: "completed", retries: 0 },
      ],
      errors: [],
    })
    updateJobMock.mockImplementation(async (_id, updates) => ({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["fr"],
      options: {},
      status: updates.status ?? "pending",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: updates.artifacts ?? {},
      steps: updates.steps ?? [],
      errors: updates.errors ?? [],
      currentStep: updates.currentStep,
    }))
    resetEnrichmentForRerunMock.mockImplementation(async (id, artifacts) => {
      const job = await getJobMock(id)
      return {
        ...job,
        status: "pending",
        artifacts,
        steps: [],
        errors: [],
        options: {},
      }
    })
    restampEngineMock.mockImplementation(async (id, engine) => {
      const job = await getJobMock(id)
      return {
        ...job,
        status: "pending",
        artifacts: resetEnrichmentForRerunMock.mock.calls.at(-1)?.[1] ?? {},
        options: { ...job.options, engine },
      }
    })
  })

  it("accepts a forced rerun, clears source declarations, and restarts the workflow from transcription", async () => {
    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/transcription/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "elevenlabs" }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(202)
    expect(resetEnrichmentForRerunMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        transcriptionRouting: {
          kind: "metadata",
          data: expect.objectContaining({
            sourceInputUrl: "https://cdn.example.com/video.mp4",
            currentAttemptId: expect.any(String),
            attempts: [
              expect.objectContaining({
                requestedProvider: "elevenlabs",
                resolvedProvider: "elevenlabs",
                status: "running",
              }),
            ],
          }),
        },
      }),
    )
    const updatedArtifacts = resetEnrichmentForRerunMock.mock
      .calls[0]?.[1] as Record<string, unknown>
    expect(updatedArtifacts).not.toHaveProperty("transcript")
    expect(updatedArtifacts).not.toHaveProperty("subtitles")
    expect(updatedArtifacts).not.toHaveProperty("subtitlesVtt")
    expect(updatedArtifacts).not.toHaveProperty("chapters")
    expect(updatedArtifacts).not.toHaveProperty("transcript-raw")
    expect(updatedArtifacts).not.toHaveProperty("subtitles-raw")
    expect(updatedArtifacts).not.toHaveProperty("transcript-correction-report")
    expect(updatedArtifacts).not.toHaveProperty("metadata")
    expect(updatedArtifacts).not.toHaveProperty("embeddings")
    expect(updatedArtifacts).not.toHaveProperty("muxSync")
    expect(updatedArtifacts).not.toHaveProperty("subtitles-fr")
    expect(updatedArtifacts).not.toHaveProperty("translation-fr")
    expect(updatedArtifacts).not.toHaveProperty("subtitle-validation-fr")
    expect(updatedArtifacts).not.toHaveProperty(
      "transcriptionRouting.data.finalProvider",
    )
    expect(updatedArtifacts).not.toHaveProperty(
      "transcriptionRouting.data.finalSourceLanguageCode",
    )
    expect(updatedArtifacts).not.toHaveProperty(
      "transcriptionRouting.data.fallbackReason",
    )

    dispatch.expectDispatched(runVideoEnrichment, [
      expect.objectContaining({
        jobId: "job-1",
        assetId: "mux-1",
        muxAssetId: "mux-1",
        initialArtifacts: expect.objectContaining({
          transcriptionRouting: expect.any(Object),
        }),
        requestedTranscriptionProvider: "elevenlabs",
        runAudioCleanup: true,
      }),
    ])
    expect(dispatch.spy).toHaveBeenCalledTimes(1)
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })

  it("returns a failed job payload when workflow dispatch fails", async () => {
    startMock.mockReset()
    startMock.mockRejectedValueOnce(new Error("workflow offline"))
    updateJobMock.mockImplementationOnce(async (_id, updates) => ({
      ...(await getJobMock()),
      ...updates,
    }))

    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/transcription/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "mux" }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to relaunch enrichment workflow.",
      job: expect.objectContaining({
        id: "job-1",
        status: "failed",
      }),
    })
    expect(updateJobMock).toHaveBeenNthCalledWith(
      1,
      "job-1",
      expect.objectContaining({
        status: "failed",
        currentStep: undefined,
      }),
    )
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })

  it("rejects reruns while transcription is already active", async () => {
    getJobMock.mockResolvedValueOnce({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["fr"],
      options: {},
      status: "running",
      currentStep: "transcription",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: {},
      steps: [],
      errors: [],
    })

    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/transcription/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "mux" }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(409)
    expect(updateJobMock).not.toHaveBeenCalled()
    expect(resetEnrichmentForRerunMock).not.toHaveBeenCalled()
    dispatch.expectNotDispatched()
  })

  it("rejects forced ElevenLabs reruns when no original source url is available", async () => {
    getJobMock.mockResolvedValueOnce({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["fr"],
      options: {},
      status: "completed",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: {
        transcriptionRouting: {
          kind: "metadata",
          data: {
            attempts: [],
          },
        },
      },
      steps: [],
      errors: [],
    })

    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/transcription/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "elevenlabs" }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(409)
    dispatch.expectNotDispatched()
  })

  it("recovers a direct Mux static MP4 source for older ElevenLabs reruns", async () => {
    getJobMock.mockResolvedValueOnce({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["fr"],
      options: {},
      status: "completed",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      sourceLanguageCode: "en",
      artifacts: {
        transcript: { kind: "downloadable" },
        subtitles: { kind: "downloadable" },
        transcriptionRouting: {
          kind: "metadata",
          data: {
            attempts: [],
          },
        },
        materialization: {
          kind: "metadata",
          data: {
            mode: "direct_mux_asset_reuse",
            sourceInputType: "mux_asset",
            sourceMuxAssetId: "mux-source-1",
            reusedMuxAssetId: "mux-1",
          },
        },
      },
      steps: [],
      errors: [],
    })

    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/transcription/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "elevenlabs" }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(202)
    expect(getMuxAssetMock).toHaveBeenCalledWith("mux-source-1")
    expect(getMuxStaticRenditionSourceUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "mux-source-1",
        publicPlaybackId: "play-source-1",
      }),
    )
    expect(resetEnrichmentForRerunMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        transcriptionRouting: {
          kind: "metadata",
          data: expect.objectContaining({
            sourceInputUrl: "https://stream.mux.com/play-source-1/480p.mp4",
            sourceInputHost: "stream.mux.com",
            currentAttemptId: expect.any(String),
          }),
        },
      }),
    )
    dispatch.expectDispatched(runVideoEnrichment, [
      expect.objectContaining({
        requestedTranscriptionProvider: "elevenlabs",
        runAudioCleanup: true,
        initialArtifacts: expect.objectContaining({
          transcriptionRouting: expect.objectContaining({
            data: expect.objectContaining({
              sourceInputUrl: "https://stream.mux.com/play-source-1/480p.mp4",
            }),
          }),
        }),
      }),
    ])
  })

  it("rejects forced ElevenLabs reruns when the source language is unresolved", async () => {
    getJobMock.mockResolvedValueOnce({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["fr"],
      options: {},
      status: "completed",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      sourceLanguageCode: "auto",
      artifacts: {
        transcriptionRouting: {
          kind: "metadata",
          data: {
            sourceInputUrl: "https://cdn.example.com/video.mp4",
            attempts: [],
          },
        },
      },
      steps: [],
      errors: [],
    })

    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/transcription/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "elevenlabs" }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(409)
    expect(updateJobMock).not.toHaveBeenCalled()
    expect(resetEnrichmentForRerunMock).not.toHaveBeenCalled()
    dispatch.expectNotDispatched()
  })

  it("rejects forced ElevenLabs reruns when the source language is unsupported", async () => {
    getJobMock.mockResolvedValueOnce({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["fr"],
      options: {},
      status: "completed",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      sourceLanguageCode: "tlh",
      artifacts: {
        transcriptionRouting: {
          kind: "metadata",
          data: {
            sourceInputUrl: "https://cdn.example.com/video.mp4",
            attempts: [],
          },
        },
      },
      steps: [],
      errors: [],
    })

    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/transcription/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "elevenlabs" }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(409)
    expect(updateJobMock).not.toHaveBeenCalled()
    expect(resetEnrichmentForRerunMock).not.toHaveBeenCalled()
    dispatch.expectNotDispatched()
  })

  it("returns 400 for invalid JSON", async () => {
    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/transcription/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-valid",
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(400)
    expect(updateJobMock).not.toHaveBeenCalled()
    expect(resetEnrichmentForRerunMock).not.toHaveBeenCalled()
    dispatch.expectNotDispatched()
  })
})
