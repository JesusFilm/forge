import { afterEach, describe, expect, it, vi } from "vitest"
import { discoverUrls } from "../../acquisition/discover.js"
import { getSource } from "../../registry/index.js"
import type { CrawlPolicy } from "../../registry/index.js"
import { HttpFetcher } from "./http-fetcher.js"

afterEach(() => vi.unstubAllGlobals())

const publicResolver = async () => [{ address: "203.0.113.10", family: 4 }]
const urlset = (...urls: string[]) =>
  `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`
const sitemapIndex = (...urls: string[]) =>
  `<sitemapindex>${urls.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join("")}</sitemapindex>`

function transport(pages: Record<string, string | Response>) {
  const mock = vi.fn(async (input: URL | string) => {
    const page = pages[String(input)]
    if (page === undefined) throw new Error(`Unexpected fetch: ${input}`)
    return typeof page === "string" ? new Response(page) : page
  })
  vi.stubGlobal("fetch", mock)
  return mock
}

describe("discovery through the HTTP destination guard", () => {
  it.each([
    ["gotquestions", "https://www.gotquestions.org/what-is-prayer.html"],
    [
      "cru",
      "https://www.cru.org/us/en/train-and-grow/spiritual-growth/prayer.html",
    ],
  ])(
    "fetches registered %s sitemaps without admitting excluded articles",
    async (key, article) => {
      const crawl = getSource(key)!.crawl
      const sitemaps = crawl.sitemaps!.map(
        (path) => new URL(path, crawl.baseUrl).href,
      )
      const fetchMock = transport(
        Object.fromEntries(
          sitemaps.map((url) => [
            url,
            urlset(
              article,
              `${crawl.baseUrl}/donate`,
              "https://outside.test/article.html",
            ),
          ]),
        ),
      )

      const result = await discoverUrls(
        { fetcher: new HttpFetcher({ resolveHost: publicResolver }) },
        crawl,
      )

      expect(result.urls).toEqual([article])
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(sitemaps)
    },
  )

  const scoped: CrawlPolicy = {
    ...getSource("gotquestions")!.pathCrawls!["/islenska/"],
    // Use an article-only allow pattern to expose the transport/filter split.
    allow: ["^https://www\\.gotquestions\\.org/islenska/[^/?#]+\\.html$"],
  }
  const root = "https://www.gotquestions.org/islenska/icelandic.xml"

  it("recurses relative children within the registered sitemap directory", async () => {
    const child = "https://www.gotquestions.org/islenska/children/pages"
    const article = "https://www.gotquestions.org/islenska/eilift-lif.html"
    const fetchMock = transport({
      [root]: sitemapIndex("children/pages"),
      [child]: urlset(
        article,
        "https://www.gotquestions.org/islenska/index.html",
        "https://www.gotquestions.org/english.html",
      ),
    })
    const result = await discoverUrls(
      { fetcher: new HttpFetcher({ resolveHost: publicResolver }) },
      scoped,
    )
    expect(result.urls).toEqual([article])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      root,
      child,
    ])
  })

  const outside = [
    "https://outside.test/islenska/child.xml",
    "https://www.gotquestions.org.attacker.test/islenska/child.xml",
    "https://www.gotquestions.org:444/islenska/child.xml",
    "http://www.gotquestions.org/islenska/child.xml",
    "https://www.gotquestions.org/islenska-other/child.xml",
    "../sitemap.xml",
    "%2e%2e/sitemap.xml",
    "https://user:password@www.gotquestions.org/islenska/child.xml",
  ]

  it.each(outside)(
    "does not fetch an out-of-scope child: %s",
    async (child) => {
      const fetchMock = transport({ [root]: sitemapIndex(child) })
      const result = await discoverUrls(
        { fetcher: new HttpFetcher({ resolveHost: publicResolver }) },
        scoped,
      )
      expect(result.sitemapsFetched).toBe(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each(outside)(
    "does not follow an out-of-scope redirect: %s",
    async (location) => {
      const fetchMock = transport({
        [root]: new Response(null, { status: 302, headers: { location } }),
      })
      const progress = vi.fn()
      const result = await discoverUrls(
        { fetcher: new HttpFetcher({ resolveHost: publicResolver }) },
        scoped,
        { onProgress: progress },
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result.urls).toEqual([])
      expect(progress.mock.calls.flat().join("\n")).toMatch(
        /fetch destination refused/,
      )
    },
  )

  it("follows an in-scope redirect and still rejects private DNS results", async () => {
    const child = "https://www.gotquestions.org/islenska/pages.xml"
    const article = "https://www.gotquestions.org/islenska/eilift-lif.html"
    const fetchMock = transport({
      [root]: new Response(null, { status: 302, headers: { location: child } }),
      [child]: urlset(article),
    })
    const result = await discoverUrls(
      { fetcher: new HttpFetcher({ resolveHost: publicResolver }) },
      scoped,
    )
    expect(result.urls).toEqual([article])
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockClear()
    const progress = vi.fn()
    await discoverUrls(
      {
        fetcher: new HttpFetcher({
          resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
        }),
      },
      scoped,
      { onProgress: progress },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(progress.mock.calls.flat().join("\n")).toMatch(
      /private or reserved address/,
    )
  })
})
