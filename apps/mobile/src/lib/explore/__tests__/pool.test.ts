/**
 * The candidate pool (KTD6): projection, the stored pool and its 24 h life,
 * and the stored next ready clip. The rows are real production rows (read
 * 2026-09-25), with long descriptions shortened.
 */

import type { ExploreInventoryData } from "../../queries"
import {
  EXPLORE_INVENTORY_LIMIT,
  EXPLORE_POOL_MAX_AGE_MS,
  EXPLORE_POOL_REFRESH_AFTER_MS,
  EXPLORE_POOL_STORAGE_KEY,
  EXPLORE_POOL_VERSION,
  EXPLORE_READY_CLIP_STORAGE_KEY,
  createExplorePoolStore,
  isPoolEmpty,
  parseStoredPool,
  parseStoredReadyClip,
  planPoolLoad,
  projectInventory,
  serializePool,
  serializeReadyClip,
  usableStoredClip,
  type ExplorePool,
  type ExplorePoolStoreDeps,
} from "../pool"
import type { ReadyClip } from "../types"

type Inventory = ExploreInventoryData["watchLanguageInventory"]
type Row = Inventory["audioVideos"][number]

const T0 = new Date(2026, 8, 25, 10, 0, 0).getTime()
const HOUR_MS = 60 * 60 * 1000

// ── Real rows ───────────────────────────────────────────────────────

const JESUS: Row = {
  id: "cmp76xcw602imny01vnsbwwy9",
  coreId: "1_jf-0-0",
  slug: "jesus",
  label: "featureFilm",
  availability: "AUDIO",
  durationSeconds: null,
  muxPlaybackId: "Dl8dRUL01MKAdzv7XtfvvUj1jVYq029z2TS9TGeH8Xj00o",
  watchLanguageSlug: "english",
  title: "JESUS",
  description: "This film is a perfect introduction to Jesus.",
}

const PICKET_FENCE: Row = {
  id: "cmokmpysx0ohcqsccm3d7jssu",
  coreId: "PicketFence",
  slug: "picket-fence",
  label: "shortFilm",
  availability: "AUDIO",
  durationSeconds: null,
  muxPlaybackId: "mWwhyIMzFLXPLIa1AbUG4bhGIPpBEW7c4ui01Q53MRcw",
  watchLanguageSlug: "english",
  title: "Picket Fence",
  description: "Two women are sitting on the front porch and gossiping.",
}

const IMPULSES_SERIES: Row = {
  id: "cmsd4bqaw0hnhnx0m5s1pfvof",
  coreId: "2_ElCamImpulsesVert",
  slug: "impulses-for-the-way-vertical",
  label: "series",
  availability: "AUDIO",
  durationSeconds: null,
  muxPlaybackId: null,
  watchLanguageSlug: "english",
  title: "Impulses for the Way (Vertical)",
  description: "This series of 33 short episodes follows the speaker.",
}

const JFM_COLLECTION: Row = {
  id: "cmokmnz3d0oblqsccr1n190bg",
  coreId: "JFM1",
  slug: "jfm-collection",
  label: "collection",
  availability: "AUDIO",
  durationSeconds: null,
  muxPlaybackId: null,
  watchLanguageSlug: "english",
  title: "JFM Collection",
  description: "Jesus Film Media, the digital expression of The JESUS Film.",
}

const SERMON: Row = {
  id: "cmp770j0i0306ny01nbq1ops3",
  coreId: "1_jf6112-0-0",
  slug: "sermon-on-the-mount-2",
  label: "segment",
  availability: "AUDIO",
  durationSeconds: 219,
  muxPlaybackId: "qWaCGua8Z5Ctfbbvd02FDerilCGgwJX1iUPT5tSngATo",
  watchLanguageSlug: "english",
  title: "Sermon on the Mount",
  description: "Jesus turns to the crowds and walks through them, teaching.",
}

