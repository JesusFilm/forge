/**
 * SubtitleTranscript — parseVtt unit tests.
 *
 * The transcript section reads cues from VTT files served by Arclight's
 * api-media-core. parseVtt is the pure transform: VTT text -> cue list.
 * Each test exercises one VTT-grammar wrinkle observed in the wild
 * (Windows line endings, hour-prefix timing, inline <c> tags, HTML
 * entities) so a regression in any path fails an isolated assertion.
 */

import { describe, expect, test } from "vitest"

import { parseVtt } from "@/components/watch/SubtitleTranscript"

describe("parseVtt", () => {
  test("parses a happy-path cue", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.500
Hello world`

    expect(parseVtt(vtt)).toEqual([{ start: 1, end: 4.5, text: "Hello world" }])
  })

  test("accepts CRLF and CR line endings", () => {
    const crlf = "WEBVTT\r\n\r\n00:00:02.000 --> 00:00:03.000\r\nLine"
    const cr = "WEBVTT\r\r00:00:02.000 --> 00:00:03.000\rLine"

    expect(parseVtt(crlf)).toEqual([{ start: 2, end: 3, text: "Line" }])
    expect(parseVtt(cr)).toEqual([{ start: 2, end: 3, text: "Line" }])
  })

  test("parses hour-prefix timing", () => {
    const vtt = `WEBVTT

01:00:25.860 --> 01:00:33.400
Hour-prefixed cue`

    expect(parseVtt(vtt)).toEqual([
      { start: 3625.86, end: 3633.4, text: "Hour-prefixed cue" },
    ])
  })

  test("skips blocks with malformed or missing timing", () => {
    const vtt = `WEBVTT

NOTE this is a comment block

garbage line without arrow

00:00:05.000 --> 00:00:06.000
Valid cue`

    expect(parseVtt(vtt)).toEqual([{ start: 5, end: 6, text: "Valid cue" }])
  })

  test("strips inline <c> and <i> tags from cue text", () => {
    const vtt = `WEBVTT

00:00:10.000 --> 00:00:12.000
<c.yellow>Bright</c> <i>italic</i> word`

    expect(parseVtt(vtt)).toEqual([
      { start: 10, end: 12, text: "Bright italic word" },
    ])
  })

  test("decodes common HTML entities", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;yo&#39;&nbsp;&gt;`

    expect(parseVtt(vtt)).toEqual([
      { start: 1, end: 2, text: "Tom & Jerry <3 \"hi\" 'yo' >" },
    ])
  })

  test("skips cues with empty text after stripping", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000


00:00:03.000 --> 00:00:04.000
<c></c>

00:00:05.000 --> 00:00:06.000
Real`

    expect(parseVtt(vtt)).toEqual([{ start: 5, end: 6, text: "Real" }])
  })

  test("accepts comma decimal separator (SRT-style timing)", () => {
    const vtt = `WEBVTT

00:00:01,250 --> 00:00:02,750
Comma decimals`

    expect(parseVtt(vtt)).toEqual([
      { start: 1.25, end: 2.75, text: "Comma decimals" },
    ])
  })

  test("returns empty array for header-only input", () => {
    expect(parseVtt("WEBVTT\n\n")).toEqual([])
  })
})
