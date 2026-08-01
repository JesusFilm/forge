import { describe, expect, it } from "vitest"

import { _internal } from "./devotional-render"

describe("devotional render helpers", () => {
  it("formats the authored devotional date instead of the machine clock", () => {
    expect(
      _internal.formatHeaderDate("2026-12-25", {
        months: [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ],
        weekdays: [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ],
      } as never),
    ).toBe("Friday · December 25")
  })

  it("budgets the intro, outro, and every non-video card tail", () => {
    const seconds = _internal.computeBackgroundTimelineSec([
      { kind: "cover", durationSec: 2 },
      { kind: "video", durationSec: 5 },
      { kind: "questions", durationSec: 3 },
    ])

    expect(seconds).toBeCloseTo(17.8)
  })

  it("derives distinct stable output paths for both aspects", () => {
    const devotional = {
      sequence: 4,
      clip: { title: "The Good Shepherd" },
    }
    expect(
      _internal.devotionalVideoOutputPath(
        devotional as never,
        "outputs",
        "portrait",
      ),
    ).toMatch(/the-good-shepherd-seq4\.mp4$/)
    expect(
      _internal.devotionalVideoOutputPath(
        devotional as never,
        "outputs",
        "wide",
      ),
    ).toMatch(/the-good-shepherd-seq4-wide\.mp4$/)
  })
})
