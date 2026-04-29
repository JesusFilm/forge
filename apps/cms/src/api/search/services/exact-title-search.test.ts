import { describe, expect, it, vi } from "vitest"
import { searchByExactTitle, tokenizeForExactTitle } from "./exact-title-search"

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
    title_length: 17,
    ...overrides,
  }
}

describe("tokenizeForExactTitle", () => {
  it("splits on whitespace and strips punctuation", () => {
    expect(tokenizeForExactTitle("the Bible project")).toEqual([
      "the",
      "bible",
      "project",
    ])
    expect(tokenizeForExactTitle("the-bible-project!")).toEqual([
      "the",
      "bible",
      "project",
    ])
    expect(tokenizeForExactTitle("Genesis 1-11")).toEqual([
      "genesis",
      "1",
      "11",
    ])
  })

  it("returns [] for empty / whitespace / punctuation-only input", () => {
    expect(tokenizeForExactTitle("")).toEqual([])
    expect(tokenizeForExactTitle("   ")).toEqual([])
    expect(tokenizeForExactTitle("!?-,.")).toEqual([])
  })

  it("preserves accented Unicode letters", () => {
    expect(tokenizeForExactTitle("La Résurrection")).toEqual([
      "la",
      "résurrection",
    ])
  })
})

describe("searchByExactTitle", () => {
  it("short-circuits for empty input", async () => {
    const { knex, raw } = createMockKnex()

    const results = await searchByExactTitle(knex, {
      query: "",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it("short-circuits for punctuation-only input", async () => {
    const { knex, raw } = createMockKnex()

    const results = await searchByExactTitle(knex, {
      query: "!?-",
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it("emits one ILIKE clause per token, ANDed", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByExactTitle(knex, {
      query: "the bible project",
      locale: "en",
      limit: 10,
    })

    const [sql, bindings] = raw.mock.calls[0]!
    // 3 tokens → 3 ILIKE clauses
    const ilikeCount = (sql.match(/v\.title ILIKE \?/g) ?? []).length
    expect(ilikeCount).toBe(3)
    // Bindings: [locale, %the%, %bible%, %project%, limit]
    expect(bindings).toEqual(["en", "%the%", "%bible%", "%project%", 10])
  })

  it("ranks by title length ascending (shorter title = tighter match)", async () => {
    const rows = [
      buildRow({ video_id: 1, video_title: "Bible Project", title_length: 13 }),
      buildRow({
        video_id: 2,
        video_title: "The Bible Project: Genesis 1-11",
        title_length: 31,
      }),
    ]
    const { knex, raw } = createMockKnex(rows)

    await searchByExactTitle(knex, {
      query: "bible project",
      locale: "en",
      limit: 10,
    })

    const [sql] = raw.mock.calls[0]!
    expect(sql).toContain("LENGTH(v.title) AS title_length")
    expect(sql).toContain("ORDER BY sub.title_length ASC")
  })

  it("uses the locale + publish-state join chain", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByExactTitle(knex, {
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

  it("maps row fields to camelCase result properties", async () => {
    const rows = [
      buildRow({
        video_id: 42,
        video_slug: "x",
        video_title: "X Y Z",
        video_core_id: "c",
        image_url: "img",
        description: "d",
        title_length: 5,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByExactTitle(knex, {
      query: "x y z",
      locale: "en",
      limit: 10,
    })

    expect(results[0]).toEqual({
      videoId: 42,
      videoSlug: "x",
      videoTitle: "X Y Z",
      videoCoreId: "c",
      imageUrl: "img",
      description: "d",
      titleLength: 5,
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

    const results = await searchByExactTitle(knex, {
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
