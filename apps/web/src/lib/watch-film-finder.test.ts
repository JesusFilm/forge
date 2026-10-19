import { print } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { query, cache, unstableCache } = vi.hoisted(() => {
  const cache = new Map<string, Promise<unknown>>()
  return {
    query: vi.fn(),
    cache,
    // Mirrors unstable_cache: memoized by key parts + serialized args; a
    // rejected fill is not retained.
    unstableCache: vi.fn(
      (fn: (...args: never[]) => Promise<unknown>, keyParts: string[]) =>
        (...args: never[]) => {
          const key = JSON.stringify([keyParts, args])
          const hit = cache.get(key)
          if (hit) return hit
          const pending = fn(...args)
          cache.set(key, pending)
          pending.catch(() => cache.delete(key))
          return pending
        },
    ),
  }
})
vi.mock("@/lib/admin-client", () => ({ default: { query } }))
vi.mock("next/cache", () => ({ unstable_cache: unstableCache }))

import { WATCH_CACHE_TAGS } from "./watch-cache-tags"
import {
  getWatchFilmFinder,
  parseWatchFilmFinderParams,
  WatchFilmFinderInputError,
} from "./watch-film-finder"
import {
  setWatchRouteManifestSourceForTest,
  type WatchRouteManifest,
} from "./watch-route-manifest"

const card = {
  laneId: "CONVERSATION",
  videoId: "live-video",
  slug: "current-film",
  title: "Título actual",
  durationSeconds: 245,
  imageUrl: "https://imagedelivery.net/current/poster/public",
  muxPlaybackId: null,
  videoDubId: "spanish-dub",
}

beforeEach(() => {
  query.mockReset()
  cache.clear()
})

