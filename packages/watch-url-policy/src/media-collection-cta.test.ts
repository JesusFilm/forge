import { describe, expect, it } from "vitest"
import { isVagueMediaCollectionCtaLabel } from "./media-collection-cta"

describe("isVagueMediaCollectionCtaLabel", () => {
  it.each([
    "Watch",
    "watch",
    "WATCH",
    "  Watch  ",
    "Watch!",
    "Watch →",
    "W\u{FF41}tch",
    "See all",
    "View all",
    "Read more",
    "More",
  ])("rejects the bare label %j", (label) => {
    expect(isVagueMediaCollectionCtaLabel(label)).toBe(true)
  })

  it.each([
    "Watch the Full Story",
    "Watch the El Camino series",
    "See all videos",
    "Watch Now",
    "Watchlist",
    "",
    "   ",
  ])("accepts %j", (label) => {
    expect(isVagueMediaCollectionCtaLabel(label)).toBe(false)
  })

  it("ignores non-string values", () => {
    expect(isVagueMediaCollectionCtaLabel(undefined)).toBe(false)
    expect(isVagueMediaCollectionCtaLabel(null)).toBe(false)
  })
})
