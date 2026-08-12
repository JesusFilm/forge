import { describe, expect, it, vi } from "vitest"

import { critiqueReflectionFidelity } from "./reflection-fidelity-critic"
import { DevotionalLlmError, type DevotionalLlm } from "./llm"

function fakeLlm(complete: DevotionalLlm["complete"]): DevotionalLlm {
  return { model: "fake", complete }
}

describe("critiqueReflectionFidelity", () => {
  it("passes the source excerpt, passage, and adaptation to the model", async () => {
    const complete = vi.fn().mockResolvedValue({
      faithful: true,
      issues: [],
      summary: "keeps the author's balance",
    })
    const r = await critiqueReflectionFidelity({
      sourceExcerpt: "Firstly... secondly... thirdly, Zacchaeus climbed the tree.",
      focusReference: "Luke 19:1-10",
      adapted: "Grace found Zacchaeus without him doing anything.",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.faithful).toBe(true)
    expect(r.issues).toEqual([])

    const arg = complete.mock.calls[0][0]
    expect(arg.user).toContain("Zacchaeus climbed the tree")
    expect(arg.user).toContain("Luke 19:1-10")
    expect(arg.user).toContain("Grace found Zacchaeus")
    expect(arg.system).toMatch(/dropped-argument/i)
    expect(arg.system).toMatch(/narrative-erasure/i)
    expect(arg.system).toMatch(/imprecise-theology/i)
  })

  it("surfaces a dropped-argument / narrative-erasure finding", async () => {
    const complete = vi.fn().mockResolvedValue({
      faithful: false,
      issues: [
        {
          kind: "narrative-erasure",
          severity: "high",
          problem:
            "Drops Zacchaeus's tree-climbing, the detail the author's whole second point is built on.",
          suggestion: "Name the tree-climbing before making the grace point.",
        },
      ],
      summary: "flattens an active-response point into pure passivity",
    })
    const r = await critiqueReflectionFidelity({
      sourceExcerpt: "source",
      focusReference: "Luke 19:1-10",
      adapted: "adapted",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.faithful).toBe(false)
    expect(r.issues[0].kind).toBe("narrative-erasure")
  })

  it("degrades to faithful=true (advisory skip) when the LLM call fails", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("request_failed", "boom"))
    const r = await critiqueReflectionFidelity({
      sourceExcerpt: "source",
      focusReference: "Luke 8:22-25",
      adapted: "adapted",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.faithful).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.summary).toMatch(/skipped/i)
  })
})
