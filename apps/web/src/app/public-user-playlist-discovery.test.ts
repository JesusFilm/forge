import { describe, expect, it } from "vitest"

import robots from "./robots"
import { renderWatchSitemapIndex } from "@/lib/watch-sitemap"
import type { WatchSeoManifest } from "@/lib/watch-seo-manifest"

describe("unlisted playlist discovery isolation", () => {
  it("allows crawlers to fetch the route while robots metadata controls indexing", () => {
    const policy = robots()
    const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules]
    expect(rules.some((rule) => rule.allow === "/")).toBe(true)
    expect(JSON.stringify(policy)).not.toContain("/p/")
  })

  it("cannot enter the ordinary sitemap index", () => {
    const xml = renderWatchSitemapIndex({
      version: "v1",
      generatedAt: "2026-08-21T00:00:00.000Z",
      videoRouteGroups: [],
      episodeRouteGroups: [],
      skippedHreflangValues: {},
    } satisfies WatchSeoManifest)
    expect(xml).not.toContain("/p/")
    expect(xml).not.toContain("playlist")
  })
})
