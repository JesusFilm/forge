import { afterEach, describe, expect, it, vi } from "vitest"
import { coreQuery, CoreGraphQLError } from "./core-client"

describe("coreQuery", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("sends x-graphql-client-name: watch so Core can filter watch-restricted videos", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { videos: [] } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await coreQuery("query { videos { id } }")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-graphql-client-name": "watch",
        }),
      }),
    )
  })

  it("throws when Core returns GraphQL errors in a 200 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: null,
        errors: [{ message: "Cannot query field videos" }],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(coreQuery("query { videos { id } }")).rejects.toThrow(
      CoreGraphQLError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("backs off and retries retryable Core GraphQL errors", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: null,
          errors: [
            {
              message: "Unexpected error.",
              extensions: { code: "INTERNAL_SERVER_ERROR" },
              path: ["videoVariantDownloads"],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { videoVariantDownloads: [] },
        }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const queryPromise = coreQuery<{
      videoVariantDownloads: Array<unknown>
    }>("query Downloads { videoVariantDownloads { id } }")

    await vi.advanceTimersByTimeAsync(500)
    await expect(queryPromise).resolves.toEqual({
      data: { videoVariantDownloads: [] },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(console.warn).toHaveBeenCalledWith(
      JSON.stringify({
        event: "core-sync.core-query.retry",
        attempt: 1,
        retries: 2,
        delayMs: 500,
        error: "Core API returned GraphQL errors: Unexpected error.",
      }),
    )
  })
})
