import { describe, expect, it } from "vitest"
import { acquireSource, acquireOne } from "../src/acquisition/index.js"
import { discoverUrls } from "../src/acquisition/discover.js"
import {
  FakeFetcher,
  FakeRawDocumentStore,
  FakeRawDocumentReader,
  FakeEmbedder,
  FakeCorpusWriteStore,
} from "../src/fakes/index.js"
import { ingestPending } from "../src/indexing/index.js"
import { getSource } from "../src/registry/index.js"
import { canonicalPrefix, scopeSource } from "../scripts/lib/path-scope.js"

const source = getSource("gotquestions")!
const scoped = scopeSource(source, "/islenska/")
const origin = "https://www.gotquestions.org"
const sitemap = `${origin}/islenska/icelandic.xml`
const response = (body: string) => ({
  status: 200,
  body,
  etag: null,
  lastModified: null,
  notModified: false,
})
const xml = (urls: string[]) =>
  `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`
const prose =
  "This is a synthetic article explaining faith and hope in God. ".repeat(20)

describe("GotQuestions Icelandic path slice", () => {
  it("keeps English policy intact and rejects undeclared scopes", () => {
    expect(scopeSource(source)).toBe(source)
    expect(source.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(source.crawl.contentSelectors).toEqual(['[itemprop="articleBody"]'])
    expect(scoped.key).toBe("gotquestions")
    expect(scoped.crawl.fetchStrategy).toBe("plain-http")
    expect(canonicalPrefix(source, "/islenska/")).toBe(`${origin}/islenska/`)
    expect(() => scopeSource(source, "/Arabic/")).toThrow(/unregistered path/)
  })

  it("discovers only Icelandic articles through the actual discovery policy", async () => {
    const urls = [
      "/english.html",
      "/islenska/",
      "/islenska/index.html",
      "/islenska/one.html",
      "/islenska-other/two.html",
      "/Arabic/one.html",
      "/islenska/feed.xml",
      "/islenska/one.html?x=y",
    ]
    const fetcher = new FakeFetcher({
      [sitemap]: response(xml(urls.map((path) => origin + path))),
    })
    const result = await discoverUrls({ fetcher }, scoped.crawl)
    expect(result.urls).toEqual([`${origin}/islenska/one.html`])
    expect(result.sitemapsFetched).toBe(1)
  })

  it("checks the full count before capping, resume skipping, or writing", async () => {
    for (const count of [50, 52]) {
      const urls = Array.from(
        { length: count },
        (_, i) => `${origin}/islenska/${i}.html`,
      )
      const fetcher = new FakeFetcher({ [sitemap]: response(xml(urls)) })
      const store = new FakeRawDocumentStore()
      await expect(
        acquireSource({ fetcher, store }, scoped, { resume: true }),
      ).rejects.toThrow(`found ${count}`)
      expect(store.count()).toBe(0)
    }
  })

  it("uses different measured extraction containers for each path", async () => {
    const url = `${origin}/islenska/one.html`
    const html = `<html><body><nav>Outside navigation</nav><main><div class="content">${prose}<div itemprop="articleBody">English answer ${prose}</div></div></main></body></html>`
    const fetcher = new FakeFetcher({ [url]: response(html) })
    const english = await acquireOne(fetcher, source, url)
    const icelandic = await acquireOne(fetcher, scoped, url)
    expect(
      english.ok && english.doc.rawContent.startsWith("English answer"),
    ).toBe(true)
    expect(icelandic.ok && icelandic.doc.rawContent.startsWith("This is")).toBe(
      true,
    )
    expect(
      icelandic.ok && icelandic.doc.rawContent.includes("Outside navigation"),
    ).toBe(false)
  })

  it("filters before limiting and leaves English and other language raws untouched", async () => {
    const paths = [
      "/english.html",
      "/Arabic/article.html",
      "/islenska-other/article.html",
      "/islenska/article.html",
    ]
    const reader = new FakeRawDocumentReader(
      paths.map((path, i) => ({
        id: String(i),
        sourceKey: source.key,
        url: origin + path,
        canonicalUrl: origin + path,
        title: "Fixture",
        rawContent: prose,
        fetch: {
          status: 200,
          bodyHash: "fixture",
          etag: null,
          lastModified: null,
          notModified: false,
          fetchedAt: new Date().toISOString(),
        },
      })),
    )
    const writer = new FakeCorpusWriteStore()
    const result = await ingestPending(
      { reader, writer, embedder: new FakeEmbedder({ dimensions: 16 }) },
      {
        sourceKey: source.key,
        canonicalUrlPrefix: canonicalPrefix(source, "/islenska/"),
        limit: 1,
      },
    )
    expect(result.inserted).toBe(1)
    expect(reader.isIngested("3")).toBe(true)
    expect(["0", "1", "2"].some((id) => reader.isIngested(id))).toBe(false)
    expect(writer.allDocuments()).toHaveLength(1)
  })

  it("fails before writes when the reader violates the path boundary", async () => {
    const reader = new FakeRawDocumentReader([
      {
        id: "en",
        sourceKey: source.key,
        url: `${origin}/english.html`,
        canonicalUrl: `${origin}/english.html`,
        title: "Fixture",
        rawContent: prose,
        fetch: {
          status: 200,
          bodyHash: "x",
          etag: null,
          lastModified: null,
          notModified: false,
          fetchedAt: new Date().toISOString(),
        },
      },
    ])
    const writer = new FakeCorpusWriteStore()
    await expect(
      ingestPending(
        {
          reader: {
            listPending: () => reader.listPending(),
            markIngested: (ids) => reader.markIngested(ids),
          },
          writer,
          embedder: new FakeEmbedder({ dimensions: 16 }),
        },
        {
          sourceKey: source.key,
          canonicalUrlPrefix: canonicalPrefix(source, "/islenska/"),
        },
      ),
    ).rejects.toThrow(/outside the requested scope/)
    expect(writer.allDocuments()).toHaveLength(0)
    expect(reader.ingestedCount()).toBe(0)
  })
})
