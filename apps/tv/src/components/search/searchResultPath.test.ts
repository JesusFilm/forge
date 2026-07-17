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
    label: null,
    childCount: null,
    ...overrides,
  } as SearchResult
}

describe("searchResultPath", () => {
  it("routes a leaf VIDEO result to /watch/[slug] with a seed", () => {
    const path = searchResultPath(makeResult({ type: "VIDEO" }))
    expect(path.startsWith("/watch/the-birth-of-jesus?seed=")).toBe(true)
  })

  it("routes a SERIES-labeled video result to /series/[slug]", () => {
    const path = searchResultPath(
      makeResult({ slug: "gospel-of-john", label: "SERIES" }),
    )
    expect(path.startsWith("/series/gospel-of-john?seed=")).toBe(true)
  })

  // isSeriesSearchResult's has-children branch: an unlabeled collection still
  // lands on the series screen when the result carries a child count.
  it("routes an unlabeled result with childCount > 0 to /series/[slug]", () => {
    const path = searchResultPath(
      makeResult({ slug: "gospel", label: null, childCount: 12 }),
    )
    expect(path.startsWith("/series/gospel?seed=")).toBe(true)
  })

  it("keeps childCount 0 / null results on /watch", () => {
    expect(
      searchResultPath(makeResult({ label: null, childCount: 0 })).startsWith(
        "/watch/",
      ),
    ).toBe(true)
    expect(
      searchResultPath(
        makeResult({ label: "FEATURE_FILM", childCount: null }),
      ).startsWith("/watch/"),
    ).toBe(true)
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

  // The series screen mounts no video; a stream must never derive from its seed.
  it("nulls playbackId in the series seed", () => {
    const path = searchResultPath(
      makeResult({ label: "COLLECTION", playbackId: "abc123" }),
    )
    const seed = decodeWatchSeed(path.split("?seed=")[1])
    expect(seed).not.toBeNull()
    expect(seed?.playbackId).toBeNull()
    expect(seed?.title).toBe("The Birth of Jesus")
  })

  it("URL-encodes the slug segment on every branch", () => {
    expect(
      searchResultPath(makeResult({ type: "EXPERIENCE", slug: "a b/c" })),
    ).toBe("/experience/a%20b%2Fc")
    expect(
      searchResultPath(
        makeResult({ slug: "a b/c", label: "SERIES" }),
      ).startsWith("/series/a%20b%2Fc?seed="),
    ).toBe(true)
    expect(
      searchResultPath(makeResult({ slug: "a b/c" })).startsWith(
        "/watch/a%20b%2Fc?seed=",
      ),
    ).toBe(true)
  })
})
