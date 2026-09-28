/**
 * The ported TV cases pin the copy of TV's sentence timing. The mobile cases
 * pin the KTD5 additions: more scripts, sentence starts, long pauses, and the
 * cue cap. Real fixtures come from production tracks (see each file's NOTE).
 */

import { parseVtt, type VttCue } from "../../parseVtt"
import {
  deriveClipTiming,
  deriveSentenceTiming,
  endsSentence,
  LONG_PAUSE_SECONDS,
  MAX_TIMING_CUES,
  MIN_SENTENCE_PAUSE_SECONDS,
  SENTENCE_PAD_SECONDS,
} from "../sentenceTiming"

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

// The first 11 cues of the production Birth of Jesus English track
// (1_jf6102-0-0_ot_529.vtt), verbatim after <b> stripping, as in TV's test.
const BIRTH_OF_JESUS_CUES: VttCue[] = [
  cue(
    1.23,
    6.63,
    "I am writing to you, dear Theophilus, an orderly account of the things that have taken place among us,",
  ),
  cue(6.69, 11.63, "so that you may know the absolute truth about everything."),
  cue(
    18.55,
    24.44,
    "In the days when Caesar Augustus was emperor of Rome, and when Herod the Great was king of Judea,",
  ),
  cue(
    24.49,
    32.28,
    "God sent the angel Gabriel to visit a virgin of the city of Nazareth. And the virgin's name was Mary.",
  ),
  cue(44.98, 49.97, "Fear not Mary, for you have found favor with God."),
  cue(
    50.04,
    56.66,
    'You will conceive and give birth to a Son and you will call His name "Jesus."',
  ),
  cue(56.76, 58.29, "How can this be?"),
  cue(58.36, 59.6, "I am a virgin."),
  cue(59.72, 61.87, "The Holy Spirit will come upon you."),
  cue(
    61.94,
    70.82,
    "For this reason the Holy Child will be called the Son of the Most High God. His kingdom will never end.",
  ),
  cue(
    70.97,
    74.81,
    "Mary went to visit her cousin Elizabeth, who was too old to have a child.",
  ),
]

describe("deriveSentenceTiming (ported) — real Birth of Jesus track", () => {
  const { boundaries } = deriveSentenceTiming(BIRTH_OF_JESUS_CUES)
  const cueEnds = boundaries.map((b) => b.cueEnd)

  it("marks a boundary after each sentence that a real silence follows", () => {
    expect(cueEnds).toContain(11.63)
    expect(cueEnds).toContain(32.28)
  })

  it("marks no boundary in the rapid exchange, though every cue ends a sentence", () => {
    for (const denseEnd of [49.97, 56.66, 58.29, 59.6, 61.87, 70.82]) {
      expect(cueEnds).not.toContain(denseEnd)
    }
  })

  it("pads the switch time ~1 s past the sentence end when the silence is long", () => {
    const afterEverything = boundaries.find((b) => b.cueEnd === 11.63)
    expect(afterEverything?.switchTime).toBeCloseTo(
      11.63 + SENTENCE_PAD_SECONDS,
      5,
    )
    expect(afterEverything?.gap).toBeCloseTo(6.92, 2)
  })

  it("emits the last cue as a track-end boundary", () => {
    const last = boundaries[boundaries.length - 1]
    expect(last.cueEnd).toBe(74.81)
    expect(last.gap).toBe(Infinity)
    expect(last.switchTime).toBeCloseTo(74.81 + SENTENCE_PAD_SECONDS, 5)
  })
})

describe("deriveSentenceTiming (ported) — pause threshold and pad", () => {
  it("marks a boundary when the gap is exactly the threshold", () => {
    const cues = [
      cue(0, 5, "Done."),
      cue(5 + MIN_SENTENCE_PAUSE_SECONDS, 10, "Next."),
    ]
    const ends = deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd)
    expect(ends).toContain(5)
  })

  it("does not mark a boundary when the gap is a hair under the threshold", () => {
    const cues = [
      cue(0, 5, "Done."),
      cue(5 + MIN_SENTENCE_PAUSE_SECONDS - 0.01, 10, "Next."),
    ]
    const ends = deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd)
    expect(ends).not.toContain(5)
  })

  it("caps the padded switch at the next cue start when the gap is shorter than the pad", () => {
    const cues = [cue(0, 5, "Done."), cue(5.7, 10, "Next.")]
    const boundary = deriveSentenceTiming(cues).boundaries.find(
      (b) => b.cueEnd === 5,
    )
    expect(boundary?.switchTime).toBeCloseTo(5.7, 5)
    expect(boundary?.gap).toBeCloseTo(0.7, 5)
  })

  it("never marks a boundary on touching or overlapping cues", () => {
    for (const nextStart of [5, 4.5]) {
      const cues = [cue(0, 5, "Done."), cue(nextStart, 10, "Next.")]
      expect(
        deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd),
      ).not.toContain(5)
    }
  })
})

