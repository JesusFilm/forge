import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cache: new Map<string, Promise<unknown>>(),
  query: vi.fn(),
  unstableCache: vi.fn((fn: (...args: never[]) => unknown) => {
    return (...args: never[]) => {
      const key = JSON.stringify(args)
      const existing = mocks.cache.get(key)
      if (existing) return existing
      const pending = Promise.resolve(fn(...args))
      mocks.cache.set(key, pending)
      return pending
    }
  }),
}))

vi.mock("next/cache", () => ({ unstable_cache: mocks.unstableCache }))
vi.mock("@/lib/admin-client", () => ({
  default: { query: mocks.query },
}))

import { getDynamicCollectionFeedPage } from "./dynamic-collection-feed"
import { WATCH_CACHE_TAGS } from "./watch-cache-tags"

describe("getDynamicCollectionFeedPage", () => {
  beforeEach(() => {
    mocks.cache.clear()
    mocks.query.mockReset()
  })

  it("uses a 60-second tagged cache and maps the flat Admin DTO", async () => {
    mocks.query.mockResolvedValue({
      data: {
        watchCollectionFeed: {
          nodes: [
            {
              id: "collection-1",
              slug: "collection-one",
              title: "Collection One",
              description: "Description",
              items: [
                {
                  id: "child-1",
                  coreId: "core-child-1",
                  title: "Episode One",
                  videoSlug: "episode-one",
                  languageSlug: "english",
                  label: "EPISODE",
                  imageUrl: "https://images/episode.jpg",
                  blurDataUrl: "data:image/jpeg;base64,blur",
                  dominantColor: "#123456",
                  muxPlaybackId: "mux-1",
                },
              ],
            },
          ],
          pageInfo: { endCursor: "collection-1", hasNextPage: true },
        },
      },
    })

    const result = await getDynamicCollectionFeedPage({
      locale: "en",
      languageSlug: "english",
      cacheScope: "live",
      after: null,
      excludedIds: ["featured-id"],
      excludedSlugs: ["featured-slug"],
      first: 3,
      cardsPerParent: 12,
    })

    expect(mocks.unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      ["watch-dynamic-collection-feed-v1"],
      {
        revalidate: 60,
        tags: [WATCH_CACHE_TAGS.home, WATCH_CACHE_TAGS.video],
      },
    )
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          locale: "en",
          languageSlug: "english",
          first: 3,
          cardsPerParent: 12,
          after: null,
          excludedIds: ["featured-id"],
          excludedSlugs: ["featured-slug"],
        },
        fetchPolicy: "no-cache",
      }),
    )
    expect(result.sections[0]).toEqual(
      expect.objectContaining({
        id: "collection-1",
        title: "Collection One",
        items: [
          expect.objectContaining({ id: "child-1", title: "Episode One" }),
        ],
      }),
    )
    expect(result.endCursor).toBe("collection-1")
    expect(result.hasNextPage).toBe(true)
  })

  it("shares identical cache arguments without colliding across normalized inputs", async () => {
    mocks.query.mockResolvedValue({
      data: {
        watchCollectionFeed: {
          nodes: [],
          pageInfo: { endCursor: null, hasNextPage: false },
        },
      },
    })
    const input = {
      locale: "en",
      languageSlug: "english",
      cacheScope: "live" as const,
      after: null,
      excludedIds: ["a"],
      excludedSlugs: ["b"],
      first: 3 as const,
      cardsPerParent: 12 as const,
    }

    await getDynamicCollectionFeedPage(input)
    await getDynamicCollectionFeedPage(input)
    await getDynamicCollectionFeedPage({ ...input, after: "cursor-1" })
    await getDynamicCollectionFeedPage({ ...input, locale: "fr" })
    await getDynamicCollectionFeedPage({ ...input, languageSlug: "french" })
    await getDynamicCollectionFeedPage({ ...input, excludedIds: ["other"] })
    await getDynamicCollectionFeedPage({ ...input, excludedSlugs: ["other"] })
    await getDynamicCollectionFeedPage({
      ...input,
      first: 2,
      cardsPerParent: 8,
    })

    expect(mocks.query).toHaveBeenCalledTimes(7)
  })
})
