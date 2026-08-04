import { SEARCH_LANGUAGE_SLUG } from "./watchSearch"
import {
  WATCH_SEARCH_RESULT_CLICKED_ACTION,
  buildWatchSearchResultClickContext,
} from "./watchSearchRum"

// Deriving the arg type from the function keeps the fixture honest without
// re-importing the SearchResult type into the test.
type ResultArg = Parameters<typeof buildWatchSearchResultClickContext>[0]

// The documented allowlist — the returned context must carry EXACTLY these
// keys. Mobile deliberately omits TV's result_source (mobile can't attest a
// source) and search_language_english_name.
const EXPECTED_KEYS = [
  "watch_search.result_position",
  "watch_search.result_id",
  "watch_search.result_slug",
  "watch_search.result_title",
  "watch_search.result_type",
  "watch_search.search_request_id",
  "watch_search.search_language_slug",
].sort()

function makeResult(overrides: Record<string, unknown> = {}): ResultArg {
  return {
    type: "VIDEO",
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

describe("WATCH_SEARCH_RESULT_CLICKED_ACTION", () => {
  it("is the action name shared with web and TV", () => {
    expect(WATCH_SEARCH_RESULT_CLICKED_ACTION).toBe(
      "watch_search.result_clicked",
    )
  })
})

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
    expect(Object.keys(context)).toHaveLength(EXPECTED_KEYS.length)
  })

  it("carries the EXPERIENCE result type as-is", () => {
    const context = buildWatchSearchResultClickContext(
      makeResult({ type: "EXPERIENCE" }),
      { position: 1, searchRequestId: "req-1" },
    )
    expect(context["watch_search.result_type"]).toBe("EXPERIENCE")
  })

  it("caps result_title at 160 chars with an ellipsis", () => {
    const context = buildWatchSearchResultClickContext(
      makeResult({ title: "x".repeat(500) }),
      { position: 1, searchRequestId: "req-1" },
    )
    const title = context["watch_search.result_title"] as string
    expect(title.length).toBeLessThanOrEqual(160)
    expect(title.endsWith("...")).toBe(true)
  })

  it("flattens newlines and tabs in result_title", () => {
    const context = buildWatchSearchResultClickContext(
      makeResult({ title: "line one\r\nline two\tend" }),
      { position: 1, searchRequestId: "req-1" },
    )
    expect(context["watch_search.result_title"]).toBe("line one  line two end")
  })

  it("emits the request's search_language_slug", () => {
    const context = buildWatchSearchResultClickContext(makeResult(), {
      position: 1,
      searchRequestId: "req-1",
    })
    // Must equal what buildWatchSearchInput actually sends, or every click
    // becomes un-joinable with the request it came from (TV's "en" bug).
    expect(context["watch_search.search_language_slug"]).toBe(
      SEARCH_LANGUAGE_SLUG,
    )
    expect(context["watch_search.search_language_slug"]).toBe("english")
  })

  it("omits route_language_slug, which the request never carries", () => {
    // buildWatchSearchInput deliberately sends no routeLanguageSlug; reporting
    // one would fabricate a request field that was never on the wire.
    expect(
      buildWatchSearchResultClickContext(makeResult(), {
        position: 1,
        searchRequestId: "req-1",
      }),
    ).not.toHaveProperty("watch_search.route_language_slug")
  })

  it("normalizes position to a 1-based integer", () => {
    const at = (position: number) =>
      buildWatchSearchResultClickContext(makeResult(), {
        position,
        searchRequestId: "req-1",
      })["watch_search.result_position"]
    expect(at(0)).toBe(1)
    expect(at(-4)).toBe(1)
    expect(at(3.7)).toBe(3)
    expect(at(1)).toBe(1)
  })

  it("never leaks raw query text or snippet into any context value", () => {
    const rawQuery = "super secret raw query text"
    const context = buildWatchSearchResultClickContext(
      makeResult({ query: rawQuery, snippet: rawQuery }),
      { position: 1, searchRequestId: "req-1" },
    )
    expect(JSON.stringify(context)).not.toContain(rawQuery)
    expect(context).not.toHaveProperty("watch_search.query")
    expect(context).not.toHaveProperty("watch_search.snippet")
  })
})
