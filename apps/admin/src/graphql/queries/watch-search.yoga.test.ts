// HTTP-boundary proof for the Watch search deadline: the resolver's typed
// timeout must reach the wire as a 504 through a real Yoga response, not only
// as a GraphQL error extension. Both primaries (MODERN Typesense and DEFAULT
// Postgres) share the mapping.

import { createYoga } from "graphql-yoga"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { schema } from "@/graphql/schema"
import {
  WATCH_SEARCH_HARD_TIMEOUT_MS,
  WatchSearchTimeoutError,
} from "@/services/watch-search.service"

// Yoga loads GraphQL through Node. Share that instance instead of Vitest's
// transformed ESM instance, whose schema/error classes belong to another realm.
vi.mock("graphql", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("graphql") as typeof import("graphql")
})

const { enqueueWatchSearchTraceMock } = vi.hoisted(() => ({
  enqueueWatchSearchTraceMock: vi.fn(),
}))

vi.mock("@/services/search-trace.service", () => ({
  enqueueWatchSearchTrace: enqueueWatchSearchTraceMock,
}))

vi.mock("@/services/watch-search-shadow.service", () => ({
  enqueueWatchSearchShadow: vi.fn(),
}))

const defaultSearchMock = vi.fn()
const modernSearchMock = vi.fn()

function watchSearchYoga() {
  return createYoga({
    schema,
    logging: false,
    context: ({ request }) => ({
      user: null,
      request,
      prisma: {},
      services: {
        watchSearch: { search: defaultSearchMock },
        typesenseWatchSearch: { search: modernSearchMock },
        typesenseWatchSearchSuggestions: null,
      },
    }),
  })
}

async function postWatchSearch(mode: "MODERN" | null) {
  return watchSearchYoga().fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query:
        "query ($input: WatchSearchInput!) { watchSearch(input: $input) { searchMode degraded } }",
      variables: { input: { query: "jesus", mode } },
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("watchSearch deadline over HTTP", () => {
  it.each([
    ["MODERN", "MODERN" as const, modernSearchMock],
    ["DEFAULT", null, defaultSearchMock],
  ])(
    "answers a %s deadline with HTTP 504 and a typed, query-free error",
    async (_label, mode, searchMock) => {
      searchMock.mockRejectedValueOnce(
        new WatchSearchTimeoutError("watch_search_deadline_exceeded"),
      )

      const response = await postWatchSearch(mode)
      const body = (await response.json()) as {
        data: { watchSearch: unknown } | null
        errors: Array<{ message: string; extensions: { code: string } }>
      }

      expect(response.status).toBe(504)
      expect(body.data?.watchSearch ?? null).toBeNull()
      expect(body.errors).toEqual([
        expect.objectContaining({
          message: "Watch search timed out",
          extensions: expect.objectContaining({
            code: "WATCH_SEARCH_TIMEOUT",
          }),
        }),
      ])
      expect(JSON.stringify(body)).not.toContain("jesus")
      expect(searchMock).toHaveBeenCalledWith(expect.anything(), {
        hardTimeoutMs: WATCH_SEARCH_HARD_TIMEOUT_MS,
      })
      expect(enqueueWatchSearchTraceMock).not.toHaveBeenCalled()
    },
  )

  it("keeps a completed degraded MODERN response at HTTP 200", async () => {
    modernSearchMock.mockResolvedValueOnce({
      query: "jesus",
      results: [],
      hasMore: false,
      nextOffset: 20,
      searchMode: "watch-search-typesense",
      requestId: "search-request-yoga-1",
      degraded: true,
      latencyMs: 1_900,
      laneStatuses: [],
      languageInterpretation: null,
    })

    const response = await postWatchSearch("MODERN")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        watchSearch: { searchMode: "watch-search-typesense", degraded: true },
      },
    })
  })
})
