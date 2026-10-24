import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { createLoaders } from "@/graphql/loaders"
import { getPreferredPlayableDubs } from "./preferred-playable-dub.service"

function fixture() {
  const raw = vi.fn().mockResolvedValue([
    { videoId: "video-2", dubId: "dub-2" },
    { videoId: "video-1", dubId: "dub-1" },
  ])
  const hydrate = vi.fn().mockResolvedValue([{ id: "dub-1" }, { id: "dub-2" }])
  const db = {
    $queryRaw: raw,
    videoDub: { findMany: hydrate },
  } as unknown as PrismaClient
  return { db, raw, hydrate }
}

describe("preferred playable dub batching", () => {
  it("batches sibling reads, preserves order and nulls, and isolates request caches", async () => {
    const { db, raw, hydrate } = fixture()
    const loader = createLoaders(db).preferredPlayableDub
    const key = (videoId: string) => ({
      videoId,
      languageSlug: "english",
      query: {},
    })
    await expect(
      loader.loadMany([
        key("video-2"),
        key("missing"),
        key("video-1"),
        key("video-2"),
      ]),
    ).resolves.toEqual([
      { id: "dub-2" },
      null,
      { id: "dub-1" },
      { id: "dub-2" },
    ])
    expect(raw).toHaveBeenCalledOnce()
    expect(hydrate).toHaveBeenCalledOnce()
    await createLoaders(db).preferredPlayableDub.load(key("video-1"))
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it("separates language and Pothos selection groups", async () => {
    const { db, raw, hydrate } = fixture()
    const loader = createLoaders(db).preferredPlayableDub
    const include = { include: { language: true } }
    await loader.loadMany([
      { videoId: "video-1", languageSlug: "english", query: include },
      { videoId: "video-1", languageSlug: "french", query: include },
      {
        videoId: "video-1",
        languageSlug: "english",
        query: { select: { hls: true } },
      },
    ])
    expect(raw).toHaveBeenCalledTimes(3)
    expect(hydrate).toHaveBeenCalledWith(expect.objectContaining(include))
    expect(hydrate).toHaveBeenCalledWith(
      expect.objectContaining({ select: { hls: true, id: true } }),
    )
  })

  it("bounds batches and avoids querying empty input", async () => {
    const { db, raw } = fixture()
    await expect(
      getPreferredPlayableDubs(db, {
        videoIds: [],
        languageSlug: null,
        query: {},
      }),
    ).resolves.toEqual([])
    expect(raw).not.toHaveBeenCalled()
    const ids = Array.from({ length: 101 }, (_, i) => `video-${i}`)
    await expect(
      getPreferredPlayableDubs(db, {
        videoIds: ids,
        languageSlug: null,
        query: {},
      }),
    ).rejects.toThrow(RangeError)
    await createLoaders(db).preferredPlayableDub.loadMany(
      ids.map((videoId) => ({ videoId, languageSlug: null, query: {} })),
    )
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it("rechecks current availability during hydration and leaves vanished winners empty", async () => {
    const { db, hydrate } = fixture()
    hydrate.mockResolvedValueOnce([{ id: "dub-2" }])
    await expect(
      getPreferredPlayableDubs(db, {
        videoIds: ["video-1", "video-2"],
        languageSlug: "english",
        query: {},
      }),
    ).resolves.toEqual([null, { id: "dub-2" }])
    expect(hydrate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["dub-2", "dub-1"] },
          deletedAt: null,
          published: true,
          AND: [{ hls: { not: null } }, { hls: { not: "" } }],
          video: { deletedAt: null },
        },
      }),
    )
  })
})
