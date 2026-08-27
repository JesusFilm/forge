/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { createSignature, edgeHeaders, getPage, verifySignature } = vi.hoisted(
  () => ({
    createSignature: vi.fn(),
    edgeHeaders: vi.fn(),
    getPage: vi.fn(),
    verifySignature: vi.fn(),
  }),
)

vi.mock("@/lib/dynamic-collection-feed", () => ({
  getDynamicCollectionFeedPage: getPage,
}))
vi.mock("@/lib/cloudflare-cache", () => ({
  dynamicCollectionEdgeCacheHeaders: edgeHeaders,
}))
vi.mock("@/lib/dynamic-collection-cache-signature", () => ({
  createDynamicCollectionFeedCacheSignature: createSignature,
  isDynamicCollectionFeedCacheSignatureValid: verifySignature,
}))

import { GET } from "./route"

const emptyPage = {
  sections: [],
  endCursor: null,
  hasNextPage: false,
}
const cacheSignature = "a".repeat(43)

function request(query: string) {
  return new Request(
    `https://www.jesusfilm.org/api/dynamic-collections?${query}`,
  )
}

describe("GET /watch/api/dynamic-collections", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getPage.mockReset()
    getPage.mockResolvedValue(emptyPage)
    edgeHeaders.mockReset()
    edgeHeaders.mockReturnValue({})
    verifySignature.mockReset()
    verifySignature.mockReturnValue(false)
    createSignature.mockReset()
    createSignature.mockReturnValue("n".repeat(43))
  })

  it("normalizes a bounded live GET and returns a browser no-store DTO", async () => {
    getPage.mockResolvedValue({
      sections: [
        {
          id: "collection-1",
          slug: "collection-one",
          title: "Collection One",
          description: null,
          items: [],
        },
      ],
      endCursor: "collection-1",
      hasNextPage: true,
    })

    const response = await GET(
      request(
        "locale=en&languageSlug=english&first=3&cardsPerParent=12&excludedIds=z&excludedIds=a&excludedIds=a&excludedSlugs=featured",
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(getPage).toHaveBeenCalledWith(
      {
        locale: "en",
        languageSlug: "english",
        cacheScope: "live",
        cacheSignature: null,
        first: 3,
        cardsPerParent: 12,
        after: null,
        excludedIds: ["a", "z"],
        excludedSlugs: ["featured"],
      },
      { sharedCache: false },
    )
    expect(edgeHeaders).toHaveBeenCalledWith("live", false)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ endCursor: "collection-1", hasNextPage: true }),
    )
  })

  it("adds shared Cloudflare headers only to successful configured live responses", async () => {
    verifySignature.mockReturnValue(true)
    edgeHeaders.mockReturnValue({
      "Cloudflare-CDN-Cache-Control":
        "public, max-age=21600, stale-while-revalidate=86400",
      "Cache-Tag": "watch-dynamic-collections",
    })

    const response = await GET(
      request(
        `locale=en&languageSlug=english&first=3&cardsPerParent=12&cacheSignature=${cacheSignature}`,
      ),
    )

    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe(
      "public, max-age=21600, stale-while-revalidate=86400",
    )
    expect(response.headers.get("cache-tag")).toBe("watch-dynamic-collections")
    expect(getPage).toHaveBeenCalledWith(
      expect.objectContaining({ cacheSignature }),
      { sharedCache: true },
    )
    expect(edgeHeaders).toHaveBeenCalledWith("live", true)
  })

  it("does not admit unsigned, invalid, or noncanonical URLs to shared edge variants", async () => {
    const unsigned = await GET(
      request("locale=en&languageSlug=english&first=3&cardsPerParent=12"),
    )
    expect(unsigned.status).toBe(200)
    expect(getPage).toHaveBeenLastCalledWith(expect.any(Object), {
      sharedCache: false,
    })
    expect(edgeHeaders).toHaveBeenLastCalledWith("live", false)

    verifySignature.mockReturnValue(true)
    const reordered = await GET(
      request(
        `cacheSignature=${cacheSignature}&locale=en&languageSlug=english&first=3&cardsPerParent=12`,
      ),
    )
    expect(reordered.status).toBe(200)
    expect(getPage).toHaveBeenLastCalledWith(expect.any(Object), {
      sharedCache: true,
    })
    expect(edgeHeaders).toHaveBeenLastCalledWith("live", false)

    const explicitLive = await GET(
      request(
        `locale=en&languageSlug=english&first=3&cardsPerParent=12&scope=live&cacheSignature=${cacheSignature}`,
      ),
    )
    expect(explicitLive.status).toBe(200)
    expect(edgeHeaders).toHaveBeenLastCalledWith("live", false)

    const alternateEncoding = await GET(
      request(
        `locale=%65n&languageSlug=english&first=3&cardsPerParent=12&cacheSignature=${cacheSignature}`,
      ),
    )
    expect(alternateEncoding.status).toBe(200)
    expect(edgeHeaders).toHaveBeenLastCalledWith("live", false)
  })

  it("returns the next signed cursor outside the strict JSON DTO", async () => {
    verifySignature.mockReturnValue(true)
    getPage.mockResolvedValue({
      sections: [],
      endCursor: "collection-1",
      hasNextPage: true,
    })

    const response = await GET(
      request(
        `locale=en&languageSlug=english&first=3&cardsPerParent=12&cacheSignature=${cacheSignature}`,
      ),
    )

    expect(response.headers.get("x-watch-collection-next-signature")).toBe(
      "n".repeat(43),
    )
    expect(createSignature).toHaveBeenCalledWith(
      expect.objectContaining({ after: "collection-1" }),
    )
    await expect(response.json()).resolves.toEqual({
      sections: [],
      endCursor: "collection-1",
      hasNextPage: true,
    })
  })

  it("keeps preview responses out of shared edge caching", async () => {
    verifySignature.mockReturnValue(true)
    const response = await GET(
      request(
        `locale=en&languageSlug=english&first=3&cardsPerParent=12&scope=preview&cacheSignature=${cacheSignature}`,
      ),
    )

    expect(getPage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ cacheScope: "preview" }),
    )
    expect(edgeHeaders).toHaveBeenCalledWith("preview", true)
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull()
    expect(response.headers.get("cache-tag")).toBeNull()
  })

  it.each([
    ["missing locale", "languageSlug=english&first=3&cardsPerParent=12"],
    [
      "unknown locale",
      "locale=xx&languageSlug=english&first=3&cardsPerParent=12",
    ],
    [
      "non-public language",
      "locale=en&languageSlug=en&first=3&cardsPerParent=12",
    ],
    [
      "malformed cursor",
      "locale=en&languageSlug=english&first=3&cardsPerParent=12&after=bad%20cursor",
    ],
    [
      "invalid tuple",
      "locale=en&languageSlug=english&first=2&cardsPerParent=12",
    ],
    [
      "unknown parameter",
      "locale=en&languageSlug=english&first=3&cardsPerParent=12&extra=1",
    ],
    [
      "unknown cache scope",
      "locale=en&languageSlug=english&scope=private&first=3&cardsPerParent=12",
    ],
    [
      "repeated cache scope",
      "locale=en&languageSlug=english&scope=live&scope=preview&first=3&cardsPerParent=12",
    ],
    [
      "malformed cache signature",
      "locale=en&languageSlug=english&first=3&cardsPerParent=12&cacheSignature=short",
    ],
    [
      "repeated cache signature",
      `locale=en&languageSlug=english&first=3&cardsPerParent=12&cacheSignature=${cacheSignature}&cacheSignature=${cacheSignature}`,
    ],
  ])("rejects %s without calling Admin", async (_name, query) => {
    const response = await GET(request(query))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid collection feed request.",
    })
    expect(getPage).not.toHaveBeenCalled()
  })

  it("rejects exclusion overflow and URLs of 8 KB or more", async () => {
    const exclusions = Array.from(
      { length: 201 },
      (_, index) => `excludedIds=id-${index}`,
    ).join("&")
    expect(
      (
        await GET(
          request(
            `locale=en&languageSlug=english&first=3&cardsPerParent=12&${exclusions}`,
          ),
        )
      ).status,
    ).toBe(400)

    const oversized = `locale=en&languageSlug=english&first=3&cardsPerParent=12&excludedIds=${"a".repeat(8_192)}`
    expect((await GET(request(oversized))).status).toBe(400)
    expect(getPage).not.toHaveBeenCalled()
  })

  it("returns a fixed 503 for Admin and response-shape failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    edgeHeaders.mockReturnValue({
      "Cloudflare-CDN-Cache-Control": "public, max-age=21600",
      "Cache-Tag": "watch-dynamic-collections",
    })
    getPage.mockRejectedValueOnce(new Error("Bearer secret-internal"))

    const failed = await GET(
      request("locale=en&languageSlug=english&first=2&cardsPerParent=8"),
    )
    expect(failed.status).toBe(503)
    await expect(failed.json()).resolves.toEqual({
      error: "Collections are temporarily unavailable.",
    })
    expect(failed.headers.get("cloudflare-cdn-cache-control")).toBeNull()
    expect(failed.headers.get("cache-tag")).toBeNull()

    getPage.mockResolvedValueOnce({ sections: "invalid" })
    const malformed = await GET(
      request("locale=en&languageSlug=english&first=2&cardsPerParent=8"),
    )
    expect(malformed.status).toBe(503)
    expect(consoleError).toHaveBeenCalledTimes(2)
    expect(edgeHeaders).not.toHaveBeenCalled()
  })

  it("preserves upstream 429 and bounds Retry-After", async () => {
    edgeHeaders.mockReturnValue({
      "Cloudflare-CDN-Cache-Control": "public, max-age=21600",
      "Cache-Tag": "watch-dynamic-collections",
    })
    getPage.mockRejectedValue({
      statusCode: 429,
      response: {
        status: 429,
        headers: new Headers({ "retry-after": "9999" }),
      },
    })

    const response = await GET(
      request("locale=en&languageSlug=english&first=3&cardsPerParent=12"),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("300")
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull()
    expect(response.headers.get("cache-tag")).toBeNull()
    expect(edgeHeaders).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: "Too many collection feed requests.",
    })
  })
})
