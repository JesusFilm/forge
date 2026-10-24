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
    label: "featureFilm",
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
        subtitle: "featureFilm",
        imageUrl: "https://img.example/jesus.jpg",
      },
    ])
  })

  it("maps null label to ABSENT subtitle (not the string 'null')", () => {
    const [card] = toNativeSearchResults([result({ label: null })])
    expect(card!.subtitle).toBeUndefined()
    expect("subtitle" in card! && card!.subtitle).not.toBe("null")
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
