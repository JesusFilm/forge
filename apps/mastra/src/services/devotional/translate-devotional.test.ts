import { describe, expect, it, vi } from "vitest"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import {
  editLocalizedCopy,
  translateDevotionalCopy,
  TranslateDevotionalError,
  type TranslatableCopy,
} from "./translate-devotional"

const fakeLlm = (complete: DevotionalLlm["complete"]): DevotionalLlm => ({
  model: "fake",
  complete,
})

const COPY: TranslatableCopy = {
  title: "Jesus came looking for you",
  reflection: "Grace reaches you first.",
  conclusion: "You are already found.",
  question: "Where do you still hide from God?",
  prayer: "Take a moment to let him find you.",
}

describe("translateDevotionalCopy", () => {
  it("passes through English without calling the model", async () => {
    const complete = vi.fn()
    const out = await translateDevotionalCopy({
      copy: COPY,
      targetLang: "en",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(out).toEqual(COPY)
    expect(complete).not.toHaveBeenCalled()
  })

  it("translates all five fields to Russian and trims them", async () => {
    const complete = vi.fn().mockResolvedValue({
      title: "  Иисус искал тебя  ",
      reflection: "Благодать находит тебя первой.",
      conclusion: "Ты уже найден.",
      question: "Где ты всё ещё прячешься от Бога?",
      prayer: "Позволь Ему найти тебя.",
    })
    const out = await translateDevotionalCopy({
      copy: COPY,
      targetLang: "ru",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(out.title).toBe("Иисус искал тебя")
    expect(out.prayer).toBe("Позволь Ему найти тебя.")

    const arg = complete.mock.calls[0][0]
    expect(arg.system).toMatch(/Russian/)
    expect(arg.user).toContain("Jesus came looking for you")
    expect(arg.user).toContain("Where do you still hide from God?")
  })

  it("feeds the scene context to the translator (so references aren't calques)", async () => {
    const complete = vi.fn().mockResolvedValue({
      title: "т",
      reflection: "т",
      conclusion: "т",
      question: "т",
      prayer: "т",
    })
    await translateDevotionalCopy({
      copy: COPY,
      targetLang: "ru",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      context: {
        sceneTitle: "Jesus and Zaccheus",
        scriptureReference: "Luke 19:10",
        scriptureText: "For the Son of Man came to seek…",
      },
    })
    const user = complete.mock.calls[0][0].user
    expect(user).toContain("SCENE CONTEXT")
    expect(user).toContain("Jesus and Zaccheus")
  })
})

describe("editLocalizedCopy", () => {
  it("passes through English without calling the model", async () => {
    const complete = vi.fn()
    const out = await editLocalizedCopy({
      copy: COPY,
      targetLang: "en",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(out).toEqual(COPY)
    expect(complete).not.toHaveBeenCalled()
  })

  it("returns the editor's polished Russian", async () => {
    const polished = {
      title: "Иисус нашёл тебя первым",
      reflection: "Благодать приходит первой.",
      conclusion: "Ты уже найден.",
      question: "Где ты прячешься?",
      prayer: "Дай Ему найти тебя.",
    }
    const out = await editLocalizedCopy({
      copy: COPY,
      targetLang: "ru",
      llm: fakeLlm(vi.fn().mockResolvedValue(polished) as never),
    })
    expect(out.title).toBe("Иисус нашёл тебя первым")
  })

  it("falls back to the input copy if the editor pass errors (best-effort)", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("request_failed", "boom"))
    const input: TranslatableCopy = { ...COPY, title: "исходный" }
    const out = await editLocalizedCopy({
      copy: input,
      targetLang: "ru",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(out).toEqual(input)
  })

})

describe("translateDevotionalCopy errors", () => {
  it("wraps an LLM error as generation_failed", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("request_failed", "boom"))
    await expect(
      translateDevotionalCopy({
        copy: COPY,
        targetLang: "ru",
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      }),
    ).rejects.toMatchObject({
      name: "TranslateDevotionalError",
      code: "generation_failed",
    })
  })

  it("throws empty_output when the model blanks a field", async () => {
    const complete = vi.fn().mockResolvedValue({
      title: "Иисус искал тебя",
      reflection: "   ",
      conclusion: "Ты уже найден.",
      question: "Где?",
      prayer: "Молись.",
    })
    await expect(
      translateDevotionalCopy({
        copy: COPY,
        targetLang: "ru",
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      }),
    ).rejects.toBeInstanceOf(TranslateDevotionalError)
  })
})
