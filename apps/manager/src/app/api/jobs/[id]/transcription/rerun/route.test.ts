import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateRequestMock,
  afterMock,
  getJobMock,
  runVideoEnrichmentMock,
  updateJobMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  afterMock: vi.fn(),
  getJobMock: vi.fn(),
  runVideoEnrichmentMock: vi.fn(),
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

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
  updateJob: updateJobMock,
}))

vi.mock("@/workflows/videoEnrichment", () => ({
  runVideoEnrichment: runVideoEnrichmentMock,
}))

import { POST } from "@/app/api/jobs/[id]/transcription/rerun/route"

describe("POST /api/jobs/[id]/transcription/rerun", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    afterMock.mockReset()
    getJobMock.mockReset()
    runVideoEnrichmentMock.mockReset()
    updateJobMock.mockReset()

    authenticateRequestMock.mockResolvedValue(null)
    afterMock.mockImplementation(async (callback: () => Promise<void>) => {
      await callback()
    })
    runVideoEnrichmentMock.mockResolvedValue(undefined)
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
        subtitles: { kind: "downloadable" },
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
        { name: "translation", status: "completed", retries: 0 },
        { name: "chapters", status: "completed", retries: 0 },
        { name: "metadata", status: "completed", retries: 0 },
        { name: "embeddings", status: "completed", retries: 0 },
        { name: "mux_upload", status: "completed", retries: 0 },
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
  })

  it("accepts a forced rerun, preserves canonical transcription artifacts, and restarts the workflow from transcription", async () => {
    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/transcription/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "elevenlabs" }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(202)
    expect(updateJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        status: "pending",
        currentStep: undefined,
        completedAt: undefined,
        artifacts: expect.objectContaining({
          transcript: { kind: "downloadable" },
          subtitles: { kind: "downloadable" },
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
        steps: [
          expect.objectContaining({ name: "transcription", status: "pending" }),
          expect.objectContaining({ name: "translation", status: "pending" }),
          expect.objectContaining({ name: "chapters", status: "pending" }),
          expect.objectContaining({ name: "metadata", status: "pending" }),
          expect.objectContaining({ name: "embeddings", status: "pending" }),
          expect.objectContaining({ name: "mux_upload", status: "pending" }),
          expect.objectContaining({
            name: "theology_validation_bible_quotes",
            status: "skipped",
          }),
        ],
      }),
    )
    const updatedArtifacts = updateJobMock.mock.calls[0]?.[1]?.artifacts as {
      [key: string]: unknown
    }
    expect(updatedArtifacts).not.toHaveProperty("chapters")
    expect(updatedArtifacts).not.toHaveProperty("metadata")
    expect(updatedArtifacts).not.toHaveProperty("embeddings")
    expect(updatedArtifacts).not.toHaveProperty("muxSync")
    expect(updatedArtifacts).not.toHaveProperty(
      "transcriptionRouting.data.finalProvider",
    )
    expect(updatedArtifacts).not.toHaveProperty(
      "transcriptionRouting.data.finalSourceLanguageCode",
    )
    expect(updatedArtifacts).not.toHaveProperty(
      "transcriptionRouting.data.fallbackReason",
    )

    expect(updateJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        errors: [],
      }),
    )

    expect(runVideoEnrichmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        assetId: "mux-1",
        muxAssetId: "mux-1",
        initialArtifacts: expect.objectContaining({
          transcriptionRouting: expect.any(Object),
        }),
        requestedTranscriptionProvider: "elevenlabs",
      }),
    )
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
    expect(runVideoEnrichmentMock).not.toHaveBeenCalled()
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
    expect(runVideoEnrichmentMock).not.toHaveBeenCalled()
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
    expect(runVideoEnrichmentMock).not.toHaveBeenCalled()
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
    expect(runVideoEnrichmentMock).not.toHaveBeenCalled()
  })
})
