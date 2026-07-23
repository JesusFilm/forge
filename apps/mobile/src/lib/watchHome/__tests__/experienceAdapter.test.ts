import {
  assembleWatchHomeModel,
  buildWatchHomeSectionsFromExperience,
  experienceItemCoreIds,
} from "../experienceAdapter"
import type { WatchHomeModel, WatchHomeVideoInput } from "../model"

/**
 * The adapter maps the published homepage Experience's flat MediaCollectionBlock
 * items into the existing WatchHomeSection[] shape (lean cards, matching web).
 * Cards additionally hydrate title/image from a coreId->video index when the
 * item's own authored overrides are absent (feat-172 coreId hydration; see the
 * "coreId hydration" describe blocks below). Non-collection blocks are skipped;
 * WatchHomeHeroBlock is an expected placeholder and must not warn.
 */

type Block = { __typename?: string | null } & Record<string, unknown>

function mediaCollection(overrides: Partial<Block> = {}): Block {
  return {
    __typename: "MediaCollectionBlock",
    sectionKey: "home-video-gospels",
    title: "Discover the full story",
    categoryLabel: "Films",
    mediaCollectionVariant: "carousel",
    showItemNumbers: false,
    items: [
      {
        videoId: "cmp76xcw602imny01vnsbwwy9",
        videoSlug: "jesus",
        titleOverride: "JESUS",
        labelOverride: "Feature film",
        collectionSize: null,
        imageUrl: "https://img/jesus.jpg",
      },
    ],
    ...overrides,
  }
}

