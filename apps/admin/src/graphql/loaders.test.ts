// Tests for the per-request DataLoader factory.
//
// The behavior we care about is contract-level — DataLoader's batching
// semantics are the responsibility of the library. We assert:
// - createLoaders returns the expected loader keys
// - each loader is fresh per call (no shared state across "requests")
// - the input-order projection helper preserves order and fills holes
//   with null
//
// Live-DB batching verification lands in the Unit 6d ABAC parity test
// where Prisma query logging confirms the IN-batched fetches.

import { describe, expect, it } from "vitest"
import { createLoaders } from "@/graphql/loaders"

// Minimal Prisma stub — each model only exposes findMany since that's
// what loaders use.
function makeFakePrisma(rowsByModel: Record<string, Array<{ id: string }>>) {
  const make = (key: string) => ({
    findMany: async (args: { where: { id: { in: string[] } } }) => {
      const wanted = new Set(args.where.id.in)
      return rowsByModel[key].filter((r) => wanted.has(r.id))
    },
  })
  return {
    experience: make("experience"),
    experienceLocale: make("experienceLocale"),
    video: make("video"),
    videoImage: { findMany: async () => [] },
    videoLocale: { findMany: async () => [] },
    videoRelation: { findMany: async () => [] },
    videoStudyQuestion: { findMany: async () => [] },
    videoGeneratedQuestion: { findMany: async () => [] },
    bibleCitation: { findMany: async () => [] },
    language: make("language"),
    // Loose typing — each test provides only the delegates it exercises.
  } as unknown as Parameters<typeof createLoaders>[0]
}

