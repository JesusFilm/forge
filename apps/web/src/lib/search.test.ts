import { print, type DocumentNode } from "graphql"
import { beforeEach, describe, expect, it, vi } from "vitest"

import client from "@/lib/admin-client"
import { searchVideos } from "./search"

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: vi.fn(),
  },
}))

const queryMock = vi.mocked(client.query)

type SearchQueryCall = {
  query: DocumentNode
  variables: Record<string, unknown>
  fetchPolicy?: unknown
}

function lastSearchQueryCall(): SearchQueryCall {
  const call = queryMock.mock.calls.at(-1)?.[0]
  if (call == null) throw new Error("Expected Admin search query to run")
  return call as SearchQueryCall
}

function mockSearchResponse(searchMode: "HYBRID" | "KEYWORD_ONLY" = "HYBRID") {
  queryMock.mockResolvedValue({
    data: {
      search: {
        hasMore: false,
        query: "jesus",
        searchMode,
        results: [],
      },
    },
  } as Awaited<ReturnType<typeof client.query>>)
}

describe("searchVideos", () => {
  beforeEach(() => {
    queryMock.mockReset()
    mockSearchResponse()
  })

  it("declares and forwards the keyword-first mode argument", async () => {
    await searchVideos("jesus")

    const options = lastSearchQueryCall()
    const printed = print(options.query)

    expect(printed).toMatch(/\$mode:\s*String\b/)
    expect(printed).toMatch(/search\([^)]*mode:\s*\$mode/)
    expect(options.variables).toEqual({
      q: "jesus",
      locale: "en",
      limit: 20,
      offset: 0,
      type: undefined,
      mode: "keyword-first",
    })
    expect(options.fetchPolicy).toBe("no-cache")
  })

  it("keeps content type filtering while sending keyword-first mode", async () => {
    await searchVideos("jesus", 10, 5, "video")

    expect(lastSearchQueryCall().variables).toEqual({
      q: "jesus",
      locale: "en",
      limit: 10,
      offset: 5,
      type: "VIDEO",
      mode: "keyword-first",
    })
  })

  it("keeps response searchMode degradation separate from input mode", async () => {
    mockSearchResponse("KEYWORD_ONLY")

    const data = await searchVideos("jesus")

    expect(data.searchMode).toBe("keyword-only")
    expect(lastSearchQueryCall().variables.mode).toBe("keyword-first")
  })
})
