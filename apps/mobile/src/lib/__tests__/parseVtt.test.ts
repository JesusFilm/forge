import { parseVtt } from "../parseVtt"

describe("parseVtt", () => {
  it("parses a well-formed cue with HH:MM:SS.mmm timestamps", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello world`
    expect(parseVtt(vtt)).toEqual([{ start: 1, end: 4, text: "Hello world" }])
  })

  it("parses MM:SS.mmm (2-part) timestamps", () => {
    const vtt = `WEBVTT

01:05.000 --> 01:08.500
Two part`
    const cues = parseVtt(vtt)
    expect(cues).toHaveLength(1)
    expect(cues[0].start).toBeCloseTo(65)
    expect(cues[0].end).toBeCloseTo(68.5)
  })

  it("strips inline tags from cue text", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
<b>Bold</b> and <v Speaker>spoken</v>`
    expect(parseVtt(vtt)[0].text).toBe("Bold and spoken")
  })

  it("ignores cue settings on the end timestamp line", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:05.000 line:50% align:center
Positioned`
    const cue = parseVtt(vtt)[0]
    expect(cue.end).toBe(5)
    expect(cue.text).toBe("Positioned")
  })

  it("joins multi-line cue text with newlines", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Line one
Line two`
    expect(parseVtt(vtt)[0].text).toBe("Line one\nLine two")
  })

  it("parses identically with CRLF line endings", () => {
    const lf = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nText"
    const crlf = lf.replace(/\n/g, "\r\n")
    expect(parseVtt(crlf)).toEqual(parseVtt(lf))
  })

  it("returns an empty array for empty input", () => {
    expect(parseVtt("")).toEqual([])
    expect(parseVtt("WEBVTT\n")).toEqual([])
  })

  it("skips cues with a non-numeric timestamp (would never match the playhead)", () => {
    const vtt = `WEBVTT

xx:yy:zz.zzz --> 00:00:04.000
Bad start`
    expect(parseVtt(vtt)).toEqual([])
  })

  it("drops a cue whose timestamp has an unrecognised part-count (returns NaN, not 0)", () => {
    // A bare single-part number matches neither the HH:MM:SS nor MM:SS branch.
    // It must parse to NaN so the isFinite guard drops it — not 0, which would
    // make the cue flash at the very start of playback.
    const vtt = `WEBVTT

1000 --> 4000
No colons`
    expect(parseVtt(vtt)).toEqual([])
  })

  it("skips zero/negative-duration cues", () => {
    const vtt = `WEBVTT

00:00:04.000 --> 00:00:04.000
Zero length`
    expect(parseVtt(vtt)).toEqual([])
  })

  it("parses multiple consecutive cues", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
First

00:00:01.000 --> 00:00:02.000
Second`
    expect(parseVtt(vtt).map((c) => c.text)).toEqual(["First", "Second"])
  })
})
