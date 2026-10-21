import { describe, expect, it } from "vitest"
import { displayTranscriptSnippet } from "./watch-search-snippet"

describe("displayTranscriptSnippet", () => {
  it("keeps the speech after the cues in the production snippet", () => {
    // The full card snippet production returned on 2026-10-21 for "is god
    // real" (StoryClubs: Jesus Calms the Storm, English and Arabic results).
    const production =
      "[MUSIC] [MUSIC] [INAUDIBLE] [INAUDIBLE] [MUSIC] >> [INAUDIBLE] >> [INAUDIBLE] >> [INAUDIBLE] [MUSIC] >> [INAUDIBLE] >> [INAUDIBLE] >> [INAUDIBLE] [MUSIC] >> Where is your faith?..."
    expect(displayTranscriptSnippet(production)).toBe("Where is your faith?...")
  })

  it.each([
    "[MUSIC] [MUSIC] [INAUDIBLE] [INAUDIBLE] [MUSIC] >> [INAUDIBLE] >> [INAUDIBLE]",
    ">> [APPLAUSE] (soft music) ...",
    "   ",
  ])("returns null when only caption cues remain: %s", (snippet) => {
    expect(displayTranscriptSnippet(snippet)).toBeNull()
  })

  it.each([
    [
      "[MUSIC PLAYING] It was winter, and the festival of the dedication",
      "It was winter, and the festival of the dedication",
    ],
    [
      "(upbeat music) - Over 50 years ago, on July 20th, 1969",
      "Over 50 years ago, on July 20th, 1969",
    ],
    [
      "[music] Who is it that you say you are? [music] Who are those",
      "Who is it that you say you are? Who are those",
    ],
    [">> Who are you? >> I am the light.", "Who are you? I am the light."],
  ])("strips caption cues around speech: %s", (snippet, expected) => {
    expect(displayTranscriptSnippet(snippet)).toBe(expected)
  })

  it.each([
    "[He] said to them, (John 3:16) for God so loved the world",
    'Jesus said, "Come and see." [Luke 5]',
    "يسوع هو الطريق والحق والحياة",
    "耶稣是谁？",
  ])("keeps editorial brackets and non-Latin text unchanged: %s", (snippet) => {
    expect(displayTranscriptSnippet(snippet)).toBe(snippet)
  })

  it("keeps null as null", () => {
    expect(displayTranscriptSnippet(null)).toBeNull()
  })
})