describe("deriveSentenceTiming (ported) — sentence-end detection", () => {
  it("does not treat a comma-ending cue as a sentence end", () => {
    const cues = [cue(0, 5, "an orderly account,"), cue(20, 25, "next.")]
    expect(
      deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd),
    ).not.toContain(5)
  })

  it("treats a period or question mark behind a closing quote, and an ellipsis, as a sentence end", () => {
    for (const text of [
      'you will call His name "Jesus."',
      'she asked, "How can this be?"',
      "and so it was…",
    ]) {
      const cues = [cue(0, 5, text), cue(20, 25, "next,")]
      expect(
        deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd),
      ).toContain(5)
    }
  })
})

describe("deriveSentenceTiming (ported) — degenerate inputs and spans", () => {
  it("returns empty timing for an empty cue list", () => {
    expect(deriveSentenceTiming([])).toEqual({
      boundaries: [],
      dialogueSpans: [],
    })
  })

  it("emits zero boundaries for an unpunctuated all-caps track", () => {
    const cues = [
      cue(0, 3, "KNOW ALL MEN OF NAZARETH"),
      cue(10, 13, "BY COMMAND OF CAESAR AUGUSTUS"),
    ]
    expect(deriveSentenceTiming(cues).boundaries).toEqual([])
  })

  it("merges overlapping cues into one spoken stretch", () => {
    const cues = [cue(0, 5, "one,"), cue(4, 9, "two,"), cue(20, 25, "three.")]
    expect(deriveSentenceTiming(cues).dialogueSpans).toEqual([
      { start: 0, end: 9 },
      { start: 20, end: 25 },
    ])
  })

  it("sorts unsorted cues before deriving", () => {
    const cues = [cue(20, 25, "later."), cue(0, 5, "earlier.")]
    const { boundaries } = deriveSentenceTiming(cues)
    expect(boundaries.map((b) => b.cueEnd)).toEqual([5, 25])
  })
})

// ── Mobile additions (KTD5) ─────────────────────────────────────────

describe("endsSentence — terminators for more scripts", () => {
  it.each([
    ["CJK full stop", "他来了。"],
    ["fullwidth question mark", "真的吗？"],
    ["fullwidth exclamation mark", "太好了！"],
    ["Devanagari danda", "यह सच है।"],
    ["Devanagari double danda", "श्लोक॥"],
    ["Arabic question mark", "هل أنت؟"],
    ["Urdu full stop", "یہ سچ ہے۔"],
    ["Myanmar section mark", "ဟုတ်ကဲ့။"],
    ["Ethiopic full stop", "ኢየሩሳሌም ደረሰ።"],
    ["Armenian full stop", "Այո։"],
    ["Latin period", "Done."],
  ])("ends a sentence with the %s", (_name, text) => {
    expect(endsSentence(text)).toBe(true)
  })

  it.each([
    ["a CJK corner bracket", "「はい。」"],
    ["a CJK white corner bracket", "『本当？』"],
    ["a fullwidth parenthesis", "（完。）"],
    ["a closing guillemet", "»Ja.«"],
    ["a straight quote", 'His name is "Jesus."'],
    ["a round bracket", "(Amen.)"],
  ])("still ends a sentence behind %s", (_name, text) => {
    expect(endsSentence(text)).toBe(true)
  })

  it("still ends a sentence behind invisible direction marks", () => {
    // Real Arabic JESUS tracks wrap the period in right-to-left marks.
    expect(endsSentence("يبدي علماً\u200f.\u200f")).toBe(true)
    expect(endsSentence("Done.\u200b")).toBe(true)
  })

  it.each([
    ["a comma", "and so,"],
    ["a fullwidth comma", "上帝，"],
    ["a CJK line with no mark", "他来了"],
    ["a Thai line (Thai has no terminator)", "สวัสดีครับ"],
    ["an empty cue", ""],
  ])("does not end a sentence with %s", (_name, text) => {
    expect(endsSentence(text)).toBe(false)
  })
})

describe("deriveClipTiming — sentence starts", () => {
  it("makes the first cue a preferred start, even right at the video start", () => {
    const timing = deriveClipTiming([cue(0.1, 3, "Hello."), cue(4, 6, "Bye.")])
    expect(timing?.starts[0]).toEqual({ time: 0.1, preferred: true })
  })

  it("starts a sentence at the first cue after a sentence end, and prefers one after 0.5 s of silence", () => {
    const timing = deriveClipTiming([
      cue(0, 2, "One."),
      cue(2.2, 4, "Two after a short gap."),
      cue(4 + MIN_SENTENCE_PAUSE_SECONDS, 6, "Three after a pause,"),
      cue(6.1, 8, "still three."),
    ])
    expect(timing?.starts).toEqual([
      { time: 0, preferred: true },
      { time: 2.2, preferred: false },
      { time: 4 + MIN_SENTENCE_PAUSE_SECONDS, preferred: true },
    ])
  })

  it("never starts a sentence inside earlier speech", () => {
    const timing = deriveClipTiming([
      cue(0, 10, "A long line that runs on."),
      cue(3, 5, "Short."),
      cue(7, 9, "Overlapped start."),
      cue(12, 14, "Clear start."),
    ])
    expect(timing?.starts.map((s) => s.time)).toEqual([0, 12])
  })
})

