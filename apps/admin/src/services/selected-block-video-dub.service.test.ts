import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { createLoaders } from "@/graphql/loaders"
import { getSelectedBlockVideoDubs } from "./selected-block-video-dub.service"

function fixture() {
  const picks = [
    { videoId: "one", languageId: "en", dubId: "one-en" },
    { videoId: "one", languageId: "fr", dubId: "one-fr" },
  ]
  const raw = vi.fn().mockResolvedValue(picks)
  const hydrate = vi
    .fn()
    .mockResolvedValue(
      picks.map(({ dubId, ...key }) => ({ id: dubId, ...key })),
    )
  const db = {
    $queryRaw: raw,
    videoDub: { findMany: hydrate },
  } as unknown as PrismaClient
  return { db, raw, hydrate }
}
const key = (videoId: string, languageId = "en", query: object = {}) => ({
  videoId,
  languageId,
  query,
})

describe("selected block video dub batching", () => {
  it("preserves exact pairs, input order, missing rows, duplicate keys and request isolation", async () => {
    const { db, raw } = fixture()
    const loader = createLoaders(db).selectedBlockVideoDub
    const rows = await loader.loadMany([
      key("one", "fr"),
      key("missing"),
      key("one"),
      key("one", "fr"),
    ])
    expect(rows).toEqual([
      { id: "one-fr", videoId: "one", languageId: "fr" },
      null,
      { id: "one-en", videoId: "one", languageId: "en" },
      { id: "one-fr", videoId: "one", languageId: "fr" },
    ])
    expect(raw).toHaveBeenCalledOnce()
    await createLoaders(db).selectedBlockVideoDub.load(key("one"))
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it("keeps nested Pothos selections separate and adds identity fields for safe mapping", async () => {
    const { db, raw, hydrate } = fixture()
    await createLoaders(db).selectedBlockVideoDub.loadMany([
      key("one", "en", { include: { language: true } }),
      key("one", "fr", { select: { hls: true } }),
    ])
    expect(raw).toHaveBeenCalledTimes(2)
    expect(hydrate).toHaveBeenCalledWith(
      expect.objectContaining({ include: { language: true } }),
    )
    expect(hydrate).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { hls: true, id: true, videoId: true, languageId: true },
      }),
    )
  })

  it("bounds selection batches and avoids empty queries", async () => {
    const { db, raw, hydrate } = fixture()
    expect(await getSelectedBlockVideoDubs(db, [], {})).toEqual([])
    expect(raw).not.toHaveBeenCalled()
    const keys = Array.from({ length: 101 }, (_, i) => key(`video-${i}`))
    await expect(getSelectedBlockVideoDubs(db, keys, {})).rejects.toThrow(
      RangeError,
    )
    raw.mockResolvedValue([])
    expect(
      await createLoaders(db).selectedBlockVideoDub.loadMany(keys),
    ).toEqual(keys.map(() => null))
    expect(raw).toHaveBeenCalledTimes(2)
    expect(hydrate).not.toHaveBeenCalled()
  })

  it("keeps withdrawn or reassigned winners empty and rechecks current availability", async () => {
    const { db, hydrate } = fixture()
    hydrate.mockResolvedValue([
      { id: "one-en", videoId: "other-video", languageId: "en" },
    ])
    expect(
      await getSelectedBlockVideoDubs(db, [key("one"), key("one", "fr")], {}),
    ).toEqual([null, null])
    expect(hydrate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["one-en", "one-fr"] },
          deletedAt: null,
          published: true,
          OR: [
            { hls: { not: null } },
            { dash: { not: null } },
            { share: { not: null } },
          ],
          video: { deletedAt: null },
        },
      }),
    )
  })

  it("propagates the original selection and hydration errors", async () => {
    const { db, raw, hydrate } = fixture()
    const original = new Error("fixture failure")
    raw.mockRejectedValueOnce(original)
    await expect(
      createLoaders(db).selectedBlockVideoDub.load(key("one")),
    ).rejects.toBe(original)
    hydrate.mockRejectedValueOnce(original)
    await expect(
      createLoaders(db).selectedBlockVideoDub.load(key("one")),
    ).rejects.toBe(original)
  })
})
