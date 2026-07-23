import { CombinedGraphQLErrors } from "@apollo/client/errors"

import {
  buildWatchSearchInput,
  mapWatchSearchResponse,
  mapWatchSearchResult,
  parseSearchErrorCode,
  SEARCH_LANGUAGE_SLUG,
  stripHtml,
} from "./watchSearch"

// The wire row is fully nullable; the fixture helper mirrors that so a test can
// omit exactly the field under study.
type WireRow = Parameters<typeof mapWatchSearchResult>[0]

function row(overrides: Partial<Record<string, unknown>> = {}): WireRow {
  return {
    type: "VIDEO",
    id: "v1",
    slug: "jesus",
    title: "Jesus",
    imageUrl: null,
    snippet: null,
    startSeconds: null,
    playbackId: null,
    score: null,
    label: null,
    childCount: null,
    ...overrides,
  } as WireRow
}

describe("buildWatchSearchInput", () => {
  it("sends the admin language SLUG, never a BCP-47 tag", () => {
    // The regression this whole module exists for: "en" matches no language row,
    // so watchability hydration short-circuits and every result is UNAVAILABLE.
    expect(SEARCH_LANGUAGE_SLUG).toBe("english")
    expect(buildWatchSearchInput({ query: "q", limit: 40, offset: 0 })).toEqual(
      {
        query: "q",
        displayLanguageSlug: "english",
        limit: 40,
        offset: 0,
      },
    )
  })

  it("omits routeLanguageSlug and targetLanguageSlug entirely", () => {
    // routeLanguageSlug outranks display (breaks availability); an explicit
    // target suppresses admin's query-named-language inference.
    const input = buildWatchSearchInput({ query: "q", limit: 40, offset: 0 })
    expect(input).not.toHaveProperty("routeLanguageSlug")
    expect(input).not.toHaveProperty("targetLanguageSlug")
  })

  it("includes clientRequestId only when supplied", () => {
    expect(
      buildWatchSearchInput({
        query: "q",
        limit: 40,
        offset: 0,
        clientRequestId: "req-1",
      }),
    ).toMatchObject({ clientRequestId: "req-1" })
    expect(
      buildWatchSearchInput({ query: "q", limit: 40, offset: 0 }),
    ).not.toHaveProperty("clientRequestId")
  })

  it("honours an explicit display language slug", () => {
    expect(
      buildWatchSearchInput({
        query: "q",
        limit: 40,
        offset: 0,
        displayLanguageSlug: "spanish",
      }),
    ).toMatchObject({ displayLanguageSlug: "spanish" })
  })
})

describe("stripHtml", () => {
  it("removes tags and decodes entities", () => {
    expect(stripHtml("<p>Mary &amp; Joseph<br/>flee</p>")).toBe(
      "Mary & Joseph flee",
    )
  })

  it("returns null for empty, nullish, or tag-only input", () => {
    expect(stripHtml(null)).toBeNull()
    expect(stripHtml(undefined)).toBeNull()
    expect(stripHtml("   ")).toBeNull()
    expect(stripHtml("<span></span>")).toBeNull()
  })
})

describe("mapWatchSearchResult", () => {
  it("maps a full row to the non-null UI shape", () => {
    expect(
      mapWatchSearchResult(
        row({
          imageUrl: "https://i/x.jpg",
          snippet: "<b>hi</b>",
          startSeconds: 12,
          playbackId: "pb",
          score: 0.9,
          label: "SERIES",
          childCount: 3,
        }),
      ),
    ).toEqual({
      type: "VIDEO",
      id: "v1",
      slug: "jesus",
      title: "Jesus",
      imageUrl: "https://i/x.jpg",
      snippet: "hi",
      startSeconds: 12,
      playbackId: "pb",
      score: 0.9,
      label: "SERIES",
      childCount: 3,
    })
  })

  // Each required field gets its own case: the UI reads all four unconditionally
  // (searchResultPath does encodeURIComponent(result.slug)), so a null would
  // route to "/watch/undefined" rather than being dropped.
  it.each(["type", "id", "slug", "title"])(
    "drops a row missing %s",
    (field) => {
      expect(mapWatchSearchResult(row({ [field]: null }))).toBeNull()
    },
  )

  it("coerces absent optional fields to null, not undefined", () => {
    const mapped = mapWatchSearchResult(row())
    expect(mapped).toMatchObject({
      imageUrl: null,
      snippet: null,
      playbackId: null,
      label: null,
      childCount: null,
    })
  })
})

