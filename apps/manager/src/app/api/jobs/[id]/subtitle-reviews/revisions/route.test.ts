import { beforeEach, describe, expect, it, vi } from "vitest"

const { saveRevisionMock } = vi.hoisted(() => ({
  saveRevisionMock: vi.fn(),
}))

vi.mock("@/services/subtitleReview", () => ({
  saveSubtitleReviewRevision: saveRevisionMock,
}))

import { POST } from "@/app/api/jobs/[id]/subtitle-reviews/revisions/route"

describe("POST /api/jobs/[id]/subtitle-reviews/revisions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv(
      "SUBTITLE_EDITOR_ALLOWED_ORIGINS",
      "https://subtitles.forge.test",
    )
    vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "https://subtitles.forge.test")
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    saveRevisionMock.mockResolvedValue({
      ok: true,
      status: "saved",
      jobId: "job-1",
      artifactKey: "subtitles-fr-reviewed-r0001",
      reviewedArtifactKey: "subtitles-fr-reviewed-r0001",
      revision: 1,
      contentFingerprint: "content-fingerprint",
      baseArtifactFingerprint: "base-fingerprint",
      savedAt: "2026-04-12T12:00:00.000Z",
    })
  })

  it("saves a reviewed revision from an allowed editor origin", async () => {
    const response = await POST(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/revisions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer edit-token",
            "Content-Type": "application/json",
            Origin: "https://subtitles.forge.test",
          },
          body: JSON.stringify({
            baseArtifactFingerprint: "base-fingerprint",
            clientSaveId: "save-1",
            vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSalut\n",
          }),
        },
      ),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      status: "saved",
      artifactKey: "subtitles-fr-reviewed-r0001",
      reviewedArtifactKey: "subtitles-fr-reviewed-r0001",
      revision: 1,
      jobId: "job-1",
      contentFingerprint: "content-fingerprint",
      baseArtifactFingerprint: "base-fingerprint",
      savedAt: "2026-04-12T12:00:00.000Z",
    })
    expect(saveRevisionMock).toHaveBeenCalledWith({
      jobId: "job-1",
      editToken: "edit-token",
      baseArtifactFingerprint: "base-fingerprint",
      clientSaveId: "save-1",
      vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSalut\n",
    })
  })

  it("returns conflict when the save base is stale", async () => {
    saveRevisionMock.mockResolvedValue({
      ok: false,
      reason: "stale_base",
      latestArtifactKey: "subtitles-fr-reviewed-r0002",
    })

    const response = await POST(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/revisions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer edit-token",
            "Content-Type": "application/json",
            Origin: "https://subtitles.forge.test",
          },
          body: JSON.stringify({
            clientSaveId: "save-1",
            vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSalut\n",
          }),
        },
      ),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "stale_base",
      latestArtifactKey: "subtitles-fr-reviewed-r0002",
    })
  })
})