describe("buildWatchHomeSectionsFromExperience", () => {
  it("maps a carousel block with items to one rail/landscape section with cards (R2, R3)", () => {
    const sections = buildWatchHomeSectionsFromExperience([mediaCollection()])
    expect(sections).toHaveLength(1)
    const section = sections[0]
    expect(section.id).toBe("home-video-gospels")
    expect(section.title).toBe("Discover the full story")
    expect(section.eyebrow).toBe("Films")
    expect(section.layout).toBe("rail")
    expect(section.orientation).toBe("horizontal")
    expect(section.cards).toHaveLength(1)
    const card = section.cards[0]
    expect(card.slug).toBe("jesus")
    expect(card.title).toBe("JESUS")
    expect(card.imageUrl).toBe("https://img/jesus.jpg")
  })

  it("maps variants to layout/orientation, unknown → grid/horizontal (AE5)", () => {
    const [carouselS] = buildWatchHomeSectionsFromExperience([
      mediaCollection({ mediaCollectionVariant: "carousel" }),
    ])
    const [gridS] = buildWatchHomeSectionsFromExperience([
      mediaCollection({ mediaCollectionVariant: "grid" }),
    ])
    const [collectionS] = buildWatchHomeSectionsFromExperience([
      mediaCollection({ mediaCollectionVariant: "collection" }),
    ])
    const [unknownS] = buildWatchHomeSectionsFromExperience([
      mediaCollection({ mediaCollectionVariant: "player" }),
    ])
    expect([carouselS.layout, carouselS.orientation]).toEqual([
      "rail",
      "horizontal",
    ])
    expect([gridS.layout, gridS.orientation]).toEqual(["grid", "horizontal"])
    expect([collectionS.layout, collectionS.orientation]).toEqual([
      "grid",
      "vertical",
    ])
    expect([unknownS.layout, unknownS.orientation]).toEqual([
      "grid",
      "horizontal",
    ])
  })

  it("keeps carousel orientation from the block variant even when every item has authored art", () => {
    const [authoredArtRail] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        mediaCollectionVariant: "carousel",
        items: [
          {
            videoId: "a",
            videoSlug: "jesus",
            imageUrl: "https://admin/x/preview",
          },
          {
            videoId: "b",
            videoSlug: "lumo",
            imageUrl: "https://admin/y/preview",
          },
        ],
      }),
    ])
    expect(authoredArtRail.orientation).toBe("horizontal")

    const [mixed] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        mediaCollectionVariant: "carousel",
        items: [
          {
            videoId: "a",
            videoSlug: "jesus",
            imageUrl: "https://admin/x/preview",
          },
          { videoId: "b", videoSlug: "lumo", imageUrl: null },
        ],
      }),
    ])
    expect(mixed.orientation).toBe("horizontal")
  })

  it("uses thumbnailOrientation as the explicit authored card shape", () => {
    const [portrait] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        mediaCollectionVariant: "carousel",
        thumbnailOrientation: "vertical",
      }),
    ])
    const [landscape] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        mediaCollectionVariant: "collection",
        thumbnailOrientation: "horizontal",
      }),
    ])

    expect(portrait.orientation).toBe("vertical")
    expect(landscape.orientation).toBe("horizontal")
  })

  it("skips a non-collection block and warns in dev (AE4, R5)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    const sections = buildWatchHomeSectionsFromExperience([
      mediaCollection(),
      { __typename: "SectionBlock", sectionKey: "home-global-missions-promo" },
    ])
    expect(sections).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SectionBlock"))
    warn.mockRestore()
  })

  it("skips WatchHomeHeroBlock with NO warn (AE3, expected placeholder)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    const sections = buildWatchHomeSectionsFromExperience([
      { __typename: "WatchHomeHeroBlock", sectionKey: "watch-home-hero" },
      mediaCollection(),
    ])
    expect(sections).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("skips an empty collection and renders a sparse one as-is (R2)", () => {
    const empty = buildWatchHomeSectionsFromExperience([
      mediaCollection({ items: [] }),
    ])
    expect(empty).toHaveLength(0)

    const sparse = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          { videoSlug: "a", titleOverride: "A" },
          { videoSlug: "b", titleOverride: "B" },
        ],
      }),
    ])
    expect(sparse[0].cards).toHaveLength(2)
  })

  it("keeps a slug-less item that has a videoId (web parity), drops only id-less ones (R3)", () => {
    const [section] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          { videoId: "a", videoSlug: "keep", titleOverride: "Keep" },
          { videoId: "b", videoSlug: null, titleOverride: "No slug" },
          { videoSlug: "", titleOverride: "No id at all" },
        ],
      }),
    ])
    // Slug-less-but-identified item is kept (non-navigable, empty slug); the
    // item with neither videoId nor slug drops.
    expect(section.cards.map((c) => c.title)).toEqual(["Keep", "No slug"])
    expect(section.cards.map((c) => c.slug)).toEqual(["keep", ""])
  })

  it("renders a full shelf when items carry videoId + image but a null slug (prod shape, R2)", () => {
    // Regression: the prod watch-home Experience's MediaCollection items all
    // have videoSlug=null with a real videoId + imageUrl; dropping them mapped
    // the whole body to zero shelves and fell back to config.
    const [section] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          {
            videoId: "v1",
            videoSlug: null,
            titleOverride: "JESUS",
            imageUrl: "https://img/1.jpg",
            labelOverride: "FEATURE FILM",
          },
          {
            videoId: "v2",
            videoSlug: null,
            titleOverride: "LUMO",
            imageUrl: "https://img/2.jpg",
            labelOverride: "EPISODE",
          },
        ],
      }),
    ])
    expect(section.cards).toHaveLength(2)
    expect(section.cards.map((c) => c.title)).toEqual(["JESUS", "LUMO"])
    expect(section.cards.every((c) => c.slug === "")).toBe(true)
    expect(section.cards[0].imageUrl).toBe("https://img/1.jpg")
    expect(section.cards[0].metaLabel).toBe("FEATURE FILM")
  })

  it("uses collectionSize verbatim as metaLabel; falls to label / null otherwise (KTD5)", () => {
    const [withSize] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          { videoSlug: "s", titleOverride: "S", collectionSize: "25 items" },
        ],
      }),
    ])
    expect(withSize.cards[0].metaLabel).toBe("25 items")

    const [withLabel] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          { videoSlug: "l", titleOverride: "L", labelOverride: "Series" },
        ],
      }),
    ])
    expect(withLabel.cards[0].metaLabel).toBe("Series")

    const [none] = buildWatchHomeSectionsFromExperience([
      mediaCollection({ items: [{ videoSlug: "n", titleOverride: "N" }] }),
    ])
    expect(none.cards[0].metaLabel).toBeNull()

    // collectionSize is a free-text String, never coerced to a numeric badge.
    expect(typeof withSize.cards[0].metaLabel).toBe("string")
  })

  it("passes authored image URLs through", () => {
    const [section] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          {
            videoSlug: "seed",
            titleOverride: "Seed",
            imageUrl:
              "https://www.jesusfilm.org/images/thumbnails/1-vertical.png",
          },
          {
            videoSlug: "admin",
            titleOverride: "Admin",
            imageUrl:
              "https://admin.jesusfilm.org/api/public/media-assets/x/preview",
          },
        ],
      }),
    ])
    expect(section.cards[0].imageUrl).toBe(
      "https://www.jesusfilm.org/images/thumbnails/1-vertical.png",
    )
    expect(section.cards[1].imageUrl).toBe(
      "https://admin.jesusfilm.org/api/public/media-assets/x/preview",
    )
  })

  it("uses imageUrl; title never blank (R3)", () => {
    const [section] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          {
            videoSlug: "o",
            titleOverride: "",
            labelOverride: "Label wins",
            imageUrl: "https://img/override.jpg",
          },
        ],
      }),
    ])
    expect(section.cards[0].imageUrl).toBe("https://img/override.jpg")
    // empty titleOverride falls back to labelOverride, never blank
    expect(section.cards[0].title).toBe("Label wins")
  })

  it("gives sectionKey-less blocks unique ids (FlashList key safety)", () => {
    const sections = buildWatchHomeSectionsFromExperience([
      mediaCollection({ sectionKey: null, title: "" }),
      mediaCollection({ sectionKey: null, title: "" }),
    ])
    expect(sections).toHaveLength(2)
    expect(new Set(sections.map((s) => s.id)).size).toBe(2)
  })

  it("gives a repeated video in one collection unique card ids (recyclingKey safety)", () => {
    const [section] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          { videoId: "v1", videoSlug: "a", titleOverride: "A" },
          { videoId: "v1", videoSlug: "a", titleOverride: "A again" },
        ],
      }),
    ])
    expect(section.cards).toHaveLength(2)
    expect(new Set(section.cards.map((c) => c.id)).size).toBe(2)
  })

  it("treats a blank/whitespace collectionSize as absent, not an empty badge (KTD5)", () => {
    const [section] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          { videoSlug: "s", labelOverride: "Series", collectionSize: "" },
          { videoSlug: "t", labelOverride: "Docs", collectionSize: "   " },
        ],
      }),
    ])
    expect(section.cards[0].metaLabel).toBe("Series")
    expect(section.cards[1].metaLabel).toBe("Docs")
  })
})

