import { describe, expect, it } from "vitest"
import type { JobRecord } from "@/types/job"
import { getReviewContextRefreshKey } from "@/features/jobs/review-player/review-context-refresh-key"

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    videoDocumentId: "video-1",
    languages: ["529"],
    sourceLanguageCode: "en",
    options: {},
    status: "running",
    retries: 0,
    createdAt: "2026-04-22T10:00:00.000Z",
    updatedAt: "2026-04-22T10:00:00.000Z",
    artifacts: {},
    steps: [
      {
        name: "embeddings",
        status: "pending",
        retries: 0,
      },
      {
        name: "metadata",
        status: "pending",
        retries: 0,
      },
      {
        name: "mux_upload",
        status: "pending",
        retries: 0,
      },
    ],
    errors: [],
    ...overrides,
  }
}

describe("getReviewContextRefreshKey", () => {
  it("stays stable for unrelated progress-only updates", () => {
    const before = buildJob()
    const after = buildJob({
      updatedAt: "2026-04-22T10:05:00.000Z",
      steps: [
        {
          name: "embeddings",
          status: "running",
          retries: 0,
          startedAt: "2026-04-22T10:04:00.000Z",
        },
        {
          name: "metadata",
          status: "pending",
          retries: 0,
        },
        {
          name: "mux_upload",
          status: "pending",
          retries: 0,
        },
      ],
    })

    expect(getReviewContextRefreshKey(after)).toBe(
      getReviewContextRefreshKey(before),
    )
  })

  it("changes when reviewable artifacts or review steps change", () => {
    const before = buildJob()
    const after = buildJob({
      artifacts: {
        metadata: { kind: "downloadable" },
        "subtitles-fr": { kind: "downloadable" },
      },
      steps: [
        {
          name: "embeddings",
          status: "pending",
          retries: 0,
        },
        {
          name: "metadata",
          status: "completed",
          retries: 0,
          finishedAt: "2026-04-22T10:05:00.000Z",
        },
        {
          name: "mux_upload",
          status: "completed",
          retries: 0,
          finishedAt: "2026-04-22T10:06:00.000Z",
        },
      ],
    })

    expect(getReviewContextRefreshKey(after)).not.toBe(
      getReviewContextRefreshKey(before),
    )
  })

  it("changes when playback identity or terminal status changes", () => {
    const before = buildJob()
    const after = buildJob({
      muxPlaybackId: "playback-2",
      status: "completed",
    })

    expect(getReviewContextRefreshKey(after)).not.toBe(
      getReviewContextRefreshKey(before),
    )
  })
})
