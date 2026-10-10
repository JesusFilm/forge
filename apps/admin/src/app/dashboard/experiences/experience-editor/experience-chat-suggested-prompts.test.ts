import { describe, expect, it } from "vitest"

import { getSuggestedPrompts } from "./experience-chat-suggested-prompts"

describe("getSuggestedPrompts", () => {
  it("returns 4–6 creation-focused prompts for empty `en`, no overlap with populated", () => {
    const empty = getSuggestedPrompts({ canvasState: "empty", locale: "en" })
    const populated = getSuggestedPrompts({
      canvasState: "populated",
      locale: "en",
    })

    expect(empty.length).toBeGreaterThanOrEqual(4)
    expect(empty.length).toBeLessThanOrEqual(6)

    const overlap = empty.filter((p) => populated.includes(p))
    expect(overlap).toEqual([])
  })

  it("returns 4–6 refinement-focused prompts for populated `en`", () => {
    const populated = getSuggestedPrompts({
      canvasState: "populated",
      locale: "en",
    })
    expect(populated.length).toBeGreaterThanOrEqual(4)
    expect(populated.length).toBeLessThanOrEqual(6)
  })

  it("falls back to `en` for unknown locales", () => {
    const unknownEmpty = getSuggestedPrompts({
      canvasState: "empty",
      locale: "xx-ZZ",
    })
    const enEmpty = getSuggestedPrompts({
      canvasState: "empty",
      locale: "en",
    })
    expect(unknownEmpty).toEqual(enEmpty)
  })

  it("`es` has the same item count as `en` for both states", () => {
    const enEmpty = getSuggestedPrompts({ canvasState: "empty", locale: "en" })
    const enPop = getSuggestedPrompts({
      canvasState: "populated",
      locale: "en",
    })
    const esEmpty = getSuggestedPrompts({ canvasState: "empty", locale: "es" })
    const esPop = getSuggestedPrompts({
      canvasState: "populated",
      locale: "es",
    })
    expect(esEmpty.length).toBe(enEmpty.length)
    expect(esPop.length).toBe(enPop.length)
  })

  it("`fr` has the same item count as `en` for both states", () => {
    const enEmpty = getSuggestedPrompts({ canvasState: "empty", locale: "en" })
    const enPop = getSuggestedPrompts({
      canvasState: "populated",
      locale: "en",
    })
    const frEmpty = getSuggestedPrompts({ canvasState: "empty", locale: "fr" })
    const frPop = getSuggestedPrompts({
      canvasState: "populated",
      locale: "fr",
    })
    expect(frEmpty.length).toBe(enEmpty.length)
    expect(frPop.length).toBe(enPop.length)
  })

  it("is pure: same context returns equal arrays", () => {
    const a = getSuggestedPrompts({ canvasState: "empty", locale: "en" })
    const b = getSuggestedPrompts({ canvasState: "empty", locale: "en" })
    expect(a).toEqual(b)
  })
})
