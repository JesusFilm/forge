import { describe, expect, it } from "vitest"

import {
  focusFromSegments,
  muxPlaybackId,
  shotFrameUrls,
} from "./intro-smart-crop"

const seg = (shotId: string, x: number, mode = "speaker") =>
  ({
    shotId,
    canonicalStart: 0,
    canonicalEnd: 1,
    mode,
    primarySubject: "woman",
    secondarySubjects: [],
    avoidCutting: [],
    confidence: 0.9,
    cropKeyframes: [
      { progress: 0, x, y: 0, width: 608, height: 1080 },
      { progress: 1, x: x + 40, y: 0, width: 608, height: 1080 },
    ],
  }) as never

describe("intro smart crop", () => {
  it("reads the playback id from a Mux rendition URL only", () => {
    expect(muxPlaybackId("https://stream.mux.com/AbC123/1080p.mp4")).toBe(
      "AbC123",
    )
    expect(muxPlaybackId("https://example.com/AbC123/1080p.mp4")).toBeNull()
  })

  it("asks for three allowlisted thumbnails inside each shot", () => {
    const urls = shotFrameUrls("AbC123", { startSec: 10, lengthSec: 4 })
    expect(urls).toHaveLength(3)
    expect(urls[0]).toBe(
      "https://image.mux.com/AbC123/thumbnail.jpg?time=10.80&width=640",
    )
  })

  it("takes the planned window's centre per shot, centre for a missing or fallback shot", () => {
    const focus = focusFromSegments(
      [seg("shot_0", 1100), seg("shot_2", 0, "center_fallback")],
      3,
      1920,
    )
    // (1100 + 304 + 20) / 1920
    expect(focus[0]).toBeCloseTo(0.742, 3)
    expect(focus[1]).toBe(0.5)
    expect(focus[2]).toBe(0.5)
  })
})
