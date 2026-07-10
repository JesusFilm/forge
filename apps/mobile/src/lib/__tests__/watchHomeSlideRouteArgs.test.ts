import type { WatchHomeVideoSlide } from "../watchHome/carouselSequence"
import { slideRouteArgs } from "../watchHome/slideRouteArgs"

function videoSlide(
  overrides: Partial<WatchHomeVideoSlide> = {},
): WatchHomeVideoSlide {
  return {
    kind: "video",
    id: "v1",
    title: "JESUS",
    description: null,
    label: "Feature film",
    slug: "jesus",
    parentSlug: null,
    posterUrl: "https://img.example/poster.jpg",
    thumbnailUrl: "https://img.example/thumb.jpg",
    imageAlt: "JESUS",
    playbackId: "pb-1",
    durationSeconds: 60,
    ...overrides,
  }
}

describe("slideRouteArgs", () => {
  it("prefers posterUrl for imageUrl when present", () => {
    expect(slideRouteArgs(videoSlide()).imageUrl).toBe(
      "https://img.example/poster.jpg",
    )
  })

  it("falls back to thumbnailUrl when posterUrl is null", () => {
    expect(slideRouteArgs(videoSlide({ posterUrl: null })).imageUrl).toBe(
      "https://img.example/thumb.jpg",
    )
  })

  it("yields null imageUrl when both poster and thumbnail are null", () => {
    expect(
      slideRouteArgs(videoSlide({ posterUrl: null, thumbnailUrl: null }))
        .imageUrl,
    ).toBeNull()
  })

  it("passes slug, title, label, and playbackId through unchanged", () => {
    const args = slideRouteArgs(videoSlide())
    expect(args.slug).toBe("jesus")
    expect(args.title).toBe("JESUS")
    expect(args.label).toBe("Feature film")
    expect(args.playbackId).toBe("pb-1")
  })
})
