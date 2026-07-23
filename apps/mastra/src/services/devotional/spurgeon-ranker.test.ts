import { describe, expect, it, vi } from "vitest"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import type { ReflectionEntry } from "./reflection-corpus"
import { pickBestSpurgeon } from "./spurgeon-ranker"

const entry = (reference: string, text: string): ReflectionEntry => ({
  source: "Charles Spurgeon, Morning and Evening",
  reference,
  osisRef: null,
  verse: "…",
  text,
})

const fakeLlm = (complete: DevotionalLlm["complete"]): DevotionalLlm => ({
  model: "fake",
  complete,
})

describe("pickBestSpurgeon", () => {
  it("returns null for an empty shortlist", async () => {
    const llm = fakeLlm(vi.fn() as unknown as DevotionalLlm["complete"])
    expect(
      await pickBestSpurgeon({
        sceneTitle: "s",
        reference: "r",
        candidates: [],
        llm,
      }),
    ).toBeNull()
  })

  it("judges even a single candidate (so a weak lone match can be rejected)", async () => {
    const complete = vi.fn().mockResolvedValue({ index: -1 })
    const only = entry("Ps 23:1", "shepherd")
    const r = await pickBestSpurgeon({
      sceneTitle: "s",
      reference: "r",
      candidates: [only],
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r).toBeNull()
    expect(complete).toHaveBeenCalled()
  })

  it("returns null when the model says none fit (index -1)", async () => {
    const complete = vi.fn().mockResolvedValue({ index: -1 })
    const cands = [entry("A", "one"), entry("B", "two")]
    const r = await pickBestSpurgeon({
      sceneTitle: "s",
      reference: "r",
      candidates: cands,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r).toBeNull()
  })

  it("uses the LLM to pick the best index from multiple candidates", async () => {
    const complete = vi.fn().mockResolvedValue({ index: 1 })
    const cands = [entry("A", "one"), entry("B", "two"), entry("C", "three")]
    const r = await pickBestSpurgeon({
      sceneTitle: "Zacchaeus",
      reference: "Luke 19:1-10",
      candidates: cands,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r).toBe(cands[1])
  })

  it("returns null if the LLM errors (caller falls back to commentary)", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("request_failed", "boom"))
    const cands = [entry("A", "one"), entry("B", "two")]
    const r = await pickBestSpurgeon({
      sceneTitle: "s",
      reference: "r",
      candidates: cands,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r).toBeNull()
  })

  it("falls back to index 0 when the model returns an out-of-range index", async () => {
    const complete = vi.fn().mockResolvedValue({ index: 99 })
    const cands = [entry("A", "one"), entry("B", "two")]
    const r = await pickBestSpurgeon({
      sceneTitle: "s",
      reference: "r",
      candidates: cands,
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r).toBe(cands[0])
  })
})
