import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Core } from "@strapi/strapi"
import {
  runBackfill,
  type BackfillOptions,
} from "./backfill-experience-embeddings"

// ---------------------------------------------------------------------------
// Mock indexExperience
// ---------------------------------------------------------------------------

vi.mock("../api/experience/services/experience-embedder", () => ({
  indexExperience: vi.fn(),
}))

import { indexExperience } from "../api/experience/services/experience-embedder"

const mockIndexExperience = vi.mocked(indexExperience)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStrapi(
  rows: Array<{ id: number; locale: string; slug: string }>,
) {
  const raw = vi.fn().mockResolvedValue({ rows })
  const logs: string[] = []

  const strapi = {
    db: {
      connection: { raw, destroy: vi.fn() },
    },
    log: {
      info: vi.fn((msg: string) => logs.push(msg)),
      error: vi.fn((msg: string) => logs.push(msg)),
      warn: vi.fn((msg: string) => logs.push(msg)),
    },
  } as unknown as Core.Strapi

  return { strapi, raw, logs }
}

const defaultOptions: BackfillOptions = { dryRun: false, force: false }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIndexExperience.mockResolvedValue(undefined)
  })

  it("processes all experiences and reports success", async () => {
    const rows = [
      { id: 1, locale: "en", slug: "easter" },
      { id: 2, locale: "en", slug: "christmas" },
      { id: 3, locale: "es", slug: "easter" },
    ]
    const { strapi } = createMockStrapi(rows)

    const result = await runBackfill(strapi, defaultOptions)

    expect(result).toEqual({ success: 3, failure: 0 })
    expect(mockIndexExperience).toHaveBeenCalledTimes(3)
    expect(mockIndexExperience).toHaveBeenCalledWith(strapi, 1, "en")
    expect(mockIndexExperience).toHaveBeenCalledWith(strapi, 2, "en")
    expect(mockIndexExperience).toHaveBeenCalledWith(strapi, 3, "es")
  })

  it("handles individual failures gracefully and continues", async () => {
    const rows = [
      { id: 1, locale: "en", slug: "easter" },
      { id: 2, locale: "en", slug: "christmas" },
      { id: 3, locale: "es", slug: "easter" },
    ]
    const { strapi, logs } = createMockStrapi(rows)

    mockIndexExperience
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("OpenRouter timeout"))
      .mockResolvedValueOnce(undefined)

    const result = await runBackfill(strapi, defaultOptions)

    expect(result).toEqual({ success: 2, failure: 1 })
    expect(mockIndexExperience).toHaveBeenCalledTimes(3)
    expect(logs.some((l) => l.includes("Failed id=2"))).toBe(true)
    expect(logs.some((l) => l.includes("OpenRouter timeout"))).toBe(true)
  })

  it("returns zero counts when no experiences found", async () => {
    const { strapi } = createMockStrapi([])

    const result = await runBackfill(strapi, defaultOptions)

    expect(result).toEqual({ success: 0, failure: 0 })
    expect(mockIndexExperience).not.toHaveBeenCalled()
  })

  it("dry-run logs experiences but does not call indexExperience", async () => {
    const rows = [
      { id: 1, locale: "en", slug: "easter" },
      { id: 2, locale: "es", slug: "easter" },
    ]
    const { strapi, logs } = createMockStrapi(rows)

    const result = await runBackfill(strapi, { dryRun: true, force: false })

    expect(result).toEqual({ success: 2, failure: 0 })
    expect(mockIndexExperience).not.toHaveBeenCalled()
    expect(
      logs.some((l) => l.includes("[dry-run]") && l.includes("id=1")),
    ).toBe(true)
    expect(
      logs.some((l) => l.includes("[dry-run]") && l.includes("id=2")),
    ).toBe(true)
  })

  it("aborts when experience count exceeds limit", async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => ({
      id: i + 1,
      locale: "en",
      slug: `exp-${i + 1}`,
    }))
    const { strapi, logs } = createMockStrapi(rows)

    const result = await runBackfill(strapi, defaultOptions)

    expect(result).toEqual({ success: 0, failure: 10_001 })
    expect(mockIndexExperience).not.toHaveBeenCalled()
    expect(logs.some((l) => l.includes("exceeds limit"))).toBe(true)
  })

  it("force flag overrides guardrails", async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => ({
      id: i + 1,
      locale: "en",
      slug: `exp-${i + 1}`,
    }))
    const { strapi } = createMockStrapi(rows)

    const result = await runBackfill(strapi, { dryRun: false, force: true })

    expect(result.success + result.failure).toBe(10_001)
    expect(mockIndexExperience).toHaveBeenCalledTimes(10_001)
  })

  it("logs progress every 10 experiences", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      locale: "en",
      slug: `exp-${i + 1}`,
    }))
    const { strapi, logs } = createMockStrapi(rows)

    await runBackfill(strapi, defaultOptions)

    const progressLogs = logs.filter((l) => l.includes("Progress:"))
    expect(progressLogs).toHaveLength(2) // at 10 and 20
    expect(progressLogs[0]).toContain("10/25")
    expect(progressLogs[0]).toContain("10 ok")
    expect(progressLogs[1]).toContain("20/25")
  })
})
