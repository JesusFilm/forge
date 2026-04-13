import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
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

describe("LiveJobDetailHeader", () => {
  it("does not duplicate audio cleanup artifact links in the summary", () => {
    const markup = renderToStaticMarkup(
      React.createElement(LiveJobDetailHeader, {
        job: buildJobRecord({
          artifacts: {
            "original-audio": { kind: "downloadable" },
            "cleaned-audio": { kind: "downloadable" },
          },
        }),
        languageLabelsById: {},
      }),
    )

    expect(markup).not.toContain("Audio review")
    expect(markup).not.toContain("Original audio")
    expect(markup).not.toContain("Cleaned audio")
  })
})
