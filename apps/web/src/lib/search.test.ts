import { print, type DocumentNode } from "graphql"
import { beforeEach, describe, expect, it, vi } from "vitest"

import client, { semanticSearchAdminClient } from "@/lib/admin-client"
import { searchVideos } from "./search"

const defaultQueryMock = vi.hoisted(() => vi.fn())
const semanticQueryMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: defaultQueryMock,
  },
  semanticSearchAdminClient: {
    query: semanticQueryMock,
  },
}))

const defaultClientQueryMock = vi.mocked(client.query)
const queryMock = vi.mocked(semanticSearchAdminClient.query)

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
  } as Awaited<ReturnType<typeof semanticSearchAdminClient.query>>)
}

describe("searchVideos", () => {
  beforeEach(() => {
    defaultClientQueryMock.mockReset()
    queryMock.mockReset()
    mockSearchResponse()
  })

  it("uses the semantic-search Admin client instead of the default Admin client", async () => {
    await searchVideos("jesus")

    expect(defaultClientQueryMock).not.toHaveBeenCalled()
    expect(queryMock).toHaveBeenCalledOnce()
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
