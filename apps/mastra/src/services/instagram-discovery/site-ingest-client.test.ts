import { describe, expect, it, vi } from "vitest"

import { submitPostsToSite } from "./site-ingest-client"
import type { InstagramPost } from "./types"

function post(overrides: Partial<InstagramPost> = {}): InstagramPost {
  return {
    url: "https://www.instagram.com/reel/ABC123/",
    shortcode: "ABC123",
    mediaType: "reel",
    authorHandle: "faith.reels",
    authorName: "Faith Reels",
    caption: "AI film of Jesus",
    hashtags: ["#aiart"],
    publishedAt: null,
    thumbnailUrl: "https://img.example/t.jpg",
    matchedAi: ["ai"],
    matchedChristian: ["jesus"],
    ...overrides,
  }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

const CONFIG = {
  url: "https://site.test/api/inspiration-candidates",
  token: "tok",
}

describe("submitPostsToSite", () => {
  it("posts the mapped payload and returns the counts", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse({ ok: true, inserted: 1, skipped: 0 }),
    )
    const result = await submitPostsToSite([post()], {
      ...CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: true, inserted: 1, skipped: 0 })

    const init = fetchImpl.mock.calls[0]![1]!
    const body = JSON.parse(String(init.body))
    expect(body.posts[0]).toMatchObject({
      shortcode: "ABC123",
      author: "faith.reels",
      thumbnailUrl: "https://img.example/t.jpg",
    })
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer tok")
  })

  it("throws config_missing when url or token absent before fetch", async () => {
    const fetchImpl = vi.fn()
    await expect(
      submitPostsToSite([post()], {
        url: "",
        token: "tok",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "config_missing" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("throws config_missing for non-HTTPS URLs before fetch", async () => {
    const fetchImpl = vi.fn()
    await expect(
      submitPostsToSite([post()], {
        url: "http://site.test/api/inspiration-candidates",
        token: "tok",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "config_missing" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("returns zero counts and skips fetch for empty posts", async () => {
    const fetchImpl = vi.fn()
    const result = await submitPostsToSite([], {
      ...CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: true, inserted: 0, skipped: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps 401 to auth_failed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 401 }))
    await expect(
      submitPostsToSite([post()], {
        ...CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "auth_failed" })
  })

  it("maps 500 to retryable upstream_failed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 500 }))
    await expect(
      submitPostsToSite([post()], {
        ...CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "upstream_failed", retryable: true })
  })
})
