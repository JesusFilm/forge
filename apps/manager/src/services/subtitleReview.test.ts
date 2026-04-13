import { afterEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const { getJobMock, readArtifactMock, updateJobMock, writeArtifactMock } =
  vi.hoisted(() => ({
    getJobMock: vi.fn(),
    readArtifactMock: vi.fn(),
    updateJobMock: vi.fn(),
    writeArtifactMock: vi.fn(),
  }))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
  updateJob: updateJobMock,
}))

vi.mock("@/services/storage", () => ({
  readArtifact: readArtifactMock,
  writeArtifact: writeArtifactMock,
}))

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    languages: ["fr"],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-04-12T11:00:00.000Z",
    updatedAt: "2026-04-12T11:00:00.000Z",
    artifacts: {
      "subtitles-fr": { kind: "downloadable" },
    },
    steps: [],
    errors: [],
    ...overrides,
  }
}

const sampleVtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
Bonjour
`

const reviewedVtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
Salut
`

describe("subtitle review service", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("creates a launch session without persisting the raw launch code", async () => {
    vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "https://subtitles.forge.test")
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"))
    getJobMock.mockResolvedValue(buildJob())
    readArtifactMock.mockResolvedValue(Buffer.from(sampleVtt))
    updateJobMock.mockResolvedValue(buildJob())

    const { createSubtitleReviewSession } =
      await import("@/services/subtitleReview")

    const result = await createSubtitleReviewSession({
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      actorId: "user-1",
    })

    const url = new URL(result.editorUrl)
    const launchCode = url.searchParams.get("launch")
    expect(url.origin).toBe("https://subtitles.forge.test")
    expect(url.searchParams.get("jobId")).toBe("job-1")
    expect(launchCode).toBeTruthy()
    expect(result.editorUrl).not.toContain("token")
    expect(JSON.stringify(updateJobMock.mock.calls[0]?.[1])).not.toContain(
      launchCode,
    )
    expect(updateJobMock.mock.calls[0]?.[1]).toEqual({
      artifacts: expect.objectContaining({
        subtitleReviews: {
          kind: "metadata",
          data: expect.objectContaining({
            launchSessions: [
              expect.objectContaining({
                sourceArtifactKey: "subtitles-fr",
                targetLanguage: "fr",
                baseArtifactKey: "subtitles-fr",
                actorId: "user-1",
              }),
            ],
          }),
        },
      }),
    })
  })

  it("exchanges a stored launch code once and returns an edit token", async () => {
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"))

    const { hashSubtitleReviewLaunchCode, verifySubtitleReviewToken } =
      await import("@/lib/subtitle-review-session")
    const job = buildJob({
      artifacts: {
        "subtitles-fr": { kind: "downloadable" },
        subtitleReviews: {
          kind: "metadata",
          data: {
            revisions: [],
            launchSessions: [
              {
                nonceHash: hashSubtitleReviewLaunchCode("launch-code"),
                sourceArtifactKey: "subtitles-fr",
                targetLanguage: "fr",
                baseArtifactKey: "subtitles-fr",
                baseFingerprint: "base-fingerprint",
                actorId: "user-1",
                createdAt: "2026-04-12T11:59:00.000Z",
                expiresAt: "2026-04-12T12:05:00.000Z",
              },
            ],
            updatedAt: "2026-04-12T11:59:00.000Z",
          },
        },
      },
    })
    getJobMock.mockResolvedValue(job)
    updateJobMock.mockResolvedValue(job)

    const { exchangeSubtitleReviewLaunchCode } =
      await import("@/services/subtitleReview")

    const result = await exchangeSubtitleReviewLaunchCode({
      jobId: "job-1",
      launchCode: "launch-code",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      await expect(
        verifySubtitleReviewToken(result.editToken),
      ).resolves.toEqual(
        expect.objectContaining({
          jobId: "job-1",
          sourceArtifactKey: "subtitles-fr",
        }),
      )
    }
    expect(updateJobMock.mock.calls[0]?.[1]).toEqual({
      artifacts: expect.objectContaining({
        subtitleReviews: expect.objectContaining({
          kind: "metadata",
          data: expect.objectContaining({
            launchSessions: [
              expect.objectContaining({
                consumedAt: "2026-04-12T12:00:00.000Z",
              }),
            ],
          }),
        }),
      }),
    })
  })

  it("rate-limits repeated launch-code exchange attempts per job", async () => {
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"))
    getJobMock.mockResolvedValue(
      buildJob({
        id: "job-rate-limited",
        artifacts: {
          "subtitles-fr": { kind: "downloadable" },
          subtitleReviews: {
            kind: "metadata",
            data: {
              revisions: [],
              launchSessions: [],
              updatedAt: "2026-04-12T11:59:00.000Z",
            },
          },
        },
      }),
    )

    const { exchangeSubtitleReviewLaunchCode } =
      await import("@/services/subtitleReview")

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        exchangeSubtitleReviewLaunchCode({
          jobId: "job-rate-limited",
          launchCode: `bad-code-${attempt}`,
        }),
      ).resolves.toEqual({ ok: false, reason: "invalid_launch" })
    }

    await expect(
      exchangeSubtitleReviewLaunchCode({
        jobId: "job-rate-limited",
        launchCode: "one-too-many",
      }),
    ).resolves.toEqual({ ok: false, reason: "rate_limited" })
  })

  it("bootstraps the editor with the token base VTT and playback id", async () => {
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"))

    const { signSubtitleReviewToken } =
      await import("@/lib/subtitle-review-session")
    const editToken = await signSubtitleReviewToken({
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint: "base-fingerprint",
      actorId: "user-1",
      expiresAt: "2026-04-12T12:15:00.000Z",
    })
    getJobMock.mockResolvedValue(buildJob())
    readArtifactMock.mockResolvedValue(Buffer.from(sampleVtt))

    const { bootstrapSubtitleReviewSession } =
      await import("@/services/subtitleReview")

    await expect(
      bootstrapSubtitleReviewSession({ jobId: "job-1", editToken }),
    ).resolves.toEqual({
      ok: true,
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint: "base-fingerprint",
      vtt: sampleVtt,
      media: {
        muxPlaybackId: "playback-1",
        muxAssetId: "asset-1",
      },
      returnUrl: "/dashboard/jobs/job-1",
    })
  })

  it("bootstraps with the latest reviewed revision when one exists", async () => {
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"))

    const { fingerprintSubtitleVtt } = await import("@/lib/subtitle-review")
    const { signSubtitleReviewToken } =
      await import("@/lib/subtitle-review-session")
    const baseFingerprint = fingerprintSubtitleVtt(sampleVtt)
    const reviewedFingerprint = fingerprintSubtitleVtt(reviewedVtt)
    const editToken = await signSubtitleReviewToken({
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint,
      actorId: "user-1",
      expiresAt: "2026-04-12T12:15:00.000Z",
    })
    getJobMock.mockResolvedValue(
      buildJob({
        artifacts: {
          "subtitles-fr": { kind: "downloadable" },
          "subtitles-fr-reviewed-r0001": { kind: "downloadable" },
          subtitleReviews: {
            kind: "metadata",
            data: {
              revisions: [
                {
                  artifactKey: "subtitles-fr-reviewed-r0001",
                  sourceArtifactKey: "subtitles-fr",
                  targetLanguage: "fr",
                  revision: 1,
                  baseFingerprint,
                  contentFingerprint: reviewedFingerprint,
                  clientSaveId: "save-1",
                  actorId: "user-2",
                  createdAt: "2026-04-12T12:05:00.000Z",
                },
              ],
              launchSessions: [],
              updatedAt: "2026-04-12T12:05:00.000Z",
            },
          },
        },
      }),
    )
    readArtifactMock.mockImplementation(
      (_assetId: string, artifactType: string) =>
        Promise.resolve(
          Buffer.from(
            artifactType === "subtitles-fr-reviewed-r0001"
              ? reviewedVtt
              : sampleVtt,
          ),
        ),
    )

    const { bootstrapSubtitleReviewSession } =
      await import("@/services/subtitleReview")

    await expect(
      bootstrapSubtitleReviewSession({ jobId: "job-1", editToken }),
    ).resolves.toEqual({
      ok: true,
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr-reviewed-r0001",
      baseFingerprint: reviewedFingerprint,
      vtt: reviewedVtt,
      media: {
        muxPlaybackId: "playback-1",
        muxAssetId: "asset-1",
      },
      returnUrl: "/dashboard/jobs/job-1",
    })
    expect(readArtifactMock).toHaveBeenCalledWith(
      "asset-1",
      "subtitles-fr-reviewed-r0001",
      "vtt",
    )
  })

  it("saves a reviewed VTT as a new downloadable revision artifact", async () => {
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"))

    const { fingerprintSubtitleVtt } = await import("@/lib/subtitle-review")
    const { signSubtitleReviewToken } =
      await import("@/lib/subtitle-review-session")
    const baseFingerprint = fingerprintSubtitleVtt(sampleVtt)
    const editToken = await signSubtitleReviewToken({
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint,
      actorId: "user-1",
      expiresAt: "2026-04-12T12:15:00.000Z",
    })
    getJobMock.mockResolvedValue(buildJob())
    writeArtifactMock.mockResolvedValue(
      "asset-1/subtitles-fr-reviewed-r0001.vtt",
    )
    updateJobMock.mockResolvedValue(buildJob())

    const { saveSubtitleReviewRevision } =
      await import("@/services/subtitleReview")

    const result = await saveSubtitleReviewRevision({
      jobId: "job-1",
      editToken,
      baseArtifactFingerprint: baseFingerprint,
      vtt: sampleVtt.replace("Bonjour", "Salut"),
      clientSaveId: "save-1",
    })

    expect(result).toEqual({
      ok: true,
      status: "saved",
      jobId: "job-1",
      artifactKey: "subtitles-fr-reviewed-r0001",
      reviewedArtifactKey: "subtitles-fr-reviewed-r0001",
      revision: 1,
      contentFingerprint: fingerprintSubtitleVtt(
        sampleVtt.replace("Bonjour", "Salut"),
      ),
      baseArtifactFingerprint: baseFingerprint,
      savedAt: "2026-04-12T12:00:00.000Z",
    })
    expect(writeArtifactMock).toHaveBeenCalledWith({
      assetId: "asset-1",
      artifactType: "subtitles-fr-reviewed-r0001",
      ext: "vtt",
      body: sampleVtt.replace("Bonjour", "Salut"),
      contentType: "text/vtt; charset=utf-8",
    })
    expect(updateJobMock.mock.calls[0]?.[1]).toEqual({
      artifacts: expect.objectContaining({
        "subtitles-fr-reviewed-r0001": { kind: "downloadable" },
        subtitleReviews: {
          kind: "metadata",
          data: expect.objectContaining({
            revisions: [
              expect.objectContaining({
                artifactKey: "subtitles-fr-reviewed-r0001",
                sourceArtifactKey: "subtitles-fr",
                revision: 1,
                clientSaveId: "save-1",
              }),
            ],
          }),
        },
      }),
    })
  })

  it("does not rewrite storage for an idempotent duplicate save", async () => {
    vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"))

    const { fingerprintSubtitleVtt } = await import("@/lib/subtitle-review")
    const { signSubtitleReviewToken } =
      await import("@/lib/subtitle-review-session")
    const contentFingerprint = fingerprintSubtitleVtt(sampleVtt)
    const editToken = await signSubtitleReviewToken({
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      baseArtifactKey: "subtitles-fr",
      baseFingerprint: contentFingerprint,
      actorId: "user-1",
      expiresAt: "2026-04-12T12:15:00.000Z",
    })
    getJobMock.mockResolvedValue(
      buildJob({
        artifacts: {
          "subtitles-fr": { kind: "downloadable" },
          "subtitles-fr-reviewed-r0001": { kind: "downloadable" },
          subtitleReviews: {
            kind: "metadata",
            data: {
              revisions: [
                {
                  artifactKey: "subtitles-fr-reviewed-r0001",
                  sourceArtifactKey: "subtitles-fr",
                  targetLanguage: "fr",
                  revision: 1,
                  baseFingerprint: contentFingerprint,
                  contentFingerprint,
                  clientSaveId: "save-1",
                  actorId: "user-1",
                  createdAt: "2026-04-12T11:59:00.000Z",
                },
              ],
              launchSessions: [],
              updatedAt: "2026-04-12T11:59:00.000Z",
            },
          },
        },
      }),
    )

    const { saveSubtitleReviewRevision } =
      await import("@/services/subtitleReview")

    await expect(
      saveSubtitleReviewRevision({
        jobId: "job-1",
        editToken,
        baseArtifactFingerprint: contentFingerprint,
        vtt: sampleVtt,
        clientSaveId: "save-1",
      }),
    ).resolves.toEqual({
      ok: true,
      status: "duplicate",
      jobId: "job-1",
      artifactKey: "subtitles-fr-reviewed-r0001",
      reviewedArtifactKey: "subtitles-fr-reviewed-r0001",
      revision: 1,
      contentFingerprint,
      baseArtifactFingerprint: contentFingerprint,
      savedAt: "2026-04-12T11:59:00.000Z",
    })
    expect(writeArtifactMock).not.toHaveBeenCalled()
    expect(updateJobMock).not.toHaveBeenCalled()
  })
})