describe("createLoaders", () => {
  it("exposes the expected loader keys", () => {
    const loaders = createLoaders(makeFakePrisma({}))
    expect(Object.keys(loaders).sort()).toEqual([
      "experienceById",
      "experienceLocaleById",
      "languageById",
      "videoBibleCitationsByVideoId",
      "videoById",
      "videoByIdWithQuery",
      "videoChildrenByParentId",
      "videoGeneratedQuestionsByVideoIdAndFilter",
      "videoImagesByVideoId",
      "videoLocalesByVideoIdAndFilter",
      "videoMuxHeroPosterBlurDataUrlByIdAndLanguageSlug",
      "videoMuxHeroPosterDominantColorByIdAndLanguageSlug",
      "videoMuxPlaybackIdByIdAndLanguageSlug",
      "videoMuxThumbnailBlurDataUrlByIdAndLanguageSlug",
      "videoMuxThumbnailDominantColorByIdAndLanguageSlug",
      "videoParentsByChildId",
      "videoPrimaryDubDurationById",
      "videoStudyQuestionsByVideoIdAndFilter",
    ])
  })

  it("returns rows in the same order as input keys, with null for missing", async () => {
    const prisma = makeFakePrisma({
      experience: [{ id: "x1" }, { id: "x3" }],
      experienceLocale: [],
      video: [],
      language: [],
    })
    const loaders = createLoaders(prisma)
    const rows = await loaders.experienceById.loadMany(["x1", "x2", "x3"])
    expect(rows).toHaveLength(3)
    expect((rows[0] as { id: string } | null)?.id).toBe("x1")
    expect(rows[1]).toBeNull()
    expect((rows[2] as { id: string } | null)?.id).toBe("x3")
  })

  it("each createLoaders() call is independent (no cross-request leakage)", async () => {
    let calls = 0
    const prisma = {
      experience: {
        findMany: async () => {
          calls++
          return [{ id: "x1" }]
        },
      },
      experienceLocale: { findMany: async () => [] },
      video: { findMany: async () => [] },
      videoRelation: { findMany: async () => [] },
      language: { findMany: async () => [] },
    } as unknown as Parameters<typeof createLoaders>[0]

    const loadersA = createLoaders(prisma)
    const loadersB = createLoaders(prisma)
    await loadersA.experienceById.load("x1")
    await loadersB.experienceById.load("x1")
    // Each request fires its own batched fetch — no cache sharing.
    expect(calls).toBe(2)
  })

  it("dedupes within a single request tick", async () => {
    let calls = 0
    const prisma = {
      experience: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          calls++
          return args.where.id.in.map((id) => ({ id }))
        },
      },
      experienceLocale: { findMany: async () => [] },
      video: { findMany: async () => [] },
      language: { findMany: async () => [] },
    } as unknown as Parameters<typeof createLoaders>[0]

    const loaders = createLoaders(prisma)
    // Three loads in the same tick — one batched fetch.
    await Promise.all([
      loaders.experienceById.load("x1"),
      loaders.experienceById.load("x2"),
      loaders.experienceById.load("x1"), // duplicate; batched + cached
    ])
    expect(calls).toBe(1)
  })

  it("batches video loads that share a Pothos query selection", async () => {
    const calls: Array<{ ids: string[]; query: object }> = []
    const prisma = {
      experience: { findMany: async () => [] },
      experienceLocale: { findMany: async () => [] },
      language: { findMany: async () => [] },
      video: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          calls.push({ ids: args.where.id.in, query: args })
          return args.where.id.in.map((id) => ({ id }))
        },
      },
      videoRelation: { findMany: async () => [] },
    } as unknown as Parameters<typeof createLoaders>[0]

    const loaders = createLoaders(prisma)
    const query = { include: { images: true } }
    await Promise.all([
      loaders.videoByIdWithQuery.load({ id: "v1", query }),
      loaders.videoByIdWithQuery.load({ id: "v2", query }),
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]?.ids).toEqual(["v1", "v2"])
    expect(calls[0]?.query).toMatchObject(query)
  })

  it("does not batch video loads with different Pothos query selections", async () => {
    const calls: Array<{ ids: string[] }> = []
    const prisma = {
      experience: { findMany: async () => [] },
      experienceLocale: { findMany: async () => [] },
      language: { findMany: async () => [] },
      video: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          calls.push({ ids: args.where.id.in })
          return args.where.id.in.map((id) => ({ id }))
        },
      },
      videoRelation: { findMany: async () => [] },
    } as unknown as Parameters<typeof createLoaders>[0]

    const loaders = createLoaders(prisma)
    await Promise.all([
      loaders.videoByIdWithQuery.load({
        id: "v1",
        query: { include: { images: true } },
      }),
      loaders.videoByIdWithQuery.load({
        id: "v2",
        query: { include: { locales: true } },
      }),
    ])

    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.ids)).toEqual([["v1"], ["v2"]])
  })

  it("batches parent relation rows by child id with public visibility", async () => {
    const calls: Array<{ where: unknown }> = []
    const prisma = {
      experience: { findMany: async () => [] },
      experienceLocale: { findMany: async () => [] },
      language: { findMany: async () => [] },
      video: { findMany: async () => [] },
      videoRelation: {
        findMany: async (args: { where: { childId: { in: string[] } } }) => {
          calls.push({ where: args.where })
          return args.where.childId.in.map((childId) => ({
            id: `rel-${childId}`,
            parentId: `parent-${childId}`,
            childId,
          }))
        },
      },
    } as unknown as Parameters<typeof createLoaders>[0]

    const loaders = createLoaders(prisma)
    const rows = await Promise.all([
      loaders.videoParentsByChildId.load({
        videoId: "child-1",
        visibleOnly: true,
      }),
      loaders.videoParentsByChildId.load({
        videoId: "child-2",
        visibleOnly: true,
      }),
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]?.where).toMatchObject({
      childId: { in: ["child-1", "child-2"] },
      parent: {
        deletedAt: null,
        locales: { some: { status: "PUBLISHED", deletedAt: null } },
      },
    })
    expect(rows.map((group) => group.map((row) => row.childId))).toEqual([
      ["child-1"],
      ["child-2"],
    ])
  })

  it("batches child relation rows by parent id with editor visibility", async () => {
    const calls: Array<{ where: unknown }> = []
    const prisma = {
      experience: { findMany: async () => [] },
      experienceLocale: { findMany: async () => [] },
      language: { findMany: async () => [] },
      video: { findMany: async () => [] },
      videoRelation: {
        findMany: async (args: {
          where: { parentId: { in: string[] }; child?: unknown }
        }) => {
          calls.push({ where: args.where })
          return args.where.parentId.in.map((parentId) => ({
            id: `rel-${parentId}`,
            parentId,
            childId: `child-${parentId}`,
          }))
        },
      },
    } as unknown as Parameters<typeof createLoaders>[0]

    const loaders = createLoaders(prisma)
    const rows = await Promise.all([
      loaders.videoChildrenByParentId.load({
        videoId: "parent-1",
        visibleOnly: false,
      }),
      loaders.videoChildrenByParentId.load({
        videoId: "parent-2",
        visibleOnly: false,
      }),
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]?.where).toEqual({
      parentId: { in: ["parent-1", "parent-2"] },
    })
    expect(rows.map((group) => group.map((row) => row.parentId))).toEqual([
      ["parent-1"],
      ["parent-2"],
    ])
  })
})

