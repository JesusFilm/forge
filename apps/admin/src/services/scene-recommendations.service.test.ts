/**
 * SceneRecommendationsService tests.
 *
 * Mocks the retriever layer (resolveSlug / fetchInputEmbeddings /
 * getRelatedVideoIds / queryScenesSimilar) and verifies mode selection,
 * dedup, VideoNotFoundError semantics, and limit clamping.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  SceneRecommendationsService,
  VideoNotFoundError,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from "./scene-recommendations.service"
import type { SceneRecommendationSqlRow } from "./scene-recommendations-retriever"

vi.mock("./scene-recommendations-retriever", () => ({
  resolveSlugToVideoId: vi.fn(),
  fetchInputEmbeddings: vi.fn(),
  getRelatedVideoIds: vi.fn(),
  getEligibleRecommendationVideoIds: vi.fn(),
  queryScenesSimilar: vi.fn(),
}))

import * as retriever from "./scene-recommendations-retriever"

let rowCounter = 0
function row(
  overrides: Partial<SceneRecommendationSqlRow>,
): SceneRecommendationSqlRow {
  // Unique defaults so dedup layers don't cross-match fixtures. Tests
  // that want collisions set videoCoreId / videoTitle / embeddingText
  // explicitly via overrides.
  const n = ++rowCounter
  return {
    video_id: `vid-${n}`,
    video_slug: `slug-${n}`,
    video_title: `Title ${n}`,
    video_core_id: `core-${n}`,
    scene_index: 0,
    description: "desc",
    start_seconds: 0,
    end_seconds: 10,
    themes: [],
    demographics: [],
    spiritual_context: [],
    playback_id: `mux-${n}`,
    similarity: 0.5,
    // 3-dim orthogonal-ish vectors so defaults don't cosine-collide.
    embedding_text: `[${n % 3 === 0 ? 1 : 0},${n % 3 === 1 ? 1 : 0},${n % 3 === 2 ? 1 : 0}]`,
    ...overrides,
  }
}

function makeService() {
  // Service only reaches prisma through mocked retrievers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new SceneRecommendationsService({ prisma: {} as any })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset row counter so default fixture shapes are hermetic across tests.
  rowCounter = 0
})

describe("SceneRecommendationsService.recheckEligibility", () => {
  it("preserves cache order while dropping candidates that are no longer playable", async () => {
    vi.mocked(
      retriever.getEligibleRecommendationVideoIds,
    ).mockResolvedValueOnce(new Set(["vid-2"]))
    const svc = makeService()
    const first = row({ video_id: "vid-1" })
    const second = row({ video_id: "vid-2" })

    const results = await svc.recheckEligibility(
      [first, second].map((entry) => ({
        videoId: entry.video_id,
        videoSlug: entry.video_slug,
        videoTitle: entry.video_title ?? "",
        imageUrl: null,
        sceneIndex: entry.scene_index,
        description: entry.description,
        startSeconds: entry.start_seconds,
        endSeconds: entry.end_seconds,
        similarity: entry.similarity,
        themes: entry.themes,
        demographics: entry.demographics,
        spiritualContext: entry.spiritual_context,
        playbackId: entry.playback_id,
      })),
      "en",
      "english",
    )

    expect(results.map((item) => item.videoId)).toEqual(["vid-2"])
    expect(retriever.getEligibleRecommendationVideoIds).toHaveBeenCalledWith(
      expect.anything(),
      ["vid-1", "vid-2"],
      "en",
      "english",
    )
  })
})

describe("SceneRecommendationsService.getRecommendations", () => {
  it("throws when neither videoId nor slug is provided", async () => {
    const svc = makeService()
    await expect(svc.getRecommendations({ locale: "en" })).rejects.toThrow(
      "Either videoId or slug must be provided",
    )
  })

  it("resolves slug to videoId then runs the query", async () => {
    vi.mocked(retriever.resolveSlugToVideoId).mockResolvedValueOnce("vid-1")
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 0 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce(["vid-1"])
    vi.mocked(retriever.queryScenesSimilar).mockResolvedValueOnce([
      row({ video_id: "vid-2", similarity: 0.9 }),
    ])

    const svc = makeService()
    const results = await svc.getRecommendations({
      slug: "jesus",
      locale: "en",
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.videoId).toBe("vid-2")
    expect(retriever.resolveSlugToVideoId).toHaveBeenCalledWith(
      expect.anything(),
      "jesus",
    )
  })

  it("throws VideoNotFoundError when slug does not resolve", async () => {
    vi.mocked(retriever.resolveSlugToVideoId).mockResolvedValueOnce(null)
    const svc = makeService()
    await expect(
      svc.getRecommendations({ slug: "nope", locale: "en" }),
    ).rejects.toThrow(VideoNotFoundError)
  })

  it("throws VideoNotFoundError when the seed video has no embeddings in locale", async () => {
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([])
    const svc = makeService()
    await expect(
      svc.getRecommendations({ videoId: "vid-1", locale: "zz" }),
    ).rejects.toThrow(VideoNotFoundError)
  })

  it("takes the single-embedding path when seed has one scene", async () => {
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 0 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce(["vid-1"])
    vi.mocked(retriever.queryScenesSimilar).mockResolvedValueOnce([
      row({ video_id: "vid-2", similarity: 0.9 }),
      row({ video_id: "vid-3", similarity: 0.8 }),
    ])

    const svc = makeService()
    const results = await svc.getRecommendations({
      videoId: "vid-1",
      locale: "en",
    })

    expect(retriever.queryScenesSimilar).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.videoId)).toEqual(["vid-2", "vid-3"])
  })

  it("takes the per-video path when seed has multiple scenes, keeping best-per-candidate", async () => {
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 0 },
      { embedding: "[0.2]", sceneIndex: 1 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce(["vid-1"])

    // scene 0 returns vid-2 at 0.5
    // scene 1 returns vid-2 at 0.9 (better) + vid-3 at 0.4
    vi.mocked(retriever.queryScenesSimilar)
      .mockResolvedValueOnce([
        row({ video_id: "vid-2", similarity: 0.5, scene_index: 0 }),
      ])
      .mockResolvedValueOnce([
        row({ video_id: "vid-2", similarity: 0.9, scene_index: 3 }),
        row({ video_id: "vid-3", similarity: 0.4, scene_index: 0 }),
      ])

    const svc = makeService()
    const results = await svc.getRecommendations({
      videoId: "vid-1",
      locale: "en",
    })

    expect(retriever.queryScenesSimilar).toHaveBeenCalledTimes(2)
    expect(results.map((r) => r.videoId)).toEqual(["vid-2", "vid-3"])
    const vid2 = results.find((r) => r.videoId === "vid-2")!
    expect(vid2.similarity).toBeCloseTo(0.9)
    expect(vid2.sceneIndex).toBe(3)

    // Arg fidelity: each scene's embedding must be passed to its own
    // queryScenesSimilar call in order. Guards against a refactor that
    // accidentally queries the same embedding twice.
    const calls = vi.mocked(retriever.queryScenesSimilar).mock.calls
    expect(calls[0]![1]).toBe("[0.1]")
    expect(calls[1]![1]).toBe("[0.2]")
    // Locale + excludeIds must be identical across calls.
    expect(calls[0]![2]).toBe("en")
    expect(calls[1]![2]).toBe("en")
    expect(calls[0]![3]).toEqual(["vid-1"])
    expect(calls[1]![3]).toEqual(["vid-1"])
  })

  it("per-scene mode (sceneIndex provided) takes the single-embedding path", async () => {
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 5 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce(["vid-1"])
    vi.mocked(retriever.queryScenesSimilar).mockResolvedValueOnce([
      row({ video_id: "vid-2", similarity: 0.9 }),
    ])

    const svc = makeService()
    await svc.getRecommendations({
      videoId: "vid-1",
      locale: "en",
      sceneIndex: 5,
    })

    expect(retriever.fetchInputEmbeddings).toHaveBeenCalledWith(
      expect.anything(),
      "vid-1",
      "en",
      5,
    )
    expect(retriever.queryScenesSimilar).toHaveBeenCalledTimes(1)
  })

  it("maps imageUrl to null (cms parity)", async () => {
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 0 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce(["vid-1"])
    vi.mocked(retriever.queryScenesSimilar).mockResolvedValueOnce([
      row({ video_id: "vid-2" }),
    ])

    const svc = makeService()
    const [rec] = await svc.getRecommendations({
      videoId: "vid-1",
      locale: "en",
    })
    expect(rec!.imageUrl).toBeNull()
  })

  it("removes coreId-prefix duplicates via shared dedup", async () => {
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 0 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce(["vid-1"])
    vi.mocked(retriever.queryScenesSimilar).mockResolvedValueOnce([
      row({ video_id: "vid-2", video_core_id: "promo", similarity: 0.9 }),
      row({ video_id: "vid-3", video_core_id: "promo-AD1x1", similarity: 0.8 }),
    ])

    const svc = makeService()
    const results = await svc.getRecommendations({
      videoId: "vid-1",
      locale: "en",
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.videoId).toBe("vid-2")
  })

  it("removes exact-title duplicates via shared dedup", async () => {
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 0 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce(["vid-1"])
    vi.mocked(retriever.queryScenesSimilar).mockResolvedValueOnce([
      row({
        video_id: "vid-2",
        video_core_id: "a",
        video_title: "Sermon on the Mount",
        similarity: 0.9,
      }),
      row({
        video_id: "vid-3",
        video_core_id: "b",
        video_title: "Sermon on the Mount",
        similarity: 0.8,
      }),
    ])

    const svc = makeService()
    const results = await svc.getRecommendations({
      videoId: "vid-1",
      locale: "en",
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.videoId).toBe("vid-2")
  })

  it("excludes related videos via getRelatedVideoIds", async () => {
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 0 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce([
      "vid-1",
      "vid-parent",
      "vid-child",
    ])
    vi.mocked(retriever.queryScenesSimilar).mockResolvedValueOnce([])

    const svc = makeService()
    await svc.getRecommendations({ videoId: "vid-1", locale: "en" })

    expect(retriever.queryScenesSimilar).toHaveBeenCalledWith(
      expect.anything(),
      "[0.1]",
      "en",
      ["vid-1", "vid-parent", "vid-child"],
      expect.any(Number),
    )
  })

  it("per-video path caps perSceneLimit at MAX_LIMIT", async () => {
    // With limit=30 and OVERFETCH_FACTOR=3, naive math gives 90 — but
    // perSceneLimit is capped at MAX_LIMIT (50) to bound per-scene fan-out.
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 0 },
      { embedding: "[0.2]", sceneIndex: 1 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce(["vid-1"])
    vi.mocked(retriever.queryScenesSimilar).mockResolvedValue([])

    const svc = makeService()
    await svc.getRecommendations({
      videoId: "vid-1",
      locale: "en",
      limit: 30,
    })

    const calls = vi.mocked(retriever.queryScenesSimilar).mock.calls
    expect(calls[0]![4]).toBe(MAX_LIMIT)
    expect(calls[1]![4]).toBe(MAX_LIMIT)
  })

  it("clamps limit to [1, MAX_LIMIT]", async () => {
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 0 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce(["vid-1"])
    vi.mocked(retriever.queryScenesSimilar).mockResolvedValueOnce([])

    const svc = makeService()
    await svc.getRecommendations({
      videoId: "vid-1",
      locale: "en",
      limit: 1000,
    })

    const call = vi.mocked(retriever.queryScenesSimilar).mock.calls[0]!
    const overfetchLimit = call[4]
    // clamped limit = MAX_LIMIT = 50, overfetched by factor 3 = 150
    expect(overfetchLimit).toBe(MAX_LIMIT * 3)
  })

  it("uses DEFAULT_LIMIT when limit is omitted", async () => {
    vi.mocked(retriever.fetchInputEmbeddings).mockResolvedValueOnce([
      { embedding: "[0.1]", sceneIndex: 0 },
    ])
    vi.mocked(retriever.getRelatedVideoIds).mockResolvedValueOnce(["vid-1"])
    vi.mocked(retriever.queryScenesSimilar).mockResolvedValueOnce([])

    const svc = makeService()
    await svc.getRecommendations({ videoId: "vid-1", locale: "en" })

    const call = vi.mocked(retriever.queryScenesSimilar).mock.calls[0]!
    expect(call[4]).toBe(DEFAULT_LIMIT * 3)
  })
})
