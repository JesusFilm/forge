import { NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { authenticateManagerOverrideRequestMock, createSessionMock } =
  vi.hoisted(() => ({
    authenticateManagerOverrideRequestMock: vi.fn(),
    createSessionMock: vi.fn(),
  }))

vi.mock("@/lib/auth", () => ({
  authenticateManagerOverrideRequest: authenticateManagerOverrideRequestMock,
}))

vi.mock("@/services/subtitleReview", () => ({
  createSubtitleReviewSession: createSessionMock,
}))

import { POST } from "@/app/api/jobs/[id]/subtitle-reviews/session/route"

describe("POST /api/jobs/[id]/subtitle-reviews/session", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "https://subtitles.forge.test")
    vi.stubEnv(
      "SUBTITLE_EDITOR_ALLOWED_ORIGINS",
      "https://subtitles.forge.test",
    )
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    authenticateManagerOverrideRequestMock.mockResolvedValue({
      kind: "session",
      approvedByUserId: "user-1",
    })
    createSessionMock.mockResolvedValue({
      editorUrl: "https://subtitles.forge.test/edit?jobId=job-1&launch=abc",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint: "base-fingerprint",
      expiresAt: "2026-04-12T12:05:00.000Z",
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("creates a no-store subtitle review launch for the authorized manager actor", async () => {
    const response = await POST(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactKey: "subtitles-fr" }),
        },
      ),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    await expect(response.json()).resolves.toEqual({
      editorUrl: "https://subtitles.forge.test/edit?jobId=job-1&launch=abc",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      expiresAt: "2026-04-12T12:05:00.000Z",
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(createSessionMock).toHaveBeenCalledWith({
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      actorId: "user-1",
    })
  })

  it("does not create a launch session when manager authentication fails", async () => {
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      NextResponse.json({ error: "nope" }, { status: 403 }),
    )

    const response = await POST(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactKey: "subtitles-fr" }),
        },
      ),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(403)
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it("returns a typed configuration error before creating a launch session", async () => {
    vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "")
    vi.stubEnv("SUBTITLE_EDITOR_ALLOWED_ORIGINS", "")
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "")

    const response = await POST(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactKey: "subtitles-fr" }),
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
    expect(createSessionMock).not.toHaveBeenCalled()
  })
})
