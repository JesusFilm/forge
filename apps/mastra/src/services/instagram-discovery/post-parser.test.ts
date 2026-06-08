import { describe, expect, it } from "vitest"

import type { FirecrawlSearchHit } from "../firecrawl-search-client"
import { isInstagramUrl, parseInstagramPost } from "./post-parser"

describe("isInstagramUrl", () => {
  it("accepts post, reel, tv, and handle-prefixed permalinks", () => {
    expect(isInstagramUrl("https://www.instagram.com/p/ABC123/")).toBe(true)
    expect(isInstagramUrl("https://instagram.com/reel/XYZ_9/")).toBe(true)
    expect(isInstagramUrl("https://www.instagram.com/tv/Tv12/")).toBe(true)
    expect(
      isInstagramUrl("https://www.instagram.com/some.user/p/ABC123/"),
    ).toBe(true)
  })

  it("rejects non-instagram hosts, profiles, and stories", () => {
    expect(isInstagramUrl("https://example.com/p/ABC123/")).toBe(false)
    expect(isInstagramUrl("https://www.instagram.com/some.user/")).toBe(false)
    expect(isInstagramUrl("https://www.instagram.com/stories/user/123/")).toBe(
      false,
    )
    expect(isInstagramUrl("not a url")).toBe(false)
  })
})

describe("parseInstagramPost", () => {
  it("extracts shortcode, canonical url, author and hashtags", () => {
    const hit: FirecrawlSearchHit = {
      url: "https://instagram.com/reel/ABC123/",
      title: "Grace Films (@grace.films) • Instagram reel",
      description: "An AI generated film about Jesus #aiart #faith",
      metadata: {
        "article:published_time": "2026-05-01T10:00:00Z",
        "og:image": "https://img.example/thumb.jpg",
      },
    }

    const post = parseInstagramPost(hit)
    expect(post).not.toBeNull()
    expect(post!).toMatchObject({
      url: "https://www.instagram.com/reel/ABC123/",
      shortcode: "ABC123",
      mediaType: "reel",
      authorHandle: "grace.films",
      caption: "An AI generated film about Jesus #aiart #faith",
      hashtags: ["#aiart", "#faith"],
      publishedAt: "2026-05-01T10:00:00.000Z",
      thumbnailUrl: "https://img.example/thumb.jpg",
    })
    expect(post!.authorName).toBe("Grace Films")
  })

  it("derives author handle from the URL path when title lacks it", () => {
    const hit: FirecrawlSearchHit = {
      url: "https://www.instagram.com/holy.reels/p/ZZ9/",
      title: "A post",
      description: "caption",
    }
    const post = parseInstagramPost(hit)
    expect(post!.authorHandle).toBe("holy.reels")
    expect(post!.mediaType).toBe("post")
    expect(post!.url).toBe("https://www.instagram.com/p/ZZ9/")
  })

  it("returns null publishedAt when metadata has no timestamp", () => {
    const hit: FirecrawlSearchHit = {
      url: "https://www.instagram.com/p/NoDate/",
      description: "caption only",
    }
    const post = parseInstagramPost(hit)
    expect(post!.publishedAt).toBeNull()
    expect(post!.thumbnailUrl).toBeNull()
  })

  it("drops an over-long thumbnail URL rather than producing an invalid post", () => {
    const post = parseInstagramPost({
      url: "https://www.instagram.com/p/ABC123/",
      description: "caption",
      metadata: { "og:image": `https://img.example/${"a".repeat(600)}.jpg` },
    })
    expect(post!.thumbnailUrl).toBeNull()
  })

  it("caps author handle and name to the schema limit", () => {
    const longHandle = "a".repeat(400)
    const post = parseInstagramPost({
      url: `https://www.instagram.com/${longHandle}/p/ABC123/`,
      title: `${"N".repeat(400)} (@${longHandle}) • Instagram`,
      description: "caption",
    })
    expect(post!.authorHandle!.length).toBeLessThanOrEqual(256)
    expect((post!.authorName ?? "").length).toBeLessThanOrEqual(256)
  })

  it("treats an over-long shortcode as a non-post URL", () => {
    const longShortcode = "A".repeat(120)
    expect(
      parseInstagramPost({
        url: `https://www.instagram.com/p/${longShortcode}/`,
      }),
    ).toBeNull()
  })

  it("returns null for non-instagram hits", () => {
    expect(
      parseInstagramPost({ url: "https://youtube.com/watch?v=1" }),
    ).toBeNull()
    expect(
      parseInstagramPost({ url: "https://www.instagram.com/profile_only/" }),
    ).toBeNull()
  })
})
