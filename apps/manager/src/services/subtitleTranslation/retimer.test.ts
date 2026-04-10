import { beforeEach, describe, expect, it, vi } from "vitest"

const { structuredOutputMock } = vi.hoisted(() => ({
  structuredOutputMock: vi.fn(),
}))

vi.mock("@/services/openrouter", () => ({
  DEFAULT_MODEL: "test-model",
  createStructuredOpenrouterOutput: structuredOutputMock,
}))

import {
  deterministicRetime,
  retimeChunk,
  validateRetimingOutput,
} from "./retimer"
import type { Chunk } from "./types"

function buildChunk(startTime: number, endTime: number): Chunk {
  return {
    index: 0,
    segments: [
      {
        start: startTime,
        end: (startTime + endTime) / 2,
        text: "Original opening",
      },
      {
        start: (startTime + endTime) / 2,
        end: endTime,
        text: "Original closing",
      },
    ],
    startTime,
    endTime,
    sourceText: "Source text",
  }
}

describe("retimeChunk", () => {
  beforeEach(() => {
    structuredOutputMock.mockReset()
  })

  it("returns valid segments from the structured output helper", async () => {
    const chunk = buildChunk(0, 10)
    const translatedText = "Bonjour le monde"
    const validSegments = [
      { start: 0, end: 5, text: "Bonjour" },
      { start: 5, end: 10, text: "le monde" },
    ]

    structuredOutputMock.mockResolvedValue({
      segments: validSegments,
    })

    await expect(retimeChunk(chunk, translatedText, "French")).resolves.toEqual(
      validSegments,
    )

    expect(structuredOutputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "subtitle retiming chunk 0",
        name: "subtitle_retiming",
        model: "test-model",
      }),
    )
  })

  it("retries after a helper failure and returns the next valid response", async () => {
    const chunk = buildChunk(0, 10)
    const translatedText = "Bonjour le monde"
    const validSegments = [
      { start: 0, end: 5, text: "Bonjour" },
      { start: 5, end: 10, text: "le monde" },
    ]

    structuredOutputMock
      .mockRejectedValueOnce(
        new Error("Structured output parsing failed for subtitle retiming"),
      )
      .mockResolvedValueOnce({
        segments: validSegments,
      })

    await expect(retimeChunk(chunk, translatedText, "French")).resolves.toEqual(
      validSegments,
    )

    expect(structuredOutputMock).toHaveBeenCalledTimes(2)
  })

  it("retries with correction feedback after semantic validation fails", async () => {
    const chunk = buildChunk(0, 10)
    const translatedText = "Bonjour le monde"

    structuredOutputMock
      .mockResolvedValueOnce({
        segments: [
          { start: 0, end: 5.2, text: "Bonjour" },
          { start: 5, end: 10, text: "le monde" },
        ],
      })
      .mockResolvedValueOnce({
        segments: [
          { start: 0, end: 5, text: "Bonjour" },
          { start: 5, end: 10, text: "le monde" },
        ],
      })

    await expect(retimeChunk(chunk, translatedText, "French")).resolves.toEqual(
      [
        { start: 0, end: 5, text: "Bonjour" },
        { start: 5, end: 10, text: "le monde" },
      ],
    )

    expect(structuredOutputMock).toHaveBeenCalledTimes(2)
    expect(
      structuredOutputMock.mock.calls[1]?.[0]?.messages?.[1]?.content,
    ).toContain("Segments 0 and 1 overlap: 5.2 > 5")
  })

  it("falls back deterministically after repeated helper failures", async () => {
    const chunk = buildChunk(0, 14)
    const translatedText = "Bonjour le monde comment allez vous"

    structuredOutputMock
      .mockRejectedValueOnce(new Error("OpenRouter timeout"))
      .mockRejectedValueOnce(new Error("OpenRouter timeout"))

    await expect(retimeChunk(chunk, translatedText, "French")).resolves.toEqual(
      deterministicRetime(chunk, translatedText),
    )
  })

  it("falls back deterministically after repeated invalid segment layouts", async () => {
    const chunk = buildChunk(0, 10)
    const translatedText = "Bonjour le monde"

    structuredOutputMock
      .mockResolvedValueOnce({
        segments: [{ start: 0, end: 8, text: translatedText }],
      })
      .mockResolvedValueOnce({
        segments: [{ start: -1, end: 6, text: translatedText }],
      })

    await expect(retimeChunk(chunk, translatedText, "French")).resolves.toEqual(
      deterministicRetime(chunk, translatedText),
    )
  })
})

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
