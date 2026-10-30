/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { query, audienceEnabled } = vi.hoisted(() => ({
  query: vi.fn(),
  audienceEnabled: vi.fn(),
}))
vi.mock("@/lib/admin-client", () => ({ default: { query } }))
vi.mock("@/lib/feature-flags", () => ({
  isWatchAudienceEnabled: audienceEnabled,
}))
// The adapter's shared cache is covered in watch-film-finder.test.ts; here it
// is a pass-through so route tests observe every Admin call.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: never[]) => unknown) => fn,
}))

import {
  WATCH_FILM_FINDER_CLIENT_LIMIT,
  WATCH_FILM_FINDER_CLIENT_WINDOW_MS,
} from "@/lib/watch-film-finder"
import { GET } from "./route"

const url =
  "http://watch.test/watch/api/film-finder?laneIds=kids&languageSlug=spanish-latin-american"

// Same key order as WatchFindFlow's request (audio, duration, first, lanes).
const canonicalUrl =
  "http://watch.test/watch/api/film-finder?languageSlug=spanish-latin-american&duration=ANY&first=24&laneIds=kids&laneIds=conversation"

beforeEach(() => {
  query.mockReset()
  vi.restoreAllMocks()
  audienceEnabled.mockReset()
  audienceEnabled.mockResolvedValue(true)
})

describe("GET /watch/api/film-finder", () => {
  it("returns uncached exact-audio cards without Admin credentials or download URLs", async () => {
    query.mockResolvedValue({
      data: {
        watchFilmFinder: {
          cards: [
            {
              laneId: "KIDS",
              videoId: "video",
              videoDubId: "dub",
              slug: "live-film",
              title: "Película",
              durationSeconds: 101,
              imageUrl: null,
              muxPlaybackId: null,
              hls: "https://private.test/stream",
              downloads: ["https://private.test/file"],
              bearer: "SECRET",
            },
          ],
          hasNextPage: false,
          endCursor: null,
        },
      },
    })
    const response = await GET(new Request(url))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    const body = await response.json()
    expect(body.cards[0]).toMatchObject({
      title: "Película",
      href: "/live-film.html/spanish-latin-american.html",
    })
    expect(JSON.stringify(body)).not.toMatch(
      /SECRET|private\.test|hls|downloads|bearer/,
    )
  })

  it("rejects malformed params before any upstream work", async () => {
    const response = await GET(new Request(`${url}&first=999`))
    expect(response.status).toBe(400)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(query).not.toHaveBeenCalled()
  })

  it("returns empty supply as success and upstream failure as a safe retryable 503", async () => {
    query.mockResolvedValueOnce({
      data: {
        watchFilmFinder: { cards: [], hasNextPage: false, endCursor: null },
      },
    })
    const empty = await GET(new Request(url))
    expect(empty.status).toBe(200)
    expect(await empty.json()).toMatchObject({ cards: [] })
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    query.mockRejectedValueOnce(new Error("Authorization: Bearer SECRET"))
    const failed = await GET(new Request(url))
    expect(failed.status).toBe(503)
    expect(failed.headers.get("cache-control")).toContain("no-store")
    expect(await failed.json()).toEqual({
      error: "Films are temporarily unavailable. Please try again.",
    })
    expect(console.error).toHaveBeenCalledWith(
      "[watch] event=film_finder.fetch.failed",
    )
  })

  it.each([
    ["valid", url],
    ["malformed", `${url}&first=999`],
  ])(
    "is a no-store 404 for %s requests while the audience flag is off, before any validation or Admin work",
    async (_name, requestUrl) => {
      audienceEnabled.mockResolvedValue(false)
      const response = await GET(new Request(requestUrl))
      expect(response.status).toBe(404)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(await response.json()).toEqual({ error: "Not found" })
      expect(query).not.toHaveBeenCalled()
    },
  )

  it("fails closed to 404 when the flag client throws", async () => {
    audienceEnabled.mockRejectedValue(new Error("flag provider down"))
    const response = await GET(new Request(url))
    expect(response.status).toBe(404)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(query).not.toHaveBeenCalled()
  })

  it("keeps a successful canonical-URL page private/no-store without cookies, and a later flag-off request is still a 404", async () => {
    query.mockResolvedValue({
      data: {
        watchFilmFinder: { cards: [], hasNextPage: false, endCursor: null },
      },
    })
    const enabled = await GET(new Request(canonicalUrl))
    expect(enabled.status).toBe(200)
    expect(enabled.headers.get("cache-control")).toBe("private, no-store")
    expect(enabled.headers.get("set-cookie")).toBeNull()
    audienceEnabled.mockResolvedValue(false)
    const disabled = await GET(new Request(canonicalUrl))
    expect(disabled.status).toBe(404)
    expect(disabled.headers.get("cache-control")).toBe("private, no-store")
    expect(query).toHaveBeenCalledTimes(1)
  })
})