const CLOSING_INVITATION: Row = {
  id: "cmsd4bs6t0itnnx0mcd5t4oq9",
  coreId: "2_ElCamImpulsesVert3333",
  slug: "impulses-closing-invitation-vertical",
  label: "episode",
  availability: "AUDIO",
  durationSeconds: 142,
  muxPlaybackId: "plPY8vcf7ZQ8EOlAZKU02iW0078A8sFXiRgRYok7uSKFY",
  watchLanguageSlug: "english",
  title: "Closing Invitation (Vertical)",
  description: "We are changed by our journey with Christ.",
}

// From the chinese-simplified inventory: the fallback audio is English.
const SERMON_SUBTITLED: Row = {
  ...SERMON,
  availability: "SUBTITLE_ONLY",
  watchLanguageSlug: "english",
}

const ULTIMATE_COACH_SUBTITLED: Row = {
  id: "cmultimatecoachvert000000",
  coreId: "2_UltimateCoachVert",
  slug: "ultimate-coach-vertical",
  label: "shortFilm",
  availability: "SUBTITLE_ONLY",
  durationSeconds: 100,
  muxPlaybackId: "aBc123",
  watchLanguageSlug: "english",
  title: "Ultimate Coach (Vertical)",
  description: null,
}

function inventory(overrides: Partial<NonNullable<Inventory>> = {}): Inventory {
  return {
    language: { slug: "english" },
    audioCollections: [],
    audioVideos: [],
    subtitleOnlyVideos: [],
    ...overrides,
  }
}

function pool(overrides: Partial<ExplorePool> = {}): ExplorePool {
  return {
    ...projectInventory(
      inventory({
        audioCollections: [JESUS],
        audioVideos: [SERMON, CLOSING_INVITATION],
      }),
      "english",
      T0,
    ),
    ...overrides,
  }
}

function readyClip(overrides: Partial<ReadyClip> = {}): ReadyClip {
  return {
    videoId: SERMON.id,
    coreId: SERMON.coreId,
    slug: SERMON.slug,
    label: "segment",
    availability: "AUDIO",
    durationSeconds: 219,
    muxPlaybackId: "qWaCGua8Z5Ctfbbvd02FDerilCGgwJX1iUPT5tSngATo",
    watchLanguageSlug: "english",
    title: "Sermon on the Mount",
    description: "Jesus turns to the crowds.",
    imageUrl: "https://imagedelivery.net/x/sermon.jpg/f=jpg,w=1280",
    feedLanguageSlug: "english",
    streamUrl:
      "https://stream.mux.com/qWaCGua8Z5Ctfbbvd02FDerilCGgwJX1iUPT5tSngATo.m3u8",
    audioLanguageSlug: "english",
    subtitleLanguageSlug: "english",
    subtitleVttSrc:
      "https://api-media-core.jesusfilm.org/1_jf6112-0-0/editions/ot/subtitles/en.vtt",
    subtitleOnly: false,
    window: { startSeconds: 42.5, endSeconds: 71.25 },
    cut: "sentence",
    ...overrides,
  }
}

// ── Projection ──────────────────────────────────────────────────────

