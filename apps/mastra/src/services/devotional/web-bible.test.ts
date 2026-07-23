import { describe, expect, it } from "vitest"

import { lookupVerse, parseReference } from "./web-bible"

const verses = {
  "Luke.8.24":
    "He awoke, and rebuked the wind and the raging of the water; and they ceased, and it was calm.",
  "Luke.8.25": "He said to them, “Where is your faith?”",
  "John.11.25": "Jesus said to her, “I am the resurrection and the life.”",
}

describe("parseReference", () => {
  it("parses a single verse", () => {
    expect(parseReference("Luke 8:24")).toEqual({
      osis: "Luke",
      chapter: 8,
      startVerse: 24,
      endVerse: 24,
    })
  })
  it("parses a range", () => {
    expect(parseReference("Luke 8:24-25")).toMatchObject({
      startVerse: 24,
      endVerse: 25,
    })
  })
  it("maps full book names to osis", () => {
    expect(parseReference("Matthew 8:26")?.osis).toBe("Matt")
    expect(parseReference("John 11:25")?.osis).toBe("John")
  })
  it("returns null for an unknown book or malformed ref", () => {
    expect(parseReference("Genesis 1:1")).toBeNull() // not in Gospels+Acts map
    expect(parseReference("nonsense")).toBeNull()
  })
})

describe("lookupVerse", () => {
  it("returns the exact verse text", () => {
    expect(lookupVerse("Luke 8:25", verses)).toBe(
      "He said to them, “Where is your faith?”",
    )
  })
  it("joins a range", () => {
    expect(lookupVerse("Luke 8:24-25", verses)).toBe(
      "He awoke, and rebuked the wind and the raging of the water; and they ceased, and it was calm. He said to them, “Where is your faith?”",
    )
  })
  it("returns null when a verse in the range is missing", () => {
    expect(lookupVerse("Luke 8:24-26", verses)).toBeNull()
  })
  it("returns null for an unparseable/unknown reference", () => {
    expect(lookupVerse("Genesis 1:1", verses)).toBeNull()
  })
})
