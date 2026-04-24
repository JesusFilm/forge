/**
 * Unit tests for hybrid-search retrievers.
 *
 * These tests exercise the mock-Prisma shape so we catch argument-binding
 * and return-shape regressions without requiring a running Postgres.
 * Deeper DB-backed parity testing happens at the orchestrator + route
 * handler level.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  searchVideoSemantic,
  searchVideoKeyword,
  searchExperienceSemantic,
  searchExperienceKeyword,
} from "./hybrid-search-retrievers"

function mockPrisma() {
  const $queryRaw = vi.fn()
  return {
    $queryRaw,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe("searchVideoSemantic", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("returns a RankedItem-shaped row per DB row", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-1",
        video_core_id: "1_Jesus",
        video_slug: "jesus",
        video_title: "Jesus",
        scene_description: "Peter denies Jesus",
        start_seconds: 42.5,
        playback_id: "mux-abc",
        similarity: 0.87,
        embedding_text: "[0.1,0.2]",
      },
    ])

    const rows = await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "en",
      limit: 10,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      resultType: "video",
      resultId: "vid-1",
      videoCoreId: "1_Jesus",
      videoSlug: "jesus",
      videoTitle: "Jesus",
      imageUrl: null,
      sceneDescription: "Peter denies Jesus",
      startSeconds: 42.5,
      playbackId: "mux-abc",
      similarity: 0.87,
      embeddingText: "[0.1,0.2]",
    })
  })

  it("tolerates null playback_id (no matching dub for (edition, locale))", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-2",
        video_core_id: null,
        video_slug: "x",
        video_title: "X",
        scene_description: "d",
        start_seconds: 0,
        playback_id: null,
        similarity: 0.5,
        embedding_text: "[]",
      },
    ])

    const rows = await searchVideoSemantic(prisma, {
      queryEmbedding: "[]",
      locale: "fr",
      limit: 5,
    })

    expect(rows[0]!.playbackId).toBeNull()
    expect(rows[0]!.videoCoreId).toBeNull()
  })

  it("coerces Postgres numeric columns to JS number", async () => {
    // pg returns numeric/float as string on some drivers; we explicitly Number()
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-3",
        video_core_id: null,
        video_slug: "",
        video_title: "",
        scene_description: "",
        start_seconds: "7" as unknown as number,
        playback_id: null,
        similarity: "0.42" as unknown as number,
        embedding_text: "[]",
      },
    ])

    const rows = await searchVideoSemantic(prisma, {
      queryEmbedding: "[]",
      locale: "en",
      limit: 1,
    })

    expect(rows[0]!.startSeconds).toBe(7)
    expect(rows[0]!.similarity).toBeCloseTo(0.42)
  })
})

describe("searchVideoKeyword", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("short-circuits empty query without calling DB", async () => {
    const rows = await searchVideoKeyword(prisma, {
      query: "   ",
      locale: "en",
      limit: 10,
    })
    expect(rows).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("returns keyword rows without scene-level fields", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-1",
        video_core_id: "1_Jesus",
        video_slug: "jesus",
        video_title: "Jesus",
        description: "Film about Jesus",
        rank: 0.0913,
      },
    ])

    const rows = await searchVideoKeyword(prisma, {
      query: "jesus",
      locale: "en",
      limit: 10,
    })

    expect(rows[0]).toMatchObject({
      resultType: "video",
      resultId: "vid-1",
      imageUrl: null,
      description: "Film about Jesus",
      rank: 0.0913,
    })
    // Keyword rows must NOT carry scene-level data (fusion's property merge
    // preserves semantic-list values when both retrievers hit the same video).
    expect(
      (rows[0] as unknown as { startSeconds?: unknown }).startSeconds,
    ).toBeUndefined()
    expect(
      (rows[0] as unknown as { playbackId?: unknown }).playbackId,
    ).toBeUndefined()
    expect(
      (rows[0] as unknown as { embeddingText?: unknown }).embeddingText,
    ).toBeUndefined()
  })
})

describe("searchExperienceSemantic", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("uses ExperienceLocale.id as resultId", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        experience_locale_id: "exp-loc-1",
        slug: "easter",
        title: "Easter",
        meta_description: "The resurrection",
        similarity: 0.75,
      },
    ])

    const rows = await searchExperienceSemantic(prisma, {
      queryEmbedding: "[0.1]",
      locale: "en",
      limit: 10,
    })

    expect(rows[0]).toMatchObject({
      resultType: "experience",
      resultId: "exp-loc-1",
      experienceSlug: "easter",
      experienceTitle: "Easter",
      experienceMetaDescription: "The resurrection",
      imageUrl: null,
      similarity: 0.75,
    })
  })

  it("tolerates null meta_description", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        experience_locale_id: "exp-loc-2",
        slug: "christmas",
        title: "Christmas",
        meta_description: null,
        similarity: 0.6,
      },
    ])

    const rows = await searchExperienceSemantic(prisma, {
      queryEmbedding: "[0.1]",
      locale: "en",
      limit: 1,
    })

    expect(rows[0]!.experienceMetaDescription).toBeNull()
  })
})

describe("searchExperienceKeyword", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("short-circuits empty query without calling DB", async () => {
    const rows = await searchExperienceKeyword(prisma, {
      query: "\t\n ",
      locale: "en",
      limit: 10,
    })
    expect(rows).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("returns experience keyword rows with rank", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        experience_locale_id: "exp-loc-1",
        slug: "easter",
        title: "Easter",
        meta_description: "The resurrection",
        rank: 0.12,
      },
    ])

    const rows = await searchExperienceKeyword(prisma, {
      query: "easter",
      locale: "en",
      limit: 5,
    })

    expect(rows[0]).toMatchObject({
      resultType: "experience",
      resultId: "exp-loc-1",
      experienceSlug: "easter",
      experienceTitle: "Easter",
      imageUrl: null,
      rank: 0.12,
    })
  })
})
