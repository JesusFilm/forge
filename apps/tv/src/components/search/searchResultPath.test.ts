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

  // REGRESSION GUARD: a feature film's chapter clips must not make it a series.
  // Searching "jesus" and pressing the top hit used to open the series screen.
  it("routes a feature film WITH chapter clips to /watch/[slug]", () => {
    const path = searchResultPath(
      makeResult({ slug: "jesus", label: "FEATURE_FILM", childCount: 61 }),
    )
    expect(path.startsWith("/watch/jesus?seed=")).toBe(true)
  })

  it("routes an unlabeled result to /watch, whatever its childCount", () => {
    expect(
      searchResultPath(
        makeResult({ slug: "gospel", label: null, childCount: 12 }),
      ).startsWith("/watch/gospel?seed="),
    ).toBe(true)
    expect(
      searchResultPath(makeResult({ label: null, childCount: 0 })).startsWith(
        "/watch/",
      ),
    ).toBe(true)
  })

  // The film keeps its playbackId (only series seeds null it), so the /watch hero
  // can paint a preview immediately instead of waiting on the query.
  it("keeps the playbackId in a film's seed even when it has children", () => {
    const path = searchResultPath(
      makeResult({ slug: "jesus", label: "FEATURE_FILM", childCount: 61 }),
    )
    expect(decodeWatchSeed(path.split("seed=")[1])?.playbackId).toBe("abc123")
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