describe("deriveClipTiming — sentence ends and long pauses", () => {
  it("marks every sentence end with its gap, padded switch, and long-pause flag", () => {
    const timing = deriveClipTiming([
      cue(0, 5, "Short gap."),
      cue(5.2, 10, "Gap a hair under long."),
      cue(10 + LONG_PAUSE_SECONDS - 0.01, 15, "Gap exactly long."),
      cue(15 + LONG_PAUSE_SECONDS, 20, "no end here,"),
      cue(20.3, 25, "Track end."),
    ])
    expect(timing?.ends.map((e) => [e.cueEnd, e.longPause])).toEqual([
      [5, false],
      [10, false],
      [15, true],
      [25, true],
    ])
    expect(timing?.ends[0].switchTime).toBeCloseTo(5.2, 5)
    expect(timing?.ends[2].switchTime).toBeCloseTo(15 + SENTENCE_PAD_SECONDS, 5)
    expect(timing?.ends[3]).toMatchObject({
      gap: Infinity,
      switchTime: 25 + SENTENCE_PAD_SECONDS,
    })
  })

  it("keeps a sentence end that the next cue touches, with no pad", () => {
    const timing = deriveClipTiming([cue(0, 5, "Done."), cue(5, 9, "Next.")])
    expect(timing?.ends[0]).toMatchObject({
      cueEnd: 5,
      switchTime: 5,
      gap: 0,
    })
  })

  it("drops a sentence end that other speech overlaps", () => {
    const timing = deriveClipTiming([
      cue(0, 10, "A long line that runs on,"),
      cue(3, 5, "Nested end."),
      cue(9, 12, "Cut by the next line."),
      cue(11.5, 14, "Clean end."),
    ])
    expect(timing?.ends.map((e) => e.cueEnd)).toEqual([14])
    // The track check still counts every cue that ends a sentence.
    expect(timing?.sentenceEndCount).toBe(3)
  })

  it("reports the counts the track check needs", () => {
    const timing = deriveClipTiming([
      cue(20, 25, "Later."),
      cue(0, 5, "no end,"),
      cue(8, 30, "Longest end."),
    ])
    expect(timing).toMatchObject({
      cueCount: 3,
      sentenceEndCount: 2,
      lastCueEnd: 30,
    })
  })
})

describe("deriveClipTiming — cue cap", () => {
  function track(count: number): VttCue[] {
    return Array.from({ length: count }, (_, i) => cue(i * 2, i * 2 + 1, "A."))
  }

  it("derives timing for a track at the cap", () => {
    expect(deriveClipTiming(track(MAX_TIMING_CUES))).not.toBeNull()
  })

  it("refuses a track over the cap", () => {
    expect(MAX_TIMING_CUES).toBe(8000)
    expect(deriveClipTiming(track(MAX_TIMING_CUES + 1))).toBeNull()
  })

  it("never sorts the caller's shared cue array in place", () => {
    const cues = [cue(20, 25, "Later."), cue(0, 5, "Earlier.")]
    deriveClipTiming(cues)
    expect(cues[0].start).toBe(20)
  })
})

describe("deriveClipTiming — real production tracks", () => {
  function endTexts(name: string): string[] {
    const cues = fixtureCues(name)
    const timing = deriveClipTiming(cues)
    const textByEnd = new Map(cues.map((c) => [c.end, c.text.trim()]))
    return (timing?.ends ?? []).map((e) => textByEnd.get(e.cueEnd) ?? "")
  }

  it("ends Hindi sentences at the danda (JESUS, hindi)", () => {
    const texts = endTexts("jesus-hindi.excerpt.vtt")
    expect(texts.some((t) => t.endsWith("।"))).toBe(true)
  })

  it("ends Burmese sentences at the section mark (JESUS, burmese-common)", () => {
    const texts = endTexts("jesus-burmese-common.excerpt.vtt")
    expect(texts.some((t) => t.endsWith("။"))).toBe(true)
  })

  it("ends CJK sentences at the full stop (Considering Christmas, chinese-simplified)", () => {
    const texts = endTexts("considering-christmas-chinese-simplified.vtt")
    expect(texts.some((t) => t.endsWith("。"))).toBe(true)
  })

  it("reads the broadcast-offset track from 0:00 and ends at the Ethiopic full stop (The Covenant, amharic)", () => {
    const name = "the-covenant-amharic-smpte.excerpt.vtt"
    // The file's first cue is 01:00:25.860; parseVtt removes the hour.
    expect(fixtureCues(name)[0].start).toBeCloseTo(25.86, 3)
    expect(endTexts(name).some((t) => t.endsWith("።"))).toBe(true)
  })

  it("counts an Arabic period wrapped in direction marks (JESUS, arabic-modern-standard)", () => {
    const wrapped = fixtureCues(
      "jesus-arabic-modern-standard.excerpt.vtt",
    ).filter((c) => c.text.endsWith("\u200f.\u200f"))
    expect(wrapped.length).toBeGreaterThan(0)
    expect(wrapped.every((c) => endsSentence(c.text))).toBe(true)
  })
})
