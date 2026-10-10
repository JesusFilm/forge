import { describe, expect, it } from "vitest"

import { cleanVttText, cropVttCues, parseVtt, serializeVtt } from "./vtt"

describe("subtitle eval VTT", () => {
  it("parses two-part and three-part timestamps, cue ids, notes, and markup", () => {
    const cues = parseVtt(
      `WEBVTT\n\nNOTE language: en\n\nfirst\n00:01.500 --> 00:03.000 align:start\n<b>Hello &amp; welcome</b>\n\n00:00:04.000 --> 00:00:06.250\nSecond line\ncontinues\n`,
    )

    expect(cues).toEqual([
      { start: 1.5, end: 3, text: "Hello & welcome" },
      { start: 4, end: 6.25, text: "Second line\ncontinues" },
    ])
  })

  it("crops overlapping cues and serializes deterministic WebVTT", () => {
    const cropped = cropVttCues(
      [
        { start: 8, end: 12, text: "before" },
        { start: 12, end: 16, text: "inside" },
        { start: 18, end: 22, text: "after" },
      ],
      10,
      20,
    )

    expect(cropped).toEqual([
      { start: 10, end: 12, text: "before" },
      { start: 12, end: 16, text: "inside" },
      { start: 18, end: 20, text: "after" },
    ])
    expect(serializeVtt(cropped)).toContain(
      "00:00:10.000 --> 00:00:12.000\nbefore",
    )
  })

  it("removes display markup without dropping inner text", () => {
    expect(cleanVttText("<v Mary><c.gold>Good</c> news</v>&lrm;")).toBe(
      "Good news",
    )
  })

  it("skips empty human-reference cues but can preserve them for output validation", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n\n"

    expect(parseVtt(vtt)).toEqual([])
    expect(parseVtt(vtt, { emptyCue: "preserve" })).toEqual([
      { start: 1, end: 2, text: "" },
    ])
  })
})
