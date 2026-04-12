import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AudioReviewLinks } from "@/features/jobs/audio-review-links"
import { LiveJobDetailHeader } from "@/features/jobs/live-job-detail-header"
import type { JobRecord } from "@/types/job"

function buildJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "play-1",
    languages: [],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-04-10T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

describe("AudioReviewLinks", () => {
  it("renders nothing when there are no audio review artifacts", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AudioReviewLinks, {
        job: buildJobRecord(),
      }),
    )

    expect(markup).toBe("")
  })

  it("renders labeled original and cleaned audio links when both artifacts exist", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AudioReviewLinks, {
        job: buildJobRecord({
          artifacts: {
            "original-audio": { kind: "downloadable" },
            "cleaned-audio": { kind: "downloadable" },
          },
        }),
      }),
    )

    expect(markup).toContain("Audio review")
    expect(markup).toContain("Original audio")
    expect(markup).toContain("Cleaned audio")
    expect(markup).toContain("/api/jobs/job-1/artifacts/original-audio")
    expect(markup).toContain("/api/jobs/job-1/artifacts/cleaned-audio")
    expect(markup).toContain("Listen")
  })

  it("shows a clear missing state when only one artifact exists", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AudioReviewLinks, {
        job: buildJobRecord({
          artifacts: {
            "original-audio": { kind: "downloadable" },
          },
        }),
      }),
    )

    expect(markup).toContain("Original audio")
    expect(markup).toContain("Cleaned audio not available yet.")
    expect(markup).toContain("/api/jobs/job-1/artifacts/original-audio")
  })
})

describe("LiveJobDetailHeader", () => {
  it("includes the audio review section in the job detail summary", () => {
    const markup = renderToStaticMarkup(
      React.createElement(LiveJobDetailHeader, {
        initialJob: buildJobRecord({
          artifacts: {
            "original-audio": { kind: "downloadable" },
            "cleaned-audio": { kind: "downloadable" },
          },
        }),
        languageLabelsById: {},
      }),
    )

    expect(markup).toContain("Audio review")
    expect(markup).toContain("Original audio")
    expect(markup).toContain("Cleaned audio")
  })
})
