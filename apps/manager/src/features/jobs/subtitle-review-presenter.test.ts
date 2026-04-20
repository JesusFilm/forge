import { describe, expect, it } from "vitest"
import { getPresentedSubtitleReviews } from "@/features/jobs/subtitle-review-presenter"
import type { JobRecord } from "@/types/job"

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    languages: ["es", "fr"],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-04-12T11:00:00.000Z",
    updatedAt: "2026-04-12T11:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

describe("subtitle review presenter", () => {
  it("presents generated subtitle artifacts with latest review state", () => {
    const reviews = getPresentedSubtitleReviews(
      buildJob({
        artifacts: {
          "translation-fr": { kind: "downloadable" },
          "subtitles-fr": { kind: "downloadable" },
          "subtitles-es": { kind: "downloadable" },
          "subtitles-fr-reviewed-r0001": { kind: "downloadable" },
          "subtitles-fr-reviewed-r0002": { kind: "downloadable" },
          subtitleReviews: {
            kind: "metadata",
            data: {
              revisions: [
                {
                  artifactKey: "subtitles-fr-reviewed-r0001",
                  sourceArtifactKey: "subtitles-fr",
                  targetLanguage: "fr",
                  revision: 1,
                  baseFingerprint: "base-1",
                  contentFingerprint: "content-1",
                  clientSaveId: "save-1",
                  actorId: "user-1",
                  createdAt: "2026-04-12T12:00:00.000Z",
                },
                {
                  artifactKey: "subtitles-fr-reviewed-r0002",
                  sourceArtifactKey: "subtitles-fr",
                  targetLanguage: "fr",
                  revision: 2,
                  baseFingerprint: "base-2",
                  contentFingerprint: "content-2",
                  clientSaveId: "save-2",
                  actorId: "user-1",
                  createdAt: "2026-04-12T13:00:00.000Z",
                },
              ],
              launchSessions: [],
              updatedAt: "2026-04-12T13:00:00.000Z",
            },
          },
        },
      }),
    )

    expect(reviews).toEqual([
      {
        sourceArtifactKey: "subtitles-es",
        targetLanguage: "es",
        latestRevision: undefined,
        latestReviewArtifactKey: undefined,
        latestReviewedAt: undefined,
      },
      {
        sourceArtifactKey: "subtitles-fr",
        targetLanguage: "fr",
        latestRevision: 2,
        latestReviewArtifactKey: "subtitles-fr-reviewed-r0002",
        latestReviewedAt: "2026-04-12T13:00:00.000Z",
      },
    ])
  })
})
