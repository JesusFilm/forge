import {
  WATCH_HOME_MUX_INSERTS,
  type WatchHomeMuxInsertConfig,
} from "../watchHome/config"
import {
  WATCH_HOME_TV_ADVANCE_THRESHOLD,
  buildWatchHomeHeroQueue,
  buildWatchHomeVideoQueue,
  getWatchHomeDeterministicOffset,
  mergeWatchHomeMuxInserts,
  muxSlideDisplayCopy,
  overlayForInsert,
  type WatchHomeCarouselPool,
  type WatchHomeVideoSlide,
} from "../watchHome/carouselSequence"

// 2026-06-04 is in EDT (UTC-4): 12:00Z = 8am, 18:00Z = 2pm, 23:00Z = 7pm
// Eastern; 03:00Z is 11pm Eastern the previous evening (no overlay window).
const morningNow = new Date("2026-06-04T12:00:00.000Z")
const afternoonNow = new Date("2026-06-04T18:00:00.000Z")
const eveningNow = new Date("2026-06-04T23:00:00.000Z")
const lateNightNow = new Date("2026-06-04T03:00:00.000Z")

const welcomeInsert = WATCH_HOME_MUX_INSERTS.find(
  (insert) => insert.id === "welcome-start",
)
if (!welcomeInsert) throw new Error("welcome-start insert missing from config")

function video(
  id: string,
  overrides: Partial<WatchHomeVideoSlide> = {},
): WatchHomeVideoSlide {
  return {
    kind: "video",
    id,
    title: id,
    description: null,
    label: "Short film",
    slug: `${id}-slug`,
    parentSlug: null,
    posterUrl: `https://img.example/${id}.jpg`,
    thumbnailUrl: `https://img.example/${id}-thumb.jpg`,
    imageAlt: id,
    playbackId: null,
    durationSeconds: 10,
    ...overrides,
  }
}

function pool(id: string, videoIds: string[]): WatchHomeCarouselPool {
  return {
    id,
    collectionIds: [id],
    videos: videoIds.map((videoId) => video(videoId)),
  }
}

const muxInsert = {
  id: "welcome-start",
  enabled: true,
  playbackIds: ["playback-a"],
  durationSeconds: 9,
  label: "Faith & Scripture",
  title: "Today's Video Picks",
  collectionTitle: "Daily Inspirations",
  description: "A welcome insert.",
  action: null,
  logo: true,
  posterOverride: null,
  trigger: { type: "sequence-start" },
} satisfies WatchHomeMuxInsertConfig

describe("getWatchHomeDeterministicOffset", () => {
  it("is stable for a fixed business date and pool", () => {
    expect(
      getWatchHomeDeterministicOffset("pool-a", 12, {
        now: morningNow,
        poolIndex: 0,
        totalVideosLoaded: 0,
      }),
    ).toBe(
      getWatchHomeDeterministicOffset("pool-a", 12, {
        now: morningNow,
        poolIndex: 0,
        totalVideosLoaded: 0,
      }),
    )
    expect(
      getWatchHomeDeterministicOffset("pool-a", 0, { now: morningNow }),
    ).toBe(0)
  })
})

describe("buildWatchHomeVideoQueue", () => {
  it("builds a queue from playlist pools while skipping the in-memory played set", () => {
    const result = buildWatchHomeVideoQueue({
      pools: [
        pool("pool-a", ["video-a", "video-b"]),
        pool("pool-b", ["video-c", "video-d"]),
      ],
      playedIds: new Set(["video-a", "video-c"]),
      targetVideoCount: 2,
      now: morningNow,
    })

    expect(result.videos.map((item) => item.id)).toEqual(["video-b", "video-d"])
    expect(result.videos.map((item) => item.poolId)).toEqual([
      "pool-a",
      "pool-b",
    ])
    expect(result.nextPoolIndex).toBe(2)
  })

  it("resumes the pool rotation from a non-zero startPoolIndex (persisted session resume)", () => {
    const result = buildWatchHomeVideoQueue({
      pools: [
        pool("pool-a", ["video-a", "video-b"]),
        pool("pool-b", ["video-c", "video-d"]),
      ],
      startPoolIndex: 1,
      targetVideoCount: 1,
      now: morningNow,
    })

    expect(result.videos).toHaveLength(1)
    expect(result.videos[0]?.poolId).toBe("pool-b")
    expect(result.videos[0]?.poolIndex).toBe(1)
    expect(result.nextPoolIndex).toBe(2)
  })

  it("advances past a played slide on rebuild (played set advances the queue)", () => {
    const pools = [pool("pool-a", ["video-a", "video-b"])]
    const first = buildWatchHomeVideoQueue({
      pools,
      targetVideoCount: 1,
      now: morningNow,
    })
    const firstId = first.videos[0]?.id
    if (!firstId) throw new Error("expected a first queue pick")

    const second = buildWatchHomeVideoQueue({
      pools,
      playedIds: new Set([firstId]),
      targetVideoCount: 1,
      now: morningNow,
    })

    expect(second.videos[0]?.id).not.toBe(firstId)
    expect(["video-a", "video-b"]).toContain(second.videos[0]?.id)
  })

  it("cycles a single pool across multiple visits to fill the target", () => {
    const result = buildWatchHomeVideoQueue({
      pools: [pool("pool-a", ["video-a", "video-b", "video-c"])],
      targetVideoCount: 3,
      now: morningNow,
    })

    expect(result.videos.map((item) => item.id).sort()).toEqual([
      "video-a",
      "video-b",
      "video-c",
    ])
    expect(result.nextPoolIndex).toBe(3)
  })

  it("skips slides without a poster or slug (KTD-4 eligibility, no hls required)", () => {
    const result = buildWatchHomeVideoQueue({
      pools: [
        {
          id: "pool-a",
          collectionIds: ["pool-a"],
          videos: [
            video("no-poster", { posterUrl: null }),
            video("no-slug", { slug: null }),
            video("good"),
          ],
        },
      ],
      targetVideoCount: 3,
      now: morningNow,
    })

    expect(result.videos.map((item) => item.id)).toEqual(["good"])
  })

  it("returns existing videos untouched when pools are empty or target is met", () => {
    expect(
      buildWatchHomeVideoQueue({
        pools: [],
        targetVideoCount: 5,
        now: morningNow,
      }),
    ).toEqual({ videos: [], nextPoolIndex: 0 })

    const existing = [video("existing-1")]
    const result = buildWatchHomeVideoQueue({
      pools: [pool("pool-a", ["video-a"])],
      existingVideos: existing,
      targetVideoCount: 1,
      now: morningNow,
    })
    expect(result.videos.map((item) => item.id)).toEqual(["existing-1"])
  })
})

