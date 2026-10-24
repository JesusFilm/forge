import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const source = readFileSync(
  fileURLToPath(new URL("./index.ts", import.meta.url)),
  "utf8",
)

describe("support research registration", () => {
  it("registers the dedicated agent and scheduled workflow in Mastra", () => {
    expect(source).toContain(
      'import { supportResearchAgent } from "./agents/support-research-agent"',
    )
    expect(source).toContain(
      'import { dailySupportResearchWorkflow } from "./workflows/daily-support-research"',
    )
    expect(source).toMatch(/agents:\s*\{[\s\S]*supportResearchAgent,/u)
    expect(source).toMatch(
      /workflows:\s*\{[\s\S]*dailySupportResearchWorkflow,/u,
    )
  })
})
