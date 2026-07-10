import {
  WATCH_HOME_COLLECTION_BLACKLIST,
  WATCH_HOME_SECTIONS,
  getWatchHomeCoreIds,
} from "../watchHome/config"
import {
  buildWatchHomeModelFromVideos,
  type WatchHomeCard,
  type WatchHomeChildRelationInput,
  type WatchHomeImageInput,
  type WatchHomeVideoInput,
} from "../watchHome/model"

function image(
  overrides: Partial<WatchHomeImageInput> = {},
): WatchHomeImageInput {
  return {
    url: null,
    thumbnail: null,
    mobileCinematicHigh: null,
    mobileCinematicLow: null,
    videoStill: null,
    ...overrides,
  }
}

function child(
  coreId: string,
  overrides: Partial<WatchHomeVideoInput> = {},
): WatchHomeChildRelationInput {
  return {
    child: {
      documentId: `doc-${coreId}`,
      coreId,
      slug: `${coreId}-slug`,
      label: "EPISODE",
      durationSeconds: 300,
      images: [
        image({ mobileCinematicHigh: `https://img.example/${coreId}.jpg` }),
      ],
      locales: [
        {
          title: `${coreId} title`,
          description: `${coreId} description`,
          snippet: null,
          imageAlt: `${coreId} alt`,
        },
      ],
      ...overrides,
    },
  }
}

function videoInput(
  coreId: string,
  overrides: Partial<WatchHomeVideoInput> = {},
): WatchHomeVideoInput {
  return {
    documentId: `doc-${coreId}`,
    coreId,
    slug: `${coreId}-slug`,
    label: "COLLECTION",
    durationSeconds: null,
    images: [
      image({ mobileCinematicHigh: `https://img.example/${coreId}.jpg` }),
    ],
    locales: [
      {
        title: `${coreId} title`,
        description: `${coreId} description`,
        snippet: null,
        imageAlt: `${coreId} alt`,
      },
    ],
    children: [],
    ...overrides,
  }
}

function firstCard(model: { sections: { cards: WatchHomeCard[] }[] }) {
  const card = model.sections[0]?.cards[0]
  if (!card) throw new Error("expected at least one section card")
  return card
}

