import { describe, it, expect } from "vitest"
import { parseVttToText } from "./subtitles"

const SAMPLE_VTT = `WEBVTT
Kind: captions
Language: en

1
00:00:00.000 --> 00:00:03.500
The story begins with a father

2
00:00:03.500 --> 00:00:07.200
who has been away from his family

3
00:00:07.200 --> 00:00:10.800
<v Speaker>for many years.</v>

4
00:00:10.800 --> 00:00:14.000
He returns home seeking forgiveness.`

describe("parseVttToText", () => {
  it("extracts text from VTT content", () => {
    const text = parseVttToText(SAMPLE_VTT)
    expect(text).toBe(
      "The story begins with a father who has been away from his family for many years. He returns home seeking forgiveness.",
    )
  })

  it("strips VTT header and metadata", () => {
    const text = parseVttToText(SAMPLE_VTT)
    expect(text).not.toContain("WEBVTT")
    expect(text).not.toContain("Kind:")
    expect(text).not.toContain("Language:")
  })

  it("strips timestamps", () => {
    const text = parseVttToText(SAMPLE_VTT)
    expect(text).not.toContain("-->")
    expect(text).not.toContain("00:00")
  })

  it("strips inline VTT tags", () => {
    const text = parseVttToText(SAMPLE_VTT)
    expect(text).not.toContain("<v")
    expect(text).not.toContain("</v>")
    expect(text).toContain("for many years.")
  })

  it("handles empty input", () => {
    expect(parseVttToText("")).toBe("")
    expect(parseVttToText("WEBVTT\n\n")).toBe("")
  })

  it("strips multi-line NOTE blocks", () => {
    const vttWithNote = `WEBVTT

NOTE
This is a translator comment
that spans multiple lines

1
00:00:00.000 --> 00:00:05.000
Actual subtitle text here.`

    const text = parseVttToText(vttWithNote)
    expect(text).toBe("Actual subtitle text here.")
    expect(text).not.toContain("translator comment")
    expect(text).not.toContain("multiple lines")
  })

  it("strips single-line NOTE blocks", () => {
    const vttWithNote = `WEBVTT

NOTE This is a single-line note

1
00:00:00.000 --> 00:00:05.000
Content after note.`

    const text = parseVttToText(vttWithNote)
    expect(text).toBe("Content after note.")
  })
})
