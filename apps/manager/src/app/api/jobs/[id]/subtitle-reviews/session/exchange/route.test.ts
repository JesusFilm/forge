import { beforeEach, describe, expect, it, vi } from "vitest"

const { exchangeMock } = vi.hoisted(() => ({
  exchangeMock: vi.fn(),
}))

vi.mock("@/services/subtitleReview", () => ({
  exchangeSubtitleReviewLaunchCode: exchangeMock,
}))

import {
  OPTIONS,
  POST,
} from "@/app/api/jobs/[id]/subtitle-reviews/session/exchange/route"

describe("POST /api/jobs/[id]/subtitle-reviews/session/exchange", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv(
      "SUBTITLE_EDITOR_ALLOWED_ORIGINS",
      "https://subtitles.forge.test",
    )
    vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "https://subtitles.forge.test")
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    exchangeMock.mockResolvedValue({
      ok: true,
      editToken: "edit-token",
      expiresAt: "2026-04-12T12:30:00.000Z",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint: "base-fingerprint",
    })
  })

  it("exchanges a launch code from an allowed editor origin", async () => {
    const response = await POST(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/session/exchange",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://subtitles.forge.test",
          },
          body: JSON.stringify({ launchCode: "launch-code" }),
        },
      ),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://subtitles.forge.test",
    )
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      editToken: "edit-token",
      expiresAt: "2026-04-12T12:30:00.000Z",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint: "base-fingerprint",
    })
  })

  it("rejects unlisted origins before touching launch state", async () => {
    const response = await POST(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/session/exchange",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://evil.test",
          },
          body: JSON.stringify({ launchCode: "launch-code" }),
        },
      ),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(403)
    expect(exchangeMock).not.toHaveBeenCalled()
  })

  it("answers preflight for allowed editor origins", async () => {
    const response = await OPTIONS(
      new Request(
        "https://manager.test/api/jobs/job-1/subtitle-reviews/session/exchange",
        {
          method: "OPTIONS",
          headers: { Origin: "https://subtitles.forge.test" },
        },
      ),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    )
  })
})
