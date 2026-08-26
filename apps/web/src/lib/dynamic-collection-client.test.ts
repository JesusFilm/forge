/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DynamicCollectionFeedRequestError,
  DynamicCollectionFeedValidationError,
  type DynamicCollectionFeedInput,
} from "./dynamic-collection-contract"
import { loadDynamicCollectionFeedPage } from "./dynamic-collection-client"

const validPage = {
  sections: [],
  endCursor: null,
  hasNextPage: false,
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("loadDynamicCollectionFeedPage", () => {
  it("issues a same-origin no-store GET with normalized inputs", async () => {
    const nextCacheSignature = "n".repeat(43)
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(validPage, {
        headers: {
          "X-Watch-Collection-Next-Signature": nextCacheSignature,
        },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      loadDynamicCollectionFeedPage({
        locale: "en",
        languageSlug: "english",
        first: 2,
        cardsPerParent: 8,
        after: "cursor-1",
        excludedIds: ["z", "a", "a"],
        excludedSlugs: ["featured"],
        cacheSignature: "a".repeat(43),
      }),
    ).resolves.toEqual({ ...validPage, nextCacheSignature })

    const [href, init] = fetchMock.mock.calls[0] ?? []
    expect(href).toMatch(/^\/watch\/api\/dynamic-collections\?/)
    expect(new URLSearchParams(String(href).split("?")[1])).toEqual(
      new URLSearchParams([
        ["locale", "en"],
        ["languageSlug", "english"],
        ["first", "2"],
        ["cardsPerParent", "8"],
        ["after", "cursor-1"],
        ["excludedIds", "a"],
        ["excludedIds", "z"],
        ["excludedSlugs", "featured"],
        ["cacheSignature", "a".repeat(43)],
      ]),
    )
    expect(init).toEqual(
      expect.objectContaining({
        cache: "no-store",
        headers: { accept: "application/json" },
        method: "GET",
      }),
    )
  })

  it("serializes preview scope exactly once", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(validPage))
    vi.stubGlobal("fetch", fetchMock)

    await loadDynamicCollectionFeedPage({
      locale: "en",
      languageSlug: "english",
      cacheScope: "preview",
      first: 3,
      cardsPerParent: 12,
    })

    const [href] = fetchMock.mock.calls[0] ?? []
    expect(
      new URL(String(href), "https://example.test").searchParams.getAll(
        "scope",
      ),
    ).toEqual(["preview"])
  })

  it("rejects invalid input before fetch and enforces the URL budget", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      loadDynamicCollectionFeedPage({
        locale: "en",
        languageSlug: "english",
        first: 2,
        cardsPerParent: 12,
      } as unknown as DynamicCollectionFeedInput),
    ).rejects.toThrow("Invalid collection feed request")

    await expect(
      loadDynamicCollectionFeedPage({
        locale: "en",
        languageSlug: "english",
        first: 3,
        cardsPerParent: 12,
        excludedIds: Array.from(
          { length: 50 },
          (_, index) => `${index}-${"a".repeat(190)}`,
        ),
      }),
    ).rejects.toThrow("too large")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects HTTP, JSON, and strict response-shape failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: "safe" }, { status: 503 }))
      .mockResolvedValueOnce(new Response("not json"))
      .mockResolvedValueOnce(
        Response.json({ ...validPage, credential: "must-not-pass" }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const input = {
      locale: "en",
      languageSlug: "english",
      first: 3 as const,
      cardsPerParent: 12 as const,
    }

    await expect(loadDynamicCollectionFeedPage(input)).rejects.toThrow(
      "request failed",
    )
    await expect(loadDynamicCollectionFeedPage(input)).rejects.toThrow(
      "Invalid collection feed response",
    )
    await expect(loadDynamicCollectionFeedPage(input)).rejects.toThrow(
      "Invalid collection feed response",
    )
  })

  it("preserves a bounded rate-limit retry window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json(
          { error: "safe" },
          { status: 429, headers: { "retry-after": "9999" } },
        ),
      ),
    )

    const error = await loadDynamicCollectionFeedPage({
      locale: "en",
      languageSlug: "english",
      first: 2,
      cardsPerParent: 8,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DynamicCollectionFeedRequestError)
    expect(error).toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 300,
    })
  })

  it("aborts a hung request after the bounded timeout", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            )
          }),
      ),
    )

    const request = loadDynamicCollectionFeedPage({
      locale: "en",
      languageSlug: "english",
      first: 2,
      cardsPerParent: 8,
    })
    const rejection = expect(request).rejects.toMatchObject({ code: "timeout" })
    await vi.advanceTimersByTimeAsync(10_000)

    await rejection
  })

  it("uses typed validation failures", async () => {
    vi.stubGlobal("fetch", vi.fn())
    await expect(
      loadDynamicCollectionFeedPage({
        locale: "invalid",
        languageSlug: "english",
        first: 2,
        cardsPerParent: 8,
      }),
    ).rejects.toBeInstanceOf(DynamicCollectionFeedValidationError)

    await expect(
      loadDynamicCollectionFeedPage({
        locale: "en",
        languageSlug: "english",
        cacheScope: "private" as "live",
        first: 2,
        cardsPerParent: 8,
      }),
    ).rejects.toBeInstanceOf(DynamicCollectionFeedValidationError)

    await expect(
      loadDynamicCollectionFeedPage({
        locale: "en",
        languageSlug: "english",
        cacheSignature: "short",
        first: 2,
        cardsPerParent: 8,
      }),
    ).rejects.toBeInstanceOf(DynamicCollectionFeedValidationError)
  })
})