describe("mapWatchSearchResponse", () => {
  it("maps rows and passes through the server cursor", () => {
    const page = mapWatchSearchResponse(
      { query: "jesus", hasMore: true, nextOffset: 40, results: [row()] },
      "jesus",
      0,
    )
    expect(page).toEqual({
      query: "jesus",
      hasMore: true,
      nextOffset: 40,
      results: [expect.objectContaining({ slug: "jesus" })],
    })
  })

  it("drops unmappable rows without dropping the page", () => {
    const page = mapWatchSearchResponse(
      { results: [row(), row({ slug: null }), row({ id: "v2" })] },
      "q",
      0,
    )
    expect(page.results).toHaveLength(2)
  })

  it("back-fills echo fields from the request on a sparse response", () => {
    // nextOffset counts MAPPED rows, so a page that dropped a row can't skip
    // past unseen results on the next request.
    const page = mapWatchSearchResponse(
      { results: [row(), row({ title: null })] },
      "jesus",
      20,
    )
    expect(page).toMatchObject({
      query: "jesus",
      hasMore: false,
      nextOffset: 21,
    })
  })

  it("returns an empty page for null/undefined payloads", () => {
    for (const payload of [null, undefined]) {
      expect(mapWatchSearchResponse(payload, "q", 0)).toEqual({
        query: "q",
        hasMore: false,
        nextOffset: 0,
        results: [],
      })
    }
  })
})

describe("parseSearchErrorCode", () => {
  function graphqlError(extensions: Record<string, unknown>) {
    // The REAL Apollo v4 typed shape: CombinedGraphQLErrors.is() is a brand
    // check, so a hand-rolled { graphQLErrors } object would silently take the
    // network_error branch and leave the real one untested.
    return new CombinedGraphQLErrors({
      errors: [{ message: "nope", extensions }],
    })
  }

  // The shape admin ACTUALLY sends: @envelop/rate-limiter sets only
  // extensions.http.statusCode. Branching on a domain `code` (RATE_LIMITED /
  // UNAUTHENTICATED) classified every real rate-limit as "unknown".
  it("classifies a rate limit off extensions.http.statusCode", () => {
    expect(
      parseSearchErrorCode(graphqlError({ http: { statusCode: 429 } })),
    ).toBe("rate_limited")
  })

  it("classifies upstream 5xx as server_error", () => {
    expect(
      parseSearchErrorCode(graphqlError({ http: { statusCode: 503 } })),
    ).toBe("server_error")
  })

  it("does NOT invent a code admin never sends", () => {
    // Guards the regression directly: a bare RATE_LIMITED domain code is not
    // admin's shape, so it must not be treated as a recognized rate limit.
    expect(
      parseSearchErrorCode(graphqlError({ code: "RATE_LIMITED" })),
    ).not.toBe("rate_limited")
  })

  it("passes through a genuine domain code when one is present", () => {
    expect(
      parseSearchErrorCode(graphqlError({ code: "INTERNAL_SERVER_ERROR" })),
    ).toBe("INTERNAL_SERVER_ERROR")
  })

  it("classifies non-GraphQL failures as network_error", () => {
    expect(parseSearchErrorCode(new Error("socket hang up"))).toBe(
      "network_error",
    )
    expect(parseSearchErrorCode(undefined)).toBe("network_error")
  })

  it("falls back to unknown when the code is absent or not a string", () => {
    expect(parseSearchErrorCode(graphqlError({}))).toBe("unknown")
    expect(parseSearchErrorCode(graphqlError({ code: 500 }))).toBe("unknown")
  })
})
