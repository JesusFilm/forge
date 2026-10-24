import type { VttCue } from "../parseVtt"
import {
  deriveSentenceTiming,
  MIN_SENTENCE_PAUSE_SECONDS,
  SENTENCE_PAD_SECONDS,
} from "./sentenceTiming"

// A single cue as parseVtt emits them (tag-stripped, SMPTE-normalized). The reference
// track is English, so fixtures are English captions with real punctuation.
function cue(start: number, end: number, text: string): VttCue {
  return { start, end, text }
}

// ── Real reference-track fixture (AE1 data half) ────────────────────
// The first 11 cues of the production Birth of Jesus English VTT
// (1_jf6102-0-0_ot_529.vtt), verbatim after <b> stripping. It carries the two real
// sentence pauses the plan cites (00:11.63 → 00:18.55 and 00:32.28 → 00:44.98) and the
// 00:56–01:01 rapid exchange whose cues end in terminal punctuation but never pause.
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

describe("deriveSentenceTiming — real Birth of Jesus reference track (AE1)", () => {
  const { boundaries } = deriveSentenceTiming(BIRTH_OF_JESUS_CUES)
  const cueEnds = boundaries.map((b) => b.cueEnd)

  it("marks a boundary after each sentence that a real silence follows", () => {
    // "...about everything." → 6.92s silence; "...name was Mary." → 12.7s silence.
    expect(cueEnds).toContain(11.63)
    expect(cueEnds).toContain(32.28)
  })

  it("marks NO boundary in the rapid exchange, though every cue ends in a period/question mark", () => {
    // 00:56–01:01: "How can this be?", "I am a virgin.", etc. — terminal punctuation
    // but sub-threshold gaps (~0.07–0.15s). Terminal punctuation alone is not a pause.
    for (const denseEnd of [49.97, 56.66, 58.29, 59.6, 61.87, 70.82]) {
      expect(cueEnds).not.toContain(denseEnd)
    }
  })

  it("pads the switch time ~1s past the sentence end when the silence is long", () => {
    const afterEverything = boundaries.find((b) => b.cueEnd === 11.63)
    // 6.92s silence dwarfs the 1s pad, so the switch is a clean cueEnd + pad.
    expect(afterEverything?.switchTime).toBeCloseTo(
      11.63 + SENTENCE_PAD_SECONDS,
      5,
    )
    expect(afterEverything?.gap).toBeCloseTo(6.92, 2)
  })

  it("emits the last cue as a track-end boundary (sentence completes into no more speech)", () => {
    const last = boundaries[boundaries.length - 1]
    expect(last.cueEnd).toBe(74.81)
    expect(last.gap).toBe(Infinity)
    expect(last.switchTime).toBeCloseTo(74.81 + SENTENCE_PAD_SECONDS, 5)
  })
})

// ── Minimum-pause threshold ─────────────────────────────────────────

describe("deriveSentenceTiming — pause threshold", () => {
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
})

// ── Pad capping ─────────────────────────────────────────────────────

describe("deriveSentenceTiming — pad capping (KTD-3)", () => {
  it("caps the padded switch at the next cue start when the gap is shorter than the pad", () => {
    // gap 0.7s (≥ 0.5 threshold, < 1s pad) → switch capped so it never eats the next cue.
    const cues = [cue(0, 5, "Done."), cue(5.7, 10, "Next.")]
    const boundary = deriveSentenceTiming(cues).boundaries.find(
      (b) => b.cueEnd === 5,
    )
    expect(boundary).toBeDefined()
    expect(boundary?.switchTime).toBeCloseTo(5.7, 5)
    expect(boundary?.gap).toBeCloseTo(0.7, 5)
  })
})

// ── Overlapping and touching cues are never pauses ──────────────────

describe("deriveSentenceTiming — overlap/touch", () => {
  it("never marks a boundary on a zero gap (touching cues)", () => {
    const cues = [cue(0, 5, "Done."), cue(5, 10, "Next.")]
    expect(
      deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd),
    ).not.toContain(5)
  })

  it("never marks a boundary on a negative gap (overlapping cues)", () => {
    const cues = [cue(0, 5, "Done."), cue(4.5, 10, "Next.")]
    expect(
      deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd),
    ).not.toContain(5)
  })
})

