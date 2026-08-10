import { afterEach, describe, expect, it, vi } from "vitest"

import { searchWatchDirect } from "./watch-search-client"

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.test/api/graphql",
  },
}))

describe("searchWatchDirect", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the typed Watch search operation directly to Admin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            watchSearch: {
              requestId: "request-1",
              query: "Jesus",
              degraded: false,
              laneStatuses: [],
              results: [],
              hasMore: false,
              searchMode: "watch-search-typesense",
              latencyMs: 42,
              nextOffset: 0,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    await searchWatchDirect({
      query: "Jesus",
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://admin.test/api/graphql")
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.method).toBe("POST")
    expect(init?.body).toEqual(expect.any(String))
    const body = JSON.parse(String(init?.body)) as {
      query: string
      variables: { input: Record<string, unknown> }
    }
    expect(body.query).toContain("watchSearch")
    expect(body).toMatchObject({
      variables: {
        input: {
          query: "Jesus",
        },
      },
    })
    expect(body.variables.input).not.toHaveProperty("mode")
    expect(body.variables.input).not.toHaveProperty("shadowMode")
    expect(body.variables.input).not.toHaveProperty("profile")
    expect(body.variables.input).not.toHaveProperty("generationId")
    expect(body.variables.input).not.toHaveProperty("candidate")
  })
})
