import { describe, expect, it } from "vitest"
import { getSourceTitle } from "@/features/jobs/jobs-table-presenter"
import type { JobRecord } from "@/types/job"

function buildJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "playback-1",
    languages: [],
    options: {},
    status: "pending",
    retries: 0,
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

describe("getSourceTitle", () => {
  it("combines collection and media titles when both are present", () => {
    expect(
      getSourceTitle(
        buildJobRecord({
          sourceCollectionTitle: "How Did We Get Here? (Episode 1)",
          sourceMediaTitle: "1.1 Has The Universe Always Existed?",
        }),
      ),
    ).toBe(
      "How Did We Get Here? (Episode 1) — 1.1 Has The Universe Always Existed?",
    )
  })

  it("falls back to the media title when there is no collection title", () => {
    expect(
      getSourceTitle(
        buildJobRecord({
          sourceMediaTitle: "Standalone clip",
        }),
      ),
    ).toBe("Standalone clip")
  })
})
