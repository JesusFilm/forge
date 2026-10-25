import { describe, expect, it } from "vitest"
import {
  getPresentedMuxSyncComparison,
  getPresentedMuxSyncComparisons,
} from "@/features/jobs/mux-sync-presenter"
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

describe("mux-sync-presenter", () => {
  it("sorts mux sync comparisons by language", () => {
    const job = buildJobRecord({
      artifacts: {
        muxSync: {
          kind: "metadata",
          data: {
            comparisons: [
              {
                artifactKey: "subtitles-fr",
                targetLanguage: "fr",
                muxTargetType: "text_track",
                muxTargetKey: "fr",
                status: "synced",
                explanation: "Synced fr subtitles to Mux",
              },
              {
                artifactKey: "subtitles-en",
                targetLanguage: "en",
                muxTargetType: "text_track",
                muxTargetKey: "en",
                status: "skipped_existing_mux_data",
                explanation: "Mux already has en subtitles",
              },
            ],
            updatedAt: "2026-04-10T12:00:00.000Z",
          },
        },
      },
    })

    expect(
      getPresentedMuxSyncComparisons(job).map((entry) => entry.artifactKey),
    ).toEqual(["subtitles-en", "subtitles-fr"])
  })

  it("returns a single comparison by artifact key", () => {
    const job = buildJobRecord({
      artifacts: {
        muxSync: {
          kind: "metadata",
          data: {
            comparisons: [
              {
                artifactKey: "subtitles-es",
                targetLanguage: "es",
                muxTargetType: "text_track",
                muxTargetKey: "es",
                status: "override_applied",
                explanation: "Replaced existing es subtitles on Mux",
              },
            ],
            updatedAt: "2026-04-10T12:00:00.000Z",
          },
        },
      },
    })

    expect(getPresentedMuxSyncComparison(job, "subtitles-es")).toMatchObject({
      targetLanguage: "es",
      status: "override_applied",
    })
  })
})