describe("Watch finder Admin adapter", () => {
  it("requests exact Spanish audio and the runtime cap, returning current metadata and a canonical route", async () => {
    query.mockResolvedValue({
      data: {
        watchFilmFinder: {
          cards: [card],
          hasNextPage: true,
          endCursor: "v1:2",
        },
      },
    })
    const page = await getWatchFilmFinder({
      laneIds: ["conversation", "getting-started"],
      languageSlug: "spanish-latin-american",
      duration: "SHORT",
      first: 2,
    })
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          input: {
            laneIds: ["CONVERSATION", "GETTING_STARTED"],
            languageSlug: "spanish-latin-american",
            duration: "SHORT",
            first: 2,
          },
        },
        fetchPolicy: "no-cache",
        context: expect.objectContaining({
          queryDeduplication: false,
          fetchOptions: expect.objectContaining({ cache: "no-store" }),
        }),
      }),
    )
    expect(page.cards).toEqual([
      {
        laneId: "conversation",
        videoId: "live-video",
        slug: "current-film",
        title: "Título actual",
        durationSeconds: 245,
        imageUrl: card.imageUrl,
        videoDubId: "spanish-dub",
        href: "/current-film.html/spanish-latin-american.html",
      },
    ])
    expect(page).toMatchObject({ hasNextPage: true, endCursor: "v1:2" })
    const operation = print(query.mock.calls[0][0].query)
    expect(operation).toContain("watchFilmFinder(input: $input)")
    expect(operation).not.toMatch(/\b(hls|downloads|dubs|bearer)\b/)
  })

  it("uses canonical English routes and derives a thumbnail only from current Admin media", async () => {
    query.mockResolvedValue({
      data: {
        watchFilmFinder: {
          cards: [
            { ...card, imageUrl: null, muxPlaybackId: "current-playback" },
          ],
          hasNextPage: false,
          endCursor: null,
        },
      },
    })
    const page = await getWatchFilmFinder({
      laneIds: ["conversation"],
      languageSlug: "english",
      duration: "ANY",
      first: 24,
    })
    expect(page.cards[0]).toMatchObject({
      href: "/current-film.html",
      // Byte-for-byte admin's pre-generated WATCH_CHAPTER_CAROUSEL_RECIPE
      // (mux-image-derivative.service.ts): a bespoke width would be a cold
      // Mux render and `fit_mode=smartcrop` keeps 9:16 sources from becoming
      // a letterboxed strip.
      imageUrl:
        "https://image.mux.com/current-playback/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
    })
  })

  describe("shared public cache", () => {
    const input = {
      laneIds: ["kids", "conversation"] as const,
      languageSlug: "english",
      duration: "ANY" as const,
      first: 24,
    }
    const adminPage = {
      data: {
        watchFilmFinder: {
          cards: [card],
          hasNextPage: true,
          endCursor: "v1:24",
        },
      },
    }

    it("serves repeated identical finder requests from one bounded, tagged cache entry", async () => {
      query.mockResolvedValue(adminPage)
      const first = await getWatchFilmFinder(input)
      const second = await getWatchFilmFinder({ ...input })
      expect(second).toEqual(first)
      expect(query).toHaveBeenCalledTimes(1)
      expect(unstableCache).toHaveBeenCalledWith(
        expect.any(Function),
        ["watch-film-finder-v1"],
        {
          revalidate: 300,
          tags: [
            WATCH_CACHE_TAGS.video,
            WATCH_CACHE_TAGS.series,
            WATCH_CACHE_TAGS.settings,
          ],
        },
      )
      // Every filter dimension (lane order is rank order, audio, duration,
      // page size, cursor) is a distinct entry.
      await getWatchFilmFinder({ ...input, after: "v1:24" })
      await getWatchFilmFinder({ ...input, laneIds: ["conversation", "kids"] })
      await getWatchFilmFinder({ ...input, duration: "SHORT" })
      await getWatchFilmFinder({ ...input, languageSlug: "french" })
      expect(query).toHaveBeenCalledTimes(5)
    })

    it("keys the cache on the canonical filters only, never on caller identity or the request signal", async () => {
      query.mockResolvedValue(adminPage)
      await getWatchFilmFinder(input, new AbortController().signal)
      await getWatchFilmFinder(input, new AbortController().signal)
      expect(query).toHaveBeenCalledTimes(1)
      const keys = [...cache.keys()]
      expect(keys).toHaveLength(1)
      expect(keys[0]).toBe(
        JSON.stringify([
          ["watch-film-finder-v1"],
          [
            {
              laneIds: ["kids", "conversation"],
              languageSlug: "english",
              duration: "ANY",
              first: 24,
            },
          ],
        ]),
      )
      // A shared fill must not be cancellable by one visitor.
      expect(query.mock.calls[0][0].context.fetchOptions.signal).toBeUndefined()
    })

    it("lets a visitor abandon the shared fill without cancelling it for others, and never caches failures", async () => {
      let release: (value: unknown) => void = () => undefined
      query.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
      const controller = new AbortController()
      const abandoned = getWatchFilmFinder(input, controller.signal)
      controller.abort()
      await expect(abandoned).rejects.toMatchObject({ name: "AbortError" })
      const joined = getWatchFilmFinder(input)
      release(adminPage)
      await expect(joined).resolves.toMatchObject({ hasNextPage: true })
      expect(query).toHaveBeenCalledTimes(1)

      cache.clear()
      query.mockRejectedValueOnce(new Error("Admin timeout"))
      await expect(getWatchFilmFinder(input)).rejects.toThrow("Admin timeout")
      query.mockResolvedValueOnce(adminPage)
      await expect(getWatchFilmFinder(input)).resolves.toMatchObject({
        hasNextPage: true,
      })
    })
  })

  describe("public audio-language admission", () => {
    const base = {
      laneIds: ["kids"] as const,
      duration: "ANY" as const,
      first: 24,
    }
    const manifestWith = (
      audioLanguageSlugs: string[],
    ): WatchRouteManifest => ({
      version: "test",
      generatedAt: "2026-10-17T00:00:00.000Z",
      contentSlugs: [],
      oneSegmentSlugs: [],
      episodePairsByParent: {},
      audioLanguageSlugs,
    })
    let manifestSource: ReturnType<
      typeof vi.fn<() => Promise<WatchRouteManifest | null>>
    >
    let restoreManifest: () => void

    beforeEach(() => {
      manifestSource = vi.fn(async () => null)
      restoreManifest = setWatchRouteManifestSourceForTest(manifestSource)
      query.mockResolvedValue({
        data: {
          watchFilmFinder: { cards: [], hasNextPage: false, endCursor: null },
        },
      })
    })
    afterEach(() => restoreManifest())

    it("rejects every unknown audio language before the cache or Admin, however many distinct slugs are tried", async () => {
      for (let i = 0; i < 50; i++) {
        await expect(
          getWatchFilmFinder({ ...base, languageSlug: `unknown-${i}` }),
        ).rejects.toBeInstanceOf(WatchFilmFinderInputError)
      }
      // Rejected slugs never reach the shared fill, so they can neither cost an
      // Admin lookup nor retain a Data Cache entry.
      expect(query).not.toHaveBeenCalled()
      expect(cache.size).toBe(0)
    })

    it("admits a compiled-corpus language without consulting the live manifest", async () => {
      await getWatchFilmFinder({ ...base, languageSlug: "english" })
      await getWatchFilmFinder({
        ...base,
        languageSlug: "spanish-latin-american",
      })
      expect(manifestSource).not.toHaveBeenCalled()
      expect(query).toHaveBeenCalledTimes(2)
    })

    it("admits a language the live manifest published after the corpus was built, and nothing else", async () => {
      manifestSource.mockResolvedValue(manifestWith(["freshly-published"]))
      await getWatchFilmFinder({ ...base, languageSlug: "freshly-published" })
      expect(query).toHaveBeenCalledTimes(1)
      await expect(
        getWatchFilmFinder({ ...base, languageSlug: "still-unknown" }),
      ).rejects.toBeInstanceOf(WatchFilmFinderInputError)
      expect(query).toHaveBeenCalledTimes(1)
    })

    it("degrades to the corpus when the manifest is down: unknown stays rejected as bad input, never a manifest error", async () => {
      manifestSource.mockRejectedValue(new Error("manifest outage"))
      await expect(
        getWatchFilmFinder({ ...base, languageSlug: "unknown-slug" }),
      ).rejects.toBeInstanceOf(WatchFilmFinderInputError)
      await expect(
        getWatchFilmFinder({ ...base, languageSlug: "english" }),
      ).resolves.toMatchObject({ cards: [] })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it("applies the slug shape test to a manifest entry before it can become a cache key", async () => {
      manifestSource.mockResolvedValue(manifestWith(["Not_Shaped/../x"]))
      await expect(
        getWatchFilmFinder({ ...base, languageSlug: "Not_Shaped/../x" }),
      ).rejects.toBeInstanceOf(WatchFilmFinderInputError)
      expect(query).not.toHaveBeenCalled()
      expect(cache.size).toBe(0)
    })
  })

  it("preserves an empty inventory but propagates Admin failures instead of reporting no matches", async () => {
    const input = {
      laneIds: ["kids"] as const,
      languageSlug: "english",
      duration: "ANY" as const,
      first: 24,
    }
    query.mockResolvedValueOnce({
      data: {
        watchFilmFinder: { cards: [], hasNextPage: false, endCursor: null },
      },
    })
    await expect(getWatchFilmFinder(input)).resolves.toMatchObject({
      cards: [],
      hasNextPage: false,
    })
    // Each outcome is its own fill; the empty page above is a cached success.
    cache.clear()
    query.mockRejectedValueOnce(new Error("Admin timeout"))
    await expect(getWatchFilmFinder(input)).rejects.toThrow("Admin timeout")
    query.mockResolvedValueOnce({ data: undefined })
    await expect(getWatchFilmFinder(input)).rejects.toThrow()
  })
})

