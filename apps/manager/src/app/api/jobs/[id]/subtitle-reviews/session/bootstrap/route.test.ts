import { beforeEach, describe, expect, it, vi } from "vitest"

const { bootstrapMock } = vi.hoisted(() => ({
  bootstrapMock: vi.fn(),
}))

vi.mock("@/services/subtitleReview", () => ({
  bootstrapSubtitleReviewSession: bootstrapMock,
}))

import { POST } from "@/app/api/jobs/[id]/subtitle-reviews/session/bootstrap/route"

describe("POST /api/jobs/[id]/subtitle-reviews/session/bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv(
      "SUBTITLE_EDITOR_ALLOWED_ORIGINS",
      "https://subtitles.forge.test",
    )
    vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "https://subtitles.forge.test")
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    bootstrapMock.mockResolvedValue({
      ok: true,
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint: "base-fingerprint",
      vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBonjour\n",
      media: {
        muxPlaybackId: "playback-1",
        muxAssetId: "asset-1",
      },
      returnUrl: "/dashboard/jobs/job-1",
    })
  })

  it("returns the bootstrap payload for an allowed origin bearer token", async () => {
    const response = await POST(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/session/bootstrap",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer edit-token",
            Origin: "https://subtitles.forge.test",
          },
        },
      ),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://subtitles.forge.test",
    )
    await expect(response.json()).resolves.toEqual({
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint: "base-fingerprint",
      vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBonjour\n",
      media: {
        muxPlaybackId: "playback-1",
        muxAssetId: "asset-1",
      },
      returnUrl: "/dashboard/jobs/job-1",
    })
  })

  it("rejects missing edit tokens", async () => {
    const response = await POST(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/session/bootstrap",
        {
          method: "POST",
          headers: { Origin: "https://subtitles.forge.test" },
        },
      ),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(401)
    expect(bootstrapMock).not.toHaveBeenCalled()
  })

  it("returns a typed configuration error before bootstrapping", async () => {
    vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "")
    vi.stubEnv("SUBTITLE_EDITOR_ALLOWED_ORIGINS", "")
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "")

    const response = await POST(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/session/bootstrap",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer edit-token",
            Origin: "https://subtitles.forge.test",
          },
        },
      ),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      error: "subtitle_review_not_configured",
      missing: [
        "SUBTITLE_EDITOR_PUBLIC_URL",
        "SUBTITLE_EDITOR_ALLOWED_ORIGINS",
        "SUBTITLE_REVIEW_SESSION_SECRET",
      ],
    })
    expect(bootstrapMock).not.toHaveBeenCalled()
  })
})
