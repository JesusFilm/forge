import { describe, expect, it, vi } from "vitest"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import {
  modernizeReflection,
  ReflectionModernizerError,
} from "./reflection-modernizer"

function fakeLlm(complete: DevotionalLlm["complete"]): DevotionalLlm {
  return { model: "fake", complete }
}
const SYSTEM_PROMPT = "Use a light touch to modernize this classic reflection."

describe("modernizeReflection", () => {
  it("passes the source, focus passage, and word target to the model", async () => {
    const complete = vi.fn().mockResolvedValue({ adapted: "You are with me." })
    const r = await modernizeReflection({
      sourceText: "Thou art with me, saith the Lord.",
      focusReference: "Luke 8:22-25",
      sourceName: "Matthew Henry, Commentary on the Whole Bible",
      approxWords: 80,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      systemPrompt: SYSTEM_PROMPT,
    })
    expect(r.adapted).toBe("You are with me.")
    // Credit: "a trusted classic" + just the author (before the first comma).
    expect(r.attribution).toBe("Adapted from a trusted classic · Matthew Henry")
    expect(r.focusReference).toBe("Luke 8:22-25")

    const arg = complete.mock.calls[0][0]
    expect(arg.user).toContain("Thou art with me")
    expect(arg.user).toContain("Luke 8:22-25")
    expect(arg.user).toContain("about 80 words")
    expect(arg.system).toMatch(/light touch/i)
  })

  it("defaults to ~90 words when unspecified", async () => {
    const complete = vi.fn().mockResolvedValue({ adapted: "Modernized." })
    await modernizeReflection({
      sourceText: "x",
      focusReference: "John 11",
      sourceName: "Matthew Henry",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      systemPrompt: SYSTEM_PROMPT,
    })
    expect(complete.mock.calls[0][0].user).toContain("about 170 words")
  })

  it("wraps an LLM error as a generation_failed ReflectionModernizerError", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("request_failed", "boom"))
    await expect(
      modernizeReflection({
        sourceText: "x",
        focusReference: "Mark 4",
        sourceName: "Matthew Henry",
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
        systemPrompt: SYSTEM_PROMPT,
      }),
    ).rejects.toMatchObject({
      name: "ReflectionModernizerError",
      code: "generation_failed",
    })
  })

  it("throws empty_output when the model returns blank text", async () => {
    const complete = vi.fn().mockResolvedValue({ adapted: "   " })
    await expect(
      modernizeReflection({
        sourceText: "x",
        focusReference: "Mark 4",
        sourceName: "Ryle",
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
        systemPrompt: SYSTEM_PROMPT,
      }),
    ).rejects.toBeInstanceOf(ReflectionModernizerError)
  })
})
