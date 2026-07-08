import { buildWatchHomeSectionsFromExperience } from "../experienceAdapter"

/**
 * The adapter maps the published homepage Experience's flat MediaCollectionBlock
 * items into the existing WatchHomeSection[] shape (lean cards, matching web —
 * no video resolution). Non-collection blocks are skipped; WatchHomeHeroBlock is
 * an expected placeholder and must not warn.
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
        imageOverrideUrl: null,
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

  it("drops items missing videoSlug; remaining valid cards still render (R3)", () => {
    const [section] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          { videoSlug: "keep", titleOverride: "Keep" },
          { videoId: "x", videoSlug: null, titleOverride: "Drop me" },
          { videoSlug: "", titleOverride: "Drop empty" },
        ],
      }),
    ])
    expect(section.cards.map((c) => c.slug)).toEqual(["keep"])
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

  it("prefers imageOverrideUrl over imageUrl; title never blank (R3)", () => {
    const [section] = buildWatchHomeSectionsFromExperience([
      mediaCollection({
        items: [
          {
            videoSlug: "o",
            titleOverride: "",
            labelOverride: "Label wins",
            imageUrl: "https://img/base.jpg",
            imageOverrideUrl: "https://img/override.jpg",
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
