import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const source = readFileSync(
  fileURLToPath(new URL("./index.ts", import.meta.url)),
  "utf8",
)

describe("title-repair registration (feat-405 U4)", () => {
  it("registers the scheduled workflow in Mastra", () => {
    // Source-text pin (support-research-registration idiom): the declarative
    // schedule only persists if the workflow is REGISTERED — an import alone,
    // or a workflows entry alone, ships a sweep that never runs.
    expect(source).toContain(
      'import { titleRepairWorkflow } from "./workflows/title-repair"',
    )
    expect(source).toMatch(/workflows:\s*\{[\s\S]*titleRepairWorkflow,/u)
  })

  it("keeps the generator mini-agent OUT of the agents registry (containment)", () => {
    // The sweep's generator must never become reachable on the
    // code-unauthenticated /api/agents/* surface: index.ts imports only the
    // workflow, never the agent builder, and no agents entry names it.
    expect(source).not.toContain("buildTitleRepairAgent")
    expect(source).not.toContain("aiChatTitleRepairGenerator")
  })
})
