import { expect, it } from "vitest"
import { getSource } from "../../registry/index.js"
import { assertAllowedDestinationUrl } from "./destination-policy.js"

it("admits the Icelandic sitemap and articles through the HTTP destination guard", () => {
  const crawl = getSource("gotquestions")!.pathCrawls!["/islenska/"]
  const policy = {
    expectedHost: "www.gotquestions.org",
    allowPatterns: crawl.allow!,
  }
  for (const path of ["/islenska/icelandic.xml", "/islenska/eilift-lif.html"]) {
    const url = `https://www.gotquestions.org${path}`
    expect(assertAllowedDestinationUrl(url, policy).href).toBe(url)
  }
  for (const path of [
    "/sitemap.xml",
    "/english.html",
    "/Arabic/article.html",
    "/islenska-other/article.html",
  ]) {
    expect(() =>
      assertAllowedDestinationUrl(
        `https://www.gotquestions.org${path}`,
        policy,
      ),
    ).toThrow(/outside source policy/)
  }
})
