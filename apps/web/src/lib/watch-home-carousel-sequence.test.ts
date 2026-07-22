/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest"
import type { WatchHomeMuxInsertConfig } from "@/lib/watch-home-config"
import type { WatchHomeProgram } from "@/lib/watch-home-types"
import {
  WATCH_HOME_PROGRAM_LEDGER_STORAGE_KEY,
  WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY,
  WATCH_HOME_TV_MUX_SELECTIONS_STORAGE_KEY,
  WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
  addWatchHomeTvPlayedId,
  createWatchHomeProgramEngine,
  drawNextWatchHomeProgramItem,
  exposeWatchHomeProgramIdentity,
  getWatchHomeProgramFingerprint,
  persistWatchHomeProgramLedger,
  quarantineWatchHomeProgramIdentity,
  readWatchHomeProgramLedger,
  resetWatchHomeProgramLedgerMemory,
  buildWatchHomeVideoQueue,
  getWatchHomeDeterministicOffset,
  loadWatchHomeCurrentVideoSession,
  mergeWatchHomeMuxInserts,
  poolFailuresStorageKey,
  poolVideosStorageKey,
  readWatchHomeTvPlayedIds,
  saveWatchHomeCurrentVideoSession,
  type WatchHomeCarouselPool,
  type WatchHomeTvCarouselVideoSlide,
} from "./watch-home-carousel-sequence"

const currentMonth = new Date().toISOString().slice(0, 7)

function video(id: string): WatchHomeTvCarouselVideoSlide {
  return {
    kind: "video",
    id,
    title: id,
    description: null,
    label: "Short film",
    href: `/${id}.html/english.html`,
    posterUrl: `${id}.jpg`,
    thumbnailUrl: `${id}-thumb.jpg`,
    imageAlt: id,
    src: `${id}.m3u8`,
    playbackId: `mux-${id}`,
    durationSeconds: 10,
  }
}

function pool(id: string, videos: string[]): WatchHomeCarouselPool {
  return {
    id,
    collectionIds: [id],
    videos: videos.map(video),
  }
}

function program(): WatchHomeProgram {
  const promo = (id: string) => ({
    id,
    playbackId: `playback-${id}`,
    src: `${id}.m3u8`,
    durationSeconds: 5,
    posterUrl: `${id}.jpg`,
    label: "Campaign",
    title: id,
    description: null,
    showLogo: false,
    primaryAction: null,
    secondaryAction: null,
  })
  const programVideo = (id: string, videoId = id) => ({
    id: `item-${id}`,
    videoId,
    coreId: `core-${id}`,
    title: id,
    description: null,
    label: "Film",
    href: `/${id}.html/english.html`,
    posterUrl: `${id}.jpg`,
    thumbnailUrl: `${id}-thumb.jpg`,
    imageAlt: id,
    src: `${id}.m3u8`,
    playbackId: `mux-${id}`,
    subtitleVttSrc: null,
    subtitleLanguageBcp47: null,
    durationSeconds: 10,
  })

  return {
    intro: promo("intro"),
    buckets: [
      {
        kind: "video",
        id: "classics",
        label: "Classics",
        items: [programVideo("a"), programVideo("b"), programVideo("c")],
      },
      {
        kind: "promo",
        id: "promos",
        label: "Promos",
        items: [promo("join"), promo("share")],
      },
      {
        kind: "video",
        id: "shorts",
        label: "Shorts",
        items: [programVideo("d"), programVideo("e")],
      },
    ],
    rotation: ["classics", "promos", "classics", "shorts"],
  }
}

function drawMany(
  authoredProgram: WatchHomeProgram,
  count: number,
  seed = "entry-one",
) {
  let state = createWatchHomeProgramEngine(authoredProgram, { seed })
  const items = []
  for (let index = 0; index < count; index++) {
    const result = drawNextWatchHomeProgramItem(authoredProgram, state)
    state = result.state
    items.push(result.item)
  }
  return { items, state }
}

const muxInsert = {
  id: "welcome-start",
  copyId: "welcomeStart",
  enabled: true,
  playbackIds: ["playback-a"],
  durationSeconds: 9,
  action: null,
  logo: true,
  posterOverride: null,
  trigger: { type: "sequence-start" },
} satisfies WatchHomeMuxInsertConfig

