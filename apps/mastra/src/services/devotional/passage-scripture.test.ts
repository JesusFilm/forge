import { describe, expect, it, vi } from "vitest"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import {
  PassageScriptureError,
  selectScriptureForPassage,
} from "./passage-scripture"

const fakeLlm = (complete: DevotionalLlm["complete"]): DevotionalLlm => ({
  model: "fake",
  complete,
})
const SYSTEM_PROMPT = "Select one key WEB verse and return JSON."

describe("selectScriptureForPassage", () => {
  it("uses the EXACT WEB text for the chosen verse (verified, not model-recalled)", async () => {
    const complete = vi.fn().mockResolvedValue({
      reference: "Luke 8:25",
      text: "model paraphrase of the verse",
    })
    const r = await selectScriptureForPassage({
      reference: "Luke 8:22-25",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      systemPrompt: SYSTEM_PROMPT,
      lookupVerse: () => "He said to them, “Where is your faith?”",
    })
    expect(r.reference).toBe("Luke 8:25")
    expect(r.text).toBe("He said to them, “Where is your faith?”")
    expect(r.translation).toBe("WEB")
    expect(r.needsCanonicalSource).toBe(false)
    expect(complete.mock.calls[0][0].user).toContain("Luke 8:22-25")
  })

  it("falls back to the model text (flagged) when the verse can't be looked up", async () => {
    const complete = vi.fn().mockResolvedValue({
      reference: "Rev 21:4",
      text: "model quote",
    })
    const r = await selectScriptureForPassage({
      reference: "Revelation 21:1-4",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      systemPrompt: SYSTEM_PROMPT,
      lookupVerse: () => null, // outside the ingested Gospels+Acts
    })
    expect(r.text).toBe("model quote")
    expect(r.needsCanonicalSource).toBe(true)
  })

  it("wraps an LLM error as generation_failed", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("request_failed", "boom"))
    await expect(
      selectScriptureForPassage({
        reference: "Luke 8:22-25",
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
        systemPrompt: SYSTEM_PROMPT,
        lookupVerse: () => null,
      }),
    ).rejects.toBeInstanceOf(PassageScriptureError)
  })
})