describe("mergeWatchHomeMuxInserts", () => {
  it("merges inserts at sequence-start and after-count positions with a date-prefixed first title", () => {
    const slides = mergeWatchHomeMuxInserts(
      [video("video-1"), video("video-2")],
      [
        muxInsert,
        {
          ...muxInsert,
          id: "join-us",
          playbackIds: ["join-a", "join-b"],
          title: "Join Us",
          trigger: { type: "after-count", count: 1 },
          action: { label: "Join Us", url: "https://example.com" },
        },
      ],
      morningNow,
    )

    expect(slides.map((slide) => slide.id)).toEqual([
      "mux-welcome-start",
      "video-1",
      "mux-join-us",
      "video-2",
    ])
    expect(slides[0]).toMatchObject({
      kind: "mux",
      title: "Jun 4: Today's Video Picks",
      playbackId: "playback-a",
      prefixTitleWithDate: true,
    })
  })

  it("selects a stable playback id per session seed without any persistence", () => {
    const joinInsert: WatchHomeMuxInsertConfig = {
      ...muxInsert,
      id: "join-us",
      playbackIds: ["join-a", "join-b"],
      trigger: { type: "after-count", count: 1 },
    }
    const run = () =>
      mergeWatchHomeMuxInserts(
        [video("video-1")],
        [joinInsert],
        morningNow,
        "seed-1",
      )

    const first = run()[1]
    const second = run()[1]
    if (first?.kind !== "mux" || second?.kind !== "mux") {
      throw new Error("expected mux slides after video-1")
    }
    expect(["join-a", "join-b"]).toContain(first.playbackId)
    expect(second.playbackId).toBe(first.playbackId)
    expect(first.playbackIndex).toBe(
      joinInsert.playbackIds.indexOf(first.playbackId ?? ""),
    )
  })

  it("omits disabled inserts and inserts without playback ids", () => {
    expect(
      mergeWatchHomeMuxInserts(
        [video("video-1")],
        [{ ...muxInsert, enabled: false }],
        morningNow,
      ).map((slide) => slide.id),
    ).toEqual(["video-1"])

    expect(
      mergeWatchHomeMuxInserts(
        [video("video-1")],
        [{ ...muxInsert, playbackIds: [] }],
        morningNow,
      ).map((slide) => slide.id),
    ).toEqual(["video-1"])
  })
})

describe("overlayForInsert (display-time Eastern-hour rule)", () => {
  it("returns morning copy for a morning Eastern hour", () => {
    expect(overlayForInsert(welcomeInsert, morningNow).title).toBe(
      "Good Morning! Today's Bible Moments Await.",
    )
  })

  it("returns afternoon copy for an afternoon Eastern hour", () => {
    expect(overlayForInsert(welcomeInsert, afternoonNow).title).toBe(
      "Good Afternoon! Bible Moments for Your Day.",
    )
  })

  it("returns evening copy for an evening Eastern hour", () => {
    expect(overlayForInsert(welcomeInsert, eveningNow).title).toBe(
      "Good Evening! Wind Down with Bible Moments.",
    )
  })

  it("falls back to the base insert copy outside every overlay window", () => {
    const copy = overlayForInsert(welcomeInsert, lateNightNow)
    expect(copy.title).toBe("Today's Video Picks")
    expect(copy.label).toBe("Faith & Scripture")
    expect(copy.action).toBeNull()
  })

  it("re-resolves a built slide's copy at display time via muxSlideDisplayCopy", () => {
    const slides = mergeWatchHomeMuxInserts(
      [video("video-1")],
      [welcomeInsert],
      morningNow,
    )
    const slide = slides[0]
    if (slide?.kind !== "mux") throw new Error("expected the welcome mux slide")

    // Built in the morning, displayed in the evening: copy follows display time.
    expect(slide.title).toBe(
      "Jun 4: Good Morning! Today's Bible Moments Await.",
    )
    expect(muxSlideDisplayCopy(slide, eveningNow).title).toBe(
      "Jun 4: Good Evening! Wind Down with Bible Moments.",
    )
  })
})

