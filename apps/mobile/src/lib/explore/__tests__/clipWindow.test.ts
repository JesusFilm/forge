/**
 * The clip engine's windows (KTD24): the eligible-start list, the sentence
 * picker, and the R23 fallback. Real fixtures come from production tracks.
 */

import { parseVtt, type VttCue } from "../../parseVtt"
import {
  buildEligibleStarts,
  eligibleStartsOnce,
  fallbackWindow,
  FALLBACK_CLIP_SECONDS,
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  MIN_CLIP_VIDEO_SECONDS,
  pickSentenceWindow,
  type EligibleStart,
  type EligibleStartsMemo,
} from "../clipWindow"
import {
  deriveClipTiming,
  endsSentence,
  SENTENCE_PAD_SECONDS,
  type ClipTiming,
} from "../sentenceTiming"
import type { ClipWindow } from "../types"

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

function timingOf(cues: VttCue[]): ClipTiming {
  const timing = deriveClipTiming(cues)
  if (timing == null) throw new Error("fixture is over the cue cap")
  return timing
}

function windowFrom(
  list: readonly EligibleStart[],
  startSeconds: number,
): EligibleStart | undefined {
  return list.find((w) => w.startSeconds === startSeconds)
}

/** mulberry32: a small seeded generator, so a failing seed replays exactly. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MIN = 60

describe("buildEligibleStarts — R27 ends", () => {
  it("covers AE1 at the 30 s minimum: a 12:04 start ends at the long pause after 12:51", () => {
    const timing = timingOf([
      cue(11 * MIN + 30, 11 * MIN + 40, "Before."),
      cue(12 * MIN + 4, 12 * MIN + 20, "Ends at 12:20, under 30 s."),
      cue(
        12 * MIN + 20.3,
        12 * MIN + 36,
        "Ends at 12:36, then 1 s of silence.",
      ),
      cue(12 * MIN + 37, 12 * MIN + 51, "Ends at 12:51, then 3 s of silence."),
      cue(12 * MIN + 54, 12 * MIN + 58, "Ends at 12:58."),
      cue(12 * MIN + 58.5, 13 * MIN + 8, "More."),
    ])
    expect(windowFrom(buildEligibleStarts(timing, []), 12 * MIN + 4)).toEqual({
      startSeconds: 12 * MIN + 4,
      endSeconds: 12 * MIN + 51 + SENTENCE_PAD_SECONDS,
      preferred: true,
    })
  })

  it("covers AE2: with no long pause in range, ends at the last sentence end before start + 60 s", () => {
    const timing = timingOf([
      cue(29 * MIN + 50, 29 * MIN + 55, "Before."),
      cue(30 * MIN, 30 * MIN + 6, "The clip starts at thirty minutes."),
      cue(30 * MIN + 6.4, 30 * MIN + 15, "One."),
      cue(30 * MIN + 15.6, 30 * MIN + 40, "Two."),
      cue(30 * MIN + 41, 30 * MIN + 58, "Three, the last end before 31:00."),
      cue(30 * MIN + 58.4, 31 * MIN + 5, "Four ends past the cap."),
      cue(31 * MIN + 10, 31 * MIN + 12, "Five."),
    ])
    expect(windowFrom(buildEligibleStarts(timing, []), 30 * MIN)).toEqual({
      startSeconds: 30 * MIN,
      // The pad stops at the next cue's start.
      endSeconds: 30 * MIN + 58.4,
      preferred: true,
    })
  })

  it("leaves out a start with no sentence end from 30 s to 60 s after it", () => {
    const timing = timingOf([
      cue(0, 5, "Too short to end a clip."),
      cue(75, 80, "A far start."),
      cue(80.5, 75 + MIN_CLIP_SECONDS + 5, "It ends in range."),
    ])
    const starts = buildEligibleStarts(timing, []).map((w) => w.startSeconds)
    expect(starts).not.toContain(0)
    expect(starts).toContain(75)
  })

  it("keeps every window from 30 s to 60 s of speech, plus the pad", () => {
    const timing = timingOf(fixtureCues("jesus-english.vtt"))
    for (const w of buildEligibleStarts(timing, [])) {
      const length = w.endSeconds - w.startSeconds
      expect(length).toBeGreaterThanOrEqual(MIN_CLIP_SECONDS)
      expect(length).toBeLessThanOrEqual(
        MAX_CLIP_SECONDS + SENTENCE_PAD_SECONDS,
      )
    }
  })
})

describe("buildEligibleStarts — the record (R29)", () => {
  const AE3_CUES = [
    cue(40 * MIN, 40 * MIN + 5, "Before."),
    cue(40 * MIN + 15, 40 * MIN + 19, "Lead in."),
    cue(40 * MIN + 20, 40 * MIN + 36, "A start inside the recorded clip."),
    cue(41 * MIN + 2, 41 * MIN + 15, "A start after the recorded clip."),
    cue(41 * MIN + 16, 41 * MIN + 40, "It reaches the 30 s minimum."),
  ]

  it("covers AE3: with 40:10–40:38 recorded, 40:20 is not eligible and 41:02 is", () => {
    const timing = timingOf(AE3_CUES)
    const recorded = [
      { startSeconds: 40 * MIN + 10, endSeconds: 40 * MIN + 38 },
    ]
    const open = buildEligibleStarts(timing, []).map((w) => w.startSeconds)
    const starts = buildEligibleStarts(timing, recorded).map(
      (w) => w.startSeconds,
    )
    // Without the record, 40:20 is eligible, so the record is what removes it.
    expect(open).toContain(40 * MIN + 20)
    expect(starts).not.toContain(40 * MIN + 20)
    expect(starts).toContain(41 * MIN + 2)
  })

  it("ends before a recorded window rather than overlapping it", () => {
    const cues = [
      cue(100, 132, "An early end."),
      cue(132.3, 145, "The natural end before a long pause."),
      cue(150, 155, "Later."),
    ]
    const recorded = [{ startSeconds: 140, endSeconds: 170 }]
    const w = windowFrom(buildEligibleStarts(timingOf(cues), recorded), 100)
    expect(w).toEqual({ startSeconds: 100, endSeconds: 132.3, preferred: true })
  })

  it("drops a start whose every valid end would overlap a recorded window", () => {
    const cues = [cue(100, 132, "One long sentence."), cue(135, 140, "Later.")]
    const recorded = [{ startSeconds: 105, endSeconds: 150 }]
    const starts = buildEligibleStarts(timingOf(cues), recorded).map(
      (w) => w.startSeconds,
    )
    expect(starts).not.toContain(100)
  })

  it("allows a window that only touches a recorded window", () => {
    const cues = [
      cue(100, 135, "Ends before a long pause."),
      cue(140, 155, "Recorded next."),
    ]
    const recorded = [{ startSeconds: 136, endSeconds: 156 }]
    const w = windowFrom(buildEligibleStarts(timingOf(cues), recorded), 100)
    expect(w?.endSeconds).toBe(136)
  })

  it("gives an empty list when every start is recorded, and the picker returns no window without looping", () => {
    const timing = timingOf(fixtureCues("jesus-english.vtt"))
    const recorded = [{ startSeconds: 0, endSeconds: 8000 }]
    const list = buildEligibleStarts(timing, recorded)
    expect(list).toEqual([])
    const random = jest.fn(() => 0.5)
    expect(pickSentenceWindow(list, random)).toBeNull()
    expect(random).not.toHaveBeenCalled()
  })
})

describe("pickSentenceWindow", () => {
  // The first cue is a start with no end in range, so two candidates remain.
  const PREFERENCE_CUES = [
    cue(0, 1, "and so,"),
    cue(100, 104, "This cue is no start."),
    cue(104.2, 110, "A start after a 0.2 s gap."),
    cue(111, 145, "A start after a 1 s gap."),
  ]

  it("picks the start after the pause over the start after a 0.2 s gap, for every seed", () => {
    const list = buildEligibleStarts(timingOf(PREFERENCE_CUES), [])
    expect(list.map((w) => [w.startSeconds, w.preferred])).toEqual([
      [104.2, false],
      [111, true],
    ])
    for (let seed = 1; seed <= 50; seed++) {
      expect(pickSentenceWindow(list, seeded(seed))?.startSeconds).toBe(111)
    }
  })

  it("picks among the other starts when no preferred start is left", () => {
    const list: EligibleStart[] = [
      { startSeconds: 10, endSeconds: 25, preferred: false },
      { startSeconds: 40, endSeconds: 55, preferred: false },
    ]
    expect(pickSentenceWindow(list, () => 0.99)).toEqual({
      startSeconds: 40,
      endSeconds: 55,
    })
  })

  it("reaches every preferred start with a seeded source", () => {
    const timing = timingOf(fixtureCues("jesus-hindi.excerpt.vtt"))
    const list = buildEligibleStarts(timing, [])
    const preferred = new Set(
      list.filter((w) => w.preferred).map((w) => w.startSeconds),
    )
    const random = seeded(7)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      seen.add(pickSentenceWindow(list, random)?.startSeconds ?? -1)
    }
    expect(seen).toEqual(preferred)
  })

  it("stays in range when the random source misbehaves", () => {
    const list: EligibleStart[] = [
      { startSeconds: 10, endSeconds: 25, preferred: true },
      { startSeconds: 40, endSeconds: 55, preferred: true },
    ]
    for (const bad of [1, 1.5, -0.2, NaN]) {
      expect(pickSentenceWindow(list, () => bad)).not.toBeNull()
    }
  })
})

describe("eligibleStartsOnce — once per track and record version", () => {
  function memoSlot() {
    let held: EligibleStartsMemo | undefined
    return {
      get: jest.fn(() => held),
      set: jest.fn((value: EligibleStartsMemo) => {
        held = value
      }),
    }
  }

  it("builds once for a record version, and again when the version changes", () => {
    const timing = timingOf(fixtureCues("jesus-english.vtt"))
    const slot = memoSlot()
    const v1 = { version: 1, windows: [] as ClipWindow[] }
    const first = eligibleStartsOnce(slot, timing, v1)
    expect(eligibleStartsOnce(slot, timing, v1)).toBe(first)
    expect(slot.set).toHaveBeenCalledTimes(1)

    const recorded = [{ startSeconds: 0, endSeconds: 600 }]
    const second = eligibleStartsOnce(slot, timing, {
      version: 2,
      windows: recorded,
    })
    expect(second).not.toBe(first)
    expect(second.length).toBeLessThan(first.length)
    expect(slot.set).toHaveBeenCalledTimes(2)
  })
})

describe("real production tracks", () => {
  const PASSING = [
    "jesus-english.vtt",
    "handiwork-chinese-simplified.vtt",
    "jesus-hindi.excerpt.vtt",
    "jesus-burmese-common.excerpt.vtt",
    "the-covenant-amharic-smpte.excerpt.vtt",
  ]

  it.each(PASSING)(
    "%s gives windows that start at a cue start and end at a sentence end plus the pad",
    (name) => {
      const cues = fixtureCues(name)
      const list = buildEligibleStarts(timingOf(cues), [])
      expect(list.length).toBeGreaterThan(0)
      const cueStarts = new Set(cues.map((c) => c.start))
      // Each sentence end, keyed by its padded end (capped at the next cue's start).
      const sentenceEndByPaddedEnd = new Map<number, number>()
      cues.forEach((c, i) => {
        if (!endsSentence(c.text)) return
        const next = cues[i + 1]
        const padded = c.end + SENTENCE_PAD_SECONDS
        const key = next ? Math.min(padded, next.start) : padded
        sentenceEndByPaddedEnd.set(key, c.end)
      })
      for (const w of list) {
        expect(cueStarts.has(w.startSeconds)).toBe(true)
        const sentenceEnd = sentenceEndByPaddedEnd.get(w.endSeconds)
        expect(sentenceEnd).toBeDefined()
        expect(sentenceEnd! - w.startSeconds).toBeGreaterThanOrEqual(
          MIN_CLIP_SECONDS,
        )
        expect(sentenceEnd! - w.startSeconds).toBeLessThanOrEqual(
          MAX_CLIP_SECONDS,
        )
      }
    },
  )

  it("builds the eligible-start list for a whole feature film within 50 ms", () => {
    const cues = fixtureCues("jesus-english.vtt")
    // A heavy record for one video: a 20 s clip every 2 minutes of the film.
    const recorded: ClipWindow[] = []
    for (let t = 0; t < 7600; t += 120) {
      recorded.push({ startSeconds: t, endSeconds: t + 20 })
    }
    const started = performance.now()
    const timing = timingOf(cues)
    const list = buildEligibleStarts(timing, recorded)
    const elapsedMs = performance.now() - started
    expect(cues.length).toBe(1262)
    expect(list.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(50)
  })
})

describe("fallbackWindow (R23)", () => {
  const RANDOMS = [0, 0.25, 0.5, 0.75, 0.999999]

  it("covers AE10: a 20:00 video starts between 1:00 and 16:00 and runs 30 s", () => {
    for (const r of RANDOMS) {
      const w = fallbackWindow(20 * MIN, [], () => r)
      expect(w).not.toBeNull()
      expect(w!.startSeconds).toBeGreaterThanOrEqual(1 * MIN)
      expect(w!.startSeconds).toBeLessThanOrEqual(16 * MIN)
      expect(w!.endSeconds - w!.startSeconds).toBeCloseTo(
        FALLBACK_CLIP_SECONDS,
        9,
      )
    }
  })

  it("covers AE11 at the 30 s minimum: a 28 s video gives no window, and a 30.5 s video plays whole", () => {
    expect(fallbackWindow(28, [], () => 0.5)).toBeNull()
    expect(fallbackWindow(30.5, [], () => 0.5)).toEqual({
      startSeconds: 0,
      endSeconds: 30.5,
    })
  })

  it("starts a 60 s video between 3 s and 30 s, and plays a 31 s video whole", () => {
    for (const r of RANDOMS) {
      const w = fallbackWindow(60, [], () => r)
      expect(w!.startSeconds).toBeGreaterThanOrEqual(3)
      expect(w!.startSeconds).toBeLessThanOrEqual(30)
    }
    expect(fallbackWindow(31, [], () => 0.5)).toEqual({
      startSeconds: 0,
      endSeconds: 31,
    })
  })

  it("plays a 30 s video whole and gives a 29.9 s video nothing", () => {
    // The owner's minimum (2026-09-27), as a number, not only the constant.
    expect(MIN_CLIP_SECONDS).toBe(30)
    expect(MIN_CLIP_VIDEO_SECONDS).toBe(30)
    expect(fallbackWindow(30, [], () => 0.5)).toEqual({
      startSeconds: 0,
      endSeconds: 30,
    })
    expect(fallbackWindow(29.9, [], () => 0.5)).toBeNull()
  })

  it("ends every fallback window at or before the video's end", () => {
    const durations = [30, 30.5, 31, 31.58, 31.6, 45, 60, 100, 1200, 7673.727]
    for (const d of durations) {
      for (const r of RANDOMS) {
        const w = fallbackWindow(d, [], () => r)
        expect(w).not.toBeNull()
        expect(w!.startSeconds).toBeGreaterThanOrEqual(0)
        expect(w!.endSeconds).toBeLessThanOrEqual(d)
      }
    }
  })

  it("gives no window for a duration that is not a finite number", () => {
    for (const d of [NaN, Infinity, -5]) {
      expect(fallbackWindow(d, [], () => 0.5)).toBeNull()
    }
  })

  it("never overlaps a recorded window of the video", () => {
    const recorded = [
      { startSeconds: 100, endSeconds: 130 },
      { startSeconds: 300, endSeconds: 700 },
    ]
    const random = seeded(3)
    for (let i = 0; i < 500; i++) {
      const w = fallbackWindow(20 * MIN, recorded, random)!
      for (const r of recorded) {
        const overlaps =
          w.startSeconds < r.endSeconds && w.endSeconds > r.startSeconds
        expect(overlaps).toBe(false)
      }
    }
  })

  it("fits the one free start exactly between two recorded windows", () => {
    const recorded = [
      { startSeconds: 0, endSeconds: 20 },
      { startSeconds: 50, endSeconds: 100 },
    ]
    expect(fallbackWindow(100, recorded, () => 0.7)).toEqual({
      startSeconds: 20,
      endSeconds: 50,
    })
  })

  it("gives no window when the record covers every start, without looping", () => {
    const random = jest.fn(() => 0.5)
    expect(
      fallbackWindow(100, [{ startSeconds: 0, endSeconds: 100 }], random),
    ).toBeNull()
    expect(
      fallbackWindow(31, [{ startSeconds: 0, endSeconds: 31 }], random),
    ).toBeNull()
    expect(random).not.toHaveBeenCalled()
  })
})
