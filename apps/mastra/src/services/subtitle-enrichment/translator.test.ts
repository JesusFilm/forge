import { describe, expect, it } from "vitest"

import { _internals } from "./translator"
import type { SubtitleScriptureContext } from "./types"

describe("subtitle translator prompt", () => {
  it("adds Bible-story guidance without dropping glossary or custom prompt", () => {
    const scriptureContext: SubtitleScriptureContext = {
      contentDomain: "bible_story",
      likelyBibleReferences: ["Luke 2"],
      confidence: 0.9,
      rationale: "Birth narrative.",
    }

    const prompt = _internals.buildSystemPrompt(
      "Spanish",
      {
        glossary: { Messiah: "Mesias" },
        customPrompt: "Use Latin American Spanish.",
      },
      scriptureContext,
    )

    expect(prompt).toContain("Christian gospel content")
    expect(prompt).toContain("Likely Bible references: Luke 2")
    expect(prompt).toContain("close to familiar Bible phrasing")
    expect(prompt).toContain('"Messiah" -> "Mesias"')
    expect(prompt).toContain("Use Latin American Spanish.")
    expect(prompt).toContain("Do not add verse references")
  })

  it("does not assert Bible-story context for other content", () => {
    const prompt = _internals.buildSystemPrompt("French", undefined, {
      contentDomain: "other",
      likelyBibleReferences: [],
      confidence: 0.2,
    })

    expect(prompt).toContain("Christian gospel content")
    expect(prompt).not.toContain("This appears to be a Bible-story video")
    expect(prompt).not.toContain("Likely Bible references")
  })
})
