import { describe, expect, it } from "vitest"

import { parsePinterestPin, _internals } from "./post-parser"
import type { PinterestRawItem } from "./types"

function item(overrides: Partial<PinterestRawItem> = {}): PinterestRawItem {
  return {
    title: "AI film of Jesus #faith",
    link: "https://www.pinterest.com/pin/123456789/",
    pubDate: "Sat, 28 Dec 2024 17:35:04 GMT",
    description:
      "&lt;a href=&quot;x&quot;&gt;&lt;img src=&quot;https://i.pinimg.com/t.jpg&quot;&gt;&lt;/a&gt;caption",
    boardName: "user/jesus-ai",
    boardUrl: "https://in.pinterest.com/user/jesus-ai/",
    ...overrides,
  }
}

describe("parsePinterestPin", () => {
  it("extracts the pin id from the link", () => {
    expect(parsePinterestPin(item())!.pinId).toBe("123456789")
  })

  it("decodes the image url from the entity-encoded description", () => {
    expect(parsePinterestPin(item())!.thumbnailUrl).toBe(
      "https://i.pinimg.com/t.jpg",
    )
  })

  it("decodes HTML entities in the caption", () => {
    const pin = parsePinterestPin(
      item({ title: "Trust Jesus &amp; His name &apos;peace&apos;" }),
    )
    expect(pin!.caption).toBe("Trust Jesus & His name 'peace'")
  })

  it("extracts hashtags from the caption", () => {
    expect(parsePinterestPin(item())!.hashtags).toContain("#faith")
  })

  it("converts pubDate to ISO", () => {
    expect(parsePinterestPin(item())!.publishedAt).toBe(
      "2024-12-28T17:35:04.000Z",
    )
  })

  it("carries board attribution", () => {
    const pin = parsePinterestPin(item())!
    expect(pin.boardName).toBe("user/jesus-ai")
    expect(pin.boardUrl).toBe("https://in.pinterest.com/user/jesus-ai/")
  })

  it("returns null when there is no link", () => {
    expect(parsePinterestPin(item({ link: null }))).toBeNull()
  })

  it("falls back to a hash id when the link has no /pin/ segment", () => {
    const pin = parsePinterestPin(
      item({ link: "https://www.pinterest.com/something-else" }),
    )
    expect(pin!.pinId).toMatch(/^[0-9a-f]{16}$/)
  })

  it("decodeEntities handles named, numeric, and hex entities", () => {
    expect(_internals.decodeEntities("a &amp; b &#39;c&#39; &#x2764;")).toBe(
      "a & b 'c' ❤",
    )
  })
})
