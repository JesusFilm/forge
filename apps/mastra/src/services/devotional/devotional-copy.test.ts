import { describe, expect, it, vi } from "vitest"

import { hookStyleForSequence, writeDevotionalCopy } from "./devotional-copy"
import { DevotionalLlmError, type DevotionalLlm } from "./llm"

const fakeLlm = (complete: DevotionalLlm["complete"]): DevotionalLlm => ({
  model: "fake",
  complete,
})
const SYSTEM_PROMPT = "Write bounded devotional copy and return JSON."
const HOOK_STYLES = ["statement", "confession", "image"]

describe("writeDevotionalCopy", () => {
  it("returns trimmed title/question/prayer and feeds the model the scene + verse + reflection", async () => {
    const complete = vi.fn().mockResolvedValue({
      title: "  Peace in the Storm  ",
      conclusion: "The One who calms the sea is in your boat.",
      question:
        "What storm are you facing that you need to hand to Jesus today?",
      prayer: "Jesus, help me trust you in my storm.",
    })
    const r = await writeDevotionalCopy({
      sceneTitle: "Jesus Calms the Storm",
      reference: "Luke 8:25",
      scriptureText: "Where is your faith?",
      reflection: "Christ stilled the storm with a word.",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      systemPrompt: SYSTEM_PROMPT,
    })
    expect(r.title).toBe("Peace in the Storm")
    expect(r.question).toContain("storm")
    expect(r.prayer).toMatch(/^Jesus/)

    const user = complete.mock.calls[0][0].user
    expect(user).toContain("Jesus Calms the Storm")
    expect(user).toContain("Luke 8:25")
    expect(user).toContain("Christ stilled the storm")
  })

  it("passes the rotated hook style to the model when provided", async () => {
    const complete = vi.fn().mockResolvedValue({
      title: "You can stop performing for God.",
      conclusion: "Grace is not earned.",
      question: "Where are you still trying to earn what is already given?",
      prayer: "Rest in what Christ has already done for you.",
    })
    await writeDevotionalCopy({
      sceneTitle: "Sinful Woman Forgiven",
      reference: "Luke 7:47",
      scriptureText: "Her many sins have been forgiven.",
      reflection: "Love flows from being forgiven.",
      hookStyle: "a bold, declarative statement (no question mark)",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      systemPrompt: SYSTEM_PROMPT,
    })
    expect(complete.mock.calls[0][0].user).toContain(
      "Hook style for THIS devotional: a bold, declarative statement",
    )
  })

  it("rotates hook styles deterministically by sequence and covers negatives", () => {
    // Same style every HOOK_STYLES.length steps; distinct within one cycle.
    const cycle = HOOK_STYLES.map((_, i) =>
      hookStyleForSequence(i, HOOK_STYLES),
    )
    expect(new Set(cycle).size).toBe(HOOK_STYLES.length)
    expect(hookStyleForSequence(HOOK_STYLES.length, HOOK_STYLES)).toBe(
      hookStyleForSequence(0, HOOK_STYLES),
    )
    expect(hookStyleForSequence(HOOK_STYLES.length + 1, HOOK_STYLES)).toBe(
      hookStyleForSequence(1, HOOK_STYLES),
    )
    // Never throws / no undefined on a negative or fractional counter.
    expect(HOOK_STYLES).toContain(hookStyleForSequence(-1, HOOK_STYLES))
    expect(HOOK_STYLES).toContain(hookStyleForSequence(2.9, HOOK_STYLES))
  })

  it("wraps an LLM error", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("validation", "bad"))
    await expect(
      writeDevotionalCopy({
        sceneTitle: "s",
        reference: "r",
        scriptureText: "t",
        reflection: "x",
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
        systemPrompt: SYSTEM_PROMPT,
      }),
    ).rejects.toMatchObject({
      name: "DevotionalCopyError",
      code: "generation_failed",
    })
  })
})