describe("videoGeneratedQuestionsByVideoIdAndFilter", () => {
  it("batches public locale reads and applies the publication boundary", async () => {
    const calls: unknown[] = []
    const prisma = {
      experience: { findMany: async () => [] },
      experienceLocale: { findMany: async () => [] },
      language: { findMany: async () => [] },
      video: { findMany: async () => [] },
      videoGeneratedQuestion: {
        findMany: async (args: { where: { videoId: { in: string[] } } }) => {
          calls.push(args)
          return args.where.videoId.in.map((videoId) => ({
            id: `generated-${videoId}`,
            videoId,
            question: videoId === "video-2" ? "   " : `Question for ${videoId}`,
            answer: `Answer for ${videoId}`,
          }))
        },
      },
    } as unknown as Parameters<typeof createLoaders>[0]

    const loaders = createLoaders(prisma)
    const rows = await Promise.all([
      loaders.videoGeneratedQuestionsByVideoIdAndFilter.load({
        videoId: "video-1",
        locale: "en",
        languageSlug: "english",
        visibleOnly: true,
      }),
      loaders.videoGeneratedQuestionsByVideoIdAndFilter.load({
        videoId: "video-2",
        locale: "en",
        languageSlug: "english",
        visibleOnly: true,
      }),
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      where: {
        videoId: { in: ["video-1", "video-2"] },
        locale: "en",
        languageSlug: "english",
        status: "PUBLISHED",
        deletedAt: null,
        question: { not: "" },
        answer: { not: "" },
      },
    })
    expect(rows.map((group) => group.map((row) => row.videoId))).toEqual([
      ["video-1"],
      [],
    ])
  })

  it("lets editor-scoped reads inspect malformed non-deleted drafts", async () => {
    const calls: Array<Record<string, unknown>> = []
    const draft = {
      id: "generated-draft",
      videoId: "video-1",
      question: "   ",
      answer: "",
    }
    const prisma = {
      experience: { findMany: async () => [] },
      experienceLocale: { findMany: async () => [] },
      language: { findMany: async () => [] },
      video: { findMany: async () => [] },
      videoGeneratedQuestion: {
        findMany: async (args: Record<string, unknown>) => {
          calls.push(args)
          return [draft]
        },
      },
    } as unknown as Parameters<typeof createLoaders>[0]

    const rows = await createLoaders(
      prisma,
    ).videoGeneratedQuestionsByVideoIdAndFilter.load({
      videoId: "video-1",
      locale: null,
      languageSlug: null,
      visibleOnly: false,
    })

    expect(rows).toEqual([draft])
    expect(calls[0]).toMatchObject({ where: { deletedAt: null } })
    expect(calls[0]).not.toMatchObject({
      where: expect.objectContaining({ status: expect.anything() }),
    })
  })
})

