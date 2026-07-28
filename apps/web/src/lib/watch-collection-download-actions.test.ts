import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("@/lib/admin-client", () => ({
  default: { query: vi.fn() },
}))

import client from "@/lib/admin-client"
import { loadWatchCollectionDownloads } from "./watch-collection-download-actions"

const queryMock = vi.mocked(client.query)
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

describe("loadWatchCollectionDownloads", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  it("returns normalized recursive leaf metadata without raw download URLs", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: {
          documentId: "collection-1",
          downloadableDescendants: {
            status: "READY",
            languages: [{ slug: "english", name: "English", bcp47: "en" }],
            eligibleLeaves: [
              {
                documentId: "episode-1",
                slug: "episode-one",
                title: "Episode one",
                thumbnailUrl: null,
                ordinal: 0,
                variantId: "dub-1",
                downloads: [
                  {
                    documentId: "download-1",
                    height: 1080,
                    quality: "high",
                    size: "12345",
                  },
                ],
              },
            ],
            skippedLeaves: [],
          },
        },
      },
    } as never)

    const result = await loadWatchCollectionDownloads({
      collectionSlug: "lumo-luke",
      languageSlug: "english",
    })

    expect(result).toEqual({
      ok: true,
      languages: [{ slug: "english", name: "English", bcp47: "en" }],
      eligibleLeaves: [
        {
          documentId: "episode-1",
          slug: "episode-one",
          title: "Episode one",
          thumbnailUrl: null,
          ordinal: 0,
          variantId: "dub-1",
          downloads: [
            {
              documentId: "download-1",
              height: 1080,
              quality: "high",
              size: 12345,
            },
          ],
        },
      ],
      skippedLeaves: [],
    })
    expect(JSON.stringify(result)).not.toContain("url")
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          videoSlug: "lumo-luke",
          languageSlug: "english",
        },
        fetchPolicy: "no-cache",
      }),
    )
  })

  it("rejects invalid slugs before querying Admin", async () => {
    await expect(
      loadWatchCollectionDownloads({
        collectionSlug: "bad/collection",
        languageSlug: "english",
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid-input" })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it("returns a stable unavailable result when Admin fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("upstream secret"))

    await expect(
      loadWatchCollectionDownloads({
        collectionSlug: "lumo-luke",
        languageSlug: "english",
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" })
    expect(consoleError).toHaveBeenCalledWith(
      "[watch-collection-download] lookup failed",
      expect.objectContaining({
        collectionSlug: "lumo-luke",
        languageSlug: "english",
      }),
    )
  })

  it("fails closed when Admin reports a recursive traversal limit", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: {
          downloadableDescendants: {
            status: "TRAVERSAL_LIMIT",
            languages: [],
            eligibleLeaves: [],
            skippedLeaves: [],
          },
        },
      },
    } as never)

    await expect(
      loadWatchCollectionDownloads({ collectionSlug: "shine-films" }),
    ).resolves.toEqual({ ok: false, reason: "traversal-limit" })
  })
})
