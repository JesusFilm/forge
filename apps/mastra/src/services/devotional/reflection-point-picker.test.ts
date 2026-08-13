import { describe, expect, it, vi } from "vitest"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import { _internal, pickReflectionPoints } from "./reflection-point-picker"
import type { CommentaryPoint } from "./reflection-points"

/**
 * The 2-point cap is an owner constraint, not a preference: more than two
 * points and the viewer retains none of them, because each new point pushes the
 * previous one out. The cap therefore has to hold even when the model ignores
 * it, and this agent fails OPEN (falls back to point 1) — so a silent
 * malfunction shows up as "every devotional is suddenly about point 1", with no
 * error anywhere. It shipped with no tests.
 */

function fakeLlm(complete: DevotionalLlm["complete"]): DevotionalLlm {
  return { model: "fake", complete }
}

function points(n: number): CommentaryPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    ordinal:
      ["firstly", "secondly", "thirdly", "fourthly", "fifthly"][i] ?? "lastly",
    text: `Point ${i + 1}. We learn that lesson number ${i + 1} matters here.`,
  }))
}

describe("pickReflectionPoints", () => {
  it("returns nothing for an empty point list", async () => {
    const complete = vi.fn()
    const r = await pickReflectionPoints({
      points: [],
      sceneTitle: "scene",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.chosen).toEqual([])
    expect(complete).not.toHaveBeenCalled()
  })

  it("skips the model entirely when the author gave no more than the cap", async () => {
    // No decision to make, so no reason to spend a call.
    const complete = vi.fn()
    const r = await pickReflectionPoints({
      points: points(2),
      sceneTitle: "scene",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.chosen).toEqual([1, 2])
    expect(complete).not.toHaveBeenCalled()
  })

  it("passes the model's valid choice through", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ chosen: [3, 4], reason: "they form an arc" })
    const r = await pickReflectionPoints({
      points: points(5),
      sceneTitle: "scene",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.chosen).toEqual([3, 4])
  })

  describe("the 2-point cap", () => {
    // Asserted against the ZOD SCHEMA, because that is where an over-long answer
    // is first met — `llm.complete()` parses the model's reply through it before
    // pickReflectionPoints ever sees the array. Driving this through a faked
    // `complete` proves nothing: the fake hands the object back verbatim, so the
    // test passes whatever the schema does. (That was the original version of
    // this test, and it hid a real regression — the schema used to REJECT an
    // over-long answer outright, which the agent's fail-open path turned into
    // "silently use point 1 only".)
    it("trims an over-long answer instead of rejecting it", () => {
      const r = _internal.Schema.safeParse({
        chosen: [1, 2, 3, 4],
        reason: "all of them",
      })
      expect(r.success).toBe(true)
      expect(r.success && r.data.chosen).toEqual([1, 2])
    })

    it("still rejects an EMPTY choice, which is not recoverable", () => {
      // Nothing to trim toward: an empty array means the model answered nothing.
      expect(
        _internal.Schema.safeParse({ chosen: [], reason: "none" }).success,
      ).toBe(false)
    })

    it("leaves a within-cap answer untouched", () => {
      const r = _internal.Schema.safeParse({ chosen: [3, 5], reason: "arc" })
      expect(r.success && r.data.chosen).toEqual([3, 5])
    })

    it("caps the result even when the schema is bypassed", async () => {
      // Belt-and-braces: the caller's own slice must hold too, so neither layer
      // alone is load-bearing.
      const complete = vi
        .fn()
        .mockResolvedValue({ chosen: [1, 2, 3, 4], reason: "all of them" })
      const r = await pickReflectionPoints({
        points: points(5),
        sceneTitle: "scene",
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      })
      expect(r.chosen).toEqual([1, 2])
    })
  })

  it("drops hallucinated indices outside the author's range", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ chosen: [2, 99], reason: "one real, one invented" })
    const r = await pickReflectionPoints({
      points: points(5),
      sceneTitle: "scene",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.chosen).toEqual([2])
  })

  it("de-duplicates a repeated index instead of counting it twice against the cap", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ chosen: [3, 3, 5], reason: "duplicate" })
    const r = await pickReflectionPoints({
      points: points(5),
      sceneTitle: "scene",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.chosen).toEqual([3, 5])
  })

  it("keeps the author's order, not the order the model listed them in", async () => {
    // The reflection follows the commentary's flow: what God does, then what it
    // means. Reversing them inverts the argument.
    const complete = vi
      .fn()
      .mockResolvedValue({ chosen: [4, 2], reason: "listed out of order" })
    const r = await pickReflectionPoints({
      points: points(5),
      sceneTitle: "scene",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.chosen).toEqual([2, 4])
  })

  it("falls back to the first point when every index is invalid", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ chosen: [0, 99], reason: "nonsense" })
    const r = await pickReflectionPoints({
      points: points(5),
      sceneTitle: "scene",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.chosen).toEqual([1])
    expect(r.reason).toMatch(/no valid index/i)
  })

  it("falls back to the first point on an LLM failure rather than throwing", async () => {
    // Fails OPEN by design: a reflection built from point 1 beats no devotional,
    // and point 1 is where these authors state the passage's main lesson.
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("request_failed", "boom"))
    const r = await pickReflectionPoints({
      points: points(5),
      sceneTitle: "scene",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.chosen).toEqual([1])
  })

  it("shows the model the verse and the word budget so it can judge what fits", async () => {
    const complete = vi.fn().mockResolvedValue({ chosen: [1, 2], reason: "ok" })
    await pickReflectionPoints({
      points: points(4),
      sceneTitle: "Jesus and Zaccheus",
      scriptureReference: "Luke 19:10",
      scriptureText: "For the Son of Man came to seek and to save the lost.",
      approxWords: 230,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    const arg = complete.mock.calls[0][0]
    expect(arg.user).toContain("Luke 19:10")
    expect(arg.user).toContain("230")
    expect(arg.user).toContain("Jesus and Zaccheus")
  })

  it("states the audience constraint in the prompt", async () => {
    // A point's register is inherited by the whole reflection, so audience fit
    // is the picker's FIRST rule — the readers already follow Jesus, and a
    // seeker-facing point makes the entire devotional seeker-facing.
    const complete = vi.fn().mockResolvedValue({ chosen: [1, 2], reason: "ok" })
    await pickReflectionPoints({
      points: points(4),
      sceneTitle: "scene",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(complete.mock.calls[0][0].system).toMatch(/AUDIENCE/i)
  })
})
