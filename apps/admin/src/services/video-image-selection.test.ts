import { describe, expect, it } from "vitest"
import {
  bestVideoImageUrl,
  sortVideoImagesByDisplayPreference,
} from "./video-image-selection"

describe("video image selection", () => {
  it("prefers cinematic rows over still rows regardless of input order", () => {
    const rows = sortVideoImagesByDisplayPreference([
      {
        id: "still",
        videoStill: "https://cdn.example/still.jpg",
        thumbnail: "https://cdn.example/thumb.jpg",
        mobileCinematicHigh: null,
      },
      {
        id: "cinematic",
        mobileCinematicHigh: "https://cdn.example/cinematic.jpg",
        videoStill: null,
        thumbnail: null,
      },
    ])

    expect(rows.map((row) => row.id)).toEqual(["cinematic", "still"])
  })

  it("uses a stable id tiebreaker for equal image quality", () => {
    const rows = sortVideoImagesByDisplayPreference([
      { id: "b", mobileCinematicHigh: "https://cdn.example/b.jpg" },
      { id: "a", mobileCinematicHigh: "https://cdn.example/a.jpg" },
    ])

    expect(rows.map((row) => row.id)).toEqual(["a", "b"])
  })

  it("resolves the preferred URL inside a selected row", () => {
    expect(
      bestVideoImageUrl({
        mobileCinematicHigh: null,
        mobileCinematicLow: "https://cdn.example/low.jpg",
        videoStill: "https://cdn.example/still.jpg",
        thumbnail: "https://cdn.example/thumb.jpg",
        url: "https://cdn.example/raw.jpg",
      }),
    ).toBe("https://cdn.example/low.jpg")
  })
})
