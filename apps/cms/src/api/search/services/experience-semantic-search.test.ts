import { describe, expect, it, vi } from "vitest"
import { searchByExperienceSemantic } from "./experience-semantic-search"

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
    meta_description:
      "Discover the true meaning of Easter through story and scripture.",
    similarity: 0.9,
    ...overrides,
  }
}

const QUERY_EMBEDDING = "[0.1,0.2,0.3,0.4]"

describe("searchByExperienceSemantic", () => {
  it("returns mapped results from raw query", async () => {
    const rows = [
      buildRow({ experience_id: 1, title: "Easter", similarity: 0.95 }),
      buildRow({ experience_id: 2, title: "Christmas", similarity: 0.7 }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByExperienceSemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(2)
    expect(results[0]!.experienceTitle).toBe("Easter")
    expect(results[0]!.similarity).toBe(0.95)
    expect(results[1]!.experienceTitle).toBe("Christmas")
    expect(results[1]!.similarity).toBe(0.7)
  })

  it("tags every result with resultType=experience and resultId=experienceId", async () => {
    const rows = [buildRow({ experience_id: 7 })]
    const { knex } = createMockKnex(rows)

    const results = await searchByExperienceSemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "en",
      limit: 10,
    })

    expect(results[0]!.resultType).toBe("experience")
    expect(results[0]!.resultId).toBe(7)
    expect(results[0]!.experienceId).toBe(7)
  })

  it("passes correct parameters to knex.raw (embedding, locale, embedding, limit)", async () => {
    const { knex, raw } = createMockKnex([])

    await searchByExperienceSemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "es",
      limit: 25,
    })

    expect(raw).toHaveBeenCalledTimes(1)
    const [sql, bindings] = raw.mock.calls[0]

    // SQL should reference experience_embeddings, locale filter, and ?::vector.
    expect(sql).toContain("experience_embeddings")
    expect(sql).toContain("?::vector")
    expect(sql).toContain("ee.locale = ?")
    expect(sql).toContain("published_at IS NOT NULL")

    // Bindings: [queryEmbedding, locale, queryEmbedding, limit]
    // queryEmbedding appears twice (once for similarity calc, once for ORDER BY).
    expect(bindings).toEqual([QUERY_EMBEDDING, "es", QUERY_EMBEDDING, 25])
  })

  it("returns empty array when no rows match", async () => {
    const { knex } = createMockKnex([])

    const results = await searchByExperienceSemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
  })

  it("maps row fields correctly from snake_case to camelCase", async () => {
    const rows = [
      buildRow({
        experience_id: 42,
        slug: "sermon-on-the-mount",
        title: "Sermon on the Mount",
        meta_description: "An experience about the teachings of Jesus.",
        similarity: 0.82,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByExperienceSemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(1)
    const result = results[0]!
    expect(result.experienceId).toBe(42)
    expect(result.experienceSlug).toBe("sermon-on-the-mount")
    expect(result.experienceTitle).toBe("Sermon on the Mount")
    expect(result.experienceMetaDescription).toBe(
      "An experience about the teachings of Jesus.",
    )
    expect(result.similarity).toBe(0.82)
  })

  it("handles null optional fields gracefully", async () => {
    const rows = [
      buildRow({
        title: null,
        meta_description: null,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByExperienceSemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
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

    const results = await searchByExperienceSemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "en",
      limit: 10,
    })

    expect(results[0]!.imageUrl).toBeNull()
  })

  it("propagates knex.raw rejections to the caller (no internal swallow)", async () => {
    // The orchestrator wraps this in Promise.allSettled — the search
    // function itself must let DB errors surface so they can be logged
    // with the correct retrieval label.
    const dbError = new Error("relation experience_embeddings does not exist")
    const knex = { raw: vi.fn().mockRejectedValue(dbError) }

    await expect(
      searchByExperienceSemantic(knex, {
        queryEmbedding: QUERY_EMBEDDING,
        locale: "en",
        limit: 10,
      }),
    ).rejects.toThrow("relation experience_embeddings does not exist")
  })

  it("converts similarity to number even if returned as string", async () => {
    const rows = [
      buildRow({
        // PostgreSQL sometimes returns numeric types as strings via knex
        similarity: "0.7531" as unknown as number,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchByExperienceSemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "en",
      limit: 5,
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.similarity).toBe(0.7531)
    expect(typeof results[0]!.similarity).toBe("number")
  })
})
