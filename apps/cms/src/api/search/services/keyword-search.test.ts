import { describe, expect, it, vi } from "vitest"
import { searchByKeyword } from "./keyword-search"

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
    video_id: 1,
    video_slug: "jesus-film",
    video_title: "JESUS",
    video_core_id: "1_jf6101-0-0",
    image_url: "https://example.com/image.jpg",
    description: "The life of Jesus.",
    rank: 0.5,
    ...overrides,
  }
}

describe("searchByKeyword", () => {
  it("returns results ordered by rank descending", async () => {
    const rows = [
      buildRow({ video_id: 1, video_title: "JESUS", rank: 0.8 }),
      buildRow({ video_id: 2, video_title: "Magdalena", rank: 0.4 }),
      buildRow({ video_id: 3, video_title: "Walking with Jesus", rank: 0.2 }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByKeyword(knex, {
      query: "Jesus",
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(3)
    expect(results[0]!.videoTitle).toBe("JESUS")
    expect(results[0]!.rank).toBe(0.8)
    expect(results[1]!.videoTitle).toBe("Magdalena")
    expect(results[1]!.rank).toBe(0.4)
    expect(results[2]!.videoTitle).toBe("Walking with Jesus")
    expect(results[2]!.rank).toBe(0.2)
  })

  it("returns empty array for empty query", async () => {
    const { knex, raw } = createMockKnex()

    const results = await searchByKeyword(knex, {
      query: "",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it("returns empty array for whitespace-only query", async () => {
    const { knex, raw } = createMockKnex()

    const results = await searchByKeyword(knex, {
      query: "   ",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it("passes correct SQL parameters to knex.raw", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByKeyword(knex, {
      query: "forgiveness",
      locale: "es",
      limit: 20,
    })

    expect(raw).toHaveBeenCalledTimes(1)
    const [sql, bindings] = raw.mock.calls[0]

    // The SQL should contain key tsvector/tsquery constructs
    expect(sql).toContain("to_tsvector")
    expect(sql).toContain("plainto_tsquery")
    expect(sql).toContain("ts_rank")
    expect(sql).toContain("DISTINCT ON")

    // Bindings: [query, locale, query, limit]
    // query appears twice (once for ts_rank, once for WHERE @@)
    expect(bindings).toEqual(["forgiveness", "es", "forgiveness", 20])
  })

  it("maps row fields to camelCase result properties", async () => {
    const rows = [
      buildRow({
        video_id: 42,
        video_slug: "sermon-on-the-mount",
        video_title: "Sermon on the Mount",
        video_core_id: "2_GOLumo-0-0",
        image_url: "https://example.com/sermon.jpg",
        description: "Jesus teaches on the mount.",
        rank: 0.75,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByKeyword(knex, {
      query: "sermon",
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(1)
    const result = results[0]!
    expect(result.videoId).toBe(42)
    expect(result.videoSlug).toBe("sermon-on-the-mount")
    expect(result.videoTitle).toBe("Sermon on the Mount")
    expect(result.videoCoreId).toBe("2_GOLumo-0-0")
    expect(result.imageUrl).toBe("https://example.com/sermon.jpg")
    expect(result.description).toBe("Jesus teaches on the mount.")
    expect(result.rank).toBe(0.75)
  })

  it("handles null optional fields gracefully", async () => {
    const rows = [
      buildRow({
        video_slug: null,
        video_title: null,
        video_core_id: null,
        image_url: null,
        description: null,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByKeyword(knex, {
      query: "test",
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(1)
    const result = results[0]!
    expect(result.videoSlug).toBe("")
    expect(result.videoTitle).toBe("")
    expect(result.videoCoreId).toBeNull()
    expect(result.imageUrl).toBeNull()
    expect(result.description).toBeNull()
  })

  it("returns empty array when no rows match", async () => {
    const { knex } = createMockKnex([])

    const results = await searchByKeyword(knex, {
      query: "nonexistent",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
  })
})
