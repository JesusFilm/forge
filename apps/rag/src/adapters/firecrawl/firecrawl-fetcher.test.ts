import { afterEach, describe, expect, it, vi } from "vitest"

import { FirecrawlFetcher } from "./firecrawl-fetcher.js"

afterEach(() => vi.unstubAllGlobals())

describe("FirecrawlFetcher", () => {
  it("requests uncached raw HTML and maps the origin status", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              rawHtml: "<html>rendered</html>",
              metadata: {
                statusCode: 200,
                sourceURL: "https://walled.test",
                url: "https://walled.test/final",
              },
            },
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      new FirecrawlFetcher({ apiKey: "fc-test" }).fetch("https://walled.test"),
    ).resolves.toEqual({
      status: 200,
      body: "<html>rendered</html>",
      etag: null,
      lastModified: null,
      notModified: false,
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.firecrawl.dev/v2/scrape",
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({ authorization: "Bearer fc-test" })
    expect(JSON.parse(init.body as string)).toEqual({
      url: "https://walled.test",
      formats: ["rawHtml"],
      maxAge: 0,
      storeInCache: false,
    })
  })

  it("refuses a provider-followed destination outside the source policy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              data: {
                rawHtml: "<html>foreign</html>",
                metadata: {
                  statusCode: 200,
                  sourceURL: "https://walled.test/article",
                  url: "https://foreign.test/article",
                },
              },
            }),
          ),
      ),
    )

    await expect(
      new FirecrawlFetcher({ apiKey: "fc-test" }).fetch(
        "https://walled.test/article",
        undefined,
        { expectedHost: "walled.test", allowPatterns: [] },
      ),
    ).rejects.toMatchObject({ code: "fetch_destination_refused" })
  })

  it("fails closed when Firecrawl does not attest the final URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              data: {
                rawHtml: "<html>unknown destination</html>",
                metadata: { statusCode: 200 },
              },
            }),
          ),
      ),
    )

    await expect(
      new FirecrawlFetcher({ apiKey: "fc-test" }).fetch(
        "https://walled.test/article",
        undefined,
        { expectedHost: "walled.test", allowPatterns: [] },
      ),
    ).rejects.toThrow(/did not attest the final URL/)
  })

  it("throws on provider and payload failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("payment required", { status: 402 })),
    )
    await expect(
      new FirecrawlFetcher({ apiKey: "fc-test" }).fetch("https://walled.test"),
    ).rejects.toThrow(/402/)
  })
})
