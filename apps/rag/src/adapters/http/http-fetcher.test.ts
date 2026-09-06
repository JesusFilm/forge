import { afterEach, describe, expect, it, vi } from "vitest"

import { HttpFetcher } from "./http-fetcher.js"

afterEach(() => vi.unstubAllGlobals())

describe("HttpFetcher", () => {
  const publicResolver = async () => [{ address: "203.0.113.10", family: 4 }]

  it("forwards cache validators and maps a 304 without reading a body", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(null, { status: 304, headers: { etag: '"v2"' } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      new HttpFetcher({
        userAgent: "forge-test",
        resolveHost: publicResolver,
      }).fetch("https://example.test", {
        ifNoneMatch: '"v2"',
        ifModifiedSince: "Wed, 21 Oct 2026 07:28:00 GMT",
      }),
    ).resolves.toEqual({
      status: 304,
      body: null,
      etag: '"v2"',
      lastModified: null,
      notModified: true,
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.redirect).toBe("manual")
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
      new HttpFetcher({ resolveHost: publicResolver }).fetch(
        "https://example.test",
      ),
    ).resolves.toEqual({
      status: 200,
      body: "<html>article</html>",
      etag: null,
      lastModified: "today",
      notModified: false,
    })
  })

  it("rejects redirects outside the source destination policy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          }),
      ),
    )
    await expect(
      new HttpFetcher({ resolveHost: publicResolver }).fetch(
        "https://example.test/start",
        undefined,
        {
          expectedHost: "example.test",
          allowPatterns: ["^https://example\\.test/"],
        },
      ),
    ).rejects.toThrow(/outside source policy/)
  })

  it("rejects private resolved addresses", async () => {
    await expect(
      new HttpFetcher({
        resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
      }).fetch("https://example.test"),
    ).rejects.toThrow(/private or reserved address/)
  })
})
