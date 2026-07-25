import { describe, expect, it, vi } from "vitest"

import {
  PinterestSearchError,
  boardFeedUrl,
  boardNameFromUrl,
  fetchBoardFeed,
  _internals,
} from "./pinterest-search-client"

const RSS = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>
  <title>Jesus AI</title>
  <item><title>AI film of Jesus</title><link>https://www.pinterest.com/pin/1/</link>
    <pubDate>Sat, 28 Dec 2024 17:35:04 GMT</pubDate>
    <description>&lt;img src=&quot;https://i.pinimg.com/a.jpg&quot;&gt;</description></item>
  <item><title>Another pin</title><link>https://www.pinterest.com/pin/2/</link>
    <pubDate>Sun, 29 Dec 2024 10:00:00 GMT</pubDate><description>x</description></item>
</channel></rss>`

function rssResponse(body = RSS, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/rss+xml" },
    ...init,
  })
}

describe("boardFeedUrl / boardNameFromUrl", () => {
  it("appends .rss and trims trailing slash", () => {
    expect(boardFeedUrl("https://www.pinterest.com/u/board/")).toBe(
      "https://www.pinterest.com/u/board.rss",
    )
  })
  it("strips query parameters before constructing the feed URL", () => {
    expect(boardFeedUrl("https://www.pinterest.com/u/board/?ref=feed")).toBe(
      "https://www.pinterest.com/u/board.rss",
    )
  })
  it("derives a board name from the url", () => {
    expect(
      boardNameFromUrl("https://in.pinterest.com/Learnolgy/jesus-ai/"),
    ).toBe("Learnolgy/jesus-ai")
  })
})

describe("parseRssItems", () => {
  it("splits items and extracts fields", () => {
    const items = _internals.parseRssItems(RSS)
    expect(items).toHaveLength(2)
    expect(items[0]!.link).toBe("https://www.pinterest.com/pin/1/")
    expect(items[0]!.title).toBe("AI film of Jesus")
  })
})

describe("fetchBoardFeed", () => {
  it("returns raw items tagged with board name/url", async () => {
    const fetchImpl = vi.fn(async (..._a: Parameters<typeof fetch>) =>
      rssResponse(),
    )
    const items = await fetchBoardFeed(
      "https://in.pinterest.com/Learnolgy/jesus-ai/",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(items).toHaveLength(2)
    expect(items[0]!.boardName).toBe("Learnolgy/jesus-ai")
    expect(new URL(String(fetchImpl.mock.calls[0]![0])).pathname).toMatch(
      /\.rss$/,
    )
  })

  it("maps 404 to not_found (private/missing board)", async () => {
    const fetchImpl = vi.fn(async () => rssResponse("", { status: 404 }))
    await expect(
      fetchBoardFeed("https://www.pinterest.com/u/b/", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
  })

  it("rejects non-Pinterest or non-HTTPS board URLs before fetching", async () => {
    const fetchImpl = vi.fn()
    await expect(
      fetchBoardFeed("https://example.com/u/board/", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" })
    await expect(
      fetchBoardFeed("http://www.pinterest.com/u/board/", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps non-RSS body to invalid_response", async () => {
    const fetchImpl = vi.fn(async () => rssResponse("<html>nope</html>"))
    await expect(
      fetchBoardFeed("https://www.pinterest.com/u/b/", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" })
  })

  it("retries a 500 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(rssResponse("", { status: 503 }))
      .mockResolvedValueOnce(rssResponse())
    const items = await fetchBoardFeed("https://www.pinterest.com/u/b/", {
      maxAttempts: 2,
      sleep: async () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(items).toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("carries a PinterestSearchError code + retryable flag", () => {
    const err = new PinterestSearchError("upstream_failed", "x", true)
    expect(err.code).toBe("upstream_failed")
    expect(err.retryable).toBe(true)
  })
})
