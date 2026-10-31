import { type SearchResult } from "../../lib/queries"
import { findResultById, toNativeSearchResults } from "./nativeSearchResults"

// Full app shape with every optional field POPULATED; tests null out the field
// under test individually so each projection rule is falsified on its own.
function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    type: "VIDEO",
    id: "r1",
    slug: "jesus",
    title: "JESUS",
    imageUrl: "https://img.example/jesus.jpg",
    snippet: "snippet",
    startSeconds: 10,
    playbackId: "pb1",
    score: 0.9,
    label: "FEATURE_FILM",
    childCount: 61,
    ...overrides,
  }
}

describe("toNativeSearchResults", () => {
  it("projects id/title/subtitle/imageUrl", () => {
    expect(toNativeSearchResults([result()])).toEqual([
      {
        id: "r1",
        title: "JESUS",
        subtitle: "Feature Film",
        imageUrl: "https://img.example/jesus.jpg",
      },
    ])
  })

  it.each([
    ["EPISODE", "Episode"],
    ["SEGMENT", "Segment"],
    ["SHORT_FILM", "Short Film"],
    ["SERIES", "Series"],
    ["COLLECTION", "Collection"],
    ["BEHIND_THE_SCENES", "Behind The Scenes"],
  ])("presents %s as readable content metadata", (label, expected) => {
    expect(toNativeSearchResults([result({ label })])[0]?.subtitle).toBe(
      expected,
    )
  })

  it.each([null, ""])(
    "calls an unlabeled video Video, even when it has chapters (label=%s)",
    (label) => {
      expect(toNativeSearchResults([result({ label })])[0]?.subtitle).toBe(
        "Video",
      )
    },
  )

  it("identifies experiences without borrowing a video's label", () => {
    expect(
      toNativeSearchResults([
        result({ type: "EXPERIENCE", label: "FEATURE_FILM" }),
      ])[0]?.subtitle,
    ).toBe("Experience")
  })

  it("maps null imageUrl to ABSENT imageUrl", () => {
    const [card] = toNativeSearchResults([result({ imageUrl: null })])
    expect(card!.imageUrl).toBeUndefined()
  })

  it("preserves order and length", () => {
    const cards = toNativeSearchResults([
      result({ id: "a" }),
      result({ id: "b" }),
      result({ id: "c" }),
    ])
    expect(cards.map((c) => c.id)).toEqual(["a", "b", "c"])
  })
})

describe("findResultById", () => {
  const results = [result({ id: "a" }), result({ id: "b" })]

  it("resolves a known id to the full app result", () => {
    expect(findResultById(results, "b")).toBe(results[1])
  })

  it("returns null for an unknown id (selection racing a refresh)", () => {
    expect(findResultById(results, "gone")).toBeNull()
  })
})
