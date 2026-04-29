import { describe, expect, it, vi } from "vitest"
import { searchByTrigram } from "./trigram-search"

function createMockKnex(rows: Record<string, unknown>[] = []) {
  const raw = vi.fn(async () => ({ rows }))
  return { raw, knex: { raw } }
}

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    video_id: 1,
    video_slug: "bible-project",
    video_title: "The Bible Project",
    video_core_id: "bp-1",
    image_url: null,
    description: null,
    similarity: 0.7,
    ...overrides,
  }
}

describe("searchByTrigram", () => {
  it("returns results ordered by similarity descending", async () => {
    const rows = [
      buildRow({ video_id: 1, similarity: 0.85 }),
      buildRow({ video_id: 2, similarity: 0.42 }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByTrigram(knex, {
      query: "bibel project",
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(2)
    expect(results[0]!.similarity).toBe(0.85)
    expect(results[1]!.similarity).toBe(0.42)
  })

  it("returns empty array for empty query", async () => {
    const { knex, raw } = createMockKnex()

    const results = await searchByTrigram(knex, {
      query: "",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it("returns empty array for whitespace-only query", async () => {
    const { knex, raw } = createMockKnex()

    const results = await searchByTrigram(knex, {
      query: "   ",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it("uses %> word-similarity operator on videos.title (matches GIN trigram index)", async () => {
    // The companion GIN index is on `videos.title gin_trgm_ops`. The
    // planner picks it up only for the %> operator on `videos.title`
    // — drift to `%` or to a different column kills index use.
    const { knex, raw } = createMockKnex([])

    await searchByTrigram(knex, {
      query: "bibel project",
      locale: "en",
      limit: 10,
    })

    const [sql] = raw.mock.calls[0]!
    expect(sql).toContain("v.title %> ?")
    expect(sql).toContain("similarity(v.title, ?)")
  })

  it("uses the locale + publish-state join chain", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByTrigram(knex, {
      query: "test",
      locale: "en",
      limit: 10,
    })

    const [sql] = raw.mock.calls[0]!
    expect(sql).toContain("video_variants_video_lnk")
    expect(sql).toContain("vv.published_at IS NOT NULL")
    expect(sql).toContain("l.bcp_47 = ?")
    expect(sql).toContain("DISTINCT ON")
  })

  it("passes [query, locale, query, limit] bindings", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByTrigram(knex, {
      query: "the bibel project",
      locale: "es",
      limit: 25,
    })

    const [, bindings] = raw.mock.calls[0]!
    expect(bindings).toEqual([
      "the bibel project",
      "es",
      "the bibel project",
      25,
    ])
  })

  it("maps row fields to camelCase result properties", async () => {
    const rows = [
      buildRow({
        video_id: 7,
        video_slug: "x",
        video_title: "X",
        video_core_id: "c",
        image_url: "img",
        description: "d",
        similarity: 0.6,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByTrigram(knex, {
      query: "x",
      locale: "en",
      limit: 10,
    })

    expect(results[0]).toEqual({
      videoId: 7,
      videoSlug: "x",
      videoTitle: "X",
      videoCoreId: "c",
      imageUrl: "img",
      description: "d",
      similarity: 0.6,
    })
  })
})
