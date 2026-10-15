import { describe, expect, it, vi } from "vitest"

import {
  conclusionDuplicatesReflection,
  DevotionalConclusionError,
  writeDevotionalConclusion,
} from "./devotional-conclusion"
import { DevotionalLlmError, type DevotionalLlm } from "./llm"

const fakeLlm = (complete: DevotionalLlm["complete"]): DevotionalLlm => ({
  model: "fake",
  complete,
})

const BASE_INPUT = {
  sceneTitle: "Jesus Calms the Storm",
  reference: "Luke 8:25",
  scriptureText: "Where is your faith?",
  reflection:
    "Jesus slept as man and stilled the storm as God. All his almighty power is engaged on your behalf.",
  title: "The one who knows your weariness commands the wind.",
  question: "What storm are you facing today that you need to bring to Jesus?",
  prayer: "Bring your fear to the one who calms every storm.",
}

describe("writeDevotionalConclusion", () => {
  it("returns a trimmed conclusion and feeds the model the scene + reflection + already-chosen fields", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ conclusion: "  The storm obeys him still.  " })
    const r = await writeDevotionalConclusion({
      ...BASE_INPUT,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.conclusion).toBe("The storm obeys him still.")

    const user = complete.mock.calls[0][0].user
    expect(user).toContain("Jesus Calms the Storm")
    expect(user).toContain("Luke 8:25")
    expect(user).toContain(BASE_INPUT.reflection)
    expect(user).toContain(BASE_INPUT.title)
    expect(user).toContain(BASE_INPUT.question)
    expect(user).toContain(BASE_INPUT.prayer)
  })

  it("retries once when the conclusion just repeats a sentence already in the reflection", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        conclusion: "All his almighty power is engaged on your behalf.",
      })
      .mockResolvedValueOnce({
        conclusion: "The storm obeys the same voice that once let you sleep.",
      })
    const r = await writeDevotionalConclusion({
      ...BASE_INPUT,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.conclusion).toBe(
      "The storm obeys the same voice that once let you sleep.",
    )
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1][0].user).toContain("just repeats a sentence")
  })

  it("does not retry when the conclusion restates the reflection in new words", async () => {
    const complete = vi.fn().mockResolvedValue({
      conclusion: "The storm obeys the same voice that once let you sleep.",
    })
    await writeDevotionalConclusion({
      ...BASE_INPUT,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("wraps an LLM error as a generation_failed DevotionalConclusionError", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("validation", "bad"))
    await expect(
      writeDevotionalConclusion({
        ...BASE_INPUT,
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      }),
    ).rejects.toMatchObject({
      name: "DevotionalConclusionError",
      code: "generation_failed",
    })
  })

  it("throws empty_output when the model returns blank text", async () => {
    const complete = vi.fn().mockResolvedValue({ conclusion: "   " })
    await expect(
      writeDevotionalConclusion({
        ...BASE_INPUT,
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      }),
    ).rejects.toBeInstanceOf(DevotionalConclusionError)
  })
})

describe("conclusionDuplicatesReflection", () => {
  it("flags a verbatim (or punctuation/case-insensitive) match", () => {
    const reflection =
      "Jesus slept as man and stilled the storm as God. All his almighty power is engaged on your behalf."
    expect(
      conclusionDuplicatesReflection(
        "All his almighty power is engaged on your behalf.",
        reflection,
      ),
    ).toBe(true)
    expect(
      conclusionDuplicatesReflection(
        "ALL HIS ALMIGHTY POWER IS ENGAGED ON YOUR BEHALF",
        reflection,
      ),
    ).toBe(true)
  })

  it("returns false for a genuinely different conclusion", () => {
    const reflection =
      "Jesus slept as man and stilled the storm as God. All his almighty power is engaged on your behalf."
    expect(
      conclusionDuplicatesReflection(
        "The storm obeys the same voice that once let you sleep.",
        reflection,
      ),
    ).toBe(false)
  })
})
