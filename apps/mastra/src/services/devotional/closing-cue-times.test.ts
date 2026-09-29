import { describe, expect, it } from "vitest"

import { closingCueTimes } from "./devotional-manifest"
import { EN_LOCALE } from "./devotional-locale"

const timed = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => ({ word, startSec: i, endSec: i + 0.8 }))

describe("closingCueTimes", () => {
  const question = "Whose blessing have you been measuring?"
  const prayer = "Name that person to God."
  const spoken = EN_LOCALE.connectors.questions(question, prayer)

  it("speaks the owner's lead-ins before the question and the prayer", () => {
    expect(spoken).toBe(
      "First, ask yourself: Whose blessing have you been measuring?\n\n" +
        "Talk to God about it: Name that person to God.",
    )
  })

  it("finds the question, the prayer's lead-in and the prayer", () => {
    // 3 lead words, 6 question words, then 5 lead words.
    expect(closingCueTimes(timed(spoken), question, EN_LOCALE.labels)).toEqual({
      questionAtSec: 3,
      prayerAtSec: 9,
      prayerTextAtSec: 14,
    })
  })

  it("does not guess when the words do not line up", () => {
    const off = timed(`Hello ${spoken}`)
    expect(closingCueTimes(off, question, EN_LOCALE.labels)).toEqual({})
    expect(closingCueTimes(undefined, question, EN_LOCALE.labels)).toEqual({})
  })
})
