import { CombinedGraphQLErrors } from "@apollo/client/errors"

import type { WatchSearchResultItem } from "../queries"
import {
  SEARCH_LANGUAGE_SLUG,
  buildWatchSearchInput,
  mapWatchSearchResponse,
  mapWatchSearchResult,
  parseSearchError,
  stripHtml,
} from "../watchSearch"

// Admin returns every watchSearch field nullable; the UI reads slug/title/type/id
// unconditionally. These cover the narrowing at that seam.

function row(overrides: Partial<WatchSearchResultItem> = {}) {
  return {
    type: "VIDEO",
    id: "v1",
    slug: "jesus",
    title: "JESUS",
    imageUrl: "https://img.example/1.jpg",
    snippet: "The story of Jesus.",
    startSeconds: 0,
    playbackId: "pb1",
    score: 0.9,
    label: "featureFilm",
    childCount: 0,
    ...overrides,
  } as WatchSearchResultItem
}

// Admin resolves availability, playbackId and durationSeconds against the target
// language. Sending a BCP-47 tag where a language.slug is expected resolved the
// target to the literal "en", which matches no language row — every result came
// back UNAVAILABLE with a null playbackId (verified against prod).
describe("buildWatchSearchInput", () => {
  it("sends the language SLUG, never a BCP-47 tag", () => {
    const input = buildWatchSearchInput({
      query: "jesus",
      offset: 0,
      limit: 20,
    })
    expect(input.displayLanguageSlug).toBe("english")
    expect(SEARCH_LANGUAGE_SLUG).toBe("english")
    expect(input.displayLanguageSlug).not.toMatch(/^[a-z]{2}(-[A-Za-z]+)?$/)
  })

  // An explicit target short-circuits admin's query-named-language inference,
  // so "jesus in spanish" would stop returning Spanish results.
  it("omits targetLanguageSlug so query-named-language inference still runs", () => {
    const input = buildWatchSearchInput({
      query: "jesus",
      offset: 0,
      limit: 20,
    })
    expect(input).not.toHaveProperty("targetLanguageSlug")
  })

  // routeLanguageSlug outranks displayLanguageSlug in admin's target resolution;
  // mobile has no URL language segment to source it from.
  it("omits routeLanguageSlug, which has no mobile equivalent", () => {
    const input = buildWatchSearchInput({
      query: "jesus",
      offset: 0,
      limit: 20,
    })
    expect(input).not.toHaveProperty("routeLanguageSlug")
  })

  it("threads query, paging and the correlation id through", () => {
    expect(
      buildWatchSearchInput({
        query: "hope",
        offset: 40,
        limit: 20,
        clientRequestId: "search-3",
      }),
    ).toEqual({
      query: "hope",
      displayLanguageSlug: "english",
      clientRequestId: "search-3",
      limit: 20,
      offset: 40,
    })
  })

  it("omits clientRequestId entirely when none is supplied", () => {
    const input = buildWatchSearchInput({ query: "hope", offset: 0, limit: 20 })
    expect(input).not.toHaveProperty("clientRequestId")
  })
})