describe("buildWatchHomeHeroQueue", () => {
  const pools = [
    pool("pool-a", ["video-a", "video-b"]),
    pool("pool-b", ["video-c", "video-d"]),
  ]

  it("composes the full queue with the real config inserts at their trigger positions", () => {
    const result = buildWatchHomeHeroQueue({
      pools,
      inserts: WATCH_HOME_MUX_INSERTS,
      targetVideoCount: 4,
      now: morningNow,
    })

    expect(result.videos).toHaveLength(4)
    expect(result.wrapped).toBe(false)
    expect(result.slides.map((slide) => slide.kind)).toEqual([
      "mux",
      "video",
      "mux",
      "video",
      "video",
      "mux",
      "video",
    ])
    expect(result.slides[0]?.id).toBe("mux-welcome-start")
    expect(result.slides[2]?.id).toBe("mux-join-us")
    expect(result.slides[5]?.id).toBe("mux-telling-the-story-of-jesus")
  })

  it("wraps to the start when every slide has been played", () => {
    const result = buildWatchHomeHeroQueue({
      pools: [pool("pool-a", ["video-a", "video-b"])],
      inserts: [],
      playedIds: new Set(["video-a", "video-b"]),
      now: morningNow,
    })

    expect(result.wrapped).toBe(true)
    expect(result.videos.map((item) => item.id).sort()).toEqual([
      "video-a",
      "video-b",
    ])
  })

  it("does not wrap while unplayed slides remain; played ones backfill the queue", () => {
    const result = buildWatchHomeHeroQueue({
      pools: [pool("pool-a", ["video-a", "video-b"])],
      inserts: [],
      playedIds: new Set(["video-a"]),
      now: morningNow,
    })

    expect(result.wrapped).toBe(false)
    // Fixed-size contract: the unseen video leads, the played one returns
    // behind it instead of the queue shrinking to a single slide.
    expect(result.videos.map((item) => item.id)).toEqual(["video-b", "video-a"])
  })

  it("holds the fixed target by backfilling played videos AFTER every unseen one", () => {
    const result = buildWatchHomeHeroQueue({
      pools,
      inserts: [],
      playedIds: new Set(["video-a", "video-b", "video-c"]),
      targetVideoCount: 4,
      now: morningNow,
    })

    expect(result.wrapped).toBe(false)
    expect(result.videos).toHaveLength(4)
    expect(result.videos[0]?.id).toBe("video-d")
    expect(result.videos.map((v) => v.id).sort()).toEqual([
      "video-a",
      "video-b",
      "video-c",
      "video-d",
    ])
  })

  it("backfill stops at pool exhaustion with no duplicates", () => {
    const result = buildWatchHomeHeroQueue({
      pools: [pool("pool-a", ["video-a", "video-b"])],
      inserts: [],
      playedIds: new Set(["video-a"]),
      targetVideoCount: 7,
      now: morningNow,
    })

    expect(result.videos).toHaveLength(2)
    expect(new Set(result.videos.map((v) => v.id)).size).toBe(2)
  })
})

describe("constants", () => {
  it("keeps web's 95% advance threshold", () => {
    expect(WATCH_HOME_TV_ADVANCE_THRESHOLD).toBe(95)
  })
})

describe("watchHome modules are Hermes-safe (no storage access)", () => {
  // On Hermes `window` exists but storage globals throw on access. Install
  // throwing globals and exercise the full surface so any reintroduced storage
  // call (web's localStorage played-id tracking) fails here before it crashes the app.
  type GlobalWithStorage = typeof globalThis & {
    localStorage?: unknown
    sessionStorage?: unknown
  }

  const throwingStorage = new Proxy({} as Storage, {
    get() {
      throw new Error("storage API accessed by a watchHome module")
    },
  })

  const g = globalThis as GlobalWithStorage

  beforeAll(() => {
    g.localStorage = throwingStorage
    g.sessionStorage = throwingStorage
  })

  afterAll(() => {
    Reflect.deleteProperty(g, "localStorage")
    Reflect.deleteProperty(g, "sessionStorage")
  })

  it("builds queues, merges inserts, and resolves overlays without touching storage", () => {
    const now = new Date("2026-06-10T15:00:00-04:00")
    const queue = buildWatchHomeHeroQueue({
      pools: [],
      inserts: WATCH_HOME_MUX_INSERTS,
      playedIds: new Set<string>(),
      now,
    })
    expect(queue.slides.length).toBeGreaterThan(0)
    for (const insert of WATCH_HOME_MUX_INSERTS) {
      overlayForInsert(insert, now)
    }
  })
})
