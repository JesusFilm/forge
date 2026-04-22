import { describe, expect, it, vi } from "vitest"
import { searchByExperienceKeyword } from "./experience-keyword-search"

/**
 * Creates a mock knex instance whose `.raw()` records calls and returns
 * the provided rows.
 */
function createMockKnex(rows: Record<string, unknown>[] = []) {
  const raw = vi.fn(async () => ({ rows }))
  return { raw, knex: { raw } }
}

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    experience_id: 1,
    slug: "easter",
    title: "Easter",
    meta_description: "Discover the true meaning of Easter.",
    rank: 0.5,
    ...overrides,
  }
}

describe("searchByExperienceKeyword", () => {
  it("returns results ordered by rank descending", async () => {
    const rows = [
      buildRow({ experience_id: 1, title: "Easter", rank: 0.8 }),
      buildRow({ experience_id: 2, title: "Christmas", rank: 0.4 }),
      buildRow({ experience_id: 3, title: "Advent", rank: 0.2 }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByExperienceKeyword(knex, {
      query: "Easter",
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(3)
    expect(results[0]!.experienceTitle).toBe("Easter")
    expect(results[0]!.rank).toBe(0.8)
    expect(results[1]!.experienceTitle).toBe("Christmas")
    expect(results[1]!.rank).toBe(0.4)
  })

  it("tags every result with resultType=experience and resultId=experienceId", async () => {
    const rows = [buildRow({ experience_id: 7 })]
    const { knex } = createMockKnex(rows)

    const results = await searchByExperienceKeyword(knex, {
      query: "anything",
      locale: "en",
      limit: 10,
    })

    expect(results[0]!.resultType).toBe("experience")
    expect(results[0]!.resultId).toBe(7)
    expect(results[0]!.experienceId).toBe(7)
  })

  it("returns empty array for empty query", async () => {
    const { knex, raw } = createMockKnex()

    const results = await searchByExperienceKeyword(knex, {
      query: "",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it("returns empty array for whitespace-only query", async () => {
    const { knex, raw } = createMockKnex()

    const results = await searchByExperienceKeyword(knex, {
      query: "   ",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it("passes correct SQL parameters to knex.raw", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByExperienceKeyword(knex, {
      query: "Easter",
      locale: "es",
      limit: 20,
    })

    expect(raw).toHaveBeenCalledTimes(1)
    const [sql, bindings] = raw.mock.calls[0]

    // SQL should reference the experiences table, locale filter, and the
    // tsvector expression matching the GIN index.
    expect(sql).toContain("experiences")
    expect(sql).toContain("to_tsvector")
    expect(sql).toContain("plainto_tsquery")
    expect(sql).toContain("ts_rank")
    expect(sql).toContain("e.locale = ?")
    expect(sql).toContain("published_at IS NOT NULL")

    // Bindings: [query (ts_rank), query (WHERE @@), locale, limit]
    expect(bindings).toEqual(["Easter", "Easter", "es", 20])
  })

  it("trims the query before binding to SQL", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByExperienceKeyword(knex, {
      query: "  Easter  ",
      locale: "en",
      limit: 10,
    })

    const [, bindings] = raw.mock.calls[0]
    expect(bindings[0]).toBe("Easter")
    expect(bindings[1]).toBe("Easter")
  })

  it("maps row fields to camelCase result properties", async () => {
    const rows = [
      buildRow({
        experience_id: 42,
        slug: "sermon-on-the-mount",
        title: "Sermon on the Mount",
        meta_description: "An experience about Jesus's teachings.",
        rank: 0.75,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByExperienceKeyword(knex, {
      query: "sermon",
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(1)
    const result = results[0]!
    expect(result.experienceId).toBe(42)
    expect(result.experienceSlug).toBe("sermon-on-the-mount")
    expect(result.experienceTitle).toBe("Sermon on the Mount")
    expect(result.experienceMetaDescription).toBe(
      "An experience about Jesus's teachings.",
    )
    expect(result.rank).toBe(0.75)
  })

  it("handles null optional fields gracefully", async () => {
    const rows = [
      buildRow({
        title: null,
        meta_description: null,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByExperienceKeyword(knex, {
      query: "test",
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(1)
    const result = results[0]!
    expect(result.experienceTitle).toBe("")
    expect(result.experienceMetaDescription).toBeNull()
  })

  it("returns null for imageUrl in v1 (og_image join deferred)", async () => {
    const { knex } = createMockKnex([buildRow()])

    const results = await searchByExperienceKeyword(knex, {
      query: "easter",
      locale: "en",
      limit: 10,
    })

    expect(results[0]!.imageUrl).toBeNull()
  })

  it("returns empty array when no rows match", async () => {
    const { knex } = createMockKnex([])

    const results = await searchByExperienceKeyword(knex, {
      query: "nonexistent",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
  })
})