describe("stripHtml", () => {
  it("removes tags and decodes entities from CMS-authored descriptions", () => {
    expect(stripHtml("<p>Mary &amp; Joseph<br/>travel</p>")).toBe(
      "Mary & Joseph travel",
    )
  })

  // CodeQL js/incomplete-multi-character-sanitization: one pass over nested
  // angle brackets reassembles a live tag from the leftovers.
  it("keeps stripping until no tag can be reassembled", () => {
    expect(stripHtml("<<b>b>bold")).toBe("bold")
    expect(stripHtml("<<script>script>alert")).toBe("alert")
  })

  // CodeQL js/double-escaping: decoding &amp; before &lt; turns escaped text
  // back into live markup.
  it("decodes entities in a single pass, never twice", () => {
    expect(stripHtml("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;")
    expect(stripHtml("&amp;amp;")).toBe("&amp;")
  })

  // Prose comparisons are not markup.
  it("leaves ordinary angle brackets in prose alone", () => {
    expect(stripHtml("a < b and c > d")).toBe("a < b and c > d")
  })

  it("returns null for empty, absent, or tag-only values", () => {
    expect(stripHtml(null)).toBeNull()
    expect(stripHtml(undefined)).toBeNull()
    expect(stripHtml("")).toBeNull()
    expect(stripHtml("<p></p>")).toBeNull()
  })
})

describe("mapWatchSearchResult", () => {
  it("maps a complete row to the non-null UI shape", () => {
    expect(mapWatchSearchResult(row())).toEqual({
      type: "VIDEO",
      id: "v1",
      slug: "jesus",
      title: "JESUS",
      imageUrl: "https://img.example/1.jpg",
      snippet: "The story of Jesus.",
      startSeconds: 0,
      playbackId: "pb1",
      score: 0.9,
      label: "featureFilm",
      childCount: 0,
    })
  })

  // Each of these is separately load-bearing: the card renders title, the
  // routing branch reads slug, keyExtractor reads type + id.
  it.each(["type", "id", "slug", "title"] as const)(
    "drops a row missing %s rather than rendering a broken card",
    (field) => {
      expect(mapWatchSearchResult(row({ [field]: null }))).toBeNull()
    },
  )

  it("keeps rows whose optional display fields are absent", () => {
    const mapped = mapWatchSearchResult(
      row({ imageUrl: null, snippet: null, playbackId: null }),
    )
    expect(mapped).not.toBeNull()
    expect(mapped?.imageUrl).toBeNull()
    expect(mapped?.snippet).toBeNull()
  })

  it("strips markup out of the snippet the card renders as plain Text", () => {
    expect(mapWatchSearchResult(row({ snippet: "<b>Hope</b>" }))?.snippet).toBe(
      "Hope",
    )
  })
})

describe("mapWatchSearchResponse", () => {
  it("maps a page and carries admin's cursor forward", () => {
    const page = mapWatchSearchResponse(
      { query: "jesus", hasMore: true, nextOffset: 20, results: [row()] },
      "jesus",
      0,
    )
    expect(page.results).toHaveLength(1)
    expect(page.hasMore).toBe(true)
    expect(page.nextOffset).toBe(20)
  })

  it("skips unusable rows without dropping the rest of the page", () => {
    const page = mapWatchSearchResponse(
      {
        query: null,
        hasMore: null,
        nextOffset: null,
        results: [row(), row({ slug: null }), row({ id: "v2" })],
      },
      "jesus",
      0,
    )
    expect(page.results.map((r) => r.id)).toEqual(["v1", "v2"])
  })

  // The cursor must advance by rows RETURNED, not rows kept — counting kept rows
  // would shift the next page back and re-fetch the dropped row's neighbours.
  it("falls back to requestedOffset + returned rows when nextOffset is absent", () => {
    const page = mapWatchSearchResponse(
      {
        query: null,
        hasMore: null,
        nextOffset: null,
        results: [row(), row({ slug: null })],
      },
      "jesus",
      20,
    )
    expect(page.results).toHaveLength(1)
    expect(page.nextOffset).toBe(22)
  })

  it("treats a null response as an empty, terminal page", () => {
    const page = mapWatchSearchResponse(null, "jesus", 0)
    expect(page).toEqual({
      query: "jesus",
      hasMore: false,
      nextOffset: 0,
      results: [],
    })
  })
})

describe("parseSearchError", () => {
  // Fixtures mirror what admin ACTUALLY emits: the rate limiter stamps
  // extensions.http.statusCode, and thrown service errors mask to
  // INTERNAL_SERVER_ERROR. It never sends a domain-specific `code`.
  function gqlError(extensions: Record<string, unknown>) {
    return new CombinedGraphQLErrors({
      errors: [{ message: "nope", extensions }],
    })
  }

  it("maps a 429 from the rate limiter to wait-and-retry copy", () => {
    expect(parseSearchError(gqlError({ http: { statusCode: 429 } }))).toBe(
      "Too many requests. Please try again in a minute.",
    )
  })

  it("maps a 5xx to temporarily-unavailable copy", () => {
    expect(parseSearchError(gqlError({ http: { statusCode: 503 } }))).toBe(
      "Search is temporarily unavailable. Please try again.",
    )
  })

  // graphql-yoga masks an unhandled resolver throw to this code with no http.
  it("maps a masked INTERNAL_SERVER_ERROR to temporarily-unavailable copy", () => {
    expect(parseSearchError(gqlError({ code: "INTERNAL_SERVER_ERROR" }))).toBe(
      "Search is temporarily unavailable. Please try again.",
    )
  })

  it("falls back to generic copy for network errors and unknown shapes", () => {
    expect(parseSearchError(new Error("offline"))).toBe(
      "Search failed. Please try again.",
    )
    expect(parseSearchError(gqlError({}))).toBe(
      "Search failed. Please try again.",
    )
    expect(parseSearchError(gqlError({ http: { statusCode: 400 } }))).toBe(
      "Search failed. Please try again.",
    )
  })
})

// A page that returns nothing cannot advance the fallback cursor, so offering
// "Load more" would refetch the same offset forever, spending a fleet-key token
// on every tap. Found by delta review of the cursor fix, not by the first pass.
describe("mapWatchSearchResponse cursor cannot stall", () => {
  it("refuses hasMore when admin returns an empty page", () => {
    const page = mapWatchSearchResponse(
      { query: null, hasMore: true, nextOffset: null, results: [] },
      "jesus",
      40,
    )
    expect(page.results).toHaveLength(0)
    expect(page.nextOffset).toBe(40)
    // hasMore:true + a cursor that can't move = an infinite refetch loop.
    expect(page.hasMore).toBe(false)
  })

  it("still honours admin's own cursor on an empty page", () => {
    const page = mapWatchSearchResponse(
      { query: null, hasMore: true, nextOffset: 60, results: [] },
      "jesus",
      40,
    )
    expect(page.nextOffset).toBe(60)
    expect(page.hasMore).toBe(false)
  })
})
