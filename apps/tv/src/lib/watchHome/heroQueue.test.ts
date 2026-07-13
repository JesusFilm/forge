import {
  buildHeroFeatured,
  buildHeroPools,
  buildHeroSourceMap,
  buildHeroVideoQueue,
  businessDate,
  getWatchHomeDeterministicOffset,
  simpleHash,
} from "./heroQueue"
import type {
  WatchHomeCard,
  WatchHomeMissingData,
  WatchHomeVideoInput,
} from "./model"
import heroParityFixture from "./__fixtures__/heroQueueParity.fixture.json"
import heroParityGolden from "./__fixtures__/heroQueueParity.golden.json"

const IMG = {
  url: "https://img.example/x.jpg",
  thumbnail: "https://img.example/x-thumb.jpg",
  mobileCinematicHigh: "https://img.example/x-high.jpg",
  mobileCinematicLow: "https://img.example/x-low.jpg",
  videoStill: "https://img.example/x-still.jpg",
}
const loc = (title: string) => [{ title, snippet: title, imageAlt: title }]
const leaf = (coreId: string, label = "EPISODE"): WatchHomeVideoInput => ({
  documentId: `${coreId}-doc`,
  coreId,
  slug: `${coreId}-slug`,
  label,
  durationSeconds: 120,
  images: [IMG],
  locales: loc(coreId),
})
const collection = (
  coreId: string,
  childCoreIds: string[],
  label = "COLLECTION",
): WatchHomeVideoInput => ({
  ...leaf(coreId, label),
  children: childCoreIds.map((id) => ({ child: leaf(id) })),
})
const sourceMap = (videos: WatchHomeVideoInput[]) => buildHeroSourceMap(videos)
const noMissing = (): WatchHomeMissingData[] => []
const coreIds = (cards: readonly WatchHomeCard[]) => cards.map((c) => c.coreId)

describe("businessDate", () => {
  // Validates TV's Intl-free date against Node's ICU en-CA output — the day-correct
  // ET reference web/mobile target. Device-Hermes parity is not provable here (that's
  // the non-ET-clock device smoke); the DST rule encodes the current US-era rule.
  it("returns the ET calendar date without Intl, matching mobile's en-CA output", () => {
    const instants = [
      "2026-07-13T15:00:00.000Z", // EDT, ET same day
      "2026-01-15T04:00:00.000Z", // EST, UTC 15th but ET 14th
      "2026-07-13T03:00:00.000Z", // EDT, UTC 13th but ET 12th
      "2026-03-08T06:30:00.000Z", // just before DST start (EST)
      "2026-03-08T07:30:00.000Z", // just after DST start (EDT)
      "2026-11-01T05:30:00.000Z", // just before DST end (EDT)
      "2026-11-01T06:30:00.000Z", // just after DST end (EST)
      "2026-12-31T23:00:00.000Z", // year-boundary
    ]
    for (const iso of instants) {
      const d = new Date(iso)
      const reference = d.toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      })
      expect(businessDate(d)).toBe(reference)
    }
  })
})

describe("simpleHash / getWatchHomeDeterministicOffset", () => {
  it("simpleHash is deterministic", () => {
    expect(simpleHash("abc")).toBe(simpleHash("abc"))
    expect(simpleHash("abc")).not.toBe(simpleHash("abd"))
  })

  it("offset stays in range and is stable for a fixed day", () => {
    const now = new Date("2026-07-13T15:00:00.000Z")
    const a = getWatchHomeDeterministicOffset("pool-x", 5, {
      now,
      poolIndex: 0,
    })
    const b = getWatchHomeDeterministicOffset("pool-x", 5, {
      now,
      poolIndex: 0,
    })
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(5)
    expect(getWatchHomeDeterministicOffset("pool-x", 0)).toBe(0)
  })
})

