import { describe, expect, it } from "vitest"

import {
  createConversation,
  deriveTitle,
  NEW_CONVERSATION_TITLE,
} from "./conversations"

describe("createConversation", () => {
  it("starts empty with the default title and a unique id", () => {
    const a = createConversation()
    const b = createConversation()

    expect(a.title).toBe(NEW_CONVERSATION_TITLE)
    expect(a.messages).toEqual([])
    expect(a.id).not.toBe(b.id)
  })
})

describe("deriveTitle", () => {
  it("returns a short message unchanged", () => {
    expect(deriveTitle("Is doubt a sin?")).toBe("Is doubt a sin?")
  })

  it("trims surrounding whitespace and collapses internal runs", () => {
    expect(deriveTitle("  hello   there  \n friend ")).toBe(
      "hello there friend",
    )
  })

  it("keeps a 40-character title whole (boundary)", () => {
    const exactly40 = "a".repeat(40)
    expect(deriveTitle(exactly40)).toBe(exactly40)
  })

  it("truncates a 41-character title to 39 chars + ellipsis", () => {
    const result = deriveTitle("a".repeat(41))
    expect(result).toBe(`${"a".repeat(39)}…`)
    expect(result).toHaveLength(40)
  })

  it("truncates a very long unbroken string to the 40-char ceiling", () => {
    const result = deriveTitle("x".repeat(200))
    expect(result).toBe(`${"x".repeat(39)}…`)
    expect(result).toHaveLength(40)
  })

  it("does not leave a trailing space before the ellipsis", () => {
    // Index 38 (the char the 39-char slice ends on) is a space, so trimEnd
    // must drop it before the ellipsis is appended.
    const text = `${"a".repeat(38)} ${"b".repeat(10)}`
    const result = deriveTitle(text)
    expect(result).toBe(`${"a".repeat(38)}…`)
    expect(result).not.toContain(" …")
  })
})
