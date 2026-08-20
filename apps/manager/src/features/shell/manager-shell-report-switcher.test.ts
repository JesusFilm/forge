import { afterEach, describe, expect, it, vi } from "vitest"
import {
  REPORT_ROUTE,
  readStoredReportType,
  reportOptions,
  visibleNavItems,
} from "./manager-shell"

describe("Video Pipelines report option", () => {
  it("is present in reportOptions with the requested label and description", () => {
    const option = reportOptions.find(
      (candidate) => candidate.value === "video-pipelines",
    )

    expect(option).toBeDefined()
    expect(option?.label).toBe("Video Pipelines")
    expect(option?.subtitle).toBe(
      "Track the development and status of video production workflows.",
    )
  })

  it("does not change the existing subtitles/audio/meta options", () => {
    const values = reportOptions.map((option) => option.value)
    expect(values).toEqual(["subtitles", "audio", "meta", "video-pipelines"])
  })
})

describe("REPORT_ROUTE", () => {
  it("routes subtitles, audio, and meta to the coverage page", () => {
    expect(REPORT_ROUTE.subtitles).toBe("/dashboard/coverage")
    expect(REPORT_ROUTE.audio).toBe("/dashboard/coverage")
    expect(REPORT_ROUTE.meta).toBe("/dashboard/coverage")
  })

  it("routes video-pipelines to its own page", () => {
    expect(REPORT_ROUTE["video-pipelines"]).toBe("/dashboard/video-pipelines")
  })
})

describe("visibleNavItems", () => {
  it("shows every nav item outside the Video Pipelines route", () => {
    const keys = visibleNavItems("/dashboard/coverage").map((item) => item.key)

    expect(keys).toEqual(["coverage", "jobs", "smart-crop", "shorts", "agents"])
  })

  it("hides Smart Crop, Shorts, and Agents under /dashboard/video-pipelines", () => {
    const keys = visibleNavItems("/dashboard/video-pipelines").map(
      (item) => item.key,
    )

    expect(keys).toEqual(["coverage", "jobs"])
  })

  it("also hides them on the per-day preview sub-route", () => {
    const keys = visibleNavItems(
      "/dashboard/video-pipelines/devotion-2026-08-01/preview",
    ).map((item) => item.key)

    expect(keys).toEqual(["coverage", "jobs"])
  })
})

describe("readStoredReportType", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns 'subtitles' when window is unavailable", () => {
    expect(readStoredReportType()).toBe("subtitles")
  })

  it("returns the stored value when it is 'video-pipelines'", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => "video-pipelines",
      },
    })

    expect(readStoredReportType()).toBe("video-pipelines")
  })

  it("falls back to 'subtitles' for an unrecognized stored value", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => "not-a-real-report-type",
      },
    })

    expect(readStoredReportType()).toBe("subtitles")
  })
})