describe("videoPrimaryDubDurationById", () => {
  // Stub video.findMany returning the loader's exact selection shape:
  // { id, primaryLanguageId, dubs: [{ languageId, duration }] }. The
  // `dubs` here stand in for the already-WHERE-filtered playable set
  // (published + hls + duration>0), pre-sorted by duration desc as the
  // loader's query asks Postgres to do.
  type VideoStub = {
    id: string
    primaryLanguageId: string | null
    dubs: Array<{ languageId: string | null; duration: number | null }>
  }
  function makePrisma(rows: VideoStub[]) {
    return {
      experience: { findMany: async () => [] },
      experienceLocale: { findMany: async () => [] },
      language: { findMany: async () => [] },
      video: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          const wanted = new Set(args.where.id.in)
          return rows.filter((r) => wanted.has(r.id))
        },
      },
    } as unknown as Parameters<typeof createLoaders>[0]
  }

  it("prefers the primary-language dub over the longest dub", async () => {
    const loaders = createLoaders(
      makePrisma([
        {
          id: "v1",
          primaryLanguageId: "lang-en",
          // Longest is the non-primary 'es' dub; primary 'en' must still win.
          dubs: [
            { languageId: "lang-es", duration: 9000 },
            { languageId: "lang-en", duration: 7674 },
          ],
        },
      ]),
    )
    expect(await loaders.videoPrimaryDubDurationById.load("v1")).toBe(7674)
  })

  it("falls back to the longest (first) dub when the primary language has no playable dub", async () => {
    const loaders = createLoaders(
      makePrisma([
        {
          id: "v1",
          primaryLanguageId: "lang-en",
          dubs: [
            { languageId: "lang-es", duration: 9000 },
            { languageId: "lang-fr", duration: 8000 },
          ],
        },
      ]),
    )
    expect(await loaders.videoPrimaryDubDurationById.load("v1")).toBe(9000)
  })

  it("returns null when the video has no playable dub", async () => {
    const loaders = createLoaders(
      makePrisma([{ id: "v1", primaryLanguageId: "lang-en", dubs: [] }]),
    )
    expect(await loaders.videoPrimaryDubDurationById.load("v1")).toBeNull()
  })

  it("returns null for a video id with no matching row", async () => {
    const loaders = createLoaders(makePrisma([]))
    expect(await loaders.videoPrimaryDubDurationById.load("missing")).toBeNull()
  })

  it("batches multiple ids into one query and preserves input order", async () => {
    let calls = 0
    const base = makePrisma([
      { id: "v1", primaryLanguageId: "lang-en", dubs: [] },
      {
        id: "v2",
        primaryLanguageId: null,
        dubs: [{ languageId: null, duration: 120 }],
      },
    ])
    const prisma = {
      ...base,
      video: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          calls++
          return (
            base as unknown as {
              video: { findMany: (a: unknown) => Promise<unknown> }
            }
          ).video.findMany(args)
        },
      },
    } as unknown as Parameters<typeof createLoaders>[0]

    const loaders = createLoaders(prisma)
    const result = await loaders.videoPrimaryDubDurationById.loadMany([
      "v2",
      "missing",
      "v1",
    ])
    expect(calls).toBe(1)
    expect(result).toEqual([120, null, null])
  })
})

