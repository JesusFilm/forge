import { afterEach, describe, expect, it, vi } from "vitest"

import { executeGraphQL } from "./graphql-client"

afterEach(() => {
  vi.restoreAllMocks()
})

function mockGraphQLResponse() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    )
}

function lastFetchHeaders(fetchMock: ReturnType<typeof mockGraphQLResponse>) {
  const init = fetchMock.mock.calls.at(-1)?.[1]
  expect(init).toBeDefined()
  return init?.headers as Record<string, string>
}

describe("executeGraphQL", () => {
  it("does not send an Authorization header without a bearer token", async () => {
    const fetchMock = mockGraphQLResponse()

    await executeGraphQL<{ ok: boolean }, { q: string }>("query", {
      q: "jesus",
    })

    expect(lastFetchHeaders(fetchMock)).toEqual({
      "Content-Type": "application/json",
    })
  })

  it("sends a raw bearer token as an Authorization header", async () => {
    const fetchMock = mockGraphQLResponse()

    await executeGraphQL<{ ok: boolean }, { q: string }>(
      "query",
      { q: "jesus" },
      { bearerToken: "search-token" },
    )

    expect(lastFetchHeaders(fetchMock).Authorization).toBe(
      "Bearer search-token",
    )
  })

  it("preserves an already-prefixed bearer token", async () => {
    const fetchMock = mockGraphQLResponse()

    await executeGraphQL<{ ok: boolean }, { q: string }>(
      "query",
      { q: "jesus" },
      { bearerToken: "Bearer search-token" },
    )

    expect(lastFetchHeaders(fetchMock).Authorization).toBe(
      "Bearer search-token",
    )
  })
})
