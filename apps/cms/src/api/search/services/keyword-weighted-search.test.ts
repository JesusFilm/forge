import { describe, expect, it, vi } from "vitest"
import { searchByKeywordWeighted } from "./keyword-weighted-search"
import { WEIGHTED_TSV_EXPR } from "./lexical-sql"

function createMockKnex(rows: Record<string, unknown>[] = []) {
  const raw = vi.fn(async () => ({ rows }))
  return { raw, knex: { raw } }
}

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    video_id: 1,
    video_slug: "bible-project-genesis",
    video_title: "The Bible Project: Genesis",
    video_core_id: "5_bp-genesis-0-0",
    image_url: "https://example.com/img.jpg",
    description: "Animated overview of Genesis.",
    rank: 0.83,
    ...overrides,
  }
}

describe("searchByKeywordWeighted", () => {
  it("returns results ordered by rank descending", async () => {
    const rows = [
      buildRow({ video_id: 1, video_title: "The Bible Project", rank: 0.9 }),
      buildRow({ video_id: 2, video_title: "Project Notes", rank: 0.4 }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByKeywordWeighted(knex, {
      query: "the bible project",
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(2)
    expect(results[0]!.rank).toBe(0.9)
    expect(results[1]!.rank).toBe(0.4)
  })

  it("returns empty array for empty query", async () => {
    const { knex, raw } = createMockKnex()

    const results = await searchByKeywordWeighted(knex, {
      query: "",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it("returns empty array for whitespace-only query", async () => {
    const { knex, raw } = createMockKnex()

    const results = await searchByKeywordWeighted(knex, {
      query: "   ",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it("byte-parity: SQL contains the exact WEIGHTED_TSV_EXPR constant", async () => {
    // The whole point of `lexical-sql.ts` is that the WHERE clause and
    // the GIN index expression are the same string. If this test fails,
    // either this retriever or `ensure-search-lexical.ts` drifted —
    // either way, the GIN index would silently stop being used at runtime.
    const { knex, raw } = createMockKnex([])

    await searchByKeywordWeighted(knex, {
      query: "test",
      locale: "en",
      limit: 10,
    })

    const [sql] = raw.mock.calls[0]!
    expect(sql).toContain(WEIGHTED_TSV_EXPR)
    expect(sql).toContain("websearch_to_tsquery('simple', ?)")
    expect(sql).toContain("ts_rank_cd")
  })

  it("uses the locale + publish-state join chain identical to keyword-search", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByKeywordWeighted(knex, {
      query: "test",
      locale: "en",
      limit: 10,
    })

    const [sql] = raw.mock.calls[0]!
    expect(sql).toContain("video_variants_video_lnk")
    expect(sql).toContain("vv.published_at IS NOT NULL")
    expect(sql).toContain("v.published_at IS NOT NULL")
    expect(sql).toContain("l.bcp_47 = ?")
    expect(sql).toContain("DISTINCT ON")
  })

  it("passes [query, locale, query, limit] bindings", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByKeywordWeighted(knex, {
      query: "the bible project",
      locale: "es",
      limit: 30,
    })

    const [, bindings] = raw.mock.calls[0]!
    expect(bindings).toEqual([
      "the bible project",
      "es",
      "the bible project",
      30,
    ])
  })

  it("trims whitespace from the query before binding", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByKeywordWeighted(knex, {
      query: "  hope  ",
      locale: "en",
      limit: 10,
    })

    const [, bindings] = raw.mock.calls[0]!
    expect(bindings[0]).toBe("hope")
    expect(bindings[2]).toBe("hope")
  })

  it("maps row fields to camelCase result properties", async () => {
    const rows = [
      buildRow({
        video_id: 42,
        video_slug: "sermon",
        video_title: "Sermon",
        video_core_id: "x",
        image_url: "https://example.com/s.jpg",
        description: "snippet",
        rank: 0.75,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByKeywordWeighted(knex, {
      query: "sermon",
      locale: "en",
      limit: 10,
    })

    expect(results[0]).toEqual({
      videoId: 42,
      videoSlug: "sermon",
      videoTitle: "Sermon",
      videoCoreId: "x",
      imageUrl: "https://example.com/s.jpg",
      description: "snippet",
      rank: 0.75,
    })
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

    const results = await searchByKeywordWeighted(knex, {
      query: "x",
      locale: "en",
      limit: 10,
    })

    expect(results[0]).toMatchObject({
      videoSlug: "",
      videoTitle: "",
      videoCoreId: null,
      imageUrl: null,
      description: null,
    })
  })
})
