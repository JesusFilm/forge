import { SEARCH_LANGUAGE_SLUG } from "./watchSearch"
import { buildWatchSearchResultClickContext } from "./watchSearchRum"

// Deriving the arg type from the function keeps the fixture honest without
// importing the gql.tada SearchResult type into the test.
type ResultArg = Parameters<typeof buildWatchSearchResultClickContext>[0]

// The documented allowlist — the returned context must carry EXACTLY these keys.
const EXPECTED_KEYS = [
  "watch_search.result_position",
  "watch_search.result_id",
  "watch_search.result_slug",
  "watch_search.result_title",
  "watch_search.result_type",
  "watch_search.search_request_id",
  "watch_search.result_source",
  "watch_search.search_language_slug",
  "watch_search.search_language_english_name",
].sort()

function makeResult(overrides: Record<string, unknown> = {}): ResultArg {
  return {
    type: "EXPERIENCE",
    id: "abc123",
    slug: "the-birth-of-jesus",
    title: "The Birth of Jesus",
    imageUrl: "https://example.test/x.jpg",
    snippet: "snippet text",
    startSeconds: null,
    playbackId: null,
    score: 0.9,
    label: null,
    childCount: null,
    ...overrides,
  } as unknown as ResultArg
}

describe("buildWatchSearchResultClickContext", () => {
  it("returns EXACTLY the allowlist keys even when result carries extras", () => {
    const context = buildWatchSearchResultClickContext(
      makeResult({
        secretField: "LEAK_ME",
        email: "person@example.com",
        query: "raw user query",
      }),
      { position: 2, searchRequestId: "req-1234-5678" },
    )
    expect(Object.keys(context).sort()).toEqual(EXPECTED_KEYS)
  })

  it("caps result_title at 160 chars", () => {
    const context = buildWatchSearchResultClickContext(
      makeResult({ title: "x".repeat(500) }),
      { position: 1, searchRequestId: "req-1" },
    )
    const title = context["watch_search.result_title"] as string
    expect(title.length).toBeLessThanOrEqual(160)
    expect(title.endsWith("...")).toBe(true)
  })

  it("emits the TV surface constants for source and languages", () => {
    const context = buildWatchSearchResultClickContext(makeResult(), {
      position: 1,
      searchRequestId: "req-1",
    })
    expect(context["watch_search.result_source"]).toBe("semantic")
    // Must equal what buildWatchSearchInput actually sends. It reported the
    // BCP-47 tag "en" — a value neither admin nor web ever produces — which
    // made every TV click un-joinable with the request it came from.
    expect(context["watch_search.search_language_slug"]).toBe(
      SEARCH_LANGUAGE_SLUG,
    )
    expect(context["watch_search.search_language_slug"]).toBe("english")
    expect(context["watch_search.search_language_english_name"]).toBe("English")
  })

  it("omits route_language_slug, which the request never carries", () => {
    // buildWatchSearchInput deliberately sends no routeLanguageSlug; reporting
    // one fabricated a request field that was never on the wire.
    expect(
      buildWatchSearchResultClickContext(makeResult(), {
        position: 1,
        searchRequestId: "req-1",
      }),
    ).not.toHaveProperty("watch_search.route_language_slug")
  })

  it("normalizes position to a 1-based integer", () => {
    expect(
      buildWatchSearchResultClickContext(makeResult(), {
        position: 0,
        searchRequestId: "req-1",
      })["watch_search.result_position"],
    ).toBe(1)
    expect(
      buildWatchSearchResultClickContext(makeResult(), {
        position: 3.7,
        searchRequestId: "req-1",
      })["watch_search.result_position"],
    ).toBe(3)
  })

  it("never leaks raw query text into any context value", () => {
    const rawQuery = "super secret raw query text"
    const context = buildWatchSearchResultClickContext(
      makeResult({ query: rawQuery, snippet: rawQuery }),
      { position: 1, searchRequestId: "req-1" },
    )
    expect(JSON.stringify(context)).not.toContain(rawQuery)
  })
})
