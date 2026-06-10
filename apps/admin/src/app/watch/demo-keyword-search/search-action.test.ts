import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const headersMock = vi.hoisted(() => vi.fn())

vi.mock("next/headers", () => ({
  headers: headersMock,
}))

vi.mock("@/config/env", () => ({
  env: {
    ADMIN_BASE_URL: "https://admin.example",
    WEB_ADMIN_API_KEYS: " first-key , second-key ",
  },
}))

import { env } from "@/config/env"
import { searchAdminGraphQL } from "./search-action"

const ENV = env as {
  ADMIN_BASE_URL: string | undefined
  WEB_ADMIN_API_KEYS: string | undefined
}

describe("searchAdminGraphQL", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    headersMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    ENV.ADMIN_BASE_URL = "https://admin.example"
    ENV.WEB_ADMIN_API_KEYS = " first-key , second-key "
    headersMock.mockResolvedValue(
      new Headers({
        origin: "https://admin.example",
        "x-forwarded-host": "ignored.example",
        "x-forwarded-proto": "https",
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function searchResponse(): Response {
    return new Response(
      JSON.stringify({
        data: {
          search: {
            hasMore: false,
            query: "jesus",
            searchMode: "HYBRID",
            results: [],
          },
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  it("calls admin GraphQL with the first configured WEB_ADMIN_API_KEYS bearer", async () => {
    fetchMock.mockResolvedValueOnce(searchResponse())

    await expect(
      searchAdminGraphQL({
        q: "jesus",
        locale: "en",
        limit: 3,
        mode: "keyword-first",
      }),
    ).resolves.toMatchObject({ query: "jesus", searchMode: "HYBRID" })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://admin.example/api/graphql")
    expect((init as RequestInit).method).toBe("POST")
    expect((init as RequestInit).cache).toBe("no-store")
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer first-key",
      Origin: "https://admin.example",
    })
    expect(JSON.parse(String((init as RequestInit).body)).variables).toEqual({
      q: "jesus",
      locale: "en",
      limit: 3,
      mode: "keyword-first",
      debug: true,
    })
  })

  it("infers the GraphQL endpoint from request headers when ADMIN_BASE_URL is unset", async () => {
    ENV.ADMIN_BASE_URL = undefined
    headersMock.mockResolvedValueOnce(
      new Headers({
        "x-forwarded-host": "preview.example",
        "x-forwarded-proto": "https",
      }),
    )
    fetchMock.mockResolvedValueOnce(searchResponse())

    await searchAdminGraphQL({
      q: "jesus",
      locale: "en",
      limit: 3,
      mode: "hybrid",
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://preview.example/api/graphql",
    )
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject(
      {
        Origin: "https://preview.example",
      },
    )
  })

  it("fails before fetch when WEB_ADMIN_API_KEYS is missing", async () => {
    ENV.WEB_ADMIN_API_KEYS = undefined

    await expect(
      searchAdminGraphQL({
        q: "jesus",
        locale: "en",
        limit: 3,
        mode: "hybrid",
      }),
    ).rejects.toThrow("demo_search_bearer_not_configured")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("surfaces GraphQL errors from the server-side call", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ message: "Authentication required" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    await expect(
      searchAdminGraphQL({
        q: "jesus",
        locale: "en",
        limit: 3,
        mode: "hybrid",
      }),
    ).rejects.toThrow("Authentication required")
  })
})
