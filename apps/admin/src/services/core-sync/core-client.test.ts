import { afterEach, describe, expect, it, vi } from "vitest"
import { coreQuery, CoreGraphQLError } from "./core-client"

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    CORE_API_URL: undefined as string | undefined,
    CORE_API_TOKEN: undefined as string | undefined,
    CORE_API_TIMEOUT_MS: undefined as number | undefined,
    CORE_API_RETRIES: undefined as number | undefined,
    NODE_ENV: "test" as string | undefined,
  },
}))

vi.mock("@/config/env", () => ({ env: mockEnv }))

describe("coreQuery", () => {
  afterEach(() => {
    mockEnv.CORE_API_URL = undefined
    mockEnv.CORE_API_TOKEN = undefined
    mockEnv.CORE_API_TIMEOUT_MS = undefined
    mockEnv.CORE_API_RETRIES = undefined
    mockEnv.NODE_ENV = "test"
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("sends both compatibility auth headers and rejects redirects", async () => {
    mockEnv.CORE_API_TOKEN = "interop-secret"
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ok: true } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await coreQuery("query { ok }")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        redirect: "error",
        headers: {
          authorization: "Bearer interop-secret",
          "content-type": "application/json",
          "interop-token": "interop-secret",
        },
      }),
    )
  })

  it("fails closed when an interop-protected query has no token", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      coreQuery("query { protected }", undefined, {
        requireInteropToken: true,
      }),
    ).rejects.toThrow("CORE_API_TOKEN is required")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a non-HTTPS Core URL in production", async () => {
    mockEnv.CORE_API_URL = "http://core.example.test/graphql"
    mockEnv.NODE_ENV = "production"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(coreQuery("query { ok }")).rejects.toThrow(
      "CORE_API_URL must use HTTPS in production",
    )
    expect(fetchMock).not.toHaveBeenCalled()
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
