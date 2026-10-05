import { describe, expect, it } from "vitest"

import { planRuns, runTake, runText, sliceRun } from "./continuous-voice"
import { wordsFromAlignment } from "./elevenlabs-voiceover"

const seg = (id: string, voice: string, text: string, direction?: string) => ({
  id,
  voice,
  text,
  ...(direction ? { direction } : {}),
})

describe("planRuns", () => {
  it("joins consecutive reflection cards of one voice, nothing else", () => {
    const runs = planRuns([
      seg("hook", "male-e", "Opening."),
      seg("step-reflect", "male-e", "Let's look."),
      seg("reflection-1", "female-d", "One."),
      seg("reflection-2", "female-d", "Two."),
      seg("reflection-3", "male-e", "Note."),
      seg("reflection-4", "female-d", "Three."),
      seg("conclusion", "female-d", "This week."),
    ])
    expect(runs.map((r) => r.segments.map((s) => s.id))).toEqual([
      ["hook"],
      ["step-reflect"],
      ["reflection-1", "reflection-2"],
      ["reflection-3"],
      ["reflection-4"],
      ["conclusion"],
    ])
  })
})

describe("runTake", () => {
  it("changes for every card of a run when one sentence or a direction changes", () => {
    const a = planRuns([
      seg("reflection-1", "female-d", "One."),
      seg("reflection-2", "female-d", "Two."),
    ])[0]!
    const b = planRuns([
      seg("reflection-1", "female-d", "One."),
      seg("reflection-2", "female-d", "Two!"),
    ])[0]!
    const c = planRuns([
      seg("reflection-1", "female-d", "One.", "[warmly]"),
      seg("reflection-2", "female-d", "Two."),
    ])[0]!
    expect(runTake(a)).toMatch(/^v4c-/)
    expect(runTake(a)).not.toBe(runTake(b))
    expect(runTake(a)).not.toBe(runTake(c))
    expect(runText(c)).toBe("[warmly] One. Two.")
  })
})

describe("sliceRun", () => {
  const run = planRuns([
    seg("reflection-1", "female-d", "He stopped.", "[slowly]"),
    seg("reflection-2", "female-d", "Then he asked."),
  ])[0]!
  const w = (word: string, startSec: number, endSec: number) => ({
    word,
    startSec,
    endSec,
  })
  const words = [
    w("He", 0.2, 0.4),
    w("stopped.", 0.4, 1.0),
    w("Then", 1.6, 1.8),
    w("he", 1.8, 1.9),
    w("asked.", 1.9, 2.5),
  ]

  it("cuts in the middle of the voice's own pause and rebases word times", () => {
    const cuts = sliceRun(run, words)!
    expect(cuts[0]!.fromSec).toBeCloseTo(0.15)
    expect(cuts[0]!.toSec).toBeCloseTo(1.3)
    expect(cuts[1]!.fromSec).toBeCloseTo(1.3)
    expect(cuts[1]!.toSec).toBeCloseTo(2.8)
    expect(cuts[1]!.words[0]).toEqual({
      word: "Then",
      startSec: expect.closeTo(0.3),
      endSec: expect.closeTo(0.5),
    })
    // The two halves rebuild the whole 0.6s pause with nothing added.
    expect(cuts[1]!.fromSec).toBe(cuts[0]!.toSec)
  })

  it("refuses to cut by guesswork when the alignment's words do not match", () => {
    expect(sliceRun(run, words.slice(1))).toBeUndefined()
  })
})

describe("wordsFromAlignment with v4 audio tags", () => {
  it("drops a tag's characters, so a tagged read yields the plain words", () => {
    const text = "[with quiet conviction] Notice this."
    const chars = [...text]
    const t = chars.map((_, i) => i * 0.01)
    const words = wordsFromAlignment({
      characters: chars,
      character_start_times_seconds: t,
      character_end_times_seconds: t.map((x) => x + 0.01),
    })
    expect(words.map((x) => x.word)).toEqual(["Notice", "this."])
  })
})