describe("buildWatchHomeSectionsFromExperience — coreId hydration", () => {
  // The prod "Acts of the Apostles" shape: items carry a coreId + muxPlaybackId
  // but null titleOverride/labelOverride/imageUrl/imageUrl.
  const actsVideo: WatchHomeVideoInput = {
    documentId: "d-acts-1",
    coreId: "6_Acts0401",
    slug: "lumo-acts-1-1-8-3",
    images: [{ mobileCinematicHigh: "https://cdn/acts-1.jpg" }],
    locales: [{ title: "LUMO - Acts 1:1-8:3" }],
  }
  const videoByCoreId = new Map<string, WatchHomeVideoInput>([
    ["6_Acts0401", actsVideo],
  ])

  it("fills title + image from the linked video when the item's overrides are all null", () => {
    const [section] = buildWatchHomeSectionsFromExperience(
      [
        mediaCollection({
          mediaCollectionVariant: "grid",
          items: [
            {
              videoId: "d-acts-1",
              coreId: "6_Acts0401",
              videoSlug: "lumo-acts-1-1-8-3",
              muxPlaybackId: "y2W2LCPRxygn8RdXmldloduOoKYJo8TaVJzdvjBrggw",
              titleOverride: null,
              labelOverride: null,
              imageUrl: null,
            },
          ],
        }),
      ],
      videoByCoreId,
    )
    expect(section.cards[0].title).toBe("LUMO - Acts 1:1-8:3")
    expect(section.cards[0].imageUrl).toBe("https://cdn/acts-1.jpg")
    expect(section.cards[0].imageAlt).toBe("LUMO - Acts 1:1-8:3")
  })

  it("keeps authored overrides winning over hydration (working shelves unchanged)", () => {
    const [section] = buildWatchHomeSectionsFromExperience(
      [
        mediaCollection({
          items: [
            {
              videoId: "d-acts-1",
              coreId: "6_Acts0401",
              videoSlug: "lumo-acts-1-1-8-3",
              titleOverride: "Curated Title",
              imageUrl: "https://img/curated.jpg",
            },
          ],
        }),
      ],
      videoByCoreId,
    )
    expect(section.cards[0].title).toBe("Curated Title")
    expect(section.cards[0].imageUrl).toBe("https://img/curated.jpg")
  })

  it("falls back to the item's mux thumbnail + slug title when the coreId does not hydrate", () => {
    const [section] = buildWatchHomeSectionsFromExperience(
      [
        mediaCollection({
          items: [
            {
              videoId: "d-x",
              coreId: "6_Missing",
              videoSlug: "lumo-acts-1-1-8-3",
              muxPlaybackId: "y2W2LCPRxygn8RdXmldloduOoKYJo8TaVJzdvjBrggw",
            },
          ],
        }),
      ],
      new Map(), // empty index → no hydration
    )
    expect(section.cards[0].title).toBe("lumo-acts-1-1-8-3")
    expect(section.cards[0].imageUrl).toBe(
      "https://image.mux.com/y2W2LCPRxygn8RdXmldloduOoKYJo8TaVJzdvjBrggw/thumbnail.png?width=1280&fit_mode=smartcrop",
    )
  })

  it("renders inline-only (no map arg) exactly as before — backward compatible", () => {
    const [section] = buildWatchHomeSectionsFromExperience([mediaCollection()])
    expect(section.cards[0].title).toBe("JESUS")
    expect(section.cards[0].imageUrl).toBe("https://img/jesus.jpg")
  })
})

