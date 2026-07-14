import { describe, expect, it } from "vitest"

import { YouTubeDiscoveryReportSchema } from "./artifacts"

function report(sourceFailureCount: number) {
  return {
    schemaVersion: "1",
    kind: "youtube-ai-christian-discovery",
    reportId: "run-123",
    mastraRunId: "run-123",
    startedAt: "2026-06-08T00:00:00.000Z",
    finishedAt: "2026-06-08T00:00:05.000Z",
    channels: Array.from({ length: 50 }, (_, index) => `channel-${index}`),
    playlists: Array.from({ length: 50 }, (_, index) => `playlist-${index}`),
    queries: Array.from({ length: 20 }, (_, index) => `query-${index}`),
    totals: {
      candidates: 0,
      videos: 0,
      deduped: 0,
      excludedCommentary: 0,
      qualified: 0,
    },
    sourceFailures: Array.from({ length: sourceFailureCount }, (_, index) => ({
      source: `source-${index}`,
      kind: "query",
      code: "upstream_failed",
      message: "timed out",
    })),
    videos: [],
  }
}

describe("YouTubeDiscoveryReportSchema", () => {
  it("accepts every possible failure from a fully populated run", () => {
    expect(YouTubeDiscoveryReportSchema.safeParse(report(120)).success).toBe(
      true,
    )
  })

  it("still rejects failures beyond the bounded run maximum", () => {
    expect(YouTubeDiscoveryReportSchema.safeParse(report(121)).success).toBe(
      false,
    )
  })
})
