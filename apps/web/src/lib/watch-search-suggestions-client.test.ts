import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  fetchWatchSearchSuggestions,
  WatchSearchSuggestionsError,
} from "./watch-search-client"

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("fetchWatchSearchSuggestions", () => {
  it("posts the narrow public query and returns bounded title context", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            watchSearchSuggestions: [
              {
                kind: "QUERY",
                title: "Jesus",
                description: "The story of Jesus.",
                matchSource: "TITLE",
                id: null,
                slug: null,
                label: null,
                childCount: null,
              },
              {
                kind: "CONTENT",
                title: "Jesus Wept",
                description: null,
                matchSource: "TITLE",
                id: "video-1",
                slug: "jesus-wept",
                label: "SEGMENT",
                childCount: 0,
              },
              {
                kind: "QUERY",
                title: "Jesus",
                description: "Duplicate title.",
                matchSource: "DESCRIPTION",
                id: null,
                slug: null,
                label: null,
                childCount: null,
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    await expect(
      fetchWatchSearchSuggestions({
        query: "je",
        languageSlug: "english",
      }),
    ).resolves.toEqual([
      {
        kind: "query",
        title: "Jesus",
        description: "The story of Jesus.",
        matchSource: "title",
        id: null,
        slug: null,
        label: null,
        childCount: null,
      },
      {
        kind: "content",
        title: "Jesus Wept",
        description: null,
        matchSource: "title",
        id: "video-1",
        slug: "jesus-wept",
        label: "SEGMENT",
        childCount: 0,
      },
    ])

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://localhost:3003/api/graphql")
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
    })
    const body = JSON.parse(String(init.body)) as {
      query: string
      variables: unknown
    }
    expect(body.query).toContain("watchSearchSuggestions")
    expect(body.query).toContain("description")
    expect(body.query).toContain("matchSource")
    expect(body.query).not.toContain("watchSearch(input")
    expect(body.variables).toEqual({
      input: { query: "je", languageSlug: "english" },
    })
  })

  it("preserves all six query phrases and six direct matches", async () => {
    const querySuggestions = Array.from({ length: 6 }, (_, index) => ({
      kind: "QUERY",
      title: `Phrase ${index + 1}`,
      description: null,
      matchSource: "TITLE",
      id: null,
      slug: null,
      label: null,
      childCount: null,
    }))
    const directMatches = Array.from({ length: 6 }, (_, index) => ({
      kind: "CONTENT",
      title: `Video ${index + 1}`,
      description: null,
      matchSource: "TITLE",
      id: `video-${index + 1}`,
      slug: `video-${index + 1}`,
      label: "SEGMENT",
      childCount: 0,
    }))
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            watchSearchSuggestions: [...querySuggestions, ...directMatches],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const suggestions = await fetchWatchSearchSuggestions({
      query: "video",
      languageSlug: "english",
    })

    expect(suggestions).toHaveLength(12)
    expect(suggestions.filter(({ kind }) => kind === "query")).toHaveLength(6)
    expect(suggestions.filter(({ kind }) => kind === "content")).toHaveLength(6)
  })

  it("forwards caller cancellation to fetch", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"))
          })
        }),
    )
    const controller = new AbortController()
    const request = fetchWatchSearchSuggestions({
      query: "je",
      languageSlug: "english",
      signal: controller.signal,
    })

    controller.abort()

    await expect(request).rejects.toMatchObject({ name: "AbortError" })
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(
      true,
    )
  })

  it("aborts a hung request at the bounded timeout", async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"))
          })
        }),
    )
    const request = fetchWatchSearchSuggestions({
      query: "je",
      languageSlug: "english",
      timeoutMs: 25,
    })
    const assertion = expect(request).rejects.toMatchObject({
      name: "AbortError",
    })

    await vi.advanceTimersByTimeAsync(25)

    await assertion
  })

  it.each([
    new Response("offline", { status: 503 }),
    new Response(JSON.stringify({ errors: [{ message: "failed" }] }), {
      status: 200,
    }),
    new Response(
      JSON.stringify({
        data: {
          watchSearchSuggestions: [
            { title: "Jesus", description: null, matchSource: "TITLE" },
            42,
          ],
        },
      }),
      { status: 200 },
    ),
  ])("rejects invalid HTTP or GraphQL responses", async (response) => {
    fetchMock.mockResolvedValue(response)

    await expect(
      fetchWatchSearchSuggestions({
        query: "je",
        languageSlug: "english",
      }),
    ).rejects.toBeInstanceOf(WatchSearchSuggestionsError)
  })
})
