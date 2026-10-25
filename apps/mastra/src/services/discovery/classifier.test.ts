import { describe, expect, it } from "vitest"

import {
  classifyContent,
  qualifies,
  type ClassifiableContent,
} from "./classifier"

function content(
  caption: string,
  hashtags: string[] = [],
): ClassifiableContent {
  return { caption, hashtags }
}

describe("classifyContent", () => {
  it("accepts a plain { caption, hashtags } object (platform-agnostic)", () => {
    const signals = classifyContent(
      content("AI-generated film of Jesus walking", ["#aiart", "#faith"]),
    )
    expect(signals.isAiGenerated).toBe(true)
    expect(signals.isChristian).toBe(true)
    expect(qualifies(signals)).toBe(true)
    expect(signals.matchedChristian).toContain("jesus")
  })

  it("does not qualify an AI-only caption", () => {
    const signals = classifyContent(
      content("Made with Midjourney, cyberpunk city"),
    )
    expect(signals.isAiGenerated).toBe(true)
    expect(signals.isChristian).toBe(false)
    expect(qualifies(signals)).toBe(false)
  })

  it("does not qualify a Christian-only caption", () => {
    const signals = classifyContent(content("Sunday worship at our church"))
    expect(signals.isChristian).toBe(true)
    expect(signals.isAiGenerated).toBe(false)
    expect(qualifies(signals)).toBe(false)
  })

  it("uses word boundaries to avoid false positives", () => {
    const signals = classifyContent(
      content("he said the goddess prayed quietly"),
    )
    expect(signals.matchedAi).not.toContain("ai")
    expect(signals.matchedChristian).not.toContain("god")
    expect(signals.isAiGenerated).toBe(false)
  })

  it("classifies from hashtags alone when the caption is empty", () => {
    const signals = classifyContent(content("", ["#midjourney", "#jesus"]))
    expect(qualifies(signals)).toBe(true)
  })

  it("excludes commentary even when AI + Christian words are present", () => {
    const signals = classifyContent(
      content("Should we be listening to AI generated Christian music?"),
    )
    expect(signals.isAiGenerated).toBe(true)
    expect(signals.isChristian).toBe(true)
    expect(signals.isCommentary).toBe(true)
    expect(qualifies(signals)).toBe(false)
  })

  it("excludes meme/novelty, talk-about-AI, and news junk", () => {
    const cases = [
      "Omg Jesus #ai #funny #trending #memes #aiart",
      "Jesus and Buddha jousting #midjourney #aiart #ai #jesus",
      "AI & Christianity: What Every Believer Must Know!",
      "How Satan is Using AI Videos to Trick Many Christians.. Be Advised!",
      "AI-generated singer hits No. 1 on Christian music charts",
    ]
    for (const caption of cases) {
      const signals = classifyContent(content(caption))
      expect(signals.isCommentary).toBe(true)
      expect(qualifies(signals)).toBe(false)
    }
  })

  it("excludes news/coverage about someone's AI post (real leaked captions)", () => {
    const cases = [
      "BREAKING: After depicting himself as Jesus, the president has now AI-generated a new image",
      "The U.S. President Donald Trump shared an AI-generated image depicting himself as the pope",
      "While Pope Leo warns about AI-generated sermons and Trump shares AI images of Jesus",
      "A viral AI-generated video shared by Iranian diplomatic accounts adds tension",
      "AI music is changing the industry, but what do we lose when a song can be created by a machine? #ai #christian",
      "Beware of AI generated Christian music flooding the feed #ai #jesus",
      "More AI generated Christian songs popping up these days #ai #christian",
      "This AI Jesus track is currently number one in iTunes Christian charts",
    ]
    for (const caption of cases) {
      const signals = classifyContent(content(caption))
      expect(signals.isCommentary).toBe(true)
      expect(qualifies(signals)).toBe(false)
    }
  })

  it("does not treat a sermon that warns about sin as commentary", () => {
    const signals = classifyContent(
      content(
        "An AI-animated parable where Jesus warns about the danger of pride",
      ),
    )
    expect(signals.isCommentary).toBe(false)
    expect(qualifies(signals)).toBe(true)
  })

  it("keeps a genuine creation that has no commentary words", () => {
    const signals = classifyContent(
      content(
        "I recreated the story of Jesus' crucifixion using cinematic AI storytelling",
      ),
    )
    expect(signals.isCommentary).toBe(false)
    expect(qualifies(signals)).toBe(true)
  })
})
