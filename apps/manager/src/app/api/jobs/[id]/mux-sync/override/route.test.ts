import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  applySubtitleOverrideMock,
  authenticateRequestMock,
  getJobMock,
  updateJobMock,
} = vi.hoisted(() => ({
  applySubtitleOverrideMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
  getJobMock: vi.fn(),
  updateJobMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
  updateJob: updateJobMock,
}))

vi.mock("@/services/mux-sync", () => ({
  applySubtitleOverride: applySubtitleOverrideMock,
}))

import { POST } from "@/app/api/jobs/[id]/mux-sync/override/route"

describe("POST /api/jobs/[id]/mux-sync/override", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    getJobMock.mockReset()
    updateJobMock.mockReset()
    applySubtitleOverrideMock.mockReset()

    authenticateRequestMock.mockResolvedValue(null)
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
        muxSync: {
          kind: "metadata",
          data: {
            comparisons: [
              {
                artifactKey: "subtitles-fr",
                targetLanguage: "fr",
                muxTargetType: "text_track",
                muxTargetKey: "fr",
                status: "skipped_existing_mux_data",
                explanation: "Mux already has fr subtitles",
                muxTrackId: "track-fr",
                canOverride: true,
              },
            ],
            updatedAt: "2026-04-10T12:00:00.000Z",
          },
        },
      },
      steps: [],
      errors: [],
    })
    applySubtitleOverrideMock.mockResolvedValue({
      comparisons: [
        {
          artifactKey: "subtitles-fr",
          targetLanguage: "fr",
          muxTargetType: "text_track",
          muxTargetKey: "fr",
          status: "override_applied",
          explanation: "Replaced existing fr subtitles on Mux",
        },
      ],
      overrideHistory: [
        {
          artifactKey: "subtitles-fr",
          targetLanguage: "fr",
          at: "2026-04-10T12:30:00.000Z",
          action: "override_subtitle_track",
        },
      ],
      updatedAt: "2026-04-10T12:30:00.000Z",
    })
    updateJobMock.mockResolvedValue({
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["fr"],
      options: {},
      status: "completed",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: {},
      steps: [],
      errors: [],
    })
  })

  it("applies an authorized subtitle override and persists the updated report", async () => {
    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/mux-sync/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactKey: "subtitles-fr",
          targetLanguage: "fr",
        }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(200)
    expect(applySubtitleOverrideMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        artifactKey: "subtitles-fr",
        targetLanguage: "fr",
      }),
    )
    expect(updateJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        artifacts: expect.objectContaining({
          muxSync: expect.objectContaining({
            kind: "metadata",
          }),
        }),
      }),
    )
  })

  it("rejects non-overrideable subtitle targets", async () => {
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
        muxSync: {
          kind: "metadata",
          data: {
            comparisons: [
              {
                artifactKey: "subtitles-fr",
                targetLanguage: "fr",
                muxTargetType: "text_track",
                muxTargetKey: "fr",
                status: "synced",
                explanation: "Synced fr subtitles to Mux",
                canOverride: false,
              },
            ],
            updatedAt: "2026-04-10T12:00:00.000Z",
          },
        },
      },
      steps: [],
      errors: [],
    })

    const response = await POST(
      new Request("https://manager.test/api/jobs/job-1/mux-sync/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactKey: "subtitles-fr",
          targetLanguage: "fr",
        }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(409)
    expect(applySubtitleOverrideMock).not.toHaveBeenCalled()
  })
})
