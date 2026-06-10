import { describe, expect, it } from "vitest"

import { classifyPost, qualifies } from "./classifier"
import type { InstagramPost } from "./types"

function post(caption: string, hashtags: string[] = []): InstagramPost {
  return {
    url: "https://www.instagram.com/reel/X/",
    shortcode: "X",
    mediaType: "reel",
    authorHandle: null,
    authorName: null,
    caption,
    hashtags,
    publishedAt: null,
    thumbnailUrl: null,
    matchedAi: [],
    matchedChristian: [],
  }
}

describe("classifyPost", () => {
  it("flags both signals for an AI-generated Christian caption", () => {
    const signals = classifyPost(
      post("AI-generated film of Jesus walking", ["#aiart", "#faith"]),
    )
    expect(signals.isAiGenerated).toBe(true)
    expect(signals.isChristian).toBe(true)
    expect(qualifies(signals)).toBe(true)
    expect(signals.matchedAi.length).toBeGreaterThan(0)
    expect(signals.matchedChristian).toContain("jesus")
  })

  it("does not qualify an AI-only caption", () => {
    const signals = classifyPost(post("Made with Midjourney, cyberpunk city"))
    expect(signals.isAiGenerated).toBe(true)
    expect(signals.isChristian).toBe(false)
    expect(qualifies(signals)).toBe(false)
  })

  it("does not qualify a Christian-only caption", () => {
    const signals = classifyPost(post("Sunday worship at our church"))
    expect(signals.isAiGenerated).toBe(false)
    expect(signals.isChristian).toBe(true)
    expect(qualifies(signals)).toBe(false)
  })

  it("uses word boundaries to avoid false positives", () => {
    const signals = classifyPost(post("he said the goddess prayed quietly"))
    // "said" must not match the "ai" token; "goddess" must not match "god".
    expect(signals.matchedAi).not.toContain("ai")
    expect(signals.matchedChristian).not.toContain("god")
    // "prayed" matches the "pray" substring keyword — Christian, but no AI.
    expect(signals.isAiGenerated).toBe(false)
  })

  it("matches case-insensitively", () => {
    const signals = classifyPost(post("GOD is good — made with Midjourney"))
    expect(signals.isChristian).toBe(true)
    expect(signals.isAiGenerated).toBe(true)
    expect(qualifies(signals)).toBe(true)
  })

  it("classifies from hashtags alone when the caption is empty", () => {
    const signals = classifyPost(post("", ["#midjourney", "#jesus"]))
    expect(signals.isAiGenerated).toBe(true)
    expect(signals.isChristian).toBe(true)
    expect(qualifies(signals)).toBe(true)
  })

  it("flags nothing for an empty caption with no hashtags", () => {
    const signals = classifyPost(post(""))
    expect(signals.isAiGenerated).toBe(false)
    expect(signals.isChristian).toBe(false)
  })
})
