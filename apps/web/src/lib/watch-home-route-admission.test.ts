import { afterEach, describe, expect, it, vi } from "vitest"

import {
  clearWatchHomepageAvailabilityCache,
  getWatchHomepageAvailability,
  setWatchHomepageAvailabilitySourceForTest,
} from "./watch-home-route-admission"

const originalEnv = { ...process.env }

function homepageResponse(available: boolean): Response {
  return Response.json({
    data: {
      watchSetting: {
        homepageExperience: available ? { id: "homepage" } : null,
      },
    },
  })
}

afterEach(() => {
  process.env.ADMIN_GRAPHQL_URL = originalEnv.ADMIN_GRAPHQL_URL
  process.env.WEB_ADMIN_API_KEYS = originalEnv.WEB_ADMIN_API_KEYS
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearWatchHomepageAvailabilityCache()
})

describe("getWatchHomepageAvailability", () => {
  it("reads published homepage availability from the existing Admin GraphQL contract", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://admin.test/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "consumer-key"
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        homepageResponse(
          (
            JSON.parse(String(init?.body)) as {
              variables: { locale: string }
            }
          ).variables.locale === "es",
        ),
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(getWatchHomepageAvailability("es")).resolves.toBe("available")
    await expect(getWatchHomepageAvailability("ru")).resolves.toBe("missing")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://admin.test/api/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer consumer-key",
        }),
      }),
    )
    const requestedLocales = fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as {
        query: string
        variables: { locale: string }
      }
      expect(body.query).toContain("watchSetting(locale: $locale)")
      return body.variables.locale
    })
    expect(requestedLocales).toEqual(["es", "ru"])
  })

  it("distinguishes a missing homepage from an upstream failure", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://admin.test/api/graphql"
    const fetchMock = vi.fn().mockResolvedValue(homepageResponse(false))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getWatchHomepageAvailability("ru")).resolves.toBe("missing")
    clearWatchHomepageAvailabilityCache()
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }))
    await expect(getWatchHomepageAvailability("fr")).resolves.toBe("unknown")
  })

  it("coalesces and caches known results without caching unknown failures", async () => {
    const source = vi
      .fn()
      .mockResolvedValueOnce("available")
      .mockResolvedValueOnce("unknown")
      .mockResolvedValueOnce("missing")
    const reset = setWatchHomepageAvailabilitySourceForTest(source)

    await expect(
      Promise.all([
        getWatchHomepageAvailability("es"),
        getWatchHomepageAvailability("es"),
      ]),
    ).resolves.toEqual(["available", "available"])
    await expect(getWatchHomepageAvailability("es")).resolves.toBe("available")
    await expect(getWatchHomepageAvailability("ru")).resolves.toBe("unknown")
    await expect(getWatchHomepageAvailability("ru")).resolves.toBe("missing")

    expect(source).toHaveBeenCalledTimes(3)
    reset()
  })

  it("retries an upstream failure instead of caching unknown", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://admin.test/api/graphql"
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(homepageResponse(true))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getWatchHomepageAvailability("es")).resolves.toBe("unknown")
    await expect(getWatchHomepageAvailability("es")).resolves.toBe("available")

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
