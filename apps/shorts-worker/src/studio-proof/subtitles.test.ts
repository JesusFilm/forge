import { describe, expect, it } from "vitest"
import { parseSourceVtt } from "./subtitles.js"

describe("canonical source subtitles", () => {
  it("preserves the selected track's exact cue text and half-open timings", () => {
    const bytes = Buffer.from(
      "WEBVTT\n\n00:22.600 --> 00:29.430\nExact source text.\n\n00:29.500 --> 00:41.340\nNext cue.\n",
    )
    expect(parseSourceVtt(bytes, { startMs: 28_600, endMs: 30_600 })).toEqual([
      { startMs: 22_600, endMs: 29_430, text: "Exact source text." },
      { startMs: 29_500, endMs: 41_340, text: "Next cue." },
    ])
    expect(parseSourceVtt(bytes, { startMs: 29_430, endMs: 29_500 })).toEqual(
      [],
    )
  })
  it("blocks unsupported source content instead of inventing replacement captions", () => {
    expect(() => parseSourceVtt(Buffer.from("not subtitles"))).toThrow()
    expect(() =>
      parseSourceVtt(
        Buffer.from("WEBVTT\n\n00:01.000 --> 00:02.000\n<i>styled</i>"),
      ),
    ).toThrow()
  })
})
