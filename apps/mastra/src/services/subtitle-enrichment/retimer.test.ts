import { describe, expect, it } from "vitest"

import { _internals } from "./retimer"
import type { Chunk, SubtitleScriptureContext } from "./types"

const chunk: Chunk = {
  index: 0,
  segments: [
    { start: 0, end: 2, text: "Source one." },
    { start: 2, end: 4, text: "Source two." },
  ],
  startTime: 0,
  endTime: 4,
  sourceText: "Source one. Source two.",
}

describe("subtitle retimer prompt", () => {
  it("preserves translated Bible-story wording instead of paraphrasing", () => {
    const scriptureContext: SubtitleScriptureContext = {
      contentDomain: "bible_story",
      likelyBibleReferences: ["Luke 2"],
      confidence: 0.9,
    }

    const prompt = _internals.buildRetimingPrompt(
      chunk,
      "For unto you is born this day.",
      "English",
      undefined,
      scriptureContext,
    )

    expect(prompt.system).toContain("do not retranslate, paraphrase")
    expect(prompt.system).toContain("Retiming must preserve that wording")
    expect(prompt.user).toContain("Translated text:")
  })
})