describe("bounded finder input", () => {
  it("keeps requested lane order, collapses duplicates, and carries cursor and audio without locale substitution", () => {
    expect(
      parseWatchFilmFinderParams(
        new URLSearchParams(
          "laneIds=kids&laneIds=conversation&laneIds=kids&languageSlug=spanish-latin-american&duration=MEDIUM&first=3&after=v1%3A3",
        ),
      ),
    ).toEqual({
      laneIds: ["kids", "conversation"],
      languageSlug: "spanish-latin-american",
      duration: "MEDIUM",
      first: 3,
      after: "v1:3",
    })
  })

  it.each([
    "languageSlug=english",
    "laneIds=untrusted&languageSlug=english",
    "laneIds=kids&languageSlug=../english",
    "laneIds=kids&languageSlug=english&languageSlug=french",
    "laneIds=kids&languageSlug=english&duration=pretend",
    "laneIds=kids&languageSlug=english&first=25",
    "laneIds=kids&languageSlug=english&first=1.5",
    "laneIds=kids&languageSlug=english&first=0",
    "laneIds=kids&languageSlug=english&after=v1:513",
    "laneIds=kids&languageSlug=english&collectionSlug=private",
    `${"laneIds=kids&".repeat(9)}languageSlug=english`,
  ])("rejects invalid or unbounded input %s", (params) => {
    expect(() =>
      parseWatchFilmFinderParams(new URLSearchParams(params)),
    ).toThrow()
  })
})
