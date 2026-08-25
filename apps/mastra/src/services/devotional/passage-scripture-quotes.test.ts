import { describe, expect, it } from "vitest"

import { balanceQuotes } from "./passage-scripture"

/**
 * A verse pulled out of a longer speech keeps whichever quote mark happened to
 * fall inside it. Luke 19:10 is the live case: the WEB text closes a quotation
 * that opened in verse 9, so the verse shown on screen ends on a mark that
 * never opened. It reads as a typo and goes into the narration as-is.
 */
describe("balanceQuotes", () => {
  it("drops the orphaned closing mark from a verse lifted mid-speech", () => {
    const luke1910 =
      "For the Son of Man came to seek and to save that which was lost.”"
    expect(balanceQuotes(luke1910)).toBe(
      "For the Son of Man came to seek and to save that which was lost.",
    )
  })

  it("leaves a verse whose quotation is complete exactly as printed", () => {
    // Luke 19:5 opens AND closes its quotation, so nothing is orphaned and the
    // punctuation must survive untouched — this is the case that a naive
    // "strip all quotes" fix would silently damage.
    const luke195 =
      "When Jesus came to the place, he looked up and said to him, “Zacchaeus, hurry and come down, for today I must stay at your house.”"
    expect(balanceQuotes(luke195)).toBe(luke195)
  })

  it("drops the orphan when the OPENING mark is the stray one", () => {
    const opening = "“Zacchaeus, hurry and come down, for today I must stay"
    expect(balanceQuotes(opening)).toBe(
      "Zacchaeus, hurry and come down, for today I must stay",
    )
  })

  it("treats straight and curly marks as the same character", () => {
    // The corpus mixes both, so counting only one kind would leave odd counts
    // uncorrected — or worse, "correct" a balanced pair.
    expect(balanceQuotes('He said, "come down.”')).toBe('He said, "come down.”')
    expect(balanceQuotes('and it was calm."')).toBe("and it was calm.")
  })

  it("does not strand a space before the punctuation it removed", () => {
    expect(balanceQuotes("that which was lost . ”")).toBe(
      "that which was lost.",
    )
  })

  it("leaves a verse with no quote marks untouched", () => {
    const plain = "He rebuked the wind and the raging water; and it was calm."
    expect(balanceQuotes(plain)).toBe(plain)
  })
})
