/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest"

const getPage = vi.hoisted(() => vi.fn())

vi.mock("@/lib/dynamic-collection-feed", () => ({
  getDynamicCollectionFeedPage: getPage,
}))

import { GET } from "./route"

const emptyPage = {
  sections: [],
  endCursor: null,
  hasNextPage: false,
}

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
  })

  it("normalizes a bounded live GET and returns a private no-store DTO", async () => {
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
    expect(response.headers.get("cache-control")).toContain("private")
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(getPage).toHaveBeenCalledWith({
      locale: "en",
      languageSlug: "english",
      cacheScope: "live",
      first: 3,
      cardsPerParent: 12,
      after: null,
      excludedIds: ["a", "z"],
      excludedSlugs: ["featured"],
    })
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ endCursor: "collection-1", hasNextPage: true }),
    )
  })

  it.each([
    ["explicit live", "scope=live", "live"],
    ["preview", "scope=preview", "preview"],
    [
      "forward-compatible cache signature",
      `cacheSignature=${"a".repeat(43)}`,
      "live",
    ],
  ])("accepts %s transport input", async (_name, transport, scope) => {
    const response = await GET(
      request(
        `locale=en&languageSlug=english&first=3&cardsPerParent=12&${transport}`,
      ),
    )

    expect(response.status).toBe(200)
    expect(getPage).toHaveBeenCalledWith(
      expect.objectContaining({ cacheScope: scope }),
    )
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
      `locale=en&languageSlug=english&first=3&cardsPerParent=12&cacheSignature=${"a".repeat(43)}&cacheSignature=${"a".repeat(43)}`,
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
    getPage.mockRejectedValueOnce(new Error("Bearer secret-internal"))

    const failed = await GET(
      request("locale=en&languageSlug=english&first=2&cardsPerParent=8"),
    )
    expect(failed.status).toBe(503)
    await expect(failed.json()).resolves.toEqual({
      error: "Collections are temporarily unavailable.",
    })

    getPage.mockResolvedValueOnce({ sections: "invalid" })
    const malformed = await GET(
      request("locale=en&languageSlug=english&first=2&cardsPerParent=8"),
    )
    expect(malformed.status).toBe(503)
    expect(consoleError).toHaveBeenCalledTimes(2)
  })

  it("preserves upstream 429 and bounds Retry-After", async () => {
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
    await expect(response.json()).resolves.toEqual({
      error: "Too many collection feed requests.",
    })
  })
})