describe("assembleWatchHomeModel — config/hydration separation (feat-172 hero-leak guard)", () => {
  // A renderable short film: label SHORT_FILM + slug + poster → eligible for the
  // carousel's greedy shortFilmById scan (isEligibleWatchHomeVideoSlide).
  const shortFilm: WatchHomeVideoInput = {
    documentId: "d-short",
    coreId: "TESTSHORT1",
    slug: "test-short",
    label: "SHORT_FILM",
    images: [{ mobileCinematicHigh: "https://cdn/short.jpg" }],
    locales: [{ title: "Test Short Film" }],
  }
  const shortFilmBlock = mediaCollection({
    items: [
      { videoId: "d-short", coreId: "TESTSHORT1", videoSlug: "test-short" },
    ],
  })
  const inCarouselPools = (model: WatchHomeModel, id: string): boolean =>
    model.carousel.pools.some((pool) => pool.videos.some((v) => v.id === id))

  it("BASELINE: a short film in the config videos DOES reach the carousel pools (guard is non-vacuous)", () => {
    const { model } = assembleWatchHomeModel({
      configVideos: [shortFilm],
      hydrationVideos: [],
      blocks: null,
    })
    expect(inCarouselPools(model, "TESTSHORT1")).toBe(true)
  })

  it("GUARD: a short film that arrives ONLY as top-up hydration renders in the Experience body but NEVER the client-owned hero", () => {
    const { model, usedExperience } = assembleWatchHomeModel({
      configVideos: [],
      hydrationVideos: [shortFilm],
      blocks: [shortFilmBlock],
    })
    // Rendered as an Experience card (hydrated title) ...
    expect(usedExperience).toBe(true)
    expect(model.sections[0].cards[0].title).toBe("Test Short Film")
    // ... but absent from every carousel pool — no feat-172 leak.
    expect(inCarouselPools(model, "TESTSHORT1")).toBe(false)
  })

  it("hydrates an under-curated block item's title + image from the merged index", () => {
    const acts: WatchHomeVideoInput = {
      documentId: "d-acts",
      coreId: "6_Acts0401",
      slug: "lumo-acts-1-1-8-3",
      images: [{ mobileCinematicHigh: "https://cdn/acts-1.jpg" }],
      locales: [{ title: "LUMO - Acts 1:1-8:3" }],
    }
    const { model } = assembleWatchHomeModel({
      configVideos: [],
      hydrationVideos: [acts],
      blocks: [
        mediaCollection({
          items: [
            {
              videoId: "d-acts",
              coreId: "6_Acts0401",
              videoSlug: "lumo-acts-1-1-8-3",
            },
          ],
        }),
      ],
    })
    expect(model.sections[0].cards[0].title).toBe("LUMO - Acts 1:1-8:3")
    expect(model.sections[0].cards[0].imageUrl).toBe("https://cdn/acts-1.jpg")
  })

  it("falls back to the config body (usedExperience false) when there are no blocks", () => {
    const { model, usedExperience } = assembleWatchHomeModel({
      configVideos: [],
      hydrationVideos: [],
      blocks: null,
    })
    expect(usedExperience).toBe(false)
    expect(model.sections).toEqual([])
  })
})

describe("experienceItemCoreIds", () => {
  it("collects and dedupes valid item coreIds from MediaCollection blocks", () => {
    const ids = experienceItemCoreIds([
      mediaCollection({
        items: [
          { coreId: "6_Acts0401", videoSlug: "a" },
          { coreId: "6_Acts0402", videoSlug: "b" },
          { coreId: "6_Acts0401", videoSlug: "a-again" },
        ],
      }),
    ])
    expect(ids).toEqual(["6_Acts0401", "6_Acts0402"])
  })

  it("ignores non-collection blocks and items with no / invalid coreId", () => {
    const ids = experienceItemCoreIds([
      { __typename: "WatchHomeHeroBlock" } as never,
      mediaCollection({
        items: [
          { coreId: null, videoSlug: "a" },
          { coreId: "bad id!", videoSlug: "b" },
          { coreId: "GOLukeCollection", videoSlug: "c" },
        ],
      }),
    ])
    expect(ids).toEqual(["GOLukeCollection"])
  })
})
