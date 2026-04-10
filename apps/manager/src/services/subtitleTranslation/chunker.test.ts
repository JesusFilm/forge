import { describe, expect, it } from "vitest"
import { chunkSegments } from "./chunker"

describe("chunkSegments", () => {
  it("returns an empty array for no segments", () => {
    expect(chunkSegments([])).toEqual([])
  })

  it("keeps chunk indices sequential and preserves derived fields", () => {
    const chunks = chunkSegments([
      { start: 0, end: 1, text: "Hello" },
      { start: 1, end: 2, text: "world." },
      { start: 2, end: 3, text: "Next" },
      { start: 3, end: 5, text: "sentence." },
    ])

    expect(chunks).toEqual([
      {
        index: 0,
        segments: [
          { start: 0, end: 1, text: "Hello" },
          { start: 1, end: 2, text: "world." },
          { start: 2, end: 3, text: "Next" },
          { start: 3, end: 5, text: "sentence." },
        ],
        startTime: 0,
        endTime: 5,
        sourceText: "Hello world. Next sentence.",
      },
    ])
  })

  it("never exceeds the max chunk size when no sentence boundary exists", () => {
    const chunks = chunkSegments(
      Array.from({ length: 10 }, (_, index) => ({
        start: index,
        end: index + 1,
        text: `Segment ${index + 1}`,
      })),
    )

    expect(chunks.map((chunk) => chunk.segments.length)).toEqual([6, 4])
    expect(chunks.every((chunk) => chunk.segments.length <= 6)).toBe(true)
  })
})
