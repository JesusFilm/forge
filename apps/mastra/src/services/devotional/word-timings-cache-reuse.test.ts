import { describe, expect, it } from "vitest"

import type { ProducedDevotionalAudio } from "./devotional-audio"
import { lacksRequestedWordTimings } from "./devotional-render"

/**
 * `produceDevotionalAudio` re-synthesises a per-segment cache hit that predates
 * word timing. `produceNarration`'s whole-bundle shortcut runs BEFORE that and
 * used to return such a bundle wholesale, so re-running a devotional with
 * `--word-timings` after an earlier run without it staged a manifest with no
 * word times at all: every card fell back to the pace-based reveal, and the log
 * said "reusing cached audio".
 */
const bundle = (
  words: ReadonlyArray<ReadonlyArray<string>>,
): ProducedDevotionalAudio =>
  ({
    segments: words.map((ws, i) => ({
      id: `seg-${i}`,
      text: "t",
      spoken: "t",
      audio: {
        format: "mp3",
        bytes: new Uint8Array([1]),
        voiceId: "v",
        model: "m",
        characterCount: 1,
        ...(ws.length > 0
          ? {
              words: ws.map((w, j) => ({
                word: w,
                startSec: j,
                endSec: j + 1,
              })),
            }
          : {}),
      },
    })),
    reused: [],
    failures: [],
  }) as unknown as ProducedDevotionalAudio

describe("lacksRequestedWordTimings", () => {
  it("rejects a cache with no word times when the run asked for them", () => {
    expect(lacksRequestedWordTimings(bundle([[], []]), true)).toBe(true)
  })

  it("rejects a PARTIAL cache — one timed segment does not make the bundle usable", () => {
    expect(lacksRequestedWordTimings(bundle([["a"], []]), true)).toBe(true)
  })

  it("accepts a fully timed cache", () => {
    expect(lacksRequestedWordTimings(bundle([["a"], ["b"]]), true)).toBe(false)
  })

  it("is inert when the run did not ask for word timings, so old renders reuse as before", () => {
    expect(lacksRequestedWordTimings(bundle([[], []]), false)).toBe(false)
    expect(lacksRequestedWordTimings(bundle([[], []]), undefined)).toBe(false)
  })
})
