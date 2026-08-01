import { decodeWatchSeed } from "../../lib/watchSeed"
import { resolveHomeCardPath, type RoutableHomeCard } from "./homeCardRouting"

function makeCard(overrides: Partial<RoutableHomeCard> = {}): RoutableHomeCard {
  return {
    slug: "jesus",
    title: "JESUS",
    imageUrl: "https://images.example/jesus.jpg",
    landscapeImageUrl: "https://images.example/jesus.jpg",
    rawLabel: "FEATURE_FILM",
    ...overrides,
  }
}

describe("resolveHomeCardPath", () => {
  it("routes a leaf card to /watch/[slug] with a seed", () => {
    const path = resolveHomeCardPath(makeCard())
    expect(path?.startsWith("/watch/jesus?seed=")).toBe(true)
  })

  // REGRESSION GUARD: the seed paints the watch/series LANDSCAPE hero. A poster
  // rail's card.imageUrl is a 2:3 poster, so seeding it flashed a cropped
  // portrait into a 16:9 hero. The seed must carry the cinematic.
  it("seeds the 16:9 cinematic, never a poster rail's portrait card art", () => {
    const path = resolveHomeCardPath(
      makeCard({
        imageUrl: "https://images.example/jesus-PORTRAIT-poster.jpg",
        landscapeImageUrl: "https://images.example/jesus-cinematic.jpg",
      }),
    )
    const seed = decodeWatchSeed(path!.split("seed=")[1])
    expect(seed?.imageUrl).toBe("https://images.example/jesus-cinematic.jpg")
  })

  it("falls back to card art when the video has no cinematic", () => {
    const path = resolveHomeCardPath(
      makeCard({
        imageUrl: "https://images.example/only.jpg",
        landscapeImageUrl: null,
      }),
    )
    const seed = decodeWatchSeed(path!.split("seed=")[1])
    expect(seed?.imageUrl).toBe("https://images.example/only.jpg")
  })

  it("routes SERIES / COLLECTION raw labels to /series/[slug]", () => {
    expect(
      resolveHomeCardPath(
        makeCard({ slug: "gospel-of-john", rawLabel: "SERIES" }),
      )?.startsWith("/series/gospel-of-john?seed="),
    ).toBe(true)
    expect(
      resolveHomeCardPath(
        makeCard({ slug: "lumo", rawLabel: "COLLECTION" }),
      )?.startsWith("/series/lumo?seed="),
    ).toBe(true)
  })

  // REGRESSION GUARD: JESUS is a FEATURE_FILM with 61 chapter clips. Routing on
  // "has children" sent it to /series, which billed it SERIES and played its full
  // 2h runtime under a "Play Trailer" button. Only the label may decide.
  it("routes a feature film WITH chapter clips to /watch, not /series", () => {
    const path = resolveHomeCardPath(
      makeCard({ slug: "jesus", rawLabel: "FEATURE_FILM" }),
    )
    expect(path?.startsWith("/watch/jesus?seed=")).toBe(true)
  })

  it("routes an unlabeled card to /watch, however many children it has", () => {
    const path = resolveHomeCardPath(
      makeCard({ slug: "gospel", rawLabel: null }),
    )
    expect(path?.startsWith("/watch/gospel?seed=")).toBe(true)
  })

  // The predicate matches uppercase wire literals only — a card carrying just
  // the display text must NOT take the series branch (keeps the predicate
  // honest; rawLabel is the contract).
  it("never routes on display-text labels", () => {
    const path = resolveHomeCardPath(makeCard({ rawLabel: "Series" }))
    expect(path?.startsWith("/watch/")).toBe(true)
  })

  it("returns null when the card has no slug", () => {
    expect(resolveHomeCardPath(makeCard({ slug: null }))).toBeNull()
  })

  it("the seed round-trips through decodeWatchSeed", () => {
    const path = resolveHomeCardPath(makeCard())
    const seed = decodeWatchSeed(path?.split("?seed=")[1])
    expect(seed).not.toBeNull()
    expect(seed?.slug).toBe("jesus")
    expect(seed?.title).toBe("JESUS")
    expect(seed?.imageUrl).toBe("https://images.example/jesus.jpg")
  })

  // Home cards are lean — no stream fields — so playbackId is null on BOTH
  // branches, and a series seed must never yield a stream.
  it("nulls playbackId in the seed on both branches", () => {
    const leafSeed = decodeWatchSeed(
      resolveHomeCardPath(makeCard())?.split("?seed=")[1],
    )
    expect(leafSeed?.playbackId).toBeNull()

    const seriesSeed = decodeWatchSeed(
      resolveHomeCardPath(makeCard({ rawLabel: "SERIES" }))?.split("?seed=")[1],
    )
    expect(seriesSeed?.playbackId).toBeNull()
  })

  it("URL-encodes the slug segment on both branches", () => {
    expect(
      resolveHomeCardPath(makeCard({ slug: "a b/c" }))?.startsWith(
        "/watch/a%20b%2Fc?seed=",
      ),
    ).toBe(true)
    expect(
      resolveHomeCardPath(
        makeCard({ slug: "a b/c", rawLabel: "SERIES" }),
      )?.startsWith("/series/a%20b%2Fc?seed="),
    ).toBe(true)
  })
})
