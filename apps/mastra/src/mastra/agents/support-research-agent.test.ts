import { describe, expect, it } from "vitest"

import { supportResearchAgent } from "./support-research-agent"

describe("supportResearchAgent", () => {
  it("registers a stable, support-specific identity", () => {
    expect(supportResearchAgent.name).toBe("Support and User Research Agent")
  })
})
