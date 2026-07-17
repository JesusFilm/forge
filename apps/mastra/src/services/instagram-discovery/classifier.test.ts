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

  it("excludes commentary even when AI + Christian words are present", () => {
    const signals = classifyPost(
      post("Should we be listening to AI generated Christian music?"),
    )
    expect(signals.isAiGenerated).toBe(true)
    expect(signals.isChristian).toBe(true)
    expect(signals.isCommentary).toBe(true)
    expect(signals.matchedCommentary).toContain("should we")
    expect(qualifies(signals)).toBe(false)
  })

  it("excludes tutorial/prompt walk-through posts", () => {
    const signals = classifyPost(
      post(
        "Here's my EXACT ChatGPT conversation to make these Veo 3 Bible prompts",
      ),
    )
    expect(signals.isCommentary).toBe(true)
    expect(qualifies(signals)).toBe(false)
  })

  it("keeps a genuine creation that has no commentary words", () => {
    const signals = classifyPost(
      post(
        "I recreated the story of Jesus' crucifixion using cinematic AI storytelling",
      ),
    )
    expect(signals.isAiGenerated).toBe(true)
    expect(signals.isChristian).toBe(true)
    expect(signals.isCommentary).toBe(false)
    expect(qualifies(signals)).toBe(true)
  })

  it("keeps genuine creations that use commentary-adjacent words", () => {
    // "according to" (Gospel attribution), "explains", and "mocking" (Passion
    // narrative) must NOT exclude real creations — these terms were removed.
    const gospel = classifyPost(
      post("AI animation of the Gospel according to John, made with Veo"),
    )
    expect(qualifies(gospel)).toBe(true)

    const explainer = classifyPost(
      post("This AI generated film explains the parable of the sower #bible"),
    )
    expect(qualifies(explainer)).toBe(true)

    const passion = classifyPost(
      post("AI recreation of the soldiers mocking Christ before the cross"),
    )
    expect(qualifies(passion)).toBe(true)
  })

  it("flags nothing for an empty caption with no hashtags", () => {
    const signals = classifyPost(post(""))
    expect(signals.isAiGenerated).toBe(false)
    expect(signals.isChristian).toBe(false)
  })
})
