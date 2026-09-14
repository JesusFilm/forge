import { describe, expect, it, vi } from "vitest"

import {
  HOOK_STYLES,
  hookStyleForSequence,
  writeDevotionalCopy,
} from "./devotional-copy"
import { DevotionalLlmError, type DevotionalLlm } from "./llm"

const fakeLlm = (complete: DevotionalLlm["complete"]): DevotionalLlm => ({
  model: "fake",
  complete,
})

describe("writeDevotionalCopy", () => {
  it("returns trimmed title/question/prayer and feeds the model the scene + verse + reflection", async () => {
    const complete = vi.fn().mockResolvedValue({
      title: "  Peace in the Storm  ",
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
    })
    expect(r.title).toBe("Peace in the Storm")
    expect(r.question).toContain("storm")
    expect(r.prayer).toMatch(/^Jesus/)

    const user = complete.mock.calls[0][0].user
    expect(user).toContain("Jesus Calms the Storm")
    expect(user).toContain("Luke 8:25")
    expect(user).toContain("Christ stilled the storm")
  })

  it("writes the cover/question/prayer against the clip's own words as act one", async () => {
    const complete = vi.fn().mockResolvedValue({
      title: "t",
      question: "q",
      prayer: "p",
    })
    await writeDevotionalCopy({
      sceneTitle: "Jesus Calms the Storm",
      reference: "Luke 8:25",
      scriptureText: "Where is your faith?",
      reflection: "Christ stilled the storm with a word.",
      clipTranscript: "Master! We are about to die!",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    const user = complete.mock.calls[0][0].user as string
    expect(user).toContain("Master! We are about to die!")
    // The cover is the way IN to the story the clip opens, so the transcript
    // has to reach this writer too — the arc runs cover → clip → reflection →
    // takeaway → question → prayer, and only the reflection used to see it.
    expect(user).toMatch(/The title is the way IN to this story/)
    expect(user.indexOf("ACT ONE")).toBe(0)
  })

  it("leaves the prompt unchanged when there is no transcript, or an empty one", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ title: "t", question: "q", prayer: "p" })
    const base = {
      sceneTitle: "Jesus Calms the Storm",
      reference: "Luke 8:25",
      scriptureText: "Where is your faith?",
      reflection: "Christ stilled the storm with a word.",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    }
    await writeDevotionalCopy(base)
    await writeDevotionalCopy({ ...base, clipTranscript: "" })
    // `fetchClipTranscript` is best-effort by contract, so this is a normal
    // path, not an error path — both runs must be the pre-feature prompt.
    expect(complete.mock.calls[0][0].user).not.toMatch(/ACT ONE/)
    expect(complete.mock.calls[1][0].user).toBe(complete.mock.calls[0][0].user)
  })

  it("passes the rotated hook style to the model when provided", async () => {
    const complete = vi.fn().mockResolvedValue({
      title: "You can stop performing for God.",
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
    })
    expect(complete.mock.calls[0][0].user).toContain(
      "Hook style for THIS devotional: a bold, declarative statement",
    )
  })

  it("rotates hook styles deterministically by sequence and covers negatives", () => {
    // Same style every HOOK_STYLES.length steps; distinct within one cycle.
    const cycle = HOOK_STYLES.map((_, i) => hookStyleForSequence(i))
    expect(new Set(cycle).size).toBe(HOOK_STYLES.length)
    expect(hookStyleForSequence(HOOK_STYLES.length)).toBe(
      hookStyleForSequence(0),
    )
    expect(hookStyleForSequence(HOOK_STYLES.length + 1)).toBe(
      hookStyleForSequence(1),
    )
    // Never throws / no undefined on a negative or fractional counter.
    expect(HOOK_STYLES).toContain(hookStyleForSequence(-1))
    expect(HOOK_STYLES).toContain(hookStyleForSequence(2.9))
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
      }),
    ).rejects.toMatchObject({
      name: "DevotionalCopyError",
      code: "generation_failed",
    })
  })
})
