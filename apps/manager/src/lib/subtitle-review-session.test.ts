import { afterEach, describe, expect, it, vi } from "vitest"

describe("subtitle review session helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.resetModules()
  })

  it("signs and verifies short-lived edit tokens for the intended job and source", async () => {
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"))

    const { signSubtitleReviewToken, verifySubtitleReviewToken } =
      await import("@/lib/subtitle-review-session")
    const token = await signSubtitleReviewToken({
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint: "base-fingerprint",
      actorId: "user-1",
      expiresAt: "2026-04-12T12:15:00.000Z",
    })

    expect(await verifySubtitleReviewToken(token)).toEqual(
      expect.objectContaining({
        jobId: "job-1",
        sourceArtifactKey: "subtitles-fr",
        targetLanguage: "fr",
      }),
    )
  })

  it("rejects expired or tampered edit tokens", async () => {
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T12:20:00.000Z"))

    const { signSubtitleReviewToken, verifySubtitleReviewToken } =
      await import("@/lib/subtitle-review-session")
    const token = await signSubtitleReviewToken({
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint: "base-fingerprint",
      actorId: "user-1",
      expiresAt: "2026-04-12T12:15:00.000Z",
    })

    await expect(verifySubtitleReviewToken(token)).resolves.toBeNull()
    await expect(
      verifySubtitleReviewToken(`${token.slice(0, -3)}bad`),
    ).resolves.toBeNull()
  })

  it("builds editor launch urls that carry only a launch code, never the edit token", async () => {
    vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "https://subtitles.forge.test")
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")

    const { buildSubtitleEditorLaunchUrl } =
      await import("@/lib/subtitle-review-session")

    const url = buildSubtitleEditorLaunchUrl({
      jobId: "job-1",
      launchCode: "launch-code",
    })

    expect(url).toBe(
      "https://subtitles.forge.test/edit?jobId=job-1&launch=launch-code",
    )
    expect(url).not.toContain("token")
  })

  it("allows only exact configured subtitle editor origins", async () => {
    vi.stubEnv(
      "SUBTITLE_EDITOR_ALLOWED_ORIGINS",
      "https://subtitles.forge.test, http://localhost:3004",
    )

    const { isAllowedSubtitleEditorOrigin } =
      await import("@/lib/subtitle-review-session")

    expect(isAllowedSubtitleEditorOrigin("https://subtitles.forge.test")).toBe(
      true,
    )
    expect(isAllowedSubtitleEditorOrigin("http://localhost:3004")).toBe(true)
    expect(
      isAllowedSubtitleEditorOrigin("https://evil-subtitles.forge.test"),
    ).toBe(false)
    expect(isAllowedSubtitleEditorOrigin(null)).toBe(false)
  })

  it("reports missing subtitle review configuration", async () => {
    vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "")
    vi.stubEnv("SUBTITLE_EDITOR_ALLOWED_ORIGINS", "")
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "")

    const { getSubtitleReviewConfiguration } =
      await import("@/lib/subtitle-review-session")

    expect(getSubtitleReviewConfiguration()).toEqual({
      ok: false,
      missing: [
        "SUBTITLE_EDITOR_PUBLIC_URL",
        "SUBTITLE_EDITOR_ALLOWED_ORIGINS",
        "SUBTITLE_REVIEW_SESSION_SECRET",
      ],
    })
  })
})
