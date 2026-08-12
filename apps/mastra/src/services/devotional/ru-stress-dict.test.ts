import { describe, expect, it } from "vitest"

import { isKnown, stressWord } from "./ru-stress-dict"

const ACUTE = "́" // U+0301

describe("ru-stress-dict", () => {
  it("returns the unambiguous stressed form for common words", () => {
    // The exact words a 5-model LLM ensemble got wrong / right — dict nails all.
    expect(stressWord("набрано")).toBe(`на${ACUTE}брано`)
    expect(stressWord("коробов")).toBe(`коробо${ACUTE}в`)
    expect(stressWord("насытились")).toBe(`насы${ACUTE}тились`)
    expect(stressWord("кусков")).toBe(`куско${ACUTE}в`)
    expect(stressWord("потерянных")).toBe(`поте${ACUTE}рянных`)
  })

  it("returns null for homographs (stress depends on context)", () => {
    // стоит = сто́ит (costs) vs стои́т (stands); замок = за́мок vs замо́к.
    expect(stressWord("стоит")).toBeNull()
    expect(stressWord("замок")).toBeNull()
  })

  it("preserves leading capitalization", () => {
    const lower = stressWord("двенадцать")
    expect(lower).toBe(`двена${ACUTE}дцать`)
    expect(stressWord("Двенадцать")).toBe(`Двена${ACUTE}дцать`)
  })

  it("returns null for unknown / non-dictionary tokens", () => {
    expect(stressWord("зкжщй")).toBeNull()
  })

  it("knows real words and not gibberish", () => {
    expect(isKnown("коробов")).toBe(true)
    expect(isKnown("зкжщй")).toBe(false)
  })
})