describe("projectInventory", () => {
  it("keeps videos and playable films, drops containers, and keeps each subtitle-only fallback slug", () => {
    const projected = projectInventory(
      inventory({
        language: { slug: "chinese-simplified" },
        audioCollections: [
          JESUS,
          IMPULSES_SERIES,
          JFM_COLLECTION,
          PICKET_FENCE,
        ],
        audioVideos: [SERMON, CLOSING_INVITATION],
        subtitleOnlyVideos: [ULTIMATE_COACH_SUBTITLED],
      }),
      "chinese-simplified",
      T0,
    )

    expect(projected.languageSlug).toBe("chinese-simplified")
    expect(projected.fetchedAt).toBe(T0)
    expect(projected.dubbed.map((c) => c.slug)).toEqual([
      "sermon-on-the-mount-2",
      "impulses-closing-invitation-vertical",
      "jesus",
      "picket-fence",
    ])
    expect(projected.dubbed.every((c) => c.availability === "AUDIO")).toBe(true)
    expect(projected.subtitleOnly).toEqual([
      {
        videoId: ULTIMATE_COACH_SUBTITLED.id,
        coreId: "2_UltimateCoachVert",
        slug: "ultimate-coach-vertical",
        label: "shortFilm",
        availability: "SUBTITLE_ONLY",
        durationSeconds: 100,
        muxPlaybackId: "aBc123",
        watchLanguageSlug: "english",
        title: "Ultimate Coach (Vertical)",
        description: null,
      },
    ])
  })

  it("carries the lean fields and no image", () => {
    const [sermon] = projectInventory(
      inventory({ audioVideos: [SERMON] }),
      "english",
      T0,
    ).dubbed
    expect(sermon).toEqual({
      videoId: "cmp770j0i0306ny01nbq1ops3",
      coreId: "1_jf6112-0-0",
      slug: "sermon-on-the-mount-2",
      label: "segment",
      availability: "AUDIO",
      durationSeconds: 219,
      muxPlaybackId: "qWaCGua8Z5Ctfbbvd02FDerilCGgwJX1iUPT5tSngATo",
      watchLanguageSlug: "english",
      title: "Sermon on the Mount",
      description:
        "Jesus turns to the crowds and walks through them, teaching.",
    })
    expect(sermon).not.toHaveProperty("imageUrl")
  })

  it("drops a video under 10 s, which can never give a clip (R23)", () => {
    const projected = projectInventory(
      inventory({
        audioVideos: [
          { ...SERMON, durationSeconds: 9 },
          { ...CLOSING_INVITATION, durationSeconds: 10 },
        ],
      }),
      "english",
      T0,
    )
    expect(projected.dubbed.map((c) => c.slug)).toEqual([
      "impulses-closing-invitation-vertical",
    ])
  })

  it("drops rows with no identity and dedupes by video id", () => {
    const projected = projectInventory(
      inventory({
        audioVideos: [
          SERMON,
          { ...CLOSING_INVITATION, id: "" },
          { ...CLOSING_INVITATION, coreId: "   " },
          { ...CLOSING_INVITATION, slug: "" },
        ],
        audioCollections: [{ ...JESUS, id: SERMON.id }],
      }),
      "english",
      T0,
    )
    expect(projected.dubbed.map((c) => c.slug)).toEqual([
      "sermon-on-the-mount-2",
    ])
  })

  it("drops a subtitle-only row whose fallback audio slug is malformed", () => {
    const projected = projectInventory(
      inventory({
        subtitleOnlyVideos: [
          { ...SERMON_SUBTITLED, watchLanguageSlug: "" },
          { ...ULTIMATE_COACH_SUBTITLED, watchLanguageSlug: "English" },
        ],
      }),
      "chinese-simplified",
      T0,
    )
    expect(projected.subtitleOnly).toEqual([])
  })

  it("keeps a subtitle-only video out of the dubbed pool when it is also dubbed", () => {
    const projected = projectInventory(
      inventory({
        audioVideos: [SERMON],
        subtitleOnlyVideos: [SERMON_SUBTITLED],
      }),
      "english",
      T0,
    )
    expect(projected.dubbed.map((c) => c.videoId)).toEqual([SERMON.id])
    expect(projected.subtitleOnly).toEqual([])
  })

  it("reads a blank description as none", () => {
    const [row] = projectInventory(
      inventory({ audioVideos: [{ ...SERMON, description: "  " }] }),
      "english",
      T0,
    ).dubbed
    expect(row.description).toBeNull()
  })

  it("gives an empty pool for an unknown language (the definitive empty)", () => {
    const projected = projectInventory(
      inventory({ language: null }),
      "swahili",
      T0,
    )
    expect(isPoolEmpty(projected)).toBe(true)
    expect(isPoolEmpty(pool())).toBe(false)
  })

  it("requests admin's per-bucket cap", () => {
    expect(EXPLORE_INVENTORY_LIMIT).toBe(1000)
  })
})

// ── Stored pool ─────────────────────────────────────────────────────