describe("videoMuxPlaybackIdByIdAndLanguageSlug", () => {
  type ExactDubStub = {
    videoId: string
    language: { slug: string | null } | null
    muxVideo: { playbackId: string | null } | null
  }
  type VideoStub = {
    id: string
    primaryLanguageId: string | null
    dubs: Array<{
      languageId: string | null
      muxVideo: { playbackId: string | null } | null
    }>
  }

  function makePlaybackPrisma({
    exactDubs,
    fallbackVideos,
    onExactFindMany,
    onVideoFindMany,
  }: {
    exactDubs?: ExactDubStub[]
    fallbackVideos?: VideoStub[]
    onExactFindMany?: (args: unknown) => void
    onVideoFindMany?: (args: unknown) => void
  }) {
    return {
      experience: { findMany: async () => [] },
      experienceLocale: { findMany: async () => [] },
      language: { findMany: async () => [] },
      videoDub: {
        findMany: async (args: unknown) => {
          onExactFindMany?.(args)
          return exactDubs ?? []
        },
      },
      video: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          onVideoFindMany?.(args)
          const wanted = new Set(args.where.id.in)
          return (fallbackVideos ?? []).filter((row) => wanted.has(row.id))
        },
      },
    } as unknown as Parameters<typeof createLoaders>[0]
  }

  it("prefers the requested language playback id over the fallback dub", async () => {
    const loaders = createLoaders(
      makePlaybackPrisma({
        exactDubs: [
          {
            videoId: "v1",
            language: { slug: "english" },
            muxVideo: { playbackId: "mux-english" },
          },
        ],
        fallbackVideos: [
          {
            id: "v1",
            primaryLanguageId: "lang-primary",
            dubs: [
              {
                languageId: "lang-primary",
                muxVideo: { playbackId: "mux-primary" },
              },
            ],
          },
        ],
      }),
    )

    await expect(
      loaders.videoMuxPlaybackIdByIdAndLanguageSlug.load({
        videoId: "v1",
        languageSlug: "english",
      }),
    ).resolves.toBe("mux-english")
  })

  it("falls back to the primary playable Mux dub when requested language has no match", async () => {
    const loaders = createLoaders(
      makePlaybackPrisma({
        exactDubs: [],
        fallbackVideos: [
          {
            id: "v1",
            primaryLanguageId: "lang-en",
            dubs: [
              { languageId: "lang-es", muxVideo: { playbackId: "mux-es" } },
              { languageId: "lang-en", muxVideo: { playbackId: "mux-en" } },
            ],
          },
        ],
      }),
    )

    await expect(
      loaders.videoMuxPlaybackIdByIdAndLanguageSlug.load({
        videoId: "v1",
        languageSlug: "missing-language",
      }),
    ).resolves.toBe("mux-en")
  })

  it("batches ids and preserves input order for thumbnail playback lookups", async () => {
    let exactCalls = 0
    let fallbackCalls = 0
    const loaders = createLoaders(
      makePlaybackPrisma({
        exactDubs: [
          {
            videoId: "v2",
            language: { slug: "english" },
            muxVideo: { playbackId: "mux-v2-en" },
          },
        ],
        fallbackVideos: [
          {
            id: "v1",
            primaryLanguageId: null,
            dubs: [{ languageId: null, muxVideo: { playbackId: "mux-v1" } }],
          },
        ],
        onExactFindMany: () => {
          exactCalls++
        },
        onVideoFindMany: () => {
          fallbackCalls++
        },
      }),
    )

    const result = await loaders.videoMuxPlaybackIdByIdAndLanguageSlug.loadMany(
      [
        { videoId: "v1", languageSlug: null },
        { videoId: "v2", languageSlug: "english" },
        { videoId: "missing", languageSlug: "english" },
      ],
    )

    expect(exactCalls).toBe(1)
    expect(fallbackCalls).toBe(1)
    expect(result).toEqual(["mux-v1", "mux-v2-en", null])
  })

  it("queries only playable dubs that have Mux playback ids", async () => {
    let exactArgs: unknown
    let fallbackArgs: unknown
    const loaders = createLoaders(
      makePlaybackPrisma({
        exactDubs: [],
        fallbackVideos: [],
        onExactFindMany: (args) => {
          exactArgs = args
        },
        onVideoFindMany: (args) => {
          fallbackArgs = args
        },
      }),
    )

    await loaders.videoMuxPlaybackIdByIdAndLanguageSlug.load({
      videoId: "v1",
      languageSlug: "english",
    })

    expect(exactArgs).toMatchObject({
      where: {
        videoId: { in: ["v1"] },
        deletedAt: null,
        published: true,
        hls: { not: null },
        language: { slug: { in: ["english"] }, deletedAt: null },
        muxVideo: { playbackId: { not: null }, deletedAt: null },
      },
      select: {
        videoId: true,
        language: { select: { slug: true } },
        muxVideo: { select: { playbackId: true } },
      },
    })
    expect(fallbackArgs).toMatchObject({
      where: { id: { in: ["v1"] }, deletedAt: null },
      select: {
        id: true,
        primaryLanguageId: true,
        dubs: {
          where: {
            published: true,
            hls: { not: null },
            deletedAt: null,
            muxVideo: { playbackId: { not: null }, deletedAt: null },
          },
          take: 5,
          select: {
            languageId: true,
            muxVideo: { select: { playbackId: true } },
          },
        },
      },
    })
  })
})
