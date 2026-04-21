import { describe, expect, it, vi } from "vitest"
import { searchBySemantic } from "./semantic-search"

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
    scene_index: 0,
    description: "Jesus teaches about forgiveness.",
    start_seconds: 120,
    playback_id: "abc123",
    similarity: 0.85,
    embedding_text: "[0.1,0.2,0.3]",
    ...overrides,
  }
}

const QUERY_EMBEDDING = "[0.1,0.2,0.3,0.4]"

describe("searchBySemantic", () => {
  it("returns mapped results from raw query", async () => {
    const rows = [
      buildRow({ video_id: 1, video_title: "JESUS", similarity: 0.9 }),
      buildRow({
        video_id: 2,
        video_title: "Magdalena",
        similarity: 0.7,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchBySemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(2)
    expect(results[0]!.videoTitle).toBe("JESUS")
    expect(results[0]!.similarity).toBe(0.9)
    expect(results[1]!.videoTitle).toBe("Magdalena")
    expect(results[1]!.similarity).toBe(0.7)
  })

  it("passes correct parameters to knex.raw (embedding, locale, embedding, limit)", async () => {
    const { knex, raw } = createMockKnex([])

    await searchBySemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "es",
      limit: 20,
    })

    expect(raw).toHaveBeenCalledTimes(1)
    const [sql, bindings] = raw.mock.calls[0]

    // The SQL should contain key pgvector constructs
    expect(sql).toContain("DISTINCT ON")
    expect(sql).toContain("?::vector")
    expect(sql).toContain("similarity")
    expect(sql).toContain("scene_embeddings")
    expect(sql).toContain("bcp_47")

    // Bindings: [queryEmbedding, locale, queryEmbedding, limit]
    // queryEmbedding appears twice (once for similarity calc, once for ORDER BY)
    expect(bindings).toEqual([QUERY_EMBEDDING, "es", QUERY_EMBEDDING, 20])
  })

  it("returns empty array when no rows match", async () => {
    const { knex } = createMockKnex([])

    const results = await searchBySemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "en",
      limit: 10,
    })

    expect(results).toEqual([])
  })

  it("maps row fields correctly from snake_case to camelCase", async () => {
    const rows = [
      buildRow({
        video_id: 42,
        video_slug: "sermon-on-the-mount",
        video_title: "Sermon on the Mount",
        video_core_id: "2_GOLumo-0-0",
        image_url: "https://example.com/sermon.jpg",
        scene_index: 3,
        description: "Jesus teaches on the mount.",
        start_seconds: 450,
        playback_id: "mux-playback-xyz",
        similarity: 0.92,
        embedding_text: "[0.5,0.6,0.7]",
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchBySemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
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
    expect(result.sceneIndex).toBe(3)
    expect(result.description).toBe("Jesus teaches on the mount.")
    expect(result.startSeconds).toBe(450)
    expect(result.playbackId).toBe("mux-playback-xyz")
    expect(result.similarity).toBe(0.92)
    expect(result.embeddingText).toBe("[0.5,0.6,0.7]")
  })

  it("handles null optional fields gracefully", async () => {
    const rows = [
      buildRow({
        video_slug: null,
        video_title: null,
        video_core_id: null,
        image_url: null,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchBySemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "en",
      limit: 10,
    })

    expect(results).toHaveLength(1)
    const result = results[0]!
    expect(result.videoSlug).toBe("")
    expect(result.videoTitle).toBe("")
    expect(result.videoCoreId).toBeNull()
    expect(result.imageUrl).toBeNull()
  })

  it("converts similarity to number even if returned as string", async () => {
    const rows = [
      buildRow({
        // PostgreSQL sometimes returns numeric types as strings via knex
        similarity: "0.8765" as unknown as number,
      }),
    ]
    const { knex } = createMockKnex(rows)

    const results = await searchBySemantic(knex, {
      queryEmbedding: QUERY_EMBEDDING,
      locale: "en",
      limit: 5,
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.similarity).toBe(0.8765)
    expect(typeof results[0]!.similarity).toBe("number")
  })
})