describe("planPoolLoad", () => {
  it("fetches at once when there is no stored pool", () => {
    expect(planPoolLoad(null, T0)).toEqual({ use: null, fetch: "now" })
  })

  it("uses a pool younger than 24 h at once, with no fetch while it is new", () => {
    const stored = pool({ fetchedAt: T0 })
    expect(planPoolLoad(stored, T0 + 10 * 60 * 1000)).toEqual({
      use: stored,
      fetch: "none",
    })
  })

  it("uses a pool younger than 24 h at once and refreshes it in the background", () => {
    const stored = pool({ fetchedAt: T0 })
    expect(EXPLORE_POOL_REFRESH_AFTER_MS).toBeLessThan(EXPLORE_POOL_MAX_AGE_MS)
    expect(
      planPoolLoad(stored, T0 + EXPLORE_POOL_REFRESH_AFTER_MS + 1),
    ).toEqual({ use: stored, fetch: "background" })
    expect(planPoolLoad(stored, T0 + 23 * HOUR_MS)).toEqual({
      use: stored,
      fetch: "background",
    })
  })

  it("does not use a pool 24 h old or older, and fetches", () => {
    const stored = pool({ fetchedAt: T0 })
    expect(planPoolLoad(stored, T0 + EXPLORE_POOL_MAX_AGE_MS)).toEqual({
      use: null,
      fetch: "now",
    })
  })

  // A clock set back makes the age unknown, so the pool is not trusted.
  it("does not use a pool stamped in the future", () => {
    expect(planPoolLoad(pool({ fetchedAt: T0 + HOUR_MS }), T0)).toEqual({
      use: null,
      fetch: "now",
    })
  })
})

describe("parseStoredPool / serializePool", () => {
  it("round-trips a projected pool", () => {
    const projected = projectInventory(
      inventory({
        audioCollections: [JESUS, PICKET_FENCE],
        audioVideos: [SERMON, CLOSING_INVITATION],
        subtitleOnlyVideos: [ULTIMATE_COACH_SUBTITLED],
      }),
      "english",
      T0,
    )
    expect(parseStoredPool(serializePool(projected), "english")).toEqual(
      projected,
    )
  })

  it.each([
    ["null", null],
    ["bad JSON", "{not json"],
    ["an array", "[]"],
    ["another version", JSON.stringify({ v: EXPLORE_POOL_VERSION + 1 })],
    ["no rows", JSON.stringify({ v: EXPLORE_POOL_VERSION, lang: "english" })],
  ])("reads %s as no pool", (_name, raw) => {
    expect(parseStoredPool(raw, "english")).toBeNull()
  })

  it("reads another language's pool as no pool", () => {
    expect(parseStoredPool(serializePool(pool()), "french")).toBeNull()
  })

  it("drops a bad row and keeps the rest", () => {
    const stored = JSON.parse(serializePool(pool())) as { d: unknown[] }
    stored.d.push(["only-an-id"], 42, null)
    const parsed = parseStoredPool(JSON.stringify(stored), "english")
    expect(parsed?.dubbed).toEqual(pool().dubbed)
  })

  // The stored pool never costs more than the rows it came from: the tuples
  // drop the keys, and the image never enters it.
  it("stores fewer bytes than the inventory rows it came from", () => {
    const rows = inventory({
      audioCollections: [JESUS, PICKET_FENCE],
      audioVideos: [SERMON, CLOSING_INVITATION],
      subtitleOnlyVideos: [ULTIMATE_COACH_SUBTITLED],
    })
    const stored = serializePool(projectInventory(rows, "english", T0))
    expect(stored.length).toBeLessThan(JSON.stringify(rows).length)
  })
})

// ── Stored ready clip ───────────────────────────────────────────────

