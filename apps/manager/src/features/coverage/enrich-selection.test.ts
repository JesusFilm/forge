import { describe, expect, it } from "vitest"
import {
  getVideoQaSelectionDisabledReason,
  isEnrichActionReady,
  isVideoQaSelectable,
  requiresLanguageSelectionForEnrich,
  resolveEnrichSelectionOutcome,
} from "@/features/coverage/enrich-selection"

describe("enrich-selection", () => {
  it("treats collection summary tiles as not selectable", () => {
    expect(isVideoQaSelectable("video-1")).toBe(true)
    expect(isVideoQaSelectable("collection:series-1")).toBe(false)
  })

  it("explains why collection summary tiles are not selectable", () => {
    expect(getVideoQaSelectionDisabledReason("video-1")).toBeNull()
    expect(getVideoQaSelectionDisabledReason("collection:series-1")).toContain(
      "Collections can't be enriched directly",
    )
  })

  it("requires a selected language before enrichment is ready", () => {
    expect(requiresLanguageSelectionForEnrich(0, 0)).toBe(false)
    expect(requiresLanguageSelectionForEnrich(1, 0)).toBe(true)
    expect(requiresLanguageSelectionForEnrich(1, 1)).toBe(false)

    expect(isEnrichActionReady(0, 0)).toBe(false)
    expect(isEnrichActionReady(1, 0)).toBe(false)
    expect(isEnrichActionReady(1, 1)).toBe(true)
  })

  it("redirects to a single job detail page when all selected videos succeed", () => {
    const outcome = resolveEnrichSelectionOutcome(new Set(["video-1"]), {
      created: 1,
      failed: 0,
      jobs: [{ videoId: "video-1", jobId: "job-1" }],
    })

    expect(outcome).toEqual({
      feedback: null,
      nextSelectedVideoIds: new Set(),
      redirectPath: "/dashboard/jobs/job-1",
    })
  })

  it("keeps only failed selections and shows neutral feedback for partial success", () => {
    const outcome = resolveEnrichSelectionOutcome(
      new Set(["video-1", "video-2"]),
      {
        created: 1,
        failed: 1,
        jobs: [{ videoId: "video-1", jobId: "job-1" }],
        errors: [
          {
            videoId: "video-2",
            error: "No downloadable MP4 source available for QA enrichment",
          },
        ],
      },
    )

    expect(outcome.redirectPath).toBeNull()
    expect(outcome.nextSelectedVideoIds).toEqual(new Set(["video-2"]))
    expect(outcome.feedback).toEqual({
      tone: "neutral",
      message:
        "1 enrichment job created. 1 video skipped: video-2: No downloadable MP4 source available for QA enrichment",
    })
  })

  it("keeps failed selections and shows an error when no jobs are created", () => {
    const outcome = resolveEnrichSelectionOutcome(
      new Set(["video-1", "video-2"]),
      {
        created: 0,
        failed: 2,
        errors: [
          { videoId: "video-1", error: "Video not found" },
          {
            videoId: "video-2",
            error: "No downloadable MP4 source available for QA enrichment",
          },
        ],
      },
    )

    expect(outcome.redirectPath).toBeNull()
    expect(outcome.nextSelectedVideoIds).toEqual(
      new Set(["video-1", "video-2"]),
    )
    expect(outcome.feedback).toEqual({
      tone: "error",
      message:
        "video-1: Video not found; video-2: No downloadable MP4 source available for QA enrichment",
    })
  })
})
