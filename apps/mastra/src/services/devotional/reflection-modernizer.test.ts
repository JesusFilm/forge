import { describe, expect, it, vi } from "vitest"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import {
  countSentences,
  countWords,
  findBannedHeavenlyRolePhrase,
  modernizeReflection,
  ReflectionModernizerError,
} from "./reflection-modernizer"

function fakeLlm(complete: DevotionalLlm["complete"]): DevotionalLlm {
  return { model: "fake", complete }
}

describe("modernizeReflection", () => {
  it("passes the source, focus passage, and word target to the model", async () => {
    const complete = vi.fn().mockResolvedValue({ adapted: "You are with me." })
    const r = await modernizeReflection({
      sourceText: "Thou art with me, saith the Lord.",
      focusReference: "Luke 8:22-25",
      sourceName: "Matthew Henry, Commentary on the Whole Bible",
      approxWords: 80,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
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

  it("includes the quoted on-screen verse when given, so the model can pick which points connect to it", async () => {
    const complete = vi.fn().mockResolvedValue({ adapted: "Modernized." })
    await modernizeReflection({
      sourceText: "x",
      focusReference: "Luke 19:1-10",
      sourceName: "Ryle",
      scriptureReference: "Luke 19:10",
      scriptureText: "For the Son of Man came to seek and save the lost.",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(complete.mock.calls[0][0].user).toContain(
      "Quoted verse shown on screen (Luke 19:10): For the Son of Man came to seek and save the lost.",
    )
  })

  it("omits the quoted-verse line entirely when scriptureReference/Text aren't given", async () => {
    const complete = vi.fn().mockResolvedValue({ adapted: "Modernized." })
    await modernizeReflection({
      sourceText: "x",
      focusReference: "Luke 19:1-10",
      sourceName: "Ryle",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(complete.mock.calls[0][0].user).not.toContain("Quoted verse shown on screen")
  })

  it("defaults to ~90 words when unspecified", async () => {
    const complete = vi.fn().mockResolvedValue({ adapted: "Modernized." })
    await modernizeReflection({
      sourceText: "x",
      focusReference: "John 11",
      sourceName: "Matthew Henry",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
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
      }),
    ).rejects.toBeInstanceOf(ReflectionModernizerError)
  })

  it("does NOT retry when the output is already clean of the banned phrase", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ adapted: "Christ intercedes for you at God's right hand." })
    const r = await modernizeReflection({
      sourceText: "x",
      focusReference: "Luke 8:22-25",
      sourceName: "Ryle",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.adapted).toBe("Christ intercedes for you at God's right hand.")
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("retries once and returns the clean retry when the first attempt contains the banned phrase", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        adapted: "There is one living for you in heaven who calms every storm.",
      })
      .mockResolvedValueOnce({
        adapted: "Christ intercedes for you in heaven and calms every storm.",
      })
    const r = await modernizeReflection({
      sourceText: "x",
      focusReference: "Luke 8:22-25",
      sourceName: "Ryle",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.adapted).toBe(
      "Christ intercedes for you in heaven and calms every storm.",
    )
    expect(complete).toHaveBeenCalledTimes(2)
    // Retry prompt quotes the exact violation back to the model.
    expect(complete.mock.calls[1][0].user).toContain("living for you")
  })

  it("throws banned_phrase_violation when the retry ALSO contains the banned phrase", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ adapted: "He lives for you in heaven." })
      .mockResolvedValueOnce({ adapted: "He still lives for you up there." })
    await expect(
      modernizeReflection({
        sourceText: "x",
        focusReference: "Luke 8:22-25",
        sourceName: "Ryle",
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      }),
    ).rejects.toMatchObject({
      name: "ReflectionModernizerError",
      code: "banned_phrase_violation",
    })
    expect(complete).toHaveBeenCalledTimes(2)
  })
})

describe("length caps", () => {
  const long = (n: number) =>
    Array.from({ length: n }, (_, i) => `Word${i} filler text here.`).join(" ")

  it("retries once, quoting the real counts, when the draft blows the word cap", async () => {
    const over = long(40) // 40 sentences, 160 words — over a 100-word cap
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ adapted: over })
      .mockResolvedValueOnce({ adapted: "Short and faithful enough." })
    const r = await modernizeReflection({
      sourceText: "x",
      focusReference: "Luke 19:1-10",
      sourceName: "Ryle",
      approxWords: 100,
      maxWords: 100,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.adapted).toBe("Short and faithful enough.")
    expect(complete).toHaveBeenCalledTimes(2)
    const retry = complete.mock.calls[1][0].user
    expect(retry).toContain("160 words")
    expect(retry).toContain("hard limits are 100 words")
    // Must tell the model to cut ornament, not substance.
    expect(retry).toMatch(/SUPPORTING ILLUSTRATION/i)
  })

  it("does NOT retry when the draft is within both caps", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ adapted: "One short faithful sentence about grace." })
    await modernizeReflection({
      sourceText: "x",
      focusReference: "Luke 19:1-10",
      sourceName: "Ryle",
      approxWords: 100,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("keeps the original when the shortening retry comes back LONGER", async () => {
    const first = long(30) // 120 words
    const longer = long(60) // 240 words — retry made it worse
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ adapted: first })
      .mockResolvedValueOnce({ adapted: longer })
    const r = await modernizeReflection({
      sourceText: "x",
      focusReference: "Luke 19:1-10",
      sourceName: "Ryle",
      approxWords: 100,
      maxWords: 100,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.adapted).toBe(first)
  })

  it("caps sentence count independently of words (each sentence becomes a card)", async () => {
    // 30 very short sentences: only 90 words, but far too many cards.
    const choppy = Array.from({ length: 30 }, (_, i) => `Point ${i} is here.`).join(" ")
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ adapted: choppy })
      .mockResolvedValueOnce({ adapted: "Two fuller sentences. That is better." })
    await modernizeReflection({
      sourceText: "x",
      focusReference: "Luke 19:1-10",
      sourceName: "Ryle",
      approxWords: 200, // word cap 230 — the WORDS are fine
      maxSentences: 12,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1][0].user).toContain("12 sentences")
  })
})

describe("countWords / countSentences", () => {
  it("counts words and sentences, ignoring extra whitespace", () => {
    expect(countWords("  one   two three  ")).toBe(3)
    expect(countWords("   ")).toBe(0)
    expect(countSentences("One. Two! Three?")).toBe(3)
    expect(countSentences("")).toBe(0)
  })
})

describe("findBannedHeavenlyRolePhrase", () => {
  it("catches the exact recurring construction and simple paraphrases", () => {
    // "in heaven" trailing AFTER "for you" (the real, observed phrasing) is
    // outside the match, but the construction is still caught.
    expect(findBannedHeavenlyRolePhrase("one lives for you in heaven")).toBe(
      "lives for you",
    )
    expect(findBannedHeavenlyRolePhrase("He is living for us always")).toBe(
      "living for us",
    )
    // "in heaven" BEFORE "for you" is captured as part of the match.
    expect(
      findBannedHeavenlyRolePhrase("He exists in heaven for you always"),
    ).toBe("exists in heaven for you")
  })

  it("returns null for clean, unrelated, or correctly-framed text", () => {
    expect(
      findBannedHeavenlyRolePhrase(
        "Christ intercedes for you at God's right hand.",
      ),
    ).toBeNull()
    expect(findBannedHeavenlyRolePhrase("This gift is for you.")).toBeNull()
    expect(findBannedHeavenlyRolePhrase("He lives for adventure.")).toBeNull()
  })
})
