import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

const { generateExperienceEmbeddingMock } = vi.hoisted(() => ({
  generateExperienceEmbeddingMock: vi.fn(),
}))

const { generateOllamaEmbeddingMock } = vi.hoisted(() => ({
  generateOllamaEmbeddingMock: vi.fn(),
}))

vi.mock("@/services/embeddings.service", () => ({
  generateExperienceEmbedding: generateExperienceEmbeddingMock,
}))

vi.mock("@/services/ollama-embedding.service", () => ({
  generateOllamaEmbedding: generateOllamaEmbeddingMock,
}))

import { loadExperienceAiVideoCandidates } from "./experience-ai.service"
import {
  buildDraftExperienceJsonSchema,
  DraftExperienceSchema,
} from "@forge/experience-schema"

type MockPrisma = PrismaClient & {
  experienceLocale: {
    findUnique: ReturnType<typeof vi.fn>
  }
  video: {
    findMany: ReturnType<typeof vi.fn>
  }
  videoLocale: {
    findMany: ReturnType<typeof vi.fn>
  }
  videoDub: {
    findMany: ReturnType<typeof vi.fn>
  }
  videoImage: {
    findMany: ReturnType<typeof vi.fn>
  }
  $transaction: ReturnType<typeof vi.fn>
}

function makePrisma(): MockPrisma {
  const experienceLocale = {
    findUnique: vi.fn(),
  }
  const video = {
    findMany: vi.fn(),
  }
  const videoLocale = {
    findMany: vi.fn(),
  }
  const videoDub = {
    findMany: vi.fn(),
  }
  const videoImage = {
    findMany: vi.fn(),
  }
  const tx = {
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
  }
  const $transaction = vi.fn((callback) => callback(tx))

  return {
    experienceLocale,
    video,
    videoLocale,
    videoDub,
    videoImage,
    $transaction,
  } as unknown as MockPrisma
}

function seedCatalog(prisma: MockPrisma) {
  prisma.video.findMany.mockResolvedValue([
    {
      id: "video-1",
      slug: "hope-story",
      label: "episode",
      updatedAt: new Date("2026-04-22T10:00:00Z"),
    },
    {
      id: "video-2",
      slug: "prayer-story",
      label: "segment",
      updatedAt: new Date("2026-04-21T10:00:00Z"),
    },
    {
      id: "video-3",
      slug: "fallback-story",
      label: null,
      updatedAt: new Date("2026-04-20T10:00:00Z"),
    },
  ])
  prisma.videoLocale.findMany.mockResolvedValue([
    {
      videoId: "video-1",
      locale: "en",
      title: "Hope Story",
      description: "A hopeful story",
      status: "PUBLISHED",
      updatedAt: new Date("2026-04-22T10:00:00Z"),
    },
    {
      videoId: "video-2",
      locale: "en",
      title: "Prayer Story",
      description: "A prayer story",
      status: "PUBLISHED",
      updatedAt: new Date("2026-04-21T10:00:00Z"),
    },
    {
      videoId: "video-3",
      locale: "en",
      title: "Fallback Story",
      description: null,
      status: "PUBLISHED",
      updatedAt: new Date("2026-04-20T10:00:00Z"),
    },
  ])
  prisma.videoDub.findMany.mockResolvedValue([
    {
      videoId: "video-1",
      hls: "https://example.com/hope.m3u8",
      dash: null,
      share: null,
      language: { bcp47: "en", iso3: "eng", slug: "english" },
      updatedAt: new Date("2026-04-22T10:00:00Z"),
    },
  ])
  prisma.videoImage.findMany.mockResolvedValue([
    {
      videoId: "video-1",
      url: "https://example.com/hope.jpg",
      createdAt: new Date("2026-04-22T10:00:00Z"),
    },
    {
      videoId: "video-2",
      url: null,
      createdAt: new Date("2026-04-21T10:00:00Z"),
    },
  ])
}

