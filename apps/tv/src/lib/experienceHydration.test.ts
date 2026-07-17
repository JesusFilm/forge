import {
  buildVideoByCoreId,
  collectMediaCollectionCoreIds,
  resolveMediaItemImageUrl,
  resolveMediaItemTitle,
  type HydratedVideo,
} from "./experienceHydration"
import type { NormalizedBlock } from "./normalizer"

// Loose casts: the helpers read structural subsets, not the full gql models.
const mc = (items: { coreId?: string | null }[]) =>
  ({ kind: "mediaCollection", items }) as unknown as NormalizedBlock
const wrapper = (sectionContent: NormalizedBlock[]) =>
  ({ kind: "sectionWrapper", sectionContent }) as unknown as NormalizedBlock
const container = (slotContent: NormalizedBlock[]) =>
  ({
    kind: "container",
    slots: [{ slotContent }],
  }) as unknown as NormalizedBlock

describe("collectMediaCollectionCoreIds", () => {
  it("collects coreIds across nesting (top-level, section, container), deduped", () => {
    const blocks = [
      mc([{ coreId: "1_jf-0-0" }, { coreId: "GOMattCollection" }]),
      wrapper([mc([{ coreId: "2_GOJ-0-0" }])]),
      container([mc([{ coreId: "1_jf-0-0" }])]), // duplicate of top-level
    ]
    expect(collectMediaCollectionCoreIds(blocks)).toEqual([
      "1_jf-0-0",
      "GOMattCollection",
      "2_GOJ-0-0",
    ])
  })

  it("recurses depth-2 through both branches (container-in-section, section-in-container)", () => {
    expect(
      collectMediaCollectionCoreIds([
        wrapper([container([mc([{ coreId: "deep-in-section" }])])]),
        container([wrapper([mc([{ coreId: "deep-in-container" }])])]),
      ]),
    ).toEqual(["deep-in-section", "deep-in-container"])
  })

  it("drops invalid/empty coreIds and tolerates empty input", () => {
    expect(
      collectMediaCollectionCoreIds([
        mc([{ coreId: null }, { coreId: "a b" }]),
      ]),
    ).toEqual([])
    expect(collectMediaCollectionCoreIds(null)).toEqual([])
    expect(collectMediaCollectionCoreIds([])).toEqual([])
  })
})

describe("buildVideoByCoreId", () => {
  it("indexes videos by valid coreId", () => {
    const jesus: HydratedVideo = { coreId: "1_jf-0-0", slug: "jesus" }
    const map = buildVideoByCoreId([jesus, { coreId: null }])
    expect(map.get("1_jf-0-0")).toBe(jesus)
    expect(map.size).toBe(1)
  })
})

describe("resolveMediaItemTitle", () => {
  const jesus: HydratedVideo = { locales: [{ title: "JESUS" }], slug: "jesus" }

  it("uses the hydrated video's localized title when no override (the fix)", () => {
    expect(resolveMediaItemTitle({ titleOverride: null }, jesus)).toBe("JESUS")
  })

  it("prefers a non-empty titleOverride over the video", () => {
    expect(resolveMediaItemTitle({ titleOverride: "Custom" }, jesus)).toBe(
      "Custom",
    )
  })

  it("ignores an empty-string override, then video, then slug, then Untitled", () => {
    expect(resolveMediaItemTitle({ titleOverride: "  " }, jesus)).toBe("JESUS")
    expect(
      resolveMediaItemTitle({}, { slug: "life-of-jesus", locales: [] }),
    ).toBe("life-of-jesus")
    expect(resolveMediaItemTitle({}, undefined)).toBe("Untitled")
  })
})

describe("resolveMediaItemImageUrl", () => {
  const withArt: HydratedVideo = {
    images: [{ mobileCinematicHigh: "https://img/jesus-high.jpg" }],
  }

  it("uses the curated override poster over the video cinematic (the real fix)", () => {
    // The jesusfilm.org seed is rewritten to the watch app origin — the SAME
    // portrait poster web renders — not the video's landscape cinematic.
    expect(
      resolveMediaItemImageUrl(
        {
          imageOverrideUrl:
            "https://www.jesusfilm.org/images/thumbnails/1_jf-0-0-vertical.png",
        },
        withArt,
      ),
    ).toBe(
      "https://watch.jesusfilm.org/watch/images/thumbnails/1_jf-0-0-vertical.png",
    )
  })

  it("passes a non-jesusfilm override URL through unchanged", () => {
    expect(
      resolveMediaItemImageUrl(
        { imageOverrideUrl: "https://cdn.example/poster.jpg" },
        withArt,
      ),
    ).toBe("https://cdn.example/poster.jpg")
  })

  it("rewrites a no-www /images seed but leaves a non-/images jesusfilm path alone", () => {
    expect(
      resolveMediaItemImageUrl(
        { imageOverrideUrl: "https://jesusfilm.org/images/thumbnails/x.png" },
        withArt,
      ),
    ).toBe("https://watch.jesusfilm.org/watch/images/thumbnails/x.png")
    // A jesusfilm.org URL NOT under /images is the rewrite boundary — passes through.
    expect(
      resolveMediaItemImageUrl(
        { imageOverrideUrl: "https://www.jesusfilm.org/videos/x.png" },
        withArt,
      ),
    ).toBe("https://www.jesusfilm.org/videos/x.png")
  })

  it("prefers the override poster when both override and imageUrl are set", () => {
    expect(
      resolveMediaItemImageUrl(
        {
          imageOverrideUrl: "https://www.jesusfilm.org/images/o.png",
          imageUrl: "https://img/authored.jpg",
        },
        withArt,
      ),
    ).toBe("https://watch.jesusfilm.org/watch/images/o.png")
  })

  it("falls to item.imageUrl, then the video cinematic, when no override", () => {
    expect(
      resolveMediaItemImageUrl(
        { imageUrl: "https://img/authored.jpg" },
        withArt,
      ),
    ).toBe("https://img/authored.jpg")
    expect(resolveMediaItemImageUrl({ imageUrl: null }, withArt)).toBe(
      "https://img/jesus-high.jpg",
    )
  })

  it("returns null when nothing yields an image", () => {
    expect(resolveMediaItemImageUrl({ imageUrl: null }, undefined)).toBeNull()
    expect(
      resolveMediaItemImageUrl({ imageUrl: "" }, { images: [] }),
    ).toBeNull()
  })
})
