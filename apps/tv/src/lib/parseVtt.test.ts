import { findActiveCue, parseVtt, type VttCue } from "./parseVtt"

describe("parseVtt", () => {
  it("parses well-formed cues", () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "00:00:01.000 --> 00:00:04.000",
      "Hello world",
      "",
      "2",
      "00:00:05.500 --> 00:00:08.000",
      "Second line",
      "",
    ].join("\n")

    expect(parseVtt(vtt)).toEqual<VttCue[]>([
      { start: 1, end: 4, text: "Hello world" },
      { start: 5.5, end: 8, text: "Second line" },
    ])
  })

  it("joins multi-line cue text with a newline", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:03.000",
      "line one",
      "line two",
      "",
    ].join("\n")

    expect(parseVtt(vtt)).toEqual<VttCue[]>([
      { start: 1, end: 3, text: "line one\nline two" },
    ])
  })

  it("ignores trailing cue settings after the end timestamp", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:02.000 --> 00:00:06.000 line:50% position:50%",
      "centered",
      "",
    ].join("\n")

    expect(parseVtt(vtt)).toEqual<VttCue[]>([
      { start: 2, end: 6, text: "centered" },
    ])
  })

  it("parses mm:ss timestamps (no hours component)", () => {
    const vtt = [
      "WEBVTT",
      "",
      "01:02.000 --> 01:05.000",
      "short form",
      "",
    ].join("\n")

    expect(parseVtt(vtt)).toEqual<VttCue[]>([
      { start: 62, end: 65, text: "short form" },
    ])
  })

  describe("inline tag stripping", () => {
    it("strips simple inline tags", () => {
      const vtt = [
        "WEBVTT",
        "",
        "00:00:01.000 --> 00:00:04.000",
        "<b>Bold</b> and <i>italic</i>",
        "",
      ].join("\n")

      expect(parseVtt(vtt)[0].text).toBe("Bold and italic")
    })

    it("strips voice, class, and timing tags", () => {
      const vtt = [
        "WEBVTT",
        "",
        "00:00:01.000 --> 00:00:04.000",
        "<v Speaker><c.loud>Loud</c><00:00:02.000> words",
        "",
      ].join("\n")

      expect(parseVtt(vtt)[0].text).toBe("Loud words")
    })

    it("removes every complete <...> tag, leaving the enclosed text", () => {
      const vtt = [
        "WEBVTT",
        "",
        "00:00:01.000 --> 00:00:04.000",
        "a<b>b<i>c</i></b>d",
        "",
      ].join("\n")

      // The loop-until-stable strip removes all complete tags; only literal
      // text remains, with no residual tag markup.
      const text = parseVtt(vtt)[0].text
      expect(text).toBe("abcd")
      expect(text).not.toContain("<")
    })
  })

  describe("SMPTE-offset normalization", () => {
    it("normalizes a 01:00:00-offset file back to 0:00", () => {
      const vtt = [
        "WEBVTT",
        "",
        "01:00:01.000 --> 01:00:04.000",
        "first cue",
        "",
        "01:00:10.000 --> 01:00:12.000",
        "second cue",
        "",
      ].join("\n")

      expect(parseVtt(vtt)).toEqual<VttCue[]>([
        { start: 1, end: 4, text: "first cue" },
        { start: 10, end: 12, text: "second cue" },
      ])
    })

    it("leaves a media-relative file (first cue < 1h) untouched", () => {
      const vtt = [
        "WEBVTT",
        "",
        "00:00:01.000 --> 00:00:04.000",
        "no offset",
        "",
      ].join("\n")

      expect(parseVtt(vtt)).toEqual<VttCue[]>([
        { start: 1, end: 4, text: "no offset" },
      ])
    })
  })

  describe("malformed input", () => {
    it("drops cues with non-positive duration", () => {
      const vtt = [
        "WEBVTT",
        "",
        "00:00:04.000 --> 00:00:04.000",
        "zero length",
        "",
        "00:00:06.000 --> 00:00:02.000",
        "reversed",
        "",
      ].join("\n")

      expect(parseVtt(vtt)).toEqual<VttCue[]>([])
    })

    it("returns an empty array for content with no cues", () => {
      expect(parseVtt("WEBVTT\n\nNOTE just a comment\n")).toEqual<VttCue[]>([])
      expect(parseVtt("")).toEqual<VttCue[]>([])
    })
  })
})

describe("findActiveCue", () => {
  const cues: VttCue[] = [
    { start: 1, end: 4, text: "first" },
    { start: 5, end: 8, text: "second" },
    { start: 10, end: 14, text: "third" },
  ]

  it("returns the cue active at a given time", () => {
    expect(findActiveCue(cues, 2)?.text).toBe("first")
    expect(findActiveCue(cues, 6)?.text).toBe("second")
    expect(findActiveCue(cues, 13.5)?.text).toBe("third")
  })

  it("returns the cue at its inclusive start boundary", () => {
    expect(findActiveCue(cues, 5)?.text).toBe("second")
  })

  it("returns undefined in a gap between cues", () => {
    expect(findActiveCue(cues, 4.5)).toBeUndefined()
    expect(findActiveCue(cues, 9)).toBeUndefined()
  })

  it("returns undefined before the first and after the last cue", () => {
    expect(findActiveCue(cues, 0)).toBeUndefined()
    expect(findActiveCue(cues, 20)).toBeUndefined()
  })

  it("treats the end boundary as exclusive", () => {
    // Cue ends at 4; t === 4 is no longer active (next cue starts at 5).
    expect(findActiveCue(cues, 4)).toBeUndefined()
  })

  it("returns undefined for an empty cue list", () => {
    expect(findActiveCue([], 1)).toBeUndefined()
  })

  it("finds an earlier, longer cue when a shorter one nested inside it has ended", () => {
    const overlapping: VttCue[] = [
      { start: 0, end: 20, text: "long backdrop" },
      { start: 2, end: 5, text: "short nested" },
    ]
    // At t=10 the short cue (2–5) has ended but the long cue (0–20) is active.
    expect(findActiveCue(overlapping, 10)?.text).toBe("long backdrop")
  })
})
