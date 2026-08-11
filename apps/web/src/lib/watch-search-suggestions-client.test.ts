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
  it("posts the narrow public query and returns bounded title strings", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            watchSearchSuggestions: ["Jesus", "Jesus Wept", "Jesus"],
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
    ).resolves.toEqual(["Jesus", "Jesus Wept"])

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
    expect(body.query).not.toContain("watchSearch(input")
    expect(body.variables).toEqual({
      input: { query: "je", languageSlug: "english" },
    })
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
      JSON.stringify({ data: { watchSearchSuggestions: ["Jesus", 42] } }),
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