describe("loadExperienceAiVideoCandidates", () => {
  beforeEach(() => {
    generateExperienceEmbeddingMock.mockReset()
    generateExperienceEmbeddingMock.mockRejectedValue(
      new Error("not configured"),
    )
    generateOllamaEmbeddingMock.mockReset()
    generateOllamaEmbeddingMock.mockRejectedValue(new Error("not running"))
  })

  it("returns bounded candidates with stable aliases in ranked order", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "hope and prayer",
      limit: 2,
    })

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      ref: "v01",
      videoId: "video-1",
      title: "Hope Story",
      previewImageUrl: "https://example.com/hope.jpg",
      previewStreamUrl: "https://example.com/hope.m3u8",
    })
    expect(candidates[1]).toMatchObject({
      ref: "v02",
      videoId: "video-2",
    })
  })

  it("does not fall back to another language for candidate copy", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    prisma.videoLocale.findMany.mockResolvedValue([
      {
        videoId: "video-1",
        locale: "es",
        title: "Historia de esperanza",
        description: "Una historia esperanzadora",
        status: "PUBLISHED",
        updatedAt: new Date("2026-04-22T10:00:00Z"),
      },
      {
        videoId: "video-2",
        locale: "en",
        title: "Prayer Story",
        description: "A prayer story",
        status: "PUBLISHED",
        updatedAt: new Date("2026-04-21T10:00:00Z"),
      },
    ])

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "hope and prayer",
      limit: 3,
    })

    expect(candidates.map((candidate) => candidate.videoId)).toEqual([
      "video-2",
    ])
    expect(candidates[0]).toMatchObject({
      title: "Prayer Story",
      description: "A prayer story",
    })
  })

  it("requires playable, non-container videos in the catalog query", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)

    await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "hope",
      limit: 2,
    })

    const where = prisma.video.findMany.mock.calls[0]?.[0]?.where
    expect(where).toMatchObject({
      deletedAt: null,
      OR: [{ label: null }, { label: { notIn: ["COLLECTION", "SERIES"] } }],
      dubs: { some: { deletedAt: null, published: true } },
    })
  })

  it("falls back to any playable dub when the locale dub has no stream", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    prisma.videoDub.findMany.mockResolvedValue([
      {
        videoId: "video-1",
        published: true,
        hls: null,
        dash: null,
        share: null,
        language: { bcp47: "en", iso3: "eng", slug: "english" },
        updatedAt: new Date("2026-04-23T10:00:00Z"),
      },
      {
        videoId: "video-1",
        published: true,
        hls: "https://example.com/french.m3u8",
        dash: null,
        share: null,
        language: { bcp47: "fr", iso3: "fra", slug: "french" },
        updatedAt: new Date("2026-04-22T10:00:00Z"),
      },
    ])

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "hope",
      limit: 1,
    })

    expect(candidates[0]?.previewStreamUrl).toBe(
      "https://example.com/french.m3u8",
    )
  })

  it("uses a matching-language dub for preview streams", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    prisma.videoDub.findMany.mockResolvedValue([
      {
        videoId: "video-1",
        hls: "https://example.com/spanish.m3u8",
        dash: null,
        share: null,
        language: { bcp47: "es", iso3: "spa", slug: "spanish" },
        updatedAt: new Date("2026-04-23T10:00:00Z"),
      },
      {
        videoId: "video-1",
        hls: "https://example.com/english.m3u8",
        dash: null,
        share: null,
        language: { bcp47: "en", iso3: "eng", slug: "english" },
        updatedAt: new Date("2026-04-22T10:00:00Z"),
      },
    ])

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "hope",
      limit: 1,
    })

    expect(candidates[0]?.previewStreamUrl).toBe(
      "https://example.com/english.m3u8",
    )
  })

  it("uses scene/transcript vector hits before token ranking", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    generateExperienceEmbeddingMock.mockResolvedValue({
      model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
      dimensions: 2048,
      embedding: Array.from({ length: 2048 }, () => 0.01),
    })
    prisma.$transaction.mockImplementationOnce(async (callback) =>
      callback({
        $executeRawUnsafe: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue([
          { videoId: "video-2", distance: 0.1 },
          { videoId: "video-1", distance: 0.2 },
        ]),
      }),
    )

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "hope and prayer",
      limit: 2,
    })

    expect(generateExperienceEmbeddingMock).toHaveBeenCalledWith(
      "hope and prayer",
    )
    expect(prisma.video.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["video-2", "video-1"] },
          deletedAt: null,
          dubs: { some: expect.objectContaining({ published: true }) },
        }),
      }),
    )
    expect(candidates.map((candidate) => candidate.videoId)).toEqual([
      "video-2",
      "video-1",
    ])
  })

  it("uses the local Ollama vector index when primary embeddings are unavailable", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    generateOllamaEmbeddingMock.mockResolvedValue(
      Array.from({ length: 768 }, () => 0.01),
    )
    prisma.$transaction.mockImplementationOnce(async (callback) =>
      callback({
        $executeRawUnsafe: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue([
          { videoId: "video-2", distance: 0.1 },
          { videoId: "video-1", distance: 0.2 },
        ]),
      }),
    )

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "Jesus",
      limit: 2,
    })

    expect(generateOllamaEmbeddingMock).toHaveBeenCalledWith("Jesus")
    expect(candidates.map((candidate) => candidate.videoId)).toEqual([
      "video-2",
      "video-1",
    ])
  })
})

describe("DraftExperienceSchema block floor", () => {
  it("rejects a draft with a single block (min floor is 2)", () => {
    const result = DraftExperienceSchema.safeParse({
      title: "T",
      metaDescription: "M",
      blocks: [
        {
          t: "videoHero",
          candidateRef: "v01",
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it("accepts a draft with two blocks", () => {
    const result = DraftExperienceSchema.safeParse({
      title: "T",
      metaDescription: "M",
      blocks: [
        { t: "videoHero", candidateRef: "v01" },
        {
          t: "section",
          content: [{ t: "text", heading: "Hi" }],
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})

describe("buildDraftExperienceJsonSchema", () => {
  it("aligns blocks.minItems with the Zod floor of 2", () => {
    const schema = buildDraftExperienceJsonSchema() as Record<string, unknown>
    const properties = schema.properties as Record<string, unknown> | undefined
    const blocks = properties?.blocks as { minItems?: number } | undefined
    expect(blocks?.minItems).toBe(2)
  })
})
