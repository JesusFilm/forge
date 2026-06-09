import { describe, expect, it } from "vitest"

import { getSeekerMemory } from "../memory"
import { seekerAgent } from "./seeker-agent"

describe("seeker agent", () => {
  it("registers a stable seeker agent name", () => {
    expect(seekerAgent.name).toBe("Seeker Agent")
  })

  it("carries the mandatory safety line in its instructions", async () => {
    const instructions = await seekerAgent.getInstructions()
    const text =
      typeof instructions === "string"
        ? instructions
        : JSON.stringify(instructions)
    // Scannable substrings: the safety line cannot be silently dropped.
    expect(text).toContain("non-production prototype")
    expect(text).toContain("must not invent scripture")
    // Verbatim pin: substring checks would still pass if the sentence were
    // semantically weakened while keeping both magic phrases (e.g. "...must not
    // invent scripture UNLESS the user asks"). Asserting the exact sentence
    // forces a conscious test edit — and re-approval — on ANY wording change to
    // this sensitive-audience guardrail.
    expect(text).toContain(
      "SAFETY: You are a non-production prototype exercised only in Mastra Studio. You must not invent scripture, citations, or doctrinal claims — even in Studio. If you do not have a grounded answer, say so plainly.",
    )
  })

  it("wires the retrieveAnswer stub tool", async () => {
    const tools = await seekerAgent.listTools()
    expect(Object.keys(tools)).toContain("retrieveAnswer")
  })

  it("attaches the seeker memory singleton", async () => {
    const memory = await seekerAgent.getMemory()
    expect(memory).toBe(getSeekerMemory())
  })
})
