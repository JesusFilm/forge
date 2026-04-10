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
    updateJobMock
      .mockResolvedValueOnce({
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
                  status: "override_pending",
                  explanation:
                    "Override requested for fr subtitles. Waiting for Mux confirmation.",
                  canOverride: false,
                },
              ],
              updatedAt: "2026-04-10T12:15:00.000Z",
            },
          },
        },
        steps: [],
        errors: [],
      })
      .mockResolvedValue({
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
        previousReport: expect.objectContaining({
          comparisons: [
            expect.objectContaining({
              artifactKey: "subtitles-fr",
              status: "override_pending",
              canOverride: false,
            }),
          ],
        }),
      }),
    )
    expect(updateJobMock).toHaveBeenNthCalledWith(
      1,
      "job-1",
      expect.objectContaining({
        artifacts: expect.objectContaining({
          muxSync: expect.objectContaining({
            kind: "metadata",
            data: expect.objectContaining({
              comparisons: [
                expect.objectContaining({
                  artifactKey: "subtitles-fr",
                  status: "override_pending",
                }),
              ],
            }),
          }),
        }),
      }),
    )
    expect(updateJobMock).toHaveBeenNthCalledWith(
      2,
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

  it("does not mutate Mux if the pending override state cannot be persisted", async () => {
    updateJobMock.mockReset()
    updateJobMock.mockResolvedValueOnce(null)

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

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: "Failed to persist subtitle override request",
    })
    expect(applySubtitleOverrideMock).not.toHaveBeenCalled()
  })

  it("returns a reconciliation-required state when Mux changes but final persistence fails", async () => {
    updateJobMock.mockReset()
    updateJobMock
      .mockResolvedValueOnce({
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
                  status: "override_pending",
                  explanation:
                    "Override requested for fr subtitles. Waiting for Mux confirmation.",
                  canOverride: false,
                },
              ],
              updatedAt: "2026-04-10T12:15:00.000Z",
            },
          },
        },
        steps: [],
        errors: [],
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
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
                  status: "reconciliation_required",
                  explanation:
                    "Mux subtitles were replaced, but the job report could not be finalized. Re-run the override or reconcile this job manually.",
                  canOverride: true,
                },
              ],
              updatedAt: "2026-04-10T12:31:00.000Z",
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

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error:
        "Subtitle override applied on Mux, but the job report needs reconciliation",
      reconciliationRequired: true,
      job: expect.objectContaining({
        artifacts: expect.objectContaining({
          muxSync: expect.objectContaining({
            data: expect.objectContaining({
              comparisons: [
                expect.objectContaining({
                  status: "reconciliation_required",
                }),
              ],
            }),
          }),
        }),
      }),
    })
  })

  it("records a failed override state when the Mux mutation throws", async () => {
    updateJobMock.mockReset()
    updateJobMock
      .mockResolvedValueOnce({
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
                  status: "override_pending",
                  explanation:
                    "Override requested for fr subtitles. Waiting for Mux confirmation.",
                  canOverride: false,
                },
              ],
              updatedAt: "2026-04-10T12:15:00.000Z",
            },
          },
        },
        steps: [],
        errors: [],
      })
      .mockResolvedValueOnce({
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
                  status: "failed",
                  explanation: "Subtitle override failed: Mux fetch failed",
                  canOverride: true,
                },
              ],
              updatedAt: "2026-04-10T12:16:00.000Z",
            },
          },
        },
        steps: [],
        errors: [],
      })
    applySubtitleOverrideMock.mockRejectedValueOnce(
      new Error("Mux fetch failed"),
    )

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

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: "Mux fetch failed",
      job: expect.objectContaining({
        artifacts: expect.objectContaining({
          muxSync: expect.objectContaining({
            data: expect.objectContaining({
              comparisons: [
                expect.objectContaining({
                  status: "failed",
                }),
              ],
            }),
          }),
        }),
      }),
    })
  })
})
