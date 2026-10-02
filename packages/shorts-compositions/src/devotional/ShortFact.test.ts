import { describe, expect, it } from "vitest"

import { captionTokens, kineticPhrases } from "./ShortFact"

const timed = (sentences: string[]) =>
  sentences.flatMap((s, card) =>
    s.split(" ").map((word, i) => ({
      word,
      startSec: card * 10 + i * 0.3,
      endSec: card * 10 + i * 0.3 + 0.25,
      card,
    })),
  )
const said = (ws: { word: string }[][]) =>
  ws.map((p) => p.map((w) => w.word).join(" "))

describe("kineticPhrases", () => {
  it("keeps a sentence that fits whole, and never mixes two sentences", () => {
    expect(
      said(
        kineticPhrases(
          timed([
            "Look at where the younger son had ended up.",
            "Feeding pigs.",
          ]),
        ),
      ),
    ).toEqual(["Look at where the younger son had ended up.", "Feeding pigs."])
  })

  it("cuts a long sentence evenly, at a comma, with no stranded word", () => {
    const p = said(
      kineticPhrases(
        timed([
          "For a Jewish listener, swine were regarded as the most unclean and the most abhorred of all animals.",
        ]),
      ),
    )
    expect(p[0]).toBe("For a Jewish listener,")
    expect(p.every((x) => x.split(" ").length > 1)).toBe(true)
    expect(p.join(" ")).toMatch(/^For a Jewish .* all animals\.$/)
  })
})

describe("captionTokens", () => {
  it("rides a short word with the next and keeps the rest one by one", () => {
    expect(
      captionTokens(
        timed(["In verse 32 the father says it was fitting to celebrate."]),
      ).map((t) => t.word),
    ).toEqual([
      "In verse",
      "32",
      "the father",
      "says",
      "it was",
      "fitting",
      "to celebrate.",
    ])
  })

  it("does not carry a short word across a sentence", () => {
    expect(
      captionTokens(timed(["This had to happen.", "The father"])).map(
        (t) => t.word,
      ),
    ).toEqual(["This", "had", "to happen.", "The father"])
  })
})