describe("GET /watch/api/film-finder admission", () => {
  const emptyPage = {
    data: {
      watchFilmFinder: { cards: [], hasNextPage: false, endCursor: null },
    },
  }
  // Each case owns its client address: the limiter is module state.
  const as = (ip: string, requestUrl = url, extra: HeadersInit = {}) =>
    new Request(requestUrl, {
      headers: { "cf-connecting-ip": ip, ...extra },
    })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("refuses a client's burst with a private/no-store 429 and Retry-After before any parsing or Admin work, leaving other clients unaffected", async () => {
    query.mockResolvedValue(emptyPage)
    for (let i = 0; i < WATCH_FILM_FINDER_CLIENT_LIMIT; i++) {
      expect((await GET(as("203.0.113.10"))).status).toBe(200)
    }
    expect(query).toHaveBeenCalledTimes(WATCH_FILM_FINDER_CLIENT_LIMIT)

    const limited = await GET(as("203.0.113.10"))
    expect(limited.status).toBe(429)
    expect(limited.headers.get("cache-control")).toBe("private, no-store")
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
    expect(await limited.json()).toEqual({
      error: "Too many requests. Please try again shortly.",
    })
    // A malformed request from the same client is throttled too: admission
    // runs before validation so junk cannot bypass the bucket.
    expect((await GET(as("203.0.113.10", `${url}&first=999`))).status).toBe(429)
    expect(query).toHaveBeenCalledTimes(WATCH_FILM_FINDER_CLIENT_LIMIT)

    expect((await GET(as("203.0.113.11"))).status).toBe(200)
  })

  it("counts rejected input against the budget, so a malformed flood cannot probe for free", async () => {
    query.mockResolvedValue(emptyPage)
    for (let i = 0; i < WATCH_FILM_FINDER_CLIENT_LIMIT; i++) {
      expect((await GET(as("203.0.113.20", `${url}&first=999`))).status).toBe(
        400,
      )
    }
    expect((await GET(as("203.0.113.20"))).status).toBe(429)
    expect(query).not.toHaveBeenCalled()
  })

  it("keys on the trusted Cloudflare address: rotating x-forwarded-for does not mint a fresh budget", async () => {
    query.mockResolvedValue(emptyPage)
    for (let i = 0; i < WATCH_FILM_FINDER_CLIENT_LIMIT; i++) {
      await GET(
        as("203.0.113.30", url, { "x-forwarded-for": `198.51.100.${i}` }),
      )
    }
    const spoofed = await GET(
      as("203.0.113.30", url, { "x-forwarded-for": "198.51.100.250" }),
    )
    expect(spoofed.status).toBe(429)
  })

  it("does not spend the budget while the audience flag is off", async () => {
    query.mockResolvedValue(emptyPage)
    audienceEnabled.mockResolvedValue(false)
    for (let i = 0; i < WATCH_FILM_FINDER_CLIENT_LIMIT + 5; i++) {
      expect((await GET(as("203.0.113.40"))).status).toBe(404)
    }
    audienceEnabled.mockResolvedValue(true)
    expect((await GET(as("203.0.113.40"))).status).toBe(200)
  })

  it("admits the client again once its window has expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    query.mockResolvedValue(emptyPage)
    for (let i = 0; i < WATCH_FILM_FINDER_CLIENT_LIMIT; i++) {
      await GET(as("203.0.113.50"))
    }
    expect((await GET(as("203.0.113.50"))).status).toBe(429)
    vi.advanceTimersByTime(WATCH_FILM_FINDER_CLIENT_WINDOW_MS)
    expect((await GET(as("203.0.113.50"))).status).toBe(200)
  })

  it("answers any unknown audio language with a private/no-store 400 and never reaches Admin", async () => {
    query.mockResolvedValue(emptyPage)
    for (let i = 0; i < 10; i++) {
      const response = await GET(
        as(
          "203.0.113.60",
          url.replace("spanish-latin-american", `unknown-${i}`),
        ),
      )
      expect(response.status).toBe(400)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
    }
    expect(query).not.toHaveBeenCalled()
  })
})
