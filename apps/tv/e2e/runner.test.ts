import { parseFlowFile, discoverFlows, executeStep } from "./runner"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { TVAdapter, FlowStep, DpadDirection } from "./types"

const tmpDir = join(__dirname, "__test_tmp__")

function createMockAdapter(): TVAdapter & {
  calls: Array<{ method: string; args: unknown[] }>
} {
  const calls: Array<{ method: string; args: unknown[] }> = []
  return {
    platform: "androidtv" as const,
    calls,
    async sendDpad(direction: DpadDirection) {
      calls.push({ method: "sendDpad", args: [direction] })
    },
    async captureScreenshot(outputPath: string) {
      calls.push({ method: "captureScreenshot", args: [outputPath] })
      mkdirSync(join(outputPath, ".."), { recursive: true })
      writeFileSync(outputPath, "fake-png")
    },
    async launchApp(bundleId: string) {
      calls.push({ method: "launchApp", args: [bundleId] })
    },
    async checkAvailability() {
      calls.push({ method: "checkAvailability", args: [] })
    },
  }
}

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("parseFlowFile", () => {
  it("parses a valid YAML flow", () => {
    const flowPath = join(tmpDir, "test-flow.yaml")
    writeFileSync(
      flowPath,
      `
name: Test Flow
platform: [tvos, androidtv]
steps:
  - dpad: down
  - wait: 500
  - screenshot: test-shot
  - dpad: select
`,
    )

    const flow = parseFlowFile(flowPath)
    expect(flow.name).toBe("Test Flow")
    expect(flow.platform).toEqual(["tvos", "androidtv"])
    expect(flow.steps).toHaveLength(4)
  })

  it("throws on invalid flow (missing name)", () => {
    const flowPath = join(tmpDir, "invalid-flow.yaml")
    writeFileSync(
      flowPath,
      `
platform: [tvos]
steps:
  - dpad: up
`,
    )

    expect(() => parseFlowFile(flowPath)).toThrow("missing name")
  })
})

describe("discoverFlows", () => {
  it("discovers YAML files in directory", () => {
    const flowDir = join(tmpDir, "flows")
    mkdirSync(flowDir, { recursive: true })
    writeFileSync(join(flowDir, "a.yaml"), "")
    writeFileSync(join(flowDir, "b.yml"), "")
    writeFileSync(join(flowDir, "c.txt"), "")

    const flows = discoverFlows(flowDir)
    expect(flows).toHaveLength(2)
    expect(flows[0]).toContain("a.yaml")
    expect(flows[1]).toContain("b.yml")
  })

  it("returns empty array for missing directory", () => {
    const flows = discoverFlows(join(tmpDir, "nonexistent"))
    expect(flows).toEqual([])
  })
})

describe("executeStep", () => {
  it("executes dpad step", async () => {
    const adapter = createMockAdapter()
    const step: FlowStep = { dpad: "down" }
    const result = await executeStep(adapter, step, tmpDir, "test")

    expect(result.success).toBe(true)
    expect(adapter.calls).toEqual([{ method: "sendDpad", args: ["down"] }])
  })

  it("executes wait step", async () => {
    const adapter = createMockAdapter()
    const step: FlowStep = { wait: 10 }
    const result = await executeStep(adapter, step, tmpDir, "test")

    expect(result.success).toBe(true)
    expect(adapter.calls).toHaveLength(0) // wait doesn't call adapter
  })

  it("executes screenshot step", async () => {
    const adapter = createMockAdapter()
    const step: FlowStep = { screenshot: "test-shot" }
    const result = await executeStep(adapter, step, tmpDir, "test")

    expect(result.success).toBe(true)
    expect(result.screenshotPath).toContain("test-shot.png")
    expect(adapter.calls[0]?.method).toBe("captureScreenshot")
  })

  it("executes launch step", async () => {
    const adapter = createMockAdapter()
    const step: FlowStep = { launch: "com.test.app" }
    const result = await executeStep(adapter, step, tmpDir, "test")

    expect(result.success).toBe(true)
    expect(adapter.calls).toEqual([
      { method: "launchApp", args: ["com.test.app"] },
    ])
  })

  it("handles unknown step gracefully", async () => {
    const adapter = createMockAdapter()
    const step = { unknown: "value" } as unknown as FlowStep
    const result = await executeStep(adapter, step, tmpDir, "test")

    expect(result.success).toBe(true) // warns but succeeds
  })

  it("handles adapter errors gracefully", async () => {
    const adapter = createMockAdapter()
    adapter.sendDpad = async () => {
      throw new Error("Simulator not found")
    }
    const step: FlowStep = { dpad: "up" }
    const result = await executeStep(adapter, step, tmpDir, "test")

    expect(result.success).toBe(false)
    expect(result.error).toContain("Simulator not found")
  })
})
