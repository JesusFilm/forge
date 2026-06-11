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

import type { WatchSubtitle } from "@/lib/content"
import {
  filterTranscriptSubtitlesForAudio,
  normalizeCueOffset,
  parseVtt,
} from "@/lib/subtitle-transcript"

const englishSubtitle: WatchSubtitle = {
  documentId: "subtitle-en",
  language: {
    slug: "english",
    name: "English",
    nativeName: null,
    bcp47: "en",
  },
  vttSrc: "https://example.com/en.vtt",
  primary: true,
  aiGenerated: false,
}

const amharicSubtitle: WatchSubtitle = {
  documentId: "subtitle-am",
  language: {
    slug: "amharic",
    name: "Amharic",
    nativeName: null,
    bcp47: "am",
  },
  vttSrc: "https://example.com/am.vtt",
  primary: false,
  aiGenerated: true,
}

describe("filterTranscriptSubtitlesForAudio", () => {
  test("keeps only subtitles that match the selected audio language", () => {
    expect(
      filterTranscriptSubtitlesForAudio(
        [englishSubtitle, amharicSubtitle],
        "english",
      ),
    ).toEqual([englishSubtitle])
  })

  test("returns no subtitles when the selected audio language has no matching subtitle track", () => {
    expect(
      filterTranscriptSubtitlesForAudio([amharicSubtitle], "english"),
    ).toEqual([])
  })

  test("preserves existing subtitle fallback behavior when no audio language is known", () => {
    const subtitles = [englishSubtitle, amharicSubtitle]

    expect(filterTranscriptSubtitlesForAudio(subtitles, null)).toBe(subtitles)
  })
})

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

  test("does not double-unescape encoded entities (CodeQL js/double-escaping)", () => {
    // Literal `&amp;lt;` in the source should decode to `&lt;` once, not
    // collapse to `<`. A chained-replace decoder that handled `&amp;`
    // first would re-trigger the `&lt;` branch.
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
&amp;lt;encoded&amp;gt;`

    expect(parseVtt(vtt)).toEqual([
      { start: 1, end: 2, text: "&lt;encoded&gt;" },
    ])
  })

  test("strips nested-tag payloads with no reconstructible <tag> residue", () => {
    // Iterate-until-stable strip prevents a nested-tag payload from
    // collapsing back into a complete `<script>` tag after one pass.
    // Defensive only — output flows into a React text node — but the
    // assertion guards against CodeQL js/incomplete-multi-character-
    // sanitization regressions. Garbage characters can remain (they
    // render as literal text), but no `<...>` pattern survives.
    const cues = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:02.000
keep <scr<script>ipt>alert(1)</script> me`)

    expect(cues).toHaveLength(1)
    expect(cues[0]!.text).not.toMatch(/<[^>]*>/)
    expect(cues[0]!.text).toContain("keep")
    expect(cues[0]!.text).toContain("alert(1)")
    expect(cues[0]!.text).toContain("me")
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

describe("normalizeCueOffset", () => {
  test("subtracts one-hour SMPTE offset when cues fall outside duration", () => {
    // Real-world example from Arclight: the-covenant Amharic VTT has
    // cues starting at 01:00:25 (3625s) while the variant is 5730s
    // long. Subtracting 3600s lands the cues at 25s..1521s — inside
    // the playable range.
    const cues = [
      { start: 3625, end: 3630, text: "first" },
      { start: 9120, end: 9125, text: "last" },
    ]
    expect(normalizeCueOffset(cues, 5730)).toEqual([
      { start: 25, end: 30, text: "first" },
      { start: 5520, end: 5525, text: "last" },
    ])
  })

  test("preserves cues that already fit within duration", () => {
    const cues = [
      { start: 5, end: 10, text: "intro" },
      { start: 5700, end: 5710, text: "outro" },
    ]
    expect(normalizeCueOffset(cues, 5730)).toEqual(cues)
  })

  test("no-ops when duration is unknown", () => {
    const cues = [{ start: 3625, end: 3630, text: "offset" }]
    expect(normalizeCueOffset(cues, null)).toEqual(cues)
    expect(normalizeCueOffset(cues, undefined)).toEqual(cues)
    expect(normalizeCueOffset(cues, 0)).toEqual(cues)
  })

  test("no-ops on empty cue list", () => {
    expect(normalizeCueOffset([], 5730)).toEqual([])
  })

  test("does not shift when shifted result would underflow zero", () => {
    // First cue starts at 5s — no whole-hour offset applies even if
    // the last cue overshoots duration; the safer fallback is to
    // render cues as authored.
    const cues = [
      { start: 5, end: 10, text: "ok" },
      { start: 7000, end: 7005, text: "way past" },
    ]
    expect(normalizeCueOffset(cues, 1000)).toEqual(cues)
  })
})
