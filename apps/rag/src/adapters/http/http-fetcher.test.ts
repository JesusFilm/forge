import { afterEach, describe, expect, it, vi } from "vitest"

import { HttpFetcher } from "./http-fetcher.js"

afterEach(() => vi.unstubAllGlobals())

describe("HttpFetcher", () => {
  it("forwards cache validators and maps a 304 without reading a body", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(null, { status: 304, headers: { etag: '"v2"' } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      new HttpFetcher({ userAgent: "forge-test" }).fetch(
        "https://example.test",
        {
          ifNoneMatch: '"v2"',
          ifModifiedSince: "Wed, 21 Oct 2026 07:28:00 GMT",
        },
      ),
    ).resolves.toEqual({
      status: 304,
      body: null,
      etag: '"v2"',
      lastModified: null,
      notModified: true,
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.redirect).toBe("follow")
    expect(init.headers).toMatchObject({
      "user-agent": "forge-test",
      "if-none-match": '"v2"',
      "if-modified-since": "Wed, 21 Oct 2026 07:28:00 GMT",
    })
  })

  it("maps a successful response and its cache metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>article</html>", {
            status: 200,
            headers: { "last-modified": "today" },
          }),
      ),
    )
    await expect(
      new HttpFetcher().fetch("https://example.test"),
    ).resolves.toEqual({
      status: 200,
      body: "<html>article</html>",
      etag: null,
      lastModified: "today",
      notModified: false,
    })
  })
})
