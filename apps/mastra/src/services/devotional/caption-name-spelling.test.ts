import { describe, expect, it } from "vitest"

import { normalizeCaptionNames } from "./caption-name-spelling"

describe("normalizeCaptionNames", () => {
  it("brings the film's spelling in line with the Bible's", () => {
    // The live case: the verse on screen says Zacchaeus, the film's caption a
    // few seconds later said Zaccheus.
    expect(
      normalizeCaptionNames(
        "In Jericho there was a tax collector named Zaccheus.",
      ),
    ).toBe("In Jericho there was a tax collector named Zacchaeus.")
  })

  it("leaves the already-correct spelling alone", () => {
    const ok = "Zacchaeus, hurry and come down."
    expect(normalizeCaptionNames(ok)).toBe(ok)
  })

  it("rewrites every occurrence in a line", () => {
    expect(normalizeCaptionNames("Zaccheus! Zaccheus, come down.")).toBe(
      "Zacchaeus! Zacchaeus, come down.",
    )
  })

  it("does not touch a longer word that merely contains the name", () => {
    // Word-bounded, so nothing that happens to start with the same letters is
    // rewritten mid-token.
    expect(normalizeCaptionNames("Zaccheusville")).toBe("Zaccheusville")
  })

  it("leaves unrelated text exactly as it was", () => {
    const line = "The people were beginning to accept Him as Lord."
    expect(normalizeCaptionNames(line)).toBe(line)
  })
})
