import { describe, expect, it } from "vitest"

import { kineticPhrases, kineticTokens } from "./KineticCaption"

describe("kineticTokens", () => {
  it("finds the hero and accents in a Cyrillic line (Bartimaeus RU)", () => {
    const t = kineticTokens(
      "Он шёл в Иерусалим на смерть, а у дороги кричал какой-то попрошайка.",
      "на смерть",
      ["кричал"],
    )
    expect(t.filter((x) => x.role === "hero").map((x) => x.word)).toEqual([
      "на",
      "смерть,",
    ])
    expect(t.find((x) => x.role === "accent")?.word).toBe("кричал")
  })

  it("does not end a Russian run on a preposition", () => {
    const phrases = kineticPhrases(
      kineticTokens("У Иисуса были все причины пройти мимо.", "пройти мимо", [
        "причины",
      ]),
    )
    for (const ph of phrases)
      expect(["у", "в", "на", "а"]).not.toContain(
        ph[ph.length - 1]!.word.toLowerCase(),
      )
  })
})