describe("the stored ready clip", () => {
  it("round-trips", () => {
    const clip = readyClip()
    expect(parseStoredReadyClip(serializeReadyClip(clip, T0))).toEqual({
      storedAt: T0,
      clip,
    })
  })

  it.each([
    ["bad JSON", "{"],
    ["a missing clip", JSON.stringify({ v: 1, at: T0 })],
    [
      "a bad window",
      serializeReadyClip(
        readyClip({ window: { startSeconds: 50, endSeconds: 40 } }),
        T0,
      ),
    ],
    [
      "a bad cut",
      serializeReadyClip(readyClip({ cut: "moment" as never }), T0),
    ],
    ["a missing stream", serializeReadyClip(readyClip({ streamUrl: "" }), T0)],
  ])("reads %s as no clip", (_name, raw) => {
    expect(parseStoredReadyClip(raw)).toBeNull()
  })

  const context = {
    feedLanguageSlug: "english",
    poolFetchedAt: T0,
    recordedWindows: () => [],
  }

  it("is used when it is newer than the pool, unrecorded, and in the feed language", () => {
    const stored = { storedAt: T0 + 1, clip: readyClip() }
    expect(usableStoredClip(stored, context)).toEqual(stored.clip)
  })

  it("is dropped when it is older than the pool", () => {
    expect(
      usableStoredClip({ storedAt: T0 - 1, clip: readyClip() }, context),
    ).toBeNull()
  })

  it("is dropped when the record already holds its window", () => {
    const stored = { storedAt: T0 + 1, clip: readyClip() }
    expect(
      usableStoredClip(stored, {
        ...context,
        recordedWindows: (videoId: string) =>
          videoId === SERMON.id ? [{ startSeconds: 60, endSeconds: 90 }] : [],
      }),
    ).toBeNull()
  })

  it("is dropped when the feed language changed", () => {
    expect(
      usableStoredClip(
        { storedAt: T0 + 1, clip: readyClip() },
        { ...context, feedLanguageSlug: "french" },
      ),
    ).toBeNull()
  })
})

// ── Store ───────────────────────────────────────────────────────────

function memoryDeps(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  const deps: ExplorePoolStoreDeps = {
    getItem: jest.fn(async (key: string) => data.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
    removeItem: jest.fn(async (key: string) => {
      data.delete(key)
    }),
  }
  return { data, deps }
}

describe("createExplorePoolStore", () => {
  it("writes the pool under one key and reads it back for its language", async () => {
    const { data, deps } = memoryDeps()
    const store = createExplorePoolStore(deps)
    await store.writePool(pool())
    expect(data.has(EXPLORE_POOL_STORAGE_KEY)).toBe(true)
    await expect(store.readPool("english")).resolves.toEqual(pool())
    await expect(store.readPool("french")).resolves.toBeNull()
  })

  it("reads a corrupt stored pool as no pool", async () => {
    const { deps } = memoryDeps({ [EXPLORE_POOL_STORAGE_KEY]: "garbage" })
    await expect(
      createExplorePoolStore(deps).readPool("english"),
    ).resolves.toBeNull()
  })

  it("never rejects when storage throws", async () => {
    const store = createExplorePoolStore({
      getItem: () => Promise.reject(new Error("read")),
      setItem: () => {
        throw new Error("write")
      },
      removeItem: () => Promise.reject(new Error("remove")),
    })
    await expect(store.readPool("english")).resolves.toBeNull()
    await expect(store.writePool(pool())).resolves.toBe(false)
    await expect(store.readReadyClip()).resolves.toBeNull()
    await expect(store.writeReadyClip(readyClip(), T0)).resolves.toBe(false)
    await expect(store.clearReadyClip()).resolves.toBeUndefined()
  })

  it("stores and clears the next ready clip beside the pool", async () => {
    const { data, deps } = memoryDeps()
    const store = createExplorePoolStore(deps)
    await store.writeReadyClip(readyClip(), T0)
    await expect(store.readReadyClip()).resolves.toEqual({
      storedAt: T0,
      clip: readyClip(),
    })
    await store.clearReadyClip()
    expect(data.has(EXPLORE_READY_CLIP_STORAGE_KEY)).toBe(false)
    await expect(store.readReadyClip()).resolves.toBeNull()
  })
})
