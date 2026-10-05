import { describe, expect, it } from "vitest"

import { commentaryPreamble, splitCommentaryPoints } from "./reflection-points"

const FOUR_POINT = `These verses describe the conversion of a soul. The Lord Jesus never changes.

We learn, firstly, from these verses — that no one is too bad to be saved. We see a covetous tax-collector transformed.

We learn, secondly, from these verses — how little are the things on which salvation turns. He climbed a tree.

We learn, thirdly, from these verses — Christ's free compassion towards sinners. Unasked, our Lord stops.

We learn, lastly, from these verses — that converted sinners give evidence. He gave half his goods.`

describe("splitCommentaryPoints", () => {
  it("splits a four-point excerpt on its ordinal lead-ins", () => {
    const points = splitCommentaryPoints(FOUR_POINT)
    expect(points).toHaveLength(4)
    expect(points.map((p) => p.ordinal)).toEqual([
      "firstly",
      "secondly",
      "thirdly",
      "lastly",
    ])
    expect(points.map((p) => p.index)).toEqual([1, 2, 3, 4])
  })

  it("keeps each point's own lead-in sentence with its body, and doesn't bleed into the next", () => {
    const [first, second] = splitCommentaryPoints(FOUR_POINT)
    expect(first.text).toContain("no one is too bad to be saved")
    expect(first.text).toContain("covetous tax-collector")
    expect(first.text).not.toContain("climbed a tree") // that's point 2
    expect(second.text).toContain("climbed a tree")
  })

  it("matches other lead-in verbs, not just 'we learn'", () => {
    const mixed = `We see, firstly, that God is good. Let us observe, secondly, that he is near. We are taught, thirdly, to trust.`
    const points = splitCommentaryPoints(mixed)
    expect(points).toHaveLength(3)
    expect(points[1].text).toContain("he is near")
  })

  it("returns an empty array for continuous exposition (no ordinal structure)", () => {
    const prose =
      "The Gospel of Luke contains many precious things. We see the goodness of God in every chapter."
    expect(splitCommentaryPoints(prose)).toEqual([])
  })

  it("returns an empty array when only ONE ordinal appears (not a multi-point piece)", () => {
    const single =
      "We learn, firstly, that God is patient. There is nothing more to add here."
    expect(splitCommentaryPoints(single)).toEqual([])
  })
})

describe("commentaryPreamble", () => {
  it("returns the text before the first ordinal point", () => {
    expect(commentaryPreamble(FOUR_POINT)).toBe(
      "These verses describe the conversion of a soul. The Lord Jesus never changes.",
    )
  })

  it("returns an empty string when there is no point structure", () => {
    expect(commentaryPreamble("Just continuous prose here.")).toBe("")
  })
})
