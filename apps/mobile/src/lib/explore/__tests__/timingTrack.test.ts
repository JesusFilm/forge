/**
 * The timing-track choice and checks (KTD5). Real fixtures come from
 * production tracks; each file's NOTE names its source.
 */

import { parseVtt, type VttCue } from "../../parseVtt"
import { fallbackWindow } from "../clipWindow"
import { MAX_TIMING_CUES } from "../sentenceTiming"
import {
  checkTimingTrack,
  MAX_CUE_OVERRUN_SECONDS,
  MIN_SENTENCE_END_SHARE,
  timingTrackOrder,
  type TimingSubtitle,
} from "../timingTrack"

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

function fixtureCues(name: string): VttCue[] {
  return parseVtt(
    fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"),
  ).sort((a, b) => a.start - b.start)
}

function cue(start: number, end: number, text: string): VttCue {
  return { start, end, text }
}

// Dub lengths from production (`lengthInMilliseconds`), read in the U1 probe;
// Considering Christmas's English dub read 2026-09-29.
const JESUS_SECONDS = 7673.727
const CONSIDERING_CHRISTMAS_SECONDS = 120
const THE_COVENANT_SECONDS = 5732.041

function track(
  slug: string,
  options: { primary?: boolean; ai?: boolean; src?: string | null } = {},
): TimingSubtitle {
  return {
    vttSrc:
      options.src === undefined
        ? `https://api-media-core.jesusfilm.org/x/${slug}${options.ai ? "-ai" : ""}.vtt`
        : options.src,
    primary: options.primary ?? false,
    aiGenerated: options.ai ?? false,
    language: { slug },
  }
}

function dubWith(subtitles: TimingSubtitle[]) {
  return { videoEdition: { subtitles } }
}

describe("timingTrackOrder — KTD5 order", () => {
  it("puts the feed-language track first, then the primary, a human-made, and any track", () => {
    const order = timingTrackOrder(
      dubWith([
        track("telugu"),
        track("french", { ai: true }),
        track("english", { primary: true }),
        track("french"),
        track("hindi", { ai: true }),
      ]),
      "french",
    )
    expect(
      order.map((c) => [c.tier, c.track.language?.slug, c.track.aiGenerated]),
    ).toEqual([
      ["feedLanguage", "french", false],
      ["primary", "english", false],
      ["humanMade", "telugu", false],
      ["any", "french", true],
    ])
  })

  it("starts with the primary track when the feed language has no track", () => {
    const order = timingTrackOrder(
      dubWith([track("telugu"), track("english", { primary: true })]),
      "swahili",
    )
    expect(order[0]).toMatchObject({ tier: "primary" })
    expect(order[0].track.language?.slug).toBe("english")
  })

  it("falls through to the primary track for a Mandarin feed, whose tracks use Chinese slugs", () => {
    const order = timingTrackOrder(
      dubWith([
        track("chinese-simplified"),
        track("chinese-traditional"),
        track("english", { primary: true }),
      ]),
      "mandarin-china",
    )
    expect(order.map((c) => [c.tier, c.track.language?.slug])).toEqual([
      ["primary", "english"],
      ["humanMade", "chinese-simplified"],
      ["any", "chinese-traditional"],
    ])
  })

  it("never chooses a track from another edition", () => {
    // Two dubs of one video, on two editions. Only the playing dub's edition counts.
    const playingDub = dubWith([track("english", { primary: true })])
    const otherEditionDub = dubWith([track("swahili")])
    const order = timingTrackOrder(playingDub, "swahili")
    const otherSources = new Set(
      otherEditionDub.videoEdition.subtitles.map((t) => t.vttSrc),
    )
    expect(order.map((c) => c.vttSrc)).toEqual([
      playingDub.videoEdition.subtitles[0].vttSrc,
    ])
    expect(order.some((c) => otherSources.has(c.vttSrc))).toBe(false)
  })

  it("lists a track once, even when it fits more than one tier", () => {
    const order = timingTrackOrder(
      dubWith([track("english", { primary: true })]),
      "english",
    )
    expect(order.map((c) => c.tier)).toEqual(["feedLanguage"])
  })

  it("skips a track with no subtitle file", () => {
    const order = timingTrackOrder(
      dubWith([
        track("french", { src: null }),
        track("french", { src: "" }),
        track("english", { primary: true }),
      ]),
      "french",
    )
    expect(order.map((c) => c.tier)).toEqual(["primary"])
  })

  it("gives no candidate for a dub with no edition or no subtitles", () => {
    expect(timingTrackOrder(null, "english")).toEqual([])
    expect(timingTrackOrder({ videoEdition: null }, "english")).toEqual([])
    expect(
      timingTrackOrder({ videoEdition: { subtitles: null } }, "english"),
    ).toEqual([])
  })
})

