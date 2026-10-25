import { resolveHomeCardPath } from "./homeCardRouting"
import { MY_LIST_SECTION_ID, buildMyListSection } from "./myListSection"
import type { MyListEntry } from "../../lib/myList/myList"

function entry(overrides: Partial<MyListEntry> = {}): MyListEntry {
  return {
    videoId: "video-1",
    slug: "stunned",
    title: "Stunned",
    imageUrl: "https://img.example/stunned.jpg",
    rawLabel: "FEATURE_FILM",
    addedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  }
}

describe("buildMyListSection", () => {
  it("returns null for an empty list — Home shows no rail at all", () => {
    // An empty rail (header, no cards) is the bug this guards.
    expect(buildMyListSection([])).toBeNull()
  })

  it("builds a rail section with the storage order preserved", () => {
    const section = buildMyListSection([
      entry({ videoId: "newest", slug: "a" }),
      entry({ videoId: "oldest", slug: "b" }),
    ])

    expect(section).not.toBeNull()
    expect(section!.id).toBe(MY_LIST_SECTION_ID)
    expect(section!.title).toBe("My List")
    expect(section!.layout).toBe("rail")
    expect(section!.cards.map((c) => c.sourceId)).toEqual(["newest", "oldest"])
  })

  it("falls back to the slug when a saved title is missing", () => {
    const section = buildMyListSection([entry({ title: null })])
    expect(section!.cards[0]!.title).toBe("stunned")
  })

  it("shows the kind noun for the label — the rail mixes films and series", () => {
    const section = buildMyListSection([
      entry({ videoId: "a", rawLabel: "FEATURE_FILM" }),
      entry({ videoId: "b", rawLabel: "SERIES" }),
      entry({ videoId: "c", rawLabel: null }),
    ])
    expect(section!.cards.map((c) => c.label)).toEqual([
      "Feature film",
      "Series",
      "Video",
    ])
  })
})

describe("saved cards route by their raw label", () => {
  // The whole reason MyListEntry stores rawLabel rather than a local boolean.
  // resolveHomeCardPath matches STRICT UPPERCASE wire literals, so a card
  // carrying display text ("Series") or a lower-cased label would send a saved
  // series to /watch — a screen with no player for it.
  it.each([
    ["SERIES", "/series/"],
    ["COLLECTION", "/series/"],
    ["FEATURE_FILM", "/watch/"],
    ["EPISODE", "/watch/"],
    [null, "/watch/"],
  ])("rawLabel %s routes to %s", (rawLabel, expected) => {
    const section = buildMyListSection([
      entry({ slug: "the-savior", rawLabel: rawLabel as string | null }),
    ])
    expect(resolveHomeCardPath(section!.cards[0]!)).toContain(expected)
  })

  it("does NOT route on the display label", () => {
    // Anti-vacuous companion: proves the assertion above discriminates on the
    // raw wire value, not on whatever the card happens to display.
    const section = buildMyListSection([entry({ rawLabel: "SERIES" })])
    expect(section!.cards[0]!.label).toBe("Series")
    expect(
      resolveHomeCardPath({ ...section!.cards[0]!, rawLabel: "Series" }),
    ).toContain("/watch/")
  })
})
