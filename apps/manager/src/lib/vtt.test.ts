import { afterEach, describe, expect, it, vi } from "vitest"
import { formatVTTTime, parseVTT, parseVTTTime, segmentsToVTT } from "./vtt"

describe("parseVTT", () => {
  it("parses multiple cues", () => {
    const result = parseVTT(`WEBVTT

00:00:00.000 --> 00:00:01.500
Hello world.

00:00:01.500 --> 00:00:03.000
How are you?
`)

    expect(result).toEqual([
      { start: 0, end: 1.5, text: "Hello world." },
      { start: 1.5, end: 3, text: "How are you?" },
    ])
  })

  it("returns an empty array for empty input", () => {
    expect(parseVTT("")).toEqual([])
  })

  it("skips malformed timestamp cues gracefully", () => {
    const result = parseVTT(`WEBVTT

not-a-time --> still-bad
Broken cue

00:00:01.000 --> 00:00:02.000
Good cue
`)

    expect(result).toEqual([{ start: 1, end: 2, text: "Good cue" }])
  })
})

describe("VTT time helpers", () => {
  it("parses VTT time values", () => {
    expect(parseVTTTime("00:01:30.500")).toBe(90.5)
  })

  it("formats VTT time values", () => {
    expect(formatVTTTime(90.5)).toBe("00:01:30.500")
  })
})

describe("segmentsToVTT", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("round-trips parsed segments", () => {
    const segments = [
      { start: 0, end: 1.5, text: "Hello world." },
      { start: 1.5, end: 3, text: "How are you?" },
    ]

    expect(parseVTT(segmentsToVTT(segments))).toEqual(segments)
  })

  it("includes metadata notes", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-01T12:00:00.000Z"))

    const result = segmentsToVTT([{ start: 0, end: 1, text: "Hi" }], {
      language: "ja",
      assetId: "asset-123",
    })

    expect(result).toContain("NOTE language: ja")
    expect(result).toContain("NOTE source: asset-123")
    expect(result).toContain("NOTE generated: 2026-04-01T12:00:00.000Z")
  })
})