// ── Terminal punctuation detection ──────────────────────────────────

describe("deriveSentenceTiming — sentence-end detection", () => {
  it("does not treat a comma-ending cue as a sentence end even before a long gap", () => {
    const cues = [
      cue(0, 5, "an orderly account of the things,"),
      cue(20, 25, "next."),
    ]
    expect(
      deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd),
    ).not.toContain(5)
  })

  it("treats a period behind a closing quote as a sentence end", () => {
    const cues = [
      cue(0, 5, 'you will call His name "Jesus."'),
      cue(20, 25, "next,"),
    ]
    expect(
      deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd),
    ).toContain(5)
  })

  it("treats a question mark behind a closing quote as a sentence end", () => {
    const cues = [
      cue(0, 5, 'she asked, "How can this be?"'),
      cue(20, 25, "next,"),
    ]
    expect(
      deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd),
    ).toContain(5)
  })

  it("treats an ellipsis as a sentence end", () => {
    const cues = [cue(0, 5, "and so it was…"), cue(20, 25, "next,")]
    expect(
      deriveSentenceTiming(cues).boundaries.map((b) => b.cueEnd),
    ).toContain(5)
  })
})

// ── Degenerate inputs ───────────────────────────────────────────────

describe("deriveSentenceTiming — degenerate inputs", () => {
  it("returns empty timing for an empty cue list without throwing", () => {
    expect(deriveSentenceTiming([])).toEqual({
      boundaries: [],
      dialogueSpans: [],
    })
  })

  it("emits an end-only boundary for a single terminal-punctuated cue", () => {
    const { boundaries } = deriveSentenceTiming([cue(0, 5, "The end.")])
    expect(boundaries).toHaveLength(1)
    expect(boundaries[0].cueEnd).toBe(5)
    expect(boundaries[0].gap).toBe(Infinity)
  })

  it("emits no boundary for a single cue with no terminal punctuation", () => {
    expect(
      deriveSentenceTiming([cue(0, 5, "no ending here")]).boundaries,
    ).toEqual([])
  })

  it("emits zero boundaries for an unpunctuated all-caps track", () => {
    const cues = [
      cue(0, 3, "KNOW ALL MEN OF NAZARETH"),
      cue(10, 13, "BY COMMAND OF CAESAR AUGUSTUS"),
      cue(20, 23, "A CENSUS WILL BE CONDUCTED"),
    ]
    expect(deriveSentenceTiming(cues).boundaries).toEqual([])
  })
})

// ── Dialogue spans (KTD-4 density input) ────────────────────────────

describe("deriveSentenceTiming — dialogue spans", () => {
  it("emits one span per non-overlapping cue, preserving the silences between them", () => {
    const spans = deriveSentenceTiming(BIRTH_OF_JESUS_CUES).dialogueSpans
    // The first two cues nearly touch (0.06s gap) but do not overlap → two spans.
    expect(spans[0]).toEqual({ start: 1.23, end: 6.63 })
    expect(spans[1]).toEqual({ start: 6.69, end: 11.63 })
  })

  it("merges overlapping cues into one spoken stretch so coverage never double-counts", () => {
    const cues = [cue(0, 5, "one,"), cue(4, 9, "two,"), cue(20, 25, "three.")]
    expect(deriveSentenceTiming(cues).dialogueSpans).toEqual([
      { start: 0, end: 9 },
      { start: 20, end: 25 },
    ])
  })

  it("sorts unsorted cues before deriving", () => {
    const cues = [cue(20, 25, "later."), cue(0, 5, "earlier.")]
    const { boundaries, dialogueSpans } = deriveSentenceTiming(cues)
    expect(dialogueSpans[0].start).toBe(0)
    // "earlier." at 0–5, then a 15s silence → boundary; "later." is the track-end boundary.
    expect(boundaries.map((b) => b.cueEnd)).toEqual([5, 25])
  })
})
