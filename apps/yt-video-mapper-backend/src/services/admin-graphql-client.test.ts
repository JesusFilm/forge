import { describe, expect, it, vi } from "vitest"
import {
  AdminGraphqlClient,
  AdminGraphqlClientError,
  type AdminCatalogItem,
  type FetchLike,
} from "./admin-graphql-client.js"

const catalogItem: AdminCatalogItem = {
  coreId: "core-video-1",
  sourceTitle: "JESUS",
  sourceTitleLocale: "en",
  videoVariantId: "variant-en",
  adminVideoId: "admin-video-1",
  adminDubId: "admin-dub-1",
  languageId: "lang-core-en",
  languageSlug: "english",
  locale: "en",
  editionCoreId: "edition-core-1",
  editionName: "Feature",
  durationSeconds: 120,
  lengthInMilliseconds: "120000",
  hlsUrl: "https://media.example.com/video.m3u8",
  dashUrl: null,
  shareUrl: "https://share.example.com/video",
  downloadUrl: "https://media.example.com/video.mp4",
  downloadQuality: "1080p",
  downloadWidth: 1920,
  downloadHeight: 1080,
  mediaSourceType: "DOWNLOAD",
  mediaSourceUrl: "https://media.example.com/video.mp4",
  videoPublished: true,
  dubPublished: true,
  videoNoIndex: false,
  videoDeleted: false,
  dubDeleted: false,
  deletedAt: null,
  indexable: true,
  nonIndexableReason: null,
}

describe("AdminGraphqlClient", () => {
  it("fetches the first catalog page without an after variable", async () => {
    const fetchImpl = createFetch({
      data: catalogResponse({
        nodes: [catalogItem],
        pageInfo: {
          startCursor: "cursor-a",
          endCursor: "cursor-b",
          hasNextPage: true,
        },
      }),
    })
    const client = createClient(fetchImpl)

    await expect(client.fetchCatalogPage({ first: 25 })).resolves.toEqual({
      nodes: [catalogItem],
      pageInfo: {
        startCursor: "cursor-a",
        endCursor: "cursor-b",
        hasNextPage: true,
      },
    })

    const [, init] = fetchImpl.mock.calls[0]
    expect(init.headers.authorization).toBe("Bearer service-token")
    expect(JSON.parse(init.body)).toMatchObject({
      variables: { first: 25 },
    })
    expect(JSON.parse(init.body).variables).not.toHaveProperty("after")
  })

  it("passes the cursor when fetching a later page", async () => {
    const fetchImpl = createFetch({
      data: catalogResponse({
        nodes: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
        },
      }),
    })
    const client = createClient(fetchImpl)

    await client.fetchCatalogPage({ first: 25, after: "cursor-b" })

    const [, init] = fetchImpl.mock.calls[0]
    expect(JSON.parse(init.body)).toMatchObject({
      variables: {
        first: 25,
        after: "cursor-b",
      },
    })
  })

  it("maps GraphQL errors to a safe client error", async () => {
    const fetchImpl = createFetch({
      data: {
        errors: [
          {
            message: "denied for service-token",
            extensions: { authorization: "Bearer service-token" },
          },
        ],
      },
    })
    const client = createClient(fetchImpl)

    await expect(client.fetchCatalogPage({ first: 25 })).rejects.toMatchObject({
      code: "graphql_error",
      summary: {
        errors: [
          {
            message: "denied for [redacted]",
            extensions: {},
          },
        ],
      },
    })
  })

  it("maps HTTP failures to a bounded safe summary", async () => {
    const fetchImpl = createFetch({
      ok: false,
      status: 502,
      data: {
        message: `upstream failed ${"x".repeat(400)} service-token`,
      },
    })
    const client = createClient(fetchImpl)

    await expect(client.fetchCatalogPage({ first: 25 })).rejects.toMatchObject({
      code: "http_error",
      summary: {
        status: 502,
        body: {
          message: expect.stringContaining("upstream failed"),
        },
      },
    })

    try {
      await client.fetchCatalogPage({ first: 25 })
    } catch (error) {
      expect(error).toBeInstanceOf(AdminGraphqlClientError)
      const serialized = JSON.stringify(
        (error as AdminGraphqlClientError).summary,
      )
      expect(serialized).not.toContain("service-token")
      expect(serialized.length).toBeLessThan(450)
    }
  })

  it("rejects malformed catalog payloads before returning rows", async () => {
    const fetchImpl = createFetch({
      data: catalogResponse({
        nodes: [{ ...catalogItem, coreId: "" }],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
        },
      }),
    })
    const client = createClient(fetchImpl)

    await expect(client.fetchCatalogPage({ first: 25 })).rejects.toMatchObject({
      code: "malformed_response",
      summary: {
        reason: "nodes[0].coreId must be a non-empty string",
      },
    })
  })
})

function createClient(fetchImpl: ReturnType<typeof createFetch>) {
  return new AdminGraphqlClient({
    url: "https://admin.example.com/graphql",
    bearerToken: "service-token",
    fetchImpl,
  })
}

function createFetch({
  ok = true,
  status = 200,
  data,
}: {
  ok?: boolean
  status?: number
  data: unknown
}) {
  return vi.fn<FetchLike>(async () => ({
    ok,
    status,
    async text() {
      return typeof data === "string" ? data : JSON.stringify(data)
    },
  }))
}

function catalogResponse(page: {
  nodes: unknown[]
  pageInfo: {
    startCursor: string | null
    endCursor: string | null
    hasNextPage: boolean
  }
}) {
  return {
    data: {
      videoMapperCatalog: page,
    },
  }
}
