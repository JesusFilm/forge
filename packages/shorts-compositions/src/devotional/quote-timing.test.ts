import { describe, expect, it } from "vitest"

import { quoteIntroTimeline, readSec } from "./quote-timing"

describe("quoteIntroTimeline", () => {
  const input = {
    quoteA: "You can never begin to be good",
    quoteB: "until you can feel and confess that you are bad.",
    questions: [
      "Does Jesus really say this?",
      "What does this mean?",
      "How does it affect my life?",
    ],
  }

  it("brings the second half in only once the first is nearly read", () => {
    const t = quoteIntroTimeline(input)
    const firstRead = t.quoteAt[0] + readSec(input.quoteA)
    // Arrives late in the first half's reading, never before it is mostly read.
    expect(t.quoteAt[1]).toBeGreaterThan(t.quoteAt[0] + 1.2)
    expect(t.quoteAt[1]).toBeLessThan(firstRead)
  })

  it("keeps the quotation up until the second half has been read", () => {
    const t = quoteIntroTimeline(input)
    expect(t.quoteOutAt).toBeGreaterThanOrEqual(
      t.quoteAt[1] + readSec(input.quoteB),
    )
  })

  it("gives the LAST question its full reading time before the block leaves", () => {
    const t = quoteIntroTimeline(input)
    const last = t.questionsAt[t.questionsAt.length - 1]
    // The owner's report: the last question was gone before she finished it.
    expect(t.questionsOutAt - last).toBeGreaterThanOrEqual(
      readSec(input.questions[2]),
    )
  })

  it("never overlaps the questions with the invitation", () => {
    const t = quoteIntroTimeline(input)
    expect(t.watchAt).toBeGreaterThan(t.questionsOutAt + 0.4)
    expect(t.totalSec).toBeGreaterThan(t.watchAt)
  })

  it("scales with the text: a longer line buys more time", () => {
    const short = quoteIntroTimeline({ ...input, quoteB: "until you feel it." })
    const long = quoteIntroTimeline(input)
    expect(long.totalSec).toBeGreaterThan(short.totalSec)
  })
})
