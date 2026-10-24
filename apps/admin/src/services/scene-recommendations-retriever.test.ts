/**
 * Unit tests for scene-recommendations retriever.
 *
 * Like R4's retriever tests, these exercise the mock-Prisma shape for
 * row mapping + argument binding without requiring a running Postgres.
 * DB-backed parity lives at the orchestrator + route handler level.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  fetchInputEmbeddings,
  getEligibleRecommendationVideoIds,
  getRelatedVideoIds,
  queryScenesSimilar,
  resolveSlugToVideoId,
} from "./scene-recommendations-retriever"

function mockPrisma() {
  const $queryRaw = vi.fn()
  return {
    $queryRaw,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe("resolveSlugToVideoId", () => {
  it("returns the cuid id for a known slug", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "vid-abc" }])
    const id = await resolveSlugToVideoId(prisma, "jesus")
    expect(id).toBe("vid-abc")
  })

  it("returns null when the slug does not resolve", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([])
    expect(await resolveSlugToVideoId(prisma, "nope")).toBeNull()
  })
})

describe("fetchInputEmbeddings", () => {
  let prisma: ReturnType<typeof mockPrisma>
  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("returns embeddings for a specific transcript chunk when sceneIndex is provided", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { embedding_text: "[0.1,0.2]", scene_index: 3 },
    ])
    const rows = await fetchInputEmbeddings(prisma, "vid-1", "en", 3)
    expect(rows).toEqual([{ embedding: "[0.1,0.2]", sceneIndex: 3 }])
  })

  it("returns every transcript chunk for the video when sceneIndex is omitted", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { embedding_text: "[0.1]", scene_index: 0 },
      { embedding_text: "[0.2]", scene_index: 1 },
      { embedding_text: "[0.3]", scene_index: 2 },
    ])
    const rows = await fetchInputEmbeddings(prisma, "vid-1", "en")
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.sceneIndex)).toEqual([0, 1, 2])
  })

  it("returns [] when the video has no embedding in the requested locale", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    const rows = await fetchInputEmbeddings(prisma, "vid-1", "fr")
    expect(rows).toEqual([])
  })
})

describe("getRelatedVideoIds", () => {
  it("returns self + parent + child ids", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: "vid-self" },
      { id: "vid-parent" },
      { id: "vid-child-1" },
      { id: "vid-child-2" },
    ])
    const ids = await getRelatedVideoIds(prisma, "vid-self")
    expect(ids).toEqual([
      "vid-self",
      "vid-parent",
      "vid-child-1",
      "vid-child-2",
    ])
  })

  it("returns just self when the video has no relations", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "vid-self" }])
    expect(await getRelatedVideoIds(prisma, "vid-self")).toEqual(["vid-self"])
  })
})

describe("getEligibleRecommendationVideoIds", () => {
  it("returns only the currently visible and playable candidate ids", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "vid-playable" }])

    await expect(
      getEligibleRecommendationVideoIds(
        prisma,
        ["vid-hidden", "vid-playable"],
        "en",
      ),
    ).resolves.toEqual(new Set(["vid-playable"]))
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
  })

  it("avoids a database query for an empty pool", async () => {
    const prisma = mockPrisma()
    await expect(
      getEligibleRecommendationVideoIds(prisma, [], "en"),
    ).resolves.toEqual(new Set())
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})

describe("queryScenesSimilar", () => {
  let prisma: ReturnType<typeof mockPrisma>
  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("maps DB rows to SceneRecommendationRow shape", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-1",
        video_slug: "jesus",
        video_title: "Jesus",
        video_core_id: "1_Jesus",
        scene_index: 0,
        description: "Jesus calls the disciples",
        start_seconds: 12.5,
        end_seconds: 42,
        themes: ["calling"],
        demographics: ["male"],
        spiritual_context: ["discipleship"],
        playback_id: "mux-abc",
        similarity: 0.87,
        embedding_text: "[0.1]",
      },
    ])

    const rows = await queryScenesSimilar(prisma, "[0.1]", "en", ["self"], 10)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      video_id: "vid-1",
      video_slug: "jesus",
      video_title: "Jesus",
      video_core_id: "1_Jesus",
      scene_index: 0,
      description: "Jesus calls the disciples",
      start_seconds: 12.5,
      end_seconds: 42,
      themes: ["calling"],
      demographics: ["male"],
      spiritual_context: ["discipleship"],
      playback_id: "mux-abc",
      similarity: 0.87,
      embedding_text: "[0.1]",
    })
  })

  it("coerces Postgres numeric columns to JS number", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-x",
        video_slug: "x",
        video_title: null,
        video_core_id: null,
        scene_index: 0,
        description: "",
        start_seconds: "7" as unknown as number,
        end_seconds: "9" as unknown as number,
        themes: null,
        demographics: null,
        spiritual_context: null,
        playback_id: "mux-x",
        similarity: "0.42" as unknown as number,
        embedding_text: "[]",
      },
    ])

    const rows = await queryScenesSimilar(prisma, "[]", "en", [], 5)
    expect(rows[0]!.start_seconds).toBe(7)
    expect(rows[0]!.end_seconds).toBe(9)
    expect(rows[0]!.similarity).toBeCloseTo(0.42)
    expect(rows[0]!.themes).toEqual([])
    expect(rows[0]!.demographics).toEqual([])
    expect(rows[0]!.spiritual_context).toEqual([])
  })

  it("returns [] when no rows are returned", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    expect(await queryScenesSimilar(prisma, "[]", "zz", [], 10)).toEqual([])
  })

  it("SQL invariant: transcript-only + DISTINCT ON (video_id) + locale filter + inner mux join + exclude-by-ALL", async () => {
    // Scrapes the tagged-template SQL passed to $queryRaw to assert the
    // load-bearing invariants called out in apps/admin/CLAUDE.md R5
    // section. A silent regression (e.g. LEFT JOIN slipping in, locale
    // filter dropped, DISTINCT ON removed) would pass every other test
    // and break consumer-contract parity only in prod.
    prisma.$queryRaw.mockResolvedValueOnce([])
    await queryScenesSimilar(prisma, "[0.1]", "en", ["self-id"], 10)
    const call = prisma.$queryRaw.mock.calls[0]!
    // Prisma tagged-template hands us an array-like with raw strings.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (call[0] as any).join(" ")
    const sql = String(raw)
    expect(sql).toMatch(/DISTINCT ON\s*\(\s*vt\.video_id\s*\)/)
    expect(sql).toMatch(/FROM video_transcript_chunk/)
    expect(sql).toMatch(/JOIN\s+video_transcript\s+vt/)
    expect(sql).toMatch(/JOIN\s+video\s+v\s+ON\s+v\.id\s*=\s*vt\.video_id/)
    expect(sql).not.toMatch(/video_scene_locale/)
    expect(sql).not.toMatch(/video_scene\b/)
    expect(sql).toMatch(/v\.deleted_at IS NULL/)
    expect(sql).toMatch(/vl\.status\s*=\s*'published'/)
    // INNER JOIN on dub/mux (not LEFT JOIN) — preserves cms's non-null
    // playbackId guarantee. See CLAUDE.md R5 "Common things to remember".
    expect(sql).toMatch(/JOIN LATERAL/)
    expect(sql).not.toMatch(/LEFT JOIN LATERAL/)
    expect(sql).toMatch(/JOIN\s+mux_video\s+mv/)
    expect(sql).not.toMatch(/LEFT\s+JOIN\s+mux_video/)
    expect(sql).toMatch(/mv\.playback_id IS NOT NULL/)
    expect(sql).toMatch(/vtc\.embedding IS NOT NULL/)
    expect(sql).toMatch(/vt\.video_id\s*<>\s*ALL/)
    expect(sql).toMatch(/vtc\.felt_needs/)
    expect(sql).toMatch(/vtc\.spiritual_context/)
  })

  it("resolveSlugToVideoId SQL invariant: deleted_at filter bound to slug parameter", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([])
    await resolveSlugToVideoId(prisma, "jesus")
    const call = prisma.$queryRaw.mock.calls[0]!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = String((call[0] as any).join(" "))
    expect(sql).toMatch(/FROM video/)
    expect(sql).toMatch(/deleted_at IS NULL/)
  })

  it("preserves null end_seconds", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "v",
        video_slug: "s",
        video_title: "T",
        video_core_id: null,
        scene_index: 0,
        description: "",
        start_seconds: 0,
        end_seconds: null,
        themes: [],
        demographics: [],
        spiritual_context: [],
        playback_id: "m",
        similarity: 0.5,
        embedding_text: "[]",
      },
    ])
    const rows = await queryScenesSimilar(prisma, "[]", "en", [], 1)
    expect(rows[0]!.end_seconds).toBeNull()
  })
})