describe("buildHeroPools", () => {
  it("maps each group to one pool and expands children (not the collection card)", () => {
    const videos = [collection("8_NBC", ["nbc-ep1", "nbc-ep2"])]
    const pools = buildHeroPools({
      videoByCoreId: sourceMap(videos),
      languageSlug: "english",
      missingData: noMissing(),
    })
    const nbcPool = pools.find((p) => p.collectionIds.includes("8_NBC"))
    expect(nbcPool).toBeDefined()
    expect(coreIds(nbcPool!.cards as WatchHomeCard[]).sort()).toEqual([
      "nbc-ep1",
      "nbc-ep2",
    ])
    expect(nbcPool!.id).toBe("playlist-2-8_NBC")
  })

  it("falls back to the parent card when a source has no eligible children", () => {
    const videos = [leaf("1_jf-0-0", "FEATURE_FILM")]
    const pools = buildHeroPools({
      videoByCoreId: sourceMap(videos),
      languageSlug: "english",
      missingData: noMissing(),
    })
    const jfPool = pools.find((p) => p.collectionIds.includes("1_jf-0-0"))
    expect(coreIds(jfPool!.cards as WatchHomeCard[])).toEqual(["1_jf-0-0"])
  })

  // The image+slug eligibility gate is the most divergence-prone path: dropping a
  // candidate shifts candidates.length and every downstream `candidates[hash % len]`
  // pick. Lock it so a regression can't silently reshuffle the hero away from mobile.
  it("excludes ineligible children (no image or no slug), falling back to the parent when all are ineligible", () => {
    const noImage = { child: { ...leaf("no-img"), images: [] } }
    const noSlug = { child: { ...leaf("no-slug"), slug: null } }
    const mixed: WatchHomeVideoInput = {
      ...leaf("8_NBC", "COLLECTION"),
      children: [noImage, noSlug, { child: leaf("good-ep") }],
    }
    const mixedPools = buildHeroPools({
      videoByCoreId: sourceMap([mixed]),
      languageSlug: "english",
      missingData: noMissing(),
    })
    const nbc = mixedPools.find((p) => p.collectionIds.includes("8_NBC"))!
    expect(coreIds(nbc.cards as WatchHomeCard[])).toEqual(["good-ep"])

    const allIneligible: WatchHomeVideoInput = {
      ...leaf("1_jf-0-0", "FEATURE_FILM"),
      children: [noImage, noSlug],
    }
    const fallbackPools = buildHeroPools({
      videoByCoreId: sourceMap([allIneligible]),
      languageSlug: "english",
      missingData: noMissing(),
    })
    const jf = fallbackPools.find((p) => p.collectionIds.includes("1_jf-0-0"))!
    expect(coreIds(jf.cards as WatchHomeCard[])).toEqual(["1_jf-0-0"])
  })

  it("keeps raw children including self-refs and duplicates (no resolvedChildren)", () => {
    const selfRef = {
      documentId: "GOMattCollection-doc", // same as parent
      coreId: "GOMattCollection",
      slug: "GOMattCollection-slug",
      label: "SERIES",
      images: [IMG],
      locales: loc("GOMattCollection"),
    }
    const gomatt: WatchHomeVideoInput = {
      ...leaf("GOMattCollection", "SERIES"),
      children: [
        { child: leaf("gomatt-ep1") },
        { child: selfRef },
        { child: leaf("gomatt-ep1") },
      ],
    }
    const pools = buildHeroPools({
      videoByCoreId: sourceMap([gomatt]),
      languageSlug: "english",
      missingData: noMissing(),
    })
    const pool = pools.find((p) =>
      p.collectionIds.includes("GOMattCollection"),
    )!
    // raw children: 3 candidates (dup + self-ref preserved), unlike resolvedChildren.
    expect(pool.cards).toHaveLength(3)
    expect(coreIds(pool.cards as WatchHomeCard[])).toEqual([
      "gomatt-ep1",
      "GOMattCollection",
      "gomatt-ep1",
    ])
  })

  it("drops a source that exists only as another record's child (top-level-only map)", () => {
    // CS1 is a sequence source, present only as a child of 8_NBC.
    const videos = [collection("8_NBC", ["CS1"])]
    const missingData = noMissing()
    const pools = buildHeroPools({
      videoByCoreId: sourceMap(videos),
      languageSlug: "english",
      missingData,
    })
    expect(pools.find((p) => p.collectionIds.includes("CS1"))).toBeUndefined()
    expect(
      missingData.some((m) => m.sourceId === "CS1" && m.field === "record"),
    ).toBe(true)
  })

  it("appends the shortFilms pool last, deduped by coreId", () => {
    const videos = [
      leaf("1_jf-0-0", "FEATURE_FILM"),
      leaf("sf-1", "SHORT_FILM"),
    ]
    const pools = buildHeroPools({
      videoByCoreId: sourceMap(videos),
      languageSlug: "english",
      missingData: noMissing(),
    })
    const last = pools[pools.length - 1]
    expect(last.id).toBe("shortFilms")
    expect(coreIds(last.cards as WatchHomeCard[])).toEqual(["sf-1"])
  })
})

describe("buildHeroVideoQueue", () => {
  const now = new Date("2026-07-13T15:00:00.000Z")

  it("returns [] for empty pools", () => {
    expect(buildHeroVideoQueue({ pools: [], now })).toEqual([])
  })

  it("dedupes across the queue by coreId", () => {
    // A duplicate child (same coreId twice) must be emitted at most once.
    const built = buildHeroPools({
      videoByCoreId: sourceMap([collection("8_NBC", ["shared", "shared"])]),
      languageSlug: "english",
      missingData: noMissing(),
    })
    const queue = buildHeroVideoQueue({ pools: built, now })
    expect(coreIds(queue).filter((id) => id === "shared")).toHaveLength(1)
  })

  // Proves buildHeroVideoQueue is pure. Cross-app and intra-day re-fetch parity
  // additionally depend on admin returning children/videos in a STABLE order (R-E):
  // the pick is candidates[hash % len], so a reorder shifts the chosen card.
  it("is deterministic for the same day and inputs", () => {
    const videos = [collection("8_NBC", ["nbc-ep1", "nbc-ep2", "nbc-ep3"])]
    const pools = buildHeroPools({
      videoByCoreId: sourceMap(videos),
      languageSlug: "english",
      missingData: noMissing(),
    })
    const a = buildHeroVideoQueue({ pools, now })
    const b = buildHeroVideoQueue({ pools, now })
    expect(coreIds(a)).toEqual(coreIds(b))
  })
})

describe("cross-app parity (AE1)", () => {
  // golden.json = mobile's REAL buildWatchHomeHeroQueue(...).videos coreIds for the fixture.
  // Regenerate on a mobile-algorithm change: run mobile's buildWatchHomeModelFromVideos +
  // buildWatchHomeHeroQueue over the fixture (startPoolIndex 0, its nowIso) → ordered coreIds.
  it("TV's hero queue equals mobile's golden output for the shared fixture", () => {
    const featured = buildHeroFeatured({
      videos: heroParityFixture.videos as WatchHomeVideoInput[],
      languageSlug: "english",
      missingData: noMissing(),
      now: new Date(heroParityFixture.nowIso),
    })

    expect(coreIds(featured)).toEqual(heroParityGolden.coreIds)
  })
})
