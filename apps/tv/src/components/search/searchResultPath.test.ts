import { type SearchResult } from "../../lib/queries"
import { decodeWatchSeed } from "../../lib/watchSeed"
import { searchResultPath } from "./searchResultPath"

function makeResult(overrides: Partial<SearchResult>): SearchResult {
  return {
    type: "VIDEO",
    id: "id-1",
    slug: "the-birth-of-jesus",
    title: "The Birth of Jesus",
    imageUrl: "https://image.mux.com/abc/thumbnail.jpg",
    snippet: null,
    startSeconds: null,
    playbackId: "abc123",
    score: 1,
    ...overrides,
  } as SearchResult
}

describe("searchResultPath", () => {
  it("routes a VIDEO result to /watch/[slug] with a seed", () => {
    const path = searchResultPath(makeResult({ type: "VIDEO" }))
    expect(path.startsWith("/watch/the-birth-of-jesus?seed=")).toBe(true)
  })

  it("routes a non-video (EXPERIENCE) result to /experience/[slug]", () => {
    const path = searchResultPath(
      makeResult({ type: "EXPERIENCE", slug: "easter" }),
    )
    expect(path).toBe("/experience/easter")
  })

  it("the video seed round-trips through decodeWatchSeed", () => {
    const path = searchResultPath(makeResult({ type: "VIDEO" }))
    const seedParam = path.split("?seed=")[1]
    const seed = decodeWatchSeed(seedParam)
    expect(seed).not.toBeNull()
    expect(seed?.slug).toBe("the-birth-of-jesus")
    expect(seed?.title).toBe("The Birth of Jesus")
  })

  it("URL-encodes the slug segment", () => {
    const path = searchResultPath(
      makeResult({ type: "EXPERIENCE", slug: "a b/c" }),
    )
    expect(path).toBe("/experience/a%20b%2Fc")
  })
})
