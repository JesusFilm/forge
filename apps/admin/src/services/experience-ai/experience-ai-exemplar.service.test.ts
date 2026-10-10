import { afterEach, describe, expect, it, vi } from "vitest"
import type { ExemplarRow } from "@/services/experience-ai/experience-ai-exemplar-query"

const { findExemplarMock, findFallbackMock } = vi.hoisted(() => ({
  findExemplarMock: vi.fn(),
  findFallbackMock: vi.fn(),
}))

vi.mock("@/services/experience-ai/experience-ai-exemplar-query", () => ({
  findExperienceExemplar: findExemplarMock,
  findFallbackExperienceExemplar: findFallbackMock,
}))

import { selectExperienceExemplar } from "./experience-ai-exemplar.service"

function row(id: string, distance: number | null): ExemplarRow {
  return {
    id,
    locale: "en",
    title: id,
    metaDescription: null,
    blocks: [{ t: "videoHero", heading: "x" }],
    distance,
  }
}

// Prisma is never touched directly (the query module is mocked).
const PRISMA = {} as never
const INPUT = { prompt: "grief and hope", locale: "en" }

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  findExemplarMock.mockReset()
  findFallbackMock.mockReset()
})

describe("selectExperienceExemplar", () => {
  it("returns the matched row when distance is within the threshold", async () => {
    findExemplarMock.mockResolvedValueOnce([row("match", 0.1)])
    const generateEmbedding = vi.fn(async () => ({ embedding: [0.1, 0.2] }))

    const result = await selectExperienceExemplar(
      { prisma: PRISMA, generateEmbedding },
      INPUT,
    )

    expect(result).toEqual({
      source: "matched",
      distance: 0.1,
      row: row("match", 0.1),
    })
    expect(findFallbackMock).not.toHaveBeenCalled()
  })

  it("falls back to Easter when the best match is over the threshold", async () => {
    findExemplarMock.mockResolvedValueOnce([row("far", 0.9)])
    findFallbackMock.mockResolvedValueOnce(row("easter", null))
    const generateEmbedding = vi.fn(async () => ({ embedding: [0.1] }))

    const result = await selectExperienceExemplar(
      { prisma: PRISMA, generateEmbedding },
      INPUT,
    )

    expect(result?.source).toBe("fallback")
    expect(result?.distance).toBeNull()
    expect(findFallbackMock).toHaveBeenCalledWith(PRISMA, {
      slug: "easter",
      locale: "en",
    })
  })

  it("falls back when there is no match at all", async () => {
    findExemplarMock.mockResolvedValueOnce([])
    findFallbackMock.mockResolvedValueOnce(row("easter", null))
    const generateEmbedding = vi.fn(async () => ({ embedding: [0.1] }))

    const result = await selectExperienceExemplar(
      { prisma: PRISMA, generateEmbedding },
      INPUT,
    )

    expect(result?.source).toBe("fallback")
  })

  it("on embedding error: logs embedding_failure (NOT a no-match) and falls back", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    findFallbackMock.mockResolvedValueOnce(row("easter", null))
    const generateEmbedding = vi.fn(async () => {
      throw new Error("missing_credentials")
    })

    const result = await selectExperienceExemplar(
      { prisma: PRISMA, generateEmbedding },
      INPUT,
    )

    expect(result?.source).toBe("fallback")
    expect(findExemplarMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "event=experience_exemplar.embedding_failure reason=embedding_error",
      ),
    )
  })

  it("on embedding timeout: logs reason=timeout and falls back", async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    findFallbackMock.mockResolvedValueOnce(row("easter", null))
    const generateEmbedding = vi.fn(
      () => new Promise<{ embedding: number[] }>(() => {}),
    )

    const promise = selectExperienceExemplar(
      { prisma: PRISMA, generateEmbedding },
      INPUT,
    )
    await vi.advanceTimersByTimeAsync(10_001)
    const result = await promise

    expect(result?.source).toBe("fallback")
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "event=experience_exemplar.embedding_failure reason=timeout",
      ),
    )
  })

  it("returns null and logs none (at error level) when the Easter fallback is unresolved", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    findExemplarMock.mockResolvedValueOnce([])
    findFallbackMock.mockResolvedValueOnce(null)
    const generateEmbedding = vi.fn(async () => ({ embedding: [0.1] }))

    const result = await selectExperienceExemplar(
      { prisma: PRISMA, generateEmbedding },
      INPUT,
    )

    expect(result).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("event=experience_exemplar.none"),
    )
  })

  it("on relevance-query failure: logs query_failure and falls back", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    findExemplarMock.mockRejectedValueOnce(new Error("pg exploded"))
    findFallbackMock.mockResolvedValueOnce(row("easter", null))
    const generateEmbedding = vi.fn(async () => ({ embedding: [0.1] }))

    const result = await selectExperienceExemplar(
      { prisma: PRISMA, generateEmbedding },
      INPUT,
    )

    expect(result?.source).toBe("fallback")
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("event=experience_exemplar.query_failure"),
    )
  })

  it("short-circuits to fallback without embedding when the prompt is blank", async () => {
    findFallbackMock.mockResolvedValueOnce(row("easter", null))
    const generateEmbedding = vi.fn(async () => ({ embedding: [0.1] }))

    const result = await selectExperienceExemplar(
      { prisma: PRISMA, generateEmbedding },
      { prompt: "   ", locale: "en" },
    )

    expect(generateEmbedding).not.toHaveBeenCalled()
    expect(findExemplarMock).not.toHaveBeenCalled()
    expect(result?.source).toBe("fallback")
  })

  it("forwards excludeExperienceId to the fallback query (no self-reference)", async () => {
    findExemplarMock.mockResolvedValueOnce([])
    findFallbackMock.mockResolvedValueOnce(row("easter", null))
    const generateEmbedding = vi.fn(async () => ({ embedding: [0.1] }))

    await selectExperienceExemplar(
      { prisma: PRISMA, generateEmbedding },
      { ...INPUT, excludeExperienceId: "exp-easter" },
    )

    expect(findFallbackMock).toHaveBeenCalledWith(
      PRISMA,
      expect.objectContaining({ excludeExperienceId: "exp-easter" }),
    )
  })

  it("passes excludeExperienceId through to the relevance query", async () => {
    findExemplarMock.mockResolvedValueOnce([row("m", 0.1)])
    const generateEmbedding = vi.fn(async () => ({ embedding: [0.1] }))

    await selectExperienceExemplar(
      { prisma: PRISMA, generateEmbedding },
      { ...INPUT, excludeExperienceId: "exp-99" },
    )

    expect(findExemplarMock).toHaveBeenCalledWith(
      PRISMA,
      expect.objectContaining({ excludeExperienceId: "exp-99", locale: "en" }),
    )
  })
})