describe("buildWatchHomeModelFromVideos", () => {
  it("renders resolved sections in config order and drops zero-card sections", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [
        videoInput("11_Advent", {
          children: [child("11_Advent-ep1"), child("11_Advent-ep2")],
        }),
        videoInput("1_jf-0-0"),
      ],
    })

    const sectionIds = model.sections.map((section) => section.id)
    expect(sectionIds).toEqual([
      "home-video-gospels",
      "home-collection-showcase-grid",
      "home-collection-bibleproject-advent",
    ])

    // Config order is preserved regardless of fixture input order.
    const configOrder = WATCH_HOME_SECTIONS.map((section) => section.id)
    const positions = sectionIds.map((id) => configOrder.indexOf(id))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))

    const advent = model.sections.find(
      (section) => section.id === "home-collection-bibleproject-advent",
    )
    expect(advent?.cards.map((card) => card.coreId)).toEqual([
      "11_Advent-ep1",
      "11_Advent-ep2",
    ])
    expect(advent?.orientation).toBe("vertical")
  })

  it("degrades gracefully when the resolver omits core ids, reporting missingData", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [videoInput("1_jf-0-0")],
    })

    const recordMissing = model.missingData.filter(
      (entry) => entry.field === "record",
    )
    const missingHeroSources = recordMissing
      .filter((entry) => entry.sectionId === "home-hero")
      .map((entry) => entry.sourceId)
    expect(missingHeroSources).toEqual(
      expect.arrayContaining([
        "2_GOJ-0-0",
        "GOMattCollection",
        "LUMOCollection",
      ]),
    )

    // Unresolved section sources surface as record entries, resolved render.
    expect(recordMissing.some((entry) => entry.sourceId === "8_NBC")).toBe(true)
    expect(model.sections.length).toBeGreaterThan(0)
  })

  it("returns an empty-but-valid model when no videos resolve", () => {
    const model = buildWatchHomeModelFromVideos({ videos: [] })

    expect(model.sections).toEqual([])
    expect(model.carousel.pools).toEqual([])
    expect(
      model.missingData.filter((entry) => entry.field === "record").length,
    ).toBeGreaterThan(0)
  })

  it("falls through the image priority chain", () => {
    const expectImage = (
      images: readonly WatchHomeImageInput[],
      expected: string | null,
    ) => {
      const model = buildWatchHomeModelFromVideos({
        videos: [videoInput("1_jf-0-0", { images })],
      })
      expect(firstCard(model).imageUrl).toBe(expected)
    }

    expectImage(
      [
        image({
          mobileCinematicHigh: "high.jpg",
          mobileCinematicLow: "low.jpg",
          videoStill: "still.jpg",
          url: "url.jpg",
          thumbnail: "thumb.jpg",
        }),
      ],
      "high.jpg",
    )
    expectImage(
      [image({ mobileCinematicLow: "low.jpg", videoStill: "still.jpg" })],
      "low.jpg",
    )
    expectImage(
      [image({ videoStill: "still.jpg", url: "url.jpg" })],
      "still.jpg",
    )
    expectImage([image({ url: "url.jpg", thumbnail: "thumb.jpg" })], "url.jpg")
    expectImage([image({ thumbnail: "thumb.jpg" })], "thumb.jpg")
    // Skips an empty first image record to find a usable later one.
    expectImage([image(), image({ thumbnail: "thumb.jpg" })], "thumb.jpg")
    expectImage([], null)
  })

  it("reports missingData for absent titles and images while keeping the card", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [videoInput("1_jf-0-0", { images: [], locales: [] })],
    })

    const card = firstCard(model)
    expect(card.title).toBe("1_jf-0-0-slug")
    expect(card.imageUrl).toBeNull()
    const fields = model.missingData
      .filter((entry) => entry.sourceId === "1_jf-0-0")
      .map((entry) => entry.field)
    expect(fields).toEqual(expect.arrayContaining(["title", "image"]))
  })

  it("derives metaLabel from children, then duration, then label", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [
        videoInput("1_jf-0-0", {
          children: [child("1_jf-0-0-ep1"), child("1_jf-0-0-ep2")],
        }),
        videoInput("11_Advent", {
          label: "COLLECTION",
          children: [
            child("11_Advent-ep1", { durationSeconds: 4806 }),
            child("11_Advent-ep2", { durationSeconds: null, label: "SEGMENT" }),
          ],
        }),
      ],
    })

    expect(firstCard(model).metaLabel).toBe("2 episodes")

    const advent = model.sections.find(
      (section) => section.id === "home-collection-bibleproject-advent",
    )
    expect(advent?.cards[0]?.metaLabel).toBe("1:20:06")
    expect(advent?.cards[1]?.metaLabel).toBe("Segment")
  })

  it("carries no href and no hls on cards (mobile routes from slug/coreId)", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [videoInput("1_jf-0-0")],
    })

    const card = firstCard(model)
    expect("href" in card).toBe(false)
    expect("hls" in card).toBe(false)
    expect(card.slug).toBe("1_jf-0-0-slug")
    expect(card.playbackId).toBeNull()
  })

  it("builds carousel pools from the playlist sequence without requiring streams (KTD-4)", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [
        videoInput("1_jf-0-0"),
        videoInput("11_Advent", {
          children: [child("11_Advent-ep1"), child("11_Advent-ep2")],
        }),
      ],
    })

    const poolIds = model.carousel.pools.map((pool) => pool.id)
    expect(poolIds).toEqual([
      "playlist-0-1_jf-0-0",
      "playlist-6-11_Sermon|11_Shema|11_ReadBible|11_Advent",
    ])

    const adventPool = model.carousel.pools[1]
    expect(adventPool?.videos.map((video) => video.id)).toEqual([
      "11_Advent-ep1",
      "11_Advent-ep2",
    ])
    expect(adventPool?.videos[0]?.parentSlug).toBe("11_Advent-slug")
  })

  it("keeps a posterless card in its section but out of the carousel (KTD-4)", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [videoInput("1_jf-0-0", { images: [] })],
    })

    expect(firstCard(model).imageUrl).toBeNull()
    expect(
      model.carousel.pools.some((pool) => pool.id === "playlist-0-1_jf-0-0"),
    ).toBe(false)
  })

  it("synthesizes the short-films pool from SHORT_FILM labels", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [
        videoInput("1_jf-0-0", {
          children: [
            child("short-1", { label: "SHORT_FILM" }),
            child("episode-1", { label: "EPISODE" }),
          ],
        }),
        videoInput("standalone-short", { label: "SHORT_FILM" }),
      ],
    })

    const shortFilms = model.carousel.pools.find(
      (pool) => pool.id === "shortFilms",
    )
    expect(shortFilms?.videos.map((video) => video.id)).toEqual(
      expect.arrayContaining(["short-1", "standalone-short"]),
    )
    expect(shortFilms?.videos.some((video) => video.id === "episode-1")).toBe(
      false,
    )
  })

  it("excludes blacklisted core ids from the carousel everywhere", () => {
    const blacklisted = "7_Origins4Connect"
    expect(WATCH_HOME_COLLECTION_BLACKLIST.has(blacklisted)).toBe(true)

    const model = buildWatchHomeModelFromVideos({
      videos: [
        videoInput(blacklisted, { label: "SHORT_FILM" }),
        videoInput("standalone-short", { label: "SHORT_FILM" }),
      ],
    })

    const shortFilms = model.carousel.pools.find(
      (pool) => pool.id === "shortFilms",
    )
    expect(shortFilms?.videos.map((video) => video.id)).toEqual([
      "standalone-short",
    ])
  })
})

describe("getWatchHomeCoreIds", () => {
  it("stays within the watchHomeVideos resolver cap of 100 core ids", () => {
    expect(getWatchHomeCoreIds().length).toBeLessThanOrEqual(100)
  })

  it("returns unique ids with no blacklisted entries", () => {
    const ids = getWatchHomeCoreIds()
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(WATCH_HOME_COLLECTION_BLACKLIST.has(id)).toBe(false)
    }
  })
})