describe("checkTimingTrack — KTD5 failure checks", () => {
  /** Ten 20 s sentences with long pauses, so a window exists. */
  function passingCues(): VttCue[] {
    return Array.from({ length: 10 }, (_, i) =>
      cue(i * 25, i * 25 + 20, "A sentence."),
    )
  }

  function withSentenceEnds(total: number, ending: number): VttCue[] {
    return Array.from({ length: total }, (_, i) =>
      cue(i * 25, i * 25 + 20, i < ending ? "Ends." : "does not end,"),
    )
  }

  it("passes a track with sentence ends, inside the duration, and under the cap", () => {
    const verdict = checkTimingTrack(passingCues(), 300)
    expect(verdict.ok).toBe(true)
  })

  it("fails a track with fewer than 20% sentence-ending cues, and passes one at exactly 20%", () => {
    expect(MIN_SENTENCE_END_SHARE).toBe(0.2)
    expect(checkTimingTrack(withSentenceEnds(100, 19), 3000)).toEqual({
      ok: false,
      reason: "few_sentence_ends",
    })
    expect(checkTimingTrack(withSentenceEnds(100, 20), 3000).ok).toBe(true)
  })

  it("fails a track whose last cue ends more than 5 s past the duration", () => {
    expect(MAX_CUE_OVERRUN_SECONDS).toBe(5)
    const cues = passingCues()
    const lastEnd = cues[cues.length - 1].end
    expect(checkTimingTrack(cues, lastEnd - 5).ok).toBe(true)
    expect(checkTimingTrack(cues, lastEnd - 5.01)).toEqual({
      ok: false,
      reason: "past_duration",
    })
  })

  it("fails a track with more than 8,000 cues", () => {
    const cues = Array.from({ length: MAX_TIMING_CUES + 1 }, (_, i) =>
      cue(i * 2, i * 2 + 1, "A."),
    )
    expect(checkTimingTrack(cues, 20_000)).toEqual({
      ok: false,
      reason: "too_many_cues",
    })
  })

  it("fails an empty track, and a dub with no usable duration", () => {
    expect(checkTimingTrack([], 300)).toEqual({ ok: false, reason: "no_cues" })
    for (const duration of [NaN, 0, -1, Infinity]) {
      expect(checkTimingTrack(passingCues(), duration)).toEqual({
        ok: false,
        reason: "unknown_duration",
      })
    }
  })

  it("fails a track that passes the checks but gives no clip window", () => {
    // Every sentence ends within 10 s of every start.
    const cues = [cue(0, 2, "One."), cue(3, 5, "Two."), cue(6, 8, "Three.")]
    expect(checkTimingTrack(cues, 60)).toEqual({
      ok: false,
      reason: "no_windows",
    })
  })
})

describe("checkTimingTrack — real production tracks", () => {
  it.each([
    ["considering-christmas-english.vtt", CONSIDERING_CHRISTMAS_SECONDS],
    [
      "considering-christmas-chinese-simplified.vtt",
      CONSIDERING_CHRISTMAS_SECONDS,
    ],
    ["jesus-hindi.excerpt.vtt", JESUS_SECONDS],
    ["jesus-burmese-common.excerpt.vtt", JESUS_SECONDS],
    ["the-covenant-amharic-smpte.excerpt.vtt", THE_COVENANT_SECONDS],
  ])("passes %s", (name, duration) => {
    expect(checkTimingTrack(fixtureCues(name), duration).ok).toBe(true)
  })

  it("fails the broadcast-offset track if its hour stays in (The Covenant, amharic)", () => {
    // The file's own times run to 02:32; the video is 1:35 long.
    const raw = fixtureCues("the-covenant-amharic-smpte.excerpt.vtt").map(
      (c) => ({ ...c, start: c.start + 3600, end: c.end + 3600 }),
    )
    expect(checkTimingTrack(raw, THE_COVENANT_SECONDS)).toEqual({
      ok: false,
      reason: "past_duration",
    })
  })

  it("fails the Arabic track on the 20% rule, as U1 found (JESUS, arabic-modern-standard)", () => {
    expect(
      checkTimingTrack(
        fixtureCues("jesus-arabic-modern-standard.excerpt.vtt"),
        JESUS_SECONDS,
      ),
    ).toEqual({ ok: false, reason: "few_sentence_ends" })
  })

  it("fails the Thai track, which has no terminators, so the fallback path runs (JESUS, thai)", () => {
    expect(
      checkTimingTrack(fixtureCues("jesus-thai.excerpt.vtt"), JESUS_SECONDS),
    ).toEqual({ ok: false, reason: "few_sentence_ends" })
    const w = fallbackWindow(JESUS_SECONDS, [], () => 0.5)
    expect(w).not.toBeNull()
    expect(w!.endSeconds).toBeLessThanOrEqual(JESUS_SECONDS)
  })
})
