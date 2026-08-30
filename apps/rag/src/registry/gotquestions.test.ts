import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"

const source = () => getSource("gotquestions")!

function keeps(url: string): boolean {
  const { allow = [], block = [], articleHints = [] } = source().crawl
  const matches = (patterns: string[]): boolean =>
    patterns.some((pattern) => new RegExp(pattern).test(url))
  if (allow.length > 0 && !matches(allow)) return false
  if (articleHints.length > 0 && !matches(articleHints)) return false
  if (block.length > 0 && matches(block)) return false
  return true
}

describe("GotQuestions registry entry", () => {
  it("registers English on the shared domain through plain HTTP", () => {
    expect(source().domain).toBe("www.gotquestions.org")
    expect(source().languages).toEqual(["en"])
    expect(source().crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(source().crawl.maxPages).toBe(11000)
    expect(resolveFetchStrategy(source())).toBe("plain-http")
  })

  it("keeps flat answer articles", () => {
    expect(keeps("https://www.gotquestions.org/Christian-Platonism.html")).toBe(
      true,
    )
    expect(keeps("https://www.gotquestions.org/what-is-the-gospel.html")).toBe(
      true,
    )
    expect(
      keeps("https://www.gotquestions.org/suicide-Bible-Christian.html"),
    ).toBe(true)
  })

  it("rejects indexes, utilities, feeds, nested translations, and other hosts", () => {
    for (const url of [
      "https://www.gotquestions.org/content_God.html",
      "https://www.gotquestions.org/questions_worldview.html",
      "https://www.gotquestions.org/top20-monthly.html",
      "https://www.gotquestions.org/international.html",
      "https://www.gotquestions.org/privacy.html",
      "https://www.gotquestions.org/contact.html",
      "https://www.gotquestions.org/apply-confirm.html",
      "https://www.gotquestions.org/apps.html",
      "https://www.gotquestions.org/testimonials2.html",
      "https://www.gotquestions.org/gqaudio.xml",
      "https://www.gotquestions.org/Arabic/",
      "https://www.gotquestions.org/Arabic/an-article.html",
      "https://gotquestions.org/Christian-Platonism.html",
    ]) {
      expect(keeps(url), url).toBe(false)
    }
  })

  it("pins extraction to the measured answer body", () => {
    expect(source().crawl.contentSelectors).toEqual([
      '[itemprop="articleBody"]',
    ])
    expect(source().crawl.minContentLength).toBe(250)
  })
})
