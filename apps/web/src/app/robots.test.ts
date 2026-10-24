import { describe, expect, it } from "vitest"

import robots from "./robots"

describe("robots", () => {
  it("allows crawling and disallows api / _next subtrees", () => {
    const result = robots()
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules
    expect(rule?.userAgent).toBe("*")
    expect(rule?.allow).toBe("/")
    expect(rule?.disallow).toEqual(["/api/", "/_next/"])
  })

  it("emits no host directive (non-standard Yandex-ism)", () => {
    const result = robots()
    expect(result.host).toBeUndefined()
  })

  it("emits the watch sitemap index URL", () => {
    const result = robots()
    expect(result.sitemap).toBe("https://www.jesusfilm.org/watch/sitemap.xml")
  })
})
