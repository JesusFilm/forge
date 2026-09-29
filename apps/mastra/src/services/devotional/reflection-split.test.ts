import { describe, expect, it } from "vitest"

import { splitReflection } from "./reflection-split"

describe("splitReflection", () => {
  it("puts one sentence on each card", () => {
    expect(splitReflection("First one. Second one! Third?")).toEqual([
      "First one.",
      "Second one!",
      "Third?",
    ])
  })

  it("keeps a closing quote with the sentence it closes", () => {
    expect(splitReflection('He said, "Go." Then he left.')).toEqual([
      'He said, "Go."',
      "Then he left.",
    ])
  })

  it("does not end a sentence at an author's initials", () => {
    // The vineyard script: "J.C. Ryle says it without softening" came out as a
    // card reading only "J.C.", voiced on its own.
    expect(
      splitReflection("J.C. Ryle says it plainly. Nobody was cheated."),
    ).toEqual(["J.C. Ryle says it plainly.", "Nobody was cheated."])
    expect(splitReflection("As C.S. Lewis put it, grace is odd.")).toEqual([
      "As C.S. Lewis put it, grace is odd.",
    ])
  })

  it("does not end a sentence at a short title", () => {
    expect(splitReflection("St. Paul wrote it. Dr. Luke kept it.")).toEqual([
      "St. Paul wrote it.",
      "Dr. Luke kept it.",
    ])
  })

  it("merges after a sentence that ends on a capital letter alone (known trade-off)", () => {
    // "I." at the end of a sentence looks exactly like an initial, and the rule
    // cannot tell them apart. Merging costs one fuller card; splitting names
    // costs a card that says "J.C." out loud. The reflections almost never end
    // a sentence on "I.", so the merge is the cheaper mistake.
    expect(splitReflection("Nobody but I. Then silence.")).toEqual([
      "Nobody but I. Then silence.",
    ])
  })
})
