import { describe, expect, it } from "vitest"

import { normalizeHighlight } from "./reflection-highlighter"

/**
 * The live failure this guards: gpt-4o-mini, asked for a short phrase copied
 * verbatim, closes it off as a sentence. Reproduced three runs out of three on
 * the Zacchaeus reflection, costing two of the three on-screen accents with
 * nothing logged. The phrases below are that run's actual output.
 */
const FULL =
  "Grace moved first. Zacchaeus had done nothing yet to deserve this. " +
  "That is how conversion begins. Not with you finally becoming good enough, " +
  "but with Christ coming to you while you are still exactly who you are. " +
  "The door of hope is wide open, and it opens from the outside."

describe("normalizeHighlight", () => {
  it("accepts a phrase that is already verbatim", () => {
    expect(normalizeHighlight("Grace moved first.", FULL)).toBe(
      "Grace moved first.",
    )
  })

  it("recovers the phrase the model closed with a full stop", () => {
    // Source has a comma here; the model supplied a period.
    expect(
      normalizeHighlight("Not with you finally becoming good enough.", FULL),
    ).toBe("Not with you finally becoming good enough")
    expect(normalizeHighlight("The door of hope is wide open.", FULL)).toBe(
      "The door of hope is wide open",
    )
  })

  it("handles the other closers a model reaches for", () => {
    // Base phrase chosen to sit MID-sentence ("...nothing yet to deserve
    // this"), so any closer the model appends is one the source lacks.
    for (const suffix of [".", ",", ";", ":", "!", "?", " ", ".  "]) {
      expect(
        normalizeHighlight(`Zacchaeus had done nothing yet${suffix}`, FULL),
      ).toBe("Zacchaeus had done nothing yet")
    }
  })

  it("leaves a phrase that legitimately ends a sentence alone", () => {
    // "Grace moved first." really does end with a period in the source, so
    // stripping it would be wrong — the check order matters.
    expect(normalizeHighlight("Grace moved first.", FULL)).toBe(
      "Grace moved first.",
    )
  })

  it("still REJECTS a paraphrase — only the ending is negotiable", () => {
    // The accent is drawn by locating this exact substring on the card, so a
    // phrase whose words differ would render no emphasis at all.
    expect(normalizeHighlight("Grace moved first of all.", FULL)).toBeNull()
    expect(normalizeHighlight("Grace came first.", FULL)).toBeNull()
    expect(normalizeHighlight("the door of hope is wide open", FULL)).toBeNull()
  })

  it("rejects empty and whitespace-only phrases", () => {
    expect(normalizeHighlight("", FULL)).toBeNull()
    expect(normalizeHighlight("   ", FULL)).toBeNull()
    // A lone mark matches a naive substring test and must still be refused.
    expect(normalizeHighlight(".", FULL)).toBeNull()
    expect(normalizeHighlight("...", FULL)).toBeNull()
  })

  it("returns a phrase that the card can actually find", () => {
    // The contract that matters: whatever comes back must be a substring of the
    // reflection, or the composition highlights nothing.
    for (const raw of [
      "Grace moved first.",
      "The door of hope is wide open.",
      "Not with you finally becoming good enough.",
    ]) {
      const out = normalizeHighlight(raw, FULL)!
      expect(FULL).toContain(out)
    }
  })
})
