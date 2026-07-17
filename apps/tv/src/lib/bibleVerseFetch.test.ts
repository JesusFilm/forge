import {
  __resetVerseCache,
  buildVerseUrl,
  cacheVerse,
  getCachedVerse,
  partitionVerses,
} from "./bibleVerseFetch"

beforeEach(() => {
  __resetVerseCache()
})

describe("buildVerseUrl", () => {
  it("builds the wldeh/bible-api jsdelivr path", () => {
    expect(buildVerseUrl("en-webbe", "john", 3, 16)).toBe(
      "https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles/en-webbe/books/john/chapters/3/verses/16.json",
    )
  })
})

describe("verse cache", () => {
  it("misses before caching, hits after (cross-mount reuse)", () => {
    const url = buildVerseUrl("en-webbe", "john", 3, 16)
    expect(getCachedVerse(url)).toBeUndefined()
    cacheVerse(url, "For God so loved the world")
    expect(getCachedVerse(url)).toBe("For God so loved the world")
  })
})

describe("partitionVerses", () => {
  it("dedupes duplicate citations to a single fetch URL (SC6)", () => {
    const url = buildVerseUrl("en-webbe", "john", 3, 16)
    const { resolved, toFetch } = partitionVerses([
      { documentId: "a", url },
      { documentId: "b", url },
    ])
    expect(toFetch.size).toBe(1) // one network request for both citations
    expect(toFetch.has(url)).toBe(true)
    expect(resolved).toEqual({})
  })

  it("routes cached URLs to resolved with zero refetch (repeat mount)", () => {
    const url = buildVerseUrl("en-webbe", "john", 3, 16)
    cacheVerse(url, "verse text")
    const { resolved, toFetch } = partitionVerses([
      { documentId: "a", url },
      { documentId: "b", url },
    ])
    expect(toFetch.size).toBe(0)
    expect(resolved).toEqual({ a: "verse text", b: "verse text" })
  })

  it("skips unfetchable citations (null url) without queuing a fetch", () => {
    const { resolved, toFetch } = partitionVerses([
      { documentId: "x", url: null },
    ])
    expect(toFetch.size).toBe(0)
    expect(resolved).toEqual({})
  })

  it("re-queues an uncached URL on the next mount (no negative cache → retry)", () => {
    const url = buildVerseUrl("en-webbe", "john", 3, 16)
    expect(partitionVerses([{ documentId: "a", url }]).toFetch.has(url)).toBe(
      true,
    )
    // A failed fetch caches nothing, so the next mount re-queues it rather than
    // leaving a permanent blank.
    expect(partitionVerses([{ documentId: "a", url }]).toFetch.has(url)).toBe(
      true,
    )
  })

  it("mixes cached and uncached: only uncached enter toFetch", () => {
    const cachedUrl = buildVerseUrl("en-webbe", "john", 3, 16)
    const freshUrl = buildVerseUrl("en-webbe", "psalms", 23, 1)
    cacheVerse(cachedUrl, "loved")
    const { resolved, toFetch } = partitionVerses([
      { documentId: "a", url: cachedUrl },
      { documentId: "b", url: freshUrl },
    ])
    expect(resolved).toEqual({ a: "loved" })
    expect([...toFetch]).toEqual([freshUrl])
  })
})
