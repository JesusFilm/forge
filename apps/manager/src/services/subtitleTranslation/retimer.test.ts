import { describe, expect, it } from "vitest"
import { deterministicRetime, validateRetimingOutput } from "./retimer"
import type { Chunk } from "./types"

function buildChunk(startTime: number, endTime: number): Chunk {
  return {
    index: 0,
    segments: [],
    startTime,
    endTime,
    sourceText: "Source text",
  }
}

describe("validateRetimingOutput", () => {
  it("returns no errors for valid segments within the chunk window", () => {
    const chunk = buildChunk(0, 10)

    expect(
      validateRetimingOutput(
        [
          { start: 0, end: 5, text: "Bonjour" },
          { start: 5, end: 10, text: "le monde" },
        ],
        chunk,
      ),
    ).toEqual([])
  })

  it("reports overlap errors", () => {
    const chunk = buildChunk(0, 10)

    expect(
      validateRetimingOutput(
        [
          { start: 0, end: 5.2, text: "Bonjour" },
          { start: 5, end: 10, text: "le monde" },
        ],
        chunk,
      ),
    ).toContain("Segments 0 and 1 overlap: 5.2 > 5")
  })
})

describe("deterministicRetime", () => {
  it("splits a 14 second chunk into two valid slots", () => {
    const chunk = buildChunk(0, 14)
    const result = deterministicRetime(
      chunk,
      "Bonjour le monde comment allez vous",
    )

    expect(result).toEqual([
      { start: 0, end: 7, text: "Bonjour le monde" },
      { start: 7, end: 14, text: "comment allez vous" },
    ])
    expect(validateRetimingOutput(result, chunk)).toEqual([])
  })

  it("uses a single slot for short chunks", () => {
    const chunk = buildChunk(0, 5)

    expect(deterministicRetime(chunk, "Hola mundo")).toEqual([
      { start: 0, end: 5, text: "Hola mundo" },
    ])
  })
})
