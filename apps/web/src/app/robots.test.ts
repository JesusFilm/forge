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

  it("sets host to the canonical watch origin + basePath", () => {
    const result = robots()
    expect(result.host).toBe("http://localhost:3000/watch")
  })

  it("emits no sitemap directive yet (sitemap deferred)", () => {
    const result = robots()
    expect(result.sitemap).toBeUndefined()
  })
})