describe("watch home carousel sequence helpers", () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    resetWatchHomeProgramLedgerMemory()
  })

  it("uses deterministic daily offsets for pool selection", () => {
    const now = new Date("2026-06-04T12:00:00.000Z")

    expect(
      getWatchHomeDeterministicOffset("pool-a", 12, {
        now,
        poolIndex: 0,
        totalVideosLoaded: 0,
      }),
    ).toBe(
      getWatchHomeDeterministicOffset("pool-a", 12, {
        now,
        poolIndex: 0,
        totalVideosLoaded: 0,
      }),
    )
    expect(getWatchHomeDeterministicOffset("pool-a", 0, { now })).toBe(0)
  })

  it("stores and expires persistent played ids in the Core monthly shape", () => {
    addWatchHomeTvPlayedId("video-1")

    expect(readWatchHomeTvPlayedIds()).toEqual(["video-1"])
    expect(
      JSON.parse(
        window.localStorage.getItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY) ??
          "{}",
      ),
    ).toEqual({
      month: currentMonth,
      ids: ["video-1"],
    })

    window.localStorage.setItem(
      WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
      JSON.stringify({ month: "2000-01", ids: ["old"] }),
    )

    expect(readWatchHomeTvPlayedIds()).toEqual([])
    expect(
      window.localStorage.getItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY),
    ).toBeNull()
  })

  it("builds a progressive queue from playlist pools while avoiding played videos", () => {
    const now = new Date("2026-06-04T12:00:00.000Z")
    addWatchHomeTvPlayedId("video-a", now)
    window.sessionStorage.setItem(
      poolVideosStorageKey("pool-b"),
      JSON.stringify(["video-c"]),
    )

    const result = buildWatchHomeVideoQueue({
      pools: [
        pool("pool-a", ["video-a", "video-b"]),
        pool("pool-b", ["video-c", "video-d"]),
      ],
      targetVideoCount: 2,
      now,
    })

    expect(result.videos.map((item) => item.id)).toEqual(["video-b", "video-d"])
    expect(result.videos.map((item) => item.poolId)).toEqual([
      "pool-a",
      "pool-b",
    ])
    expect(result.nextPoolIndex).toBe(2)
  })

  it("tracks repeated pool failures and marks depleted pools exhausted", () => {
    const now = new Date("2026-06-04T12:00:00.000Z")
    addWatchHomeTvPlayedId("video-a", now)

    for (let attempt = 0; attempt < 3; attempt++) {
      buildWatchHomeVideoQueue({
        pools: [pool("pool-a", ["video-a"])],
        targetVideoCount: 1,
        now,
      })
    }

    expect(
      window.sessionStorage.getItem(poolFailuresStorageKey("pool-a")),
    ).toBe("3")
    expect(
      JSON.parse(
        window.sessionStorage.getItem(poolVideosStorageKey("pool-a")) ?? "[]",
      ),
    ).toEqual(["exhausted-0"])
  })

  it("resets monthly played memory after fifty loaded videos so cycling can continue", () => {
    const now = new Date("2026-06-04T12:00:00.000Z")
    addWatchHomeTvPlayedId("video-a", now)

    const result = buildWatchHomeVideoQueue({
      existingVideos: Array.from({ length: 50 }, (_, index) =>
        video(`existing-${index}`),
      ),
      pools: [pool("pool-a", ["video-a"])],
      targetVideoCount: 51,
      now,
    })

    expect(readWatchHomeTvPlayedIds()).toEqual([])
    expect(result.videos.at(-1)?.id).toBe("video-a")
  })

  it("persists current video session for 24 hours", () => {
    const selected = {
      ...video("video-session"),
      poolId: "pool-a",
      poolIndex: 2,
    }
    saveWatchHomeCurrentVideoSession(selected)

    expect(loadWatchHomeCurrentVideoSession()).toMatchObject({
      videoId: "video-session",
      videoTitle: "video-session",
      poolId: "pool-a",
      poolIndex: 2,
    })

    window.sessionStorage.setItem(
      WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY,
      JSON.stringify({
        videoId: "old",
        videoTitle: "Old",
        poolId: "pool-a",
        poolIndex: 0,
        timestamp: 0,
      }),
    )

    expect(loadWatchHomeCurrentVideoSession(new Date("2026-06-04"))).toBeNull()
  })

  it("merges Mux inserts with date prefix and session-stable playback ids", () => {
    const slides = mergeWatchHomeMuxInserts(
      [video("video-1"), video("video-2")],
      [
        muxInsert,
        {
          ...muxInsert,
          id: "join-us",
          copyId: "joinUs",
          playbackIds: ["join-a", "join-b"],
          trigger: { type: "after-count", count: 1 },
          action: {
            copyId: "joinUs",
            url: "https://example.com",
          },
        },
      ],
      new Date("2026-06-04T12:00:00.000Z"),
    )

    expect(slides.map((slide) => slide.id)).toEqual([
      "mux-welcome-start",
      "video-1",
      "mux-join-us",
      "video-2",
    ])
    expect(slides[0]).toMatchObject({
      kind: "mux",
      copyId: "welcomeStart",
      titleDate: "2026-06-04T12:00:00.000Z",
      playbackId: "playback-a",
      secondaryAction: null,
    })
    expect(slides[2]).toMatchObject({
      kind: "mux",
      copyId: "joinUs",
      secondaryAction: {
        type: "watch-short-film",
      },
    })
    const stored = JSON.parse(
      window.sessionStorage.getItem(WATCH_HOME_TV_MUX_SELECTIONS_STORAGE_KEY) ??
        "{}",
    )
    expect(["join-a", "join-b"]).toContain(stored["join-us"])
  })

  it("preserves the stable copy id of a selected conditional overlay", () => {
    const [slide] = mergeWatchHomeMuxInserts(
      [],
      [
        {
          ...muxInsert,
          conditionalOverlays: [
            {
              copyId: "welcomeMorning",
              priority: 10,
              conditions: [{ type: "time-range", range: { start: 5, end: 9 } }],
              overlay: {},
            },
          ],
        },
      ],
      new Date("2026-06-04T12:00:00.000Z"),
      { useStoredSelections: false },
    )

    expect(slide).toMatchObject({
      kind: "mux",
      copyId: "welcomeMorning",
      titleDate: "2026-06-04T12:00:00.000Z",
    })
  })

  it("plays the intro once, then follows the exact repeating rotation", () => {
    const { items } = drawMany(program(), 10)

    expect(items[0]).toMatchObject({ isIntro: true, identity: "promo:intro" })
    expect(items.slice(1).map((item) => item?.bucketId)).toEqual([
      "classics",
      "promos",
      "classics",
      "shorts",
      "classics",
      "promos",
      "classics",
      "shorts",
      "classics",
    ])
    expect(new Set(items.map((item) => item?.sequenceId)).size).toBe(10)
  })

  it("keeps independent no-repeat bags and avoids a reset-boundary repeat", () => {
    const authoredProgram = program()
    let state = createWatchHomeProgramEngine(authoredProgram, { seed: 17 })
    const byBucket = new Map<string, string[]>()

    for (let index = 0; index < 17; index++) {
      const result = drawNextWatchHomeProgramItem(authoredProgram, state)
      state = result.state
      if (!result.item?.bucketId) continue
      const identities = byBucket.get(result.item.bucketId) ?? []
      identities.push(result.item.identity)
      byBucket.set(result.item.bucketId, identities)
    }

    const classics = byBucket.get("classics") ?? []
    const promos = byBucket.get("promos") ?? []
    expect(new Set(classics.slice(0, 3)).size).toBe(3)
    expect(classics[2]).not.toBe(classics[3])
    expect(new Set(promos.slice(0, 2)).size).toBe(2)
    expect(promos[1]).not.toBe(promos[2])
  })

  it("prefers global unseen identities and can reuse them only for liveness", () => {
    const authoredProgram = program()
    let state = createWatchHomeProgramEngine(authoredProgram, {
      seed: "history",
      exposedIdentities: ["video:b"],
      accountVideoIds: ["a"],
    })
    state = drawNextWatchHomeProgramItem(authoredProgram, state).state // intro

    const first = drawNextWatchHomeProgramItem(authoredProgram, state)
    expect(first.item?.identity).toBe("video:c")

    const exposed = exposeWatchHomeProgramIdentity(
      first.state,
      first.item?.identity ?? "video:c",
    )
    const quarantined = quarantineWatchHomeProgramIdentity(
      exposed,
      "promo:join",
    )
    expect(quarantined.exposedIdentities).toContain("video:c")
    expect(quarantined.quarantinedIdentities).toContain("promo:join")
    expect(quarantined.exposedIdentities).not.toContain("promo:join")
  })

  it("uses canonical Admin video identity across different buckets", () => {
    const authoredProgram = program()
    const classics = authoredProgram.buckets[0]
    const shorts = authoredProgram.buckets[2]
    if (classics?.kind !== "video" || shorts?.kind !== "video") {
      throw new Error("Expected video buckets")
    }
    shorts.items = [
      { ...classics.items[0]!, id: "shared-a-in-shorts" },
      shorts.items[0]!,
    ]
    authoredProgram.intro = null
    authoredProgram.rotation = ["classics", "shorts"]

    let state = createWatchHomeProgramEngine(authoredProgram, {
      seed: "cross-bucket",
      accountVideoIds: ["b", "c"],
    })
    const fromClassics = drawNextWatchHomeProgramItem(authoredProgram, state)
    expect(fromClassics.item?.identity).toBe("video:a")
    state = exposeWatchHomeProgramIdentity(
      fromClassics.state,
      fromClassics.item!.identity,
    )

    const fromShorts = drawNextWatchHomeProgramItem(authoredProgram, state)
    expect(fromShorts.item?.identity).toBe("video:d")
  })

  it("deduplicates canonical identities, skips invalid slots, and terminates after one rotation", () => {
    const authoredProgram = program()
    const classics = authoredProgram.buckets[0]
    if (classics?.kind === "video") {
      classics.items.push({ ...classics.items[0]!, id: "duplicate-a" })
    }
    authoredProgram.rotation = ["missing", "classics", "empty"]
    authoredProgram.buckets.push({
      kind: "promo",
      id: "empty",
      label: "Empty",
      items: [],
    })

    let state = createWatchHomeProgramEngine(authoredProgram, { seed: 9 })
    state = drawNextWatchHomeProgramItem(authoredProgram, state).state // intro
    const identities: string[] = []
    for (let index = 0; index < 3; index++) {
      const result = drawNextWatchHomeProgramItem(authoredProgram, state)
      state = result.state
      expect(result.fallback).toBe(false)
      identities.push(result.item?.identity ?? "")
    }
    expect(new Set(identities).size).toBe(3)

    state = quarantineWatchHomeProgramIdentity(state, "video:a")
    state = quarantineWatchHomeProgramIdentity(state, "video:b")
    state = quarantineWatchHomeProgramIdentity(state, "video:c")
    const exhausted = drawNextWatchHomeProgramItem(authoredProgram, state)
    expect(exhausted).toMatchObject({ item: null, fallback: true })
    expect(exhausted.scannedSlots).toBe(authoredProgram.rotation.length)
  })

  it("uses a fresh seed per entry while remaining deterministic for tests", () => {
    const authoredProgram = program()
    const first = drawMany(authoredProgram, 9, "first-entry").items.map(
      (item) => item?.identity,
    )
    const repeated = drawMany(authoredProgram, 9, "first-entry").items.map(
      (item) => item?.identity,
    )
    const fresh = drawMany(authoredProgram, 9, "second-entry").items.map(
      (item) => item?.identity,
    )

    expect(repeated).toEqual(first)
    expect(fresh).not.toEqual(first)

    const firstEntry = drawMany(authoredProgram, 1, "first-entry").items[0]
    const secondEntry = drawMany(authoredProgram, 1, "second-entry").items[0]
    expect(secondEntry?.sequenceId).not.toBe(firstEntry?.sequenceId)
  })

  it("bounds empty planning to at most one authored rotation", () => {
    for (let slotCount = 0; slotCount <= 48; slotCount++) {
      const authoredProgram: WatchHomeProgram = {
        intro: null,
        buckets: [],
        rotation: Array.from(
          { length: slotCount },
          (_, index) => `missing-${index}`,
        ),
      }
      const state = createWatchHomeProgramEngine(authoredProgram, {
        seed: slotCount,
      })
      const result = drawNextWatchHomeProgramItem(authoredProgram, state)
      expect(result.fallback).toBe(true)
      expect(result.scannedSlots).toBeLessThanOrEqual(slotCount)
    }
  })

  it("persists a versioned monthly ledger and restores bucket cycles", () => {
    const authoredProgram = program()
    const now = new Date("2026-07-22T12:00:00.000Z")
    let state = createWatchHomeProgramEngine(authoredProgram, { seed: 12 })
    state = drawNextWatchHomeProgramItem(authoredProgram, state).state // intro
    const drawn = drawNextWatchHomeProgramItem(authoredProgram, state)
    state = exposeWatchHomeProgramIdentity(drawn.state, drawn.item!.identity)

    const written = persistWatchHomeProgramLedger(authoredProgram, state, {
      now,
    })
    const restored = readWatchHomeProgramLedger(authoredProgram, { now })

    expect(written).toMatchObject({
      version: 1,
      month: "2026-07",
      programFingerprint: getWatchHomeProgramFingerprint(authoredProgram),
    })
    expect(restored.exposures[drawn.item!.identity]).toBe(now.getTime())
    expect(restored.bucketCycles.classics?.remainingIdentities).toHaveLength(2)
  })

  it("starts a new persisted bucket cycle after exhaustion", () => {
    const authoredProgram = program()
    authoredProgram.intro = null
    authoredProgram.rotation = ["classics"]
    const now = new Date("2026-07-22T12:00:00.000Z")
    let state = createWatchHomeProgramEngine(authoredProgram, { seed: 12 })

    for (let index = 0; index < 3; index++) {
      state = drawNextWatchHomeProgramItem(authoredProgram, state).state
    }
    persistWatchHomeProgramLedger(authoredProgram, state, { now })
    state = drawNextWatchHomeProgramItem(authoredProgram, state).state
    persistWatchHomeProgramLedger(authoredProgram, state, {
      now: new Date(now.getTime() + 1),
    })

    const restored = readWatchHomeProgramLedger(authoredProgram, { now })
    expect(restored.bucketCycles.classics).toMatchObject({ cycle: 2 })
    expect(restored.bucketCycles.classics?.remainingIdentities).toHaveLength(2)
  })

  it("preserves valid exposure but resets cycles after a program revision", () => {
    const authoredProgram = program()
    const now = new Date("2026-07-22T12:00:00.000Z")
    let state = createWatchHomeProgramEngine(authoredProgram, { seed: 4 })
    state = drawNextWatchHomeProgramItem(authoredProgram, state).state
    state = drawNextWatchHomeProgramItem(authoredProgram, state).state
    state = exposeWatchHomeProgramIdentity(state, "video:a")
    state = exposeWatchHomeProgramIdentity(state, "video:b")
    persistWatchHomeProgramLedger(authoredProgram, state, { now })

    const revised = program()
    const classics = revised.buckets[0]
    if (classics?.kind === "video") {
      classics.items = classics.items.filter((item) => item.videoId !== "b")
    }
    const restored = readWatchHomeProgramLedger(revised, { now })

    expect(Object.keys(restored.exposures)).toEqual(["video:a"])
    expect(restored.bucketCycles).toEqual({})
    expect(restored.programFingerprint).toBe(
      getWatchHomeProgramFingerprint(revised),
    )
  })

  it("recovers from corrupt, expired, revised, and unavailable storage", () => {
    const authoredProgram = program()
    const now = new Date("2026-07-22T12:00:00.000Z")
    window.localStorage.setItem(WATCH_HOME_PROGRAM_LEDGER_STORAGE_KEY, "{")
    expect(
      readWatchHomeProgramLedger(authoredProgram, { now }).exposures,
    ).toEqual({})

    window.localStorage.setItem(
      WATCH_HOME_PROGRAM_LEDGER_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        month: "2026-06",
        updatedAt: now.getTime(),
        programFingerprint: "old",
        exposures: { "video:a": now.getTime() },
        bucketCycles: {},
      }),
    )
    expect(
      readWatchHomeProgramLedger(authoredProgram, { now }).exposures,
    ).toEqual({})

    const storage = {
      getItem() {
        throw new Error("denied")
      },
      setItem() {
        throw new Error("denied")
      },
      removeItem() {
        throw new Error("denied")
      },
    }
    let state = createWatchHomeProgramEngine(authoredProgram, { seed: 1 })
    state = exposeWatchHomeProgramIdentity(state, "video:a")
    expect(() =>
      persistWatchHomeProgramLedger(authoredProgram, state, { now, storage }),
    ).not.toThrow()
    expect(
      readWatchHomeProgramLedger(authoredProgram, { now, storage }).exposures,
    ).toHaveProperty("video:a")
  })

  it("migrates matching legacy played ids and merges competing writes", () => {
    const authoredProgram = program()
    const now = new Date("2026-07-22T12:00:00.000Z")
    window.localStorage.setItem(
      WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
      JSON.stringify({ month: "2026-07", ids: ["core-a", "b", "unknown"] }),
    )

    const migrated = readWatchHomeProgramLedger(authoredProgram, { now })
    expect(Object.keys(migrated.exposures).sort()).toEqual([
      "video:a",
      "video:b",
    ])

    let tabOne = createWatchHomeProgramEngine(authoredProgram, {
      seed: 1,
      ledger: migrated,
    })
    let tabTwo = createWatchHomeProgramEngine(authoredProgram, {
      seed: 2,
      ledger: migrated,
    })
    tabOne = exposeWatchHomeProgramIdentity(tabOne, "promo:join")
    tabTwo = exposeWatchHomeProgramIdentity(tabTwo, "promo:share")
    persistWatchHomeProgramLedger(authoredProgram, tabOne, { now })
    persistWatchHomeProgramLedger(authoredProgram, tabTwo, {
      now: new Date(now.getTime() + 1),
    })

    expect(
      Object.keys(
        readWatchHomeProgramLedger(authoredProgram, { now }).exposures,
      ),
    ).toEqual(expect.arrayContaining(["promo:join", "promo:share"]))
  })
})
